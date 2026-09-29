import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { kurZorunlu } from "../doviz/kur-coz";
import type { KayitEylem } from "@tekirextra/shared";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { izinliEylemler, eylemIzinli } from "../core/eylemler/eylem-kayit";
import { PrismaService } from "../core/prisma.service";
import type {
  adresSemasi,
  bankaHesapSemasi,
  cariGuncelleSemasi,
  CariHareketGirdisi,
  CariOlusturGirdisi,
  etiketSemasi,
  kisiSemasi,
  crmEtkilesimSemasi,
  crmGorevSemasi,
} from "./cari.semalar";
import { yaslandir } from "./yaslandirma";
import { cariExcelOku, cariEkstreExcelYaz } from "../core/excel-yardimci";
import { PdfService } from "../core/pdf/pdf.service";
import { cariDavranisAnalizi } from "./cari-analiz";
import { gercekKisiUnvani } from "./ad-soyad";
import { ebelgeTestOrtamiMi, vknTcknKabulEdilebilirMi } from "../ebelge/vkn-kabulu";
import { belgeNoMetni, MUHTELIF_MUSTERI_KOD, MUHTELIF_MUSTERI_UNVAN, MUHTELIF_MUSTERI_VKN, muhtelifMusteriMi, vknTcknGecerliMi } from "@tekirextra/shared";
import { metinNormalize } from "@tekirextra/shared";
import { EpostaService } from "../tenant/eposta.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { iptalCiftiMi, iptalEdilmisFaturalar } from "../fatura/iptal-cifti";
import { cariEbelgeDurumlariniOku, cariEbelgeDurumuBul } from "../ebelge/cari-ebelge";
import { canliIrsaliyeKutulari, kendiGbEtiketi, postaKutusuSecimi } from "../ebelge/posta-kutusu-secimi";
import { BaglantilarService } from "../tenant/baglantilar.service";
import {
  kacis,
  paraBicim,
  sayfaSablonu,
  tarihBicim,
} from "../core/pdf/pdf-sablon";

const D = (deger: string | number): Prisma.Decimal => new Prisma.Decimal(deger);

export interface DovizBakiye {
  dovizCinsi: string;
  borc: string;
  alacak: string;
  bakiye: string;
  bakiyeTry: string;
}

@Injectable()
export class CariService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly eposta: EpostaService,
    private readonly donemKilidi: DonemKilidiService,
    private readonly baglantilar: BaglantilarService,
  ) {}

  async listele(arama?: string, imlec?: string, adet = 50, tip?: string, durum?: string, bakiye?: string) {
    const { tenantId } = aktifBaglam();
    const ctx = aktifBaglam();
    const aranan = arama ? metinNormalize(arama) : "";
    const kayitlar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findMany({
        where: {
          ...(tip === "musteri" ? { tip: { in: ["musteri", "her_ikisi"] } } : tip === "tedarikci" ? { tip: { in: ["tedarikci", "her_ikisi"] } } : {}),
          ...(durum === "bloke" ? { karaListe: true } : {}),
          ...(bakiye === "gecikmis" ? { hareketler: { some: { tip: "borc", vadeTarihi: { lt: new Date() } } } } : {}),
          // ARA-01: unvan, kod, VKN/TCKN ve telefon veritabanının ürettiği
          // `arama_normal` kolonunda toplanır; aksan ve büyük/küçük harf orada
          // katlandığı için "sisli" araması "Şişli Makina"yı da bulur.
          ...(aranan ? { aramaNormal: { contains: aranan } } : {}),
        },
        orderBy: [{ kod: "asc" }, { id: "asc" }],
        take: adet + 1,
        ...(imlec ? { cursor: { id: imlec }, skip: 1 } : {}),
        // CARI-23/EBLG-80: yurt dışı alıcı adres ülkesinden anlaşılır.
        include: { _count: { select: { hareketler: true } }, adresler: { select: { tip: true, ulke: true } } },
      }),
    );
    const sonrakiImlec = kayitlar.length > adet ? kayitlar[adet - 1].id : null;
    const sayfa = kayitlar.slice(0, adet);
    const bakiyeler = await this.bakiyeleriGetir(sayfa.map((k) => k.id));
    // CARI-23: listede kısa e-Belge etiketi; tarih yalnız kartta.
    const ebelge = sayfa.length ? await this.prisma.tenantIslem(tenantId, (tx) => cariEbelgeDurumlariniOku(tx, sayfa.map((k) => k.vknTckn))) : null;
    return {
      kayitlar: sayfa.map((k) => ({
        ...this.gorunum(k),
        ebelgeTuru: cariEbelgeDurumuBul(ebelge!, k).tur,
        bakiyeler: bakiyeler.get(k.id) ?? [],
        izinliEylemler: this.eylemler(k, ctx.rol, k._count.hareketler),
      })),
      sonrakiImlec,
    };
  }

  /**
   * EBLG-86: alıcının GİB posta kutuları ve gönderimde kullanılacak olanı.
   * Gönderim aynı işlevi kullanır; kartta görünen kutu gönderilen kutudur.
   */
  private async postaKutulari(cari: { vknTckn: string | null; efaturaPostaKutusu: string | null; eirsaliyePostaKutusu: string | null }) {
    const vkn = cari.vknTckn?.trim();
    if (!vkn) return null;
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kendiEtiketimiz = await kendiGbEtiketi(tx, tenantId);
      let eirsaliye = await postaKutusuSecimi(tx, vkn, "eirsaliye", cari.eirsaliyePostaKutusu, kendiEtiketimiz);
      // EBLG-110: çok kutulu alıcıda kart gönderimle aynı kutuyu göstersin; gönderim
      // entegratörün canlı listesinde olmayan kutuyu zaten değiştiriyor (EBLG-106).
      if (eirsaliye.adaylar.length > 1) {
        const canli = await canliIrsaliyeKutulari(tx, tenantId, (s) => this.baglantilar.adapterCoz(s), vkn);
        if (canli) eirsaliye = await postaKutusuSecimi(tx, vkn, "eirsaliye", cari.eirsaliyePostaKutusu, kendiEtiketimiz, canli);
      }
      return {
        efatura: await postaKutusuSecimi(tx, vkn, "efatura", cari.efaturaPostaKutusu, kendiEtiketimiz),
        eirsaliye,
      };
    });
  }

  /** EBLG-86: kutuyu elle seç ya da seçimi kaldır (`null` → kurala dönülür). */
  async postaKutusuSec(id: string, girdi: { belgeTuru: "efatura" | "eirsaliye"; postaKutusu: string | null }) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.findUnique({ where: { id }, select: { vknTckn: true } });
      if (!cari) throw new NotFoundException("Cari bulunamadı");
      const kutu = girdi.postaKutusu?.trim() || null;
      if (kutu) {
        const listede = cari.vknTckn && (await tx.gibMukellef.findFirst({ where: { vknTckn: cari.vknTckn.trim(), belgeTuru: girdi.belgeTuru, postaKutusu: kutu }, select: { vknTckn: true } }));
        if (!listede) throw new BadRequestException("Seçilen posta kutusu alıcının GİB listesinde yok");
        if (girdi.belgeTuru === "eirsaliye") {
          const canli = await canliIrsaliyeKutulari(tx, tenantId, (s) => this.baglantilar.adapterCoz(s), cari.vknTckn!.trim());
          if (canli?.length && !canli.includes(kutu)) {
            throw new BadRequestException("Seçilen posta kutusu entegratörün güncel listesinde yok; bu kutuya gönderilen e-İrsaliye taslakta kalır. Başka bir kutu seçin");
          }
        }
      }
      await tx.cariHesap.update({
        where: { id },
        data: girdi.belgeTuru === "efatura" ? { efaturaPostaKutusu: kutu } : { eirsaliyePostaKutusu: kutu },
      });
    });
    return this.getir(id);
  }

  async getir(id: string) {
    const ctx = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(ctx.tenantId, (tx) =>
      tx.cariHesap.findUnique({
        where: { id },
        include: {
          adresler: true,
          kisiler: true,
          bankaHesaplari: true,
          etiketler: { include: { etiket: true } },
          temsilci: { select: { id: true, adSoyad: true } },
          fiyatListesi: { select: { id: true, ad: true } },
          _count: { select: { hareketler: true } },
        },
      }),
    );
    if (!kayit) throw new NotFoundException("Cari bulunamadı");
    const bakiyeler = (await this.bakiyeleriGetir([id])).get(id) ?? [];
    const tryBakiye = bakiyeler.reduce((toplam, b) => toplam + Number(b.bakiyeTry), 0);
    const risk = await this.riskOzeti(id, tryBakiye, kayit.riskLimiti);
    // CARI-23: e-Fatura/e-Arşiv ve e-İrsaliye mükellefiyeti, GİB listesinden.
    const ebelge = await this.prisma.tenantIslem(ctx.tenantId, (tx) => cariEbelgeDurumlariniOku(tx, [kayit.vknTckn]));
    const postaKutulari = await this.postaKutulari(kayit);
    return {
      ...this.gorunum(kayit),
      ebelgeDurumu: { ...cariEbelgeDurumuBul(ebelge, kayit), listeGuncellendi: ebelge.listeGuncellendi },
      postaKutulari,
      adresler: kayit.adresler,
      kisiler: kayit.kisiler,
      bankaHesaplari: kayit.bankaHesaplari,
      etiketler: kayit.etiketler.map((a) => a.etiket),
      temsilci: kayit.temsilci,
      fiyatListesi: kayit.fiyatListesi,
      bakiyeler,
      risk,
      riskAsimi: risk.asim,
      finansalOzet: await this.finansalOzet(id),
      izinliEylemler: this.eylemler(kayit, ctx.rol, kayit._count.hareketler),
    };
  }

  /**
   * Risk özeti (CARI-17): mevcut risk = açık TRY bakiye + portföydeki/cirolu
   * çek-senet tutarı. Limit tanımlıysa kalan limit ve aşım bilgisi döner.
   */
  private async riskOzeti(
    cariId: string,
    tryBakiye: number,
    riskLimiti: Prisma.Decimal | null,
  ) {
    const { tenantId } = aktifBaglam();
    // Yalnız ALINAN çekler cari riskidir; verilen çek bizim borcumuzdur ve
    // carinin riskini artırmaz (KSB-05).
    const cekSenet = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cekSenet.aggregate({
        where: { cariId, yon: "alinan", durum: { in: ["portfoyde", "ciro_edildi"] } },
        _sum: { tutarTry: true },
      }),
    );
    const cekSenetRiski = D(cekSenet._sum.tutarTry?.toString() ?? 0);
    const mevcutRisk = D(Math.max(tryBakiye, 0)).add(cekSenetRiski);
    const limit = riskLimiti ? D(riskLimiti.toString()) : null;
    return {
      cekSenetRiski: cekSenetRiski.toFixed(2),
      mevcutRisk: mevcutRisk.toFixed(2),
      limit: limit?.toFixed(2) ?? null,
      kalanLimit: limit ? limit.sub(mevcutRisk).toFixed(2) : null,
      asim: limit !== null && mevcutRisk.greaterThan(limit),
    };
  }

  /** Hesaplanan finansal özet (CARI-18). */
  private async finansalOzet(cariId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [sonIslem, sonTahsilat, sonOdeme, hareketler] = await Promise.all([
        tx.cariHareket.findFirst({
          where: { cariId },
          orderBy: { tarih: "desc" },
          select: { tarih: true },
        }),
        tx.kasaBankaHareket.findFirst({
          where: { cariId, tip: "tahsilat" },
          orderBy: { tarih: "desc" },
          select: { tarih: true },
        }),
        tx.kasaBankaHareket.findFirst({
          where: { cariId, tip: "tediye" },
          orderBy: { tarih: "desc" },
          select: { tarih: true },
        }),
        tx.cariHareket.findMany({
          where: { cariId },
          select: { tip: true, tutarTry: true, vadeTarihi: true, tarih: true },
        }),
      ]);
      const y = yaslandir(
        hareketler.map((h) => ({
          tip: h.tip,
          tutarTry: Number(h.tutarTry),
          vadeTarihi: h.vadeTarihi,
          tarih: h.tarih,
        })),
        new Date(),
      );
      const gun = (t?: Date | null): string | null =>
        t ? t.toISOString().slice(0, 10) : null;
      return {
        sonIslemTarihi: gun(sonIslem?.tarih),
        sonTahsilatTarihi: gun(sonTahsilat?.tarih),
        sonOdemeTarihi: gun(sonOdeme?.tarih),
        vadesiGecmisBakiye: (y.toplam - y.guncel).toFixed(2),
      };
    });
  }

  /**
   * CARI-21: gerçek kişide ad ve soyad zorunludur ve unvan bunlardan türer,
   * böylece listeler/PDF'teki unvan ile e-Belge'ye giden ad ayrışmaz. Tüzel
   * kişide ad/soyad tutulmaz.
   */
  private kisiKimligi(kisiTipi: string, ad?: string | null, soyad?: string | null) {
    if (kisiTipi !== "gercek") return { ad: null, soyad: null };
    if (!ad?.trim() || !soyad?.trim()) throw new BadRequestException("Gerçek kişi carisinde ad ve soyad zorunludur");
    return { ad: ad.trim(), soyad: soyad.trim(), unvan: gercekKisiUnvani(ad, soyad) };
  }

  /**
   * Kontrol hanesi tutmayan kimliği yalnız e-belge test bağlantısı olan kiracıda
   * kabul eder (EBLG-47): o ortamın sentetik kimliklerine fatura kesebiliyorsak
   * onları cari olarak da kaydedebilmeliyiz. Bağlantı sorgusu yalnız kontrol
   * hanesi tutmadığında yapılır, normal kayıt fazladan sorgu görmez.
   */
  private async vknTcknDogrula(tenantId: string, vknTckn: string | null | undefined): Promise<void> {
    if (!vknTckn || vknTcknGecerliMi(vknTckn)) return;
    const testOrtami = await this.prisma.tenantIslem(tenantId, (tx) => ebelgeTestOrtamiMi(tx, tenantId));
    if (!vknTcknKabulEdilebilirMi(vknTckn, testOrtami)) {
      throw new BadRequestException("Geçersiz VKN/TCKN (kontrol hanesi tutmuyor)");
    }
  }

  /**
   * EBLG-95: "Muhtelif Müşteriler" sistem carisi. İlk ihtiyaçta açılır, kiracıda
   * tektir. Adresi firmanın adresinden kopyalanır: muhtelif irsaliyenin alıcı
   * ve teslimat adresi, irsaliyeye ayrıca adres girilmediyse firmanın adresidir.
   */
  async muhtelifMusteriCarisi() {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.cariHesap.findFirst({ where: { vknTckn: MUHTELIF_MUSTERI_VKN }, orderBy: { createdAt: "asc" } });
      if (mevcut) return mevcut.aktif ? mevcut : tx.cariHesap.update({ where: { id: mevcut.id }, data: { aktif: true } });
      const firma = await tx.tenant.findUnique({ where: { id: tenantId }, select: { adres: true, il: true, ilce: true, postaKodu: true } });
      const kodVar = await tx.cariHesap.findFirst({ where: { kod: MUHTELIF_MUSTERI_KOD }, select: { id: true } });
      return tx.cariHesap.create({
        data: {
          tenantId,
          kod: kodVar ? `${MUHTELIF_MUSTERI_KOD}-GIB` : MUHTELIF_MUSTERI_KOD,
          unvan: MUHTELIF_MUSTERI_UNVAN,
          tip: "musteri",
          vknTckn: MUHTELIF_MUSTERI_VKN,
          notlar: "Sistem carisi (EBLG-95): müşterisi sevkiyat başında belli olmayan dağıtım irsaliyeleri içindir. Teslim edilen her müşteriye ayrıca fatura ya da irsaliye kesilir.",
          ...(firma?.adres ? { adresler: { create: [{ tenantId, tip: "merkez", baslik: "Firma adresi", adres: firma.adres, il: firma.il, ilce: firma.ilce, postaKodu: firma.postaKodu }] } } : {}),
        },
      });
    });
    return this.gorunum(kayit);
  }

  /** EBLG-95: muhtelif müşteri kimliği yalnız sistem carisinde bulunur. */
  private muhtelifKimligiEngelle(vknTckn: string | null | undefined) {
    if (muhtelifMusteriMi({ vknTckn })) {
      throw new BadRequestException(`${MUHTELIF_MUSTERI_VKN} GİB'in "Muhtelif Müşteriler" kimliğidir; bu cari sistemde tektir, irsaliyede "Muhtelif müşteriler" seçeneğiyle açılır`);
    }
  }

  async olustur(girdi: CariOlusturGirdisi) {
    const { tenantId } = aktifBaglam();
    this.muhtelifKimligiEngelle(girdi.vknTckn);
    const kimlik = this.kisiKimligi(girdi.kisiTipi, girdi.ad, girdi.soyad);
    await this.vknTcknDogrula(tenantId, girdi.vknTckn);
    try {
      const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.create({
          data: {
            tenantId,
            ...girdi,
            ...kimlik,
            kvkkOnayTarihi: girdi.kvkkOnayTarihi
              ? new Date(girdi.kvkkOnayTarihi)
              : undefined,
            varsayilanIskonto: girdi.varsayilanIskonto
              ? D(girdi.varsayilanIskonto)
              : undefined,
            riskLimiti: girdi.riskLimiti ? D(girdi.riskLimiti) : undefined,
          },
        }),
      );
      return this.gorunum(kayit);
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.kod}' kodu zaten kullanımda`);
      }
      throw hata;
    }
  }

  async kopyala(id: string) {
    const { tenantId } = aktifBaglam();
    if (muhtelifMusteriMi(await this.getir(id))) throw new BadRequestException("Muhtelif Müşteriler sistem carisi kopyalanamaz");
    const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findUnique({
        where: { id },
        include: {
          adresler: true,
          kisiler: true,
          bankaHesaplari: true,
          etiketler: true,
        },
      }),
    );

    if (!cari) throw new NotFoundException("Cari bulunamadı");

    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.count({ where: { cariId: id } }),
    );
    const ctx = aktifBaglam();
    if (!eylemIzinli("cari", "kopyala", { aktif: cari.aktif, hareketSayisi }, ctx)) {
      throw new ForbiddenException("Bu cari kopyalanamaz veya bu işlem için yetkiniz yok");
    }

    let yeniKod = `${cari.kod}-KOPYA`;
    let sayac = 1;
    while (true) {
      const varMi = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariHesap.findUnique({ where: { tenantId_kod: { tenantId, kod: yeniKod } } }),
      );
      if (!varMi) break;
      yeniKod = `${cari.kod}-KOPYA-${sayac}`;
      sayac++;
    }

    const kopyaCari = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kopya = await tx.cariHesap.create({
        data: {
          tenantId,
          kod: yeniKod,
          unvan: `${cari.unvan} (Kopya)`,
          kisaAd: cari.kisaAd ? `${cari.kisaAd} (Kopya)` : null,
          tip: cari.tip,
          kisiTipi: cari.kisiTipi,
          ad: cari.ad,
          soyad: cari.soyad,
          sektor: cari.sektor,
          temsilciUserId: cari.temsilciUserId,
          vknTckn: cari.vknTckn,
          vergiDairesi: cari.vergiDairesi,
          mersisNo: cari.mersisNo,
          ticaretSicilNo: cari.ticaretSicilNo,
          kvkkOnayTarihi: cari.kvkkOnayTarihi,
          eposta: cari.eposta,
          telefon: cari.telefon,
          webSitesi: cari.webSitesi,
          faks: cari.faks,
          iban: cari.iban,
          karaListe: false,
          karaListeNotu: null,
          dovizCinsi: cari.dovizCinsi,
          fiyatListesiId: cari.fiyatListesiId,
          varsayilanIskonto: cari.varsayilanIskonto,
          varsayilanVadeGun: cari.varsayilanVadeGun,
          efaturaProfili: cari.efaturaProfili,
          earsivGonderimSekli: cari.earsivGonderimSekli,
          riskLimiti: cari.riskLimiti,
          eFaturaMukellefi: cari.eFaturaMukellefi,
          mukellefiyetSorguZamani: cari.mukellefiyetSorguZamani,
          notlar: cari.notlar,
          aktif: true,
        },
      });

      for (const a of cari.adresler) {
        await tx.cariAdres.create({
          data: {
            tenantId,
            cariId: kopya.id,
            tip: a.tip,
            baslik: a.baslik,
            adres: a.adres,
            il: a.il,
            ilce: a.ilce,
            postaKodu: a.postaKodu,
            ulke: a.ulke,
          },
        });
      }

      for (const k of cari.kisiler) {
        await tx.cariKisi.create({
          data: {
            tenantId,
            cariId: kopya.id,
            adSoyad: k.adSoyad,
            gorev: k.gorev,
            telefon: k.telefon,
            eposta: k.eposta,
          },
        });
      }

      for (const b of cari.bankaHesaplari) {
        await tx.cariBankaHesap.create({
          data: {
            tenantId,
            cariId: kopya.id,
            bankaAdi: b.bankaAdi,
            subeAdi: b.subeAdi,
            hesapSahibi: b.hesapSahibi,
            iban: b.iban,
            swift: b.swift,
            paraBirimi: b.paraBirimi,
          },
        });
      }

      for (const e of cari.etiketler) {
        await tx.cariEtiketAtama.create({
          data: {
            tenantId,
            cariId: kopya.id,
            etiketId: e.etiketId,
          },
        });
      }

      return kopya;
    });

    return this.getir(kopyaCari.id);
  }

  async guncelle(id: string, girdi: z.infer<typeof cariGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    const mevcut = await this.getir(id);
    // EBLG-95: sistem carisinin kimliği sabittir; adres, iletişim gibi alanları değişebilir.
    if (muhtelifMusteriMi(mevcut)) {
      const kimlikAlani = (["unvan", "ad", "soyad", "kisiTipi", "vknTckn", "tip"] as const).find((alan) => girdi[alan] !== undefined && girdi[alan] !== mevcut[alan]);
      if (kimlikAlani) throw new BadRequestException("Muhtelif Müşteriler sistem carisinin unvanı, türü ve kimliği değiştirilemez");
    } else {
      this.muhtelifKimligiEngelle(girdi.vknTckn);
    }
    await this.vknTcknDogrula(tenantId, muhtelifMusteriMi(mevcut) ? undefined : girdi.vknTckn);
    // Kimlik kuralı yalnız kimlik alanlarından biri değişirken uygulanır; başka
    // alanı güncelleyen istek, ad/soyadı henüz girilmemiş eski kayıtta kırılmasın.
    const kimlikDegisiyor = girdi.unvan !== undefined || girdi.ad !== undefined || girdi.soyad !== undefined || girdi.kisiTipi !== undefined;
    const kimlik = kimlikDegisiyor
      ? this.kisiKimligi(
          girdi.kisiTipi ?? mevcut.kisiTipi,
          girdi.ad !== undefined ? girdi.ad : mevcut.ad,
          girdi.soyad !== undefined ? girdi.soyad : mevcut.soyad,
        )
      : {};
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.update({
        where: { id },
        data: {
          ...girdi,
          ...kimlik,
          kvkkOnayTarihi: girdi.kvkkOnayTarihi
            ? new Date(girdi.kvkkOnayTarihi)
            : undefined,
          varsayilanIskonto: girdi.varsayilanIskonto
            ? D(girdi.varsayilanIskonto)
            : undefined,
          riskLimiti: girdi.riskLimiti ? D(girdi.riskLimiti) : undefined,
        },
      }),
    );
    return this.gorunum(kayit);
  }

  /** AYR-05: hareketi olan cari silinemez — pasife alınır. */
  async sil(id: string) {
    const { tenantId } = aktifBaglam();
    if (muhtelifMusteriMi(await this.getir(id))) throw new BadRequestException("Muhtelif Müşteriler sistem carisi silinemez");
    const hareketSayisi = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.count({ where: { cariId: id } }),
    );
    if (hareketSayisi > 0) {
      throw new BadRequestException(
        "Hareketi olan cari silinemez; pasife alın (PATCH aktif=false)",
      );
    }
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.delete({ where: { id } }),
    );
  }

  async adresEkle(cariId: string, girdi: z.infer<typeof adresSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariAdres.create({ data: { tenantId, cariId, ...girdi } }),
    );
  }

  async adresGuncelle(cariId: string, adresId: string, girdi: z.infer<typeof adresSemasi>) {
    const { tenantId } = aktifBaglam();
    const adres = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariAdres.findFirst({ where: { id: adresId, cariId } }));
    if (!adres) throw new NotFoundException("Adres bulunamadı");
    return this.prisma.tenantIslem(tenantId, (tx) => tx.cariAdres.update({ where: { id: adresId }, data: girdi }));
  }

  async adresSil(cariId: string, adresId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariAdres.deleteMany({ where: { id: adresId, cariId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Adres bulunamadı");
  }

  async kisiEkle(cariId: string, girdi: z.infer<typeof kisiSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariKisi.create({ data: { tenantId, cariId, ...girdi } }),
    );
  }

  async kisiSil(cariId: string, kisiId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariKisi.deleteMany({ where: { id: kisiId, cariId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("İlgili kişi bulunamadı");
  }

  // ─── BANKA HESAPLARI (CARI-16) ─────────────────────────────────────────

  async bankaHesapEkle(cariId: string, girdi: z.infer<typeof bankaHesapSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.varlikKontrol(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariBankaHesap.create({ data: { tenantId, cariId, ...girdi } }),
    );
  }

  async bankaHesapSil(cariId: string, hesapId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariBankaHesap.deleteMany({ where: { id: hesapId, cariId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Banka hesabı bulunamadı");
  }

  // ─── ETİKETLER (CARI-11) ───────────────────────────────────────────────

  async etiketleriListele() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariEtiket.findMany({
        orderBy: { ad: "asc" },
        include: { _count: { select: { atamalar: true } } },
      }),
    );
  }

  async etiketOlustur(girdi: z.infer<typeof etiketSemasi>) {
    const { tenantId } = aktifBaglam();
    try {
      return await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.cariEtiket.create({ data: { tenantId, ...girdi } }),
      );
    } catch (hata) {
      if (
        hata instanceof Prisma.PrismaClientKnownRequestError &&
        hata.code === "P2002"
      ) {
        throw new ConflictException(`'${girdi.ad}' etiketi zaten var`);
      }
      throw hata;
    }
  }

  async etiketSil(etiketId: string) {
    const { tenantId } = aktifBaglam();
    const silinen = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariEtiket.deleteMany({ where: { id: etiketId } }),
    );
    if (silinen.count === 0) throw new NotFoundException("Etiket bulunamadı");
  }

  async etiketAta(cariId: string, etiketId: string) {
    const { tenantId } = aktifBaglam();
    await this.varlikKontrol(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariEtiketAtama.upsert({
        where: { tenantId_cariId_etiketId: { tenantId, cariId, etiketId } },
        create: { tenantId, cariId, etiketId },
        update: {},
      }),
    );
  }

  async etiketKaldir(cariId: string, etiketId: string) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariEtiketAtama.deleteMany({ where: { cariId, etiketId } }),
    );
  }

  /** Detay görünümü hesaplamadan yalnız kayıt varlığını doğrular. */
  private async varlikKontrol(cariId: string) {
    const { tenantId } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findUnique({ where: { id: cariId }, select: { id: true } }),
    );
    if (!kayit) throw new NotFoundException("Cari bulunamadı");
  }

  async crmGetir(cariId: string) {
    const { tenantId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [etkilesimler, gorevler, teklifler, kullanicilar] = await Promise.all([
        tx.crmEtkilesim.findMany({ where: { cariId }, orderBy: { tarih: "desc" }, include: { user: { select: { id: true, adSoyad: true } } } }),
        tx.crmGorev.findMany({ where: { cariId }, orderBy: [{ durum: "asc" }, { sonTarih: "asc" }, { createdAt: "desc" }], include: { atanan: { select: { id: true, adSoyad: true } } } }),
        tx.belge.findMany({ where: { cariId, tur: "teklif" }, orderBy: { tarih: "desc" }, select: { id: true, no: true, revizyonNo: true, tarih: true, gecerlilikTarihi: true, durum: true, genelToplam: true, dovizCinsi: true } }),
        tx.user.findMany({ where: { aktif: true }, orderBy: { adSoyad: "asc" }, select: { id: true, adSoyad: true, rol: true } }),
      ]);
      // FTR-34: teklif sürümleri "Rev.N" ekiyle görünür.
      return { etkilesimler, gorevler, teklifler: teklifler.map((t) => ({ ...t, no: t.no ? belgeNoMetni(t.no, t.revizyonNo) : null })), kullanicilar };
    });
  }

  async davranisAnalizi(cariId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const cari = await tx.cariHesap.findUnique({
        where: { id: cariId },
        select: {
          riskLimiti: true,
          hareketler: {
            select: { tip: true, tutarTry: true, tarih: true, vadeTarihi: true },
            orderBy: { tarih: "asc" },
          },
        },
      });
      if (!cari) throw new NotFoundException("Cari bulunamadı");
      return cariDavranisAnalizi(
        cari.hareketler.map((h) => ({ ...h, tutarTry: Number(h.tutarTry) })),
        cari.riskLimiti === null ? null : Number(cari.riskLimiti),
      );
    });
  }

  async crmEtkilesimEkle(cariId: string, girdi: z.infer<typeof crmEtkilesimSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, (tx) => tx.crmEtkilesim.create({ data: { tenantId, cariId, userId, tip: girdi.tip, konu: girdi.konu, aciklama: girdi.aciklama, tarih: new Date(girdi.tarih) } }));
  }

  async crmGorevEkle(cariId: string, girdi: z.infer<typeof crmGorevSemasi>) {
    const { tenantId, userId } = aktifBaglam();
    await this.getir(cariId);
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const atananUserId = girdi.atananUserId ?? userId;
      const kullanici = await tx.user.findFirst({ where: { id: atananUserId, aktif: true } });
      if (!kullanici) throw new BadRequestException("Atanacak aktif kullanıcı bulunamadı");
      if (girdi.hatirlatmaTarihi && girdi.sonTarih && new Date(girdi.hatirlatmaTarihi) > new Date(girdi.sonTarih)) throw new BadRequestException("Hatırlatma tarihi son tarihten sonra olamaz");
      return tx.crmGorev.create({ data: { tenantId, cariId, atananUserId, baslik: girdi.baslik, aciklama: girdi.aciklama, sonTarih: girdi.sonTarih ? new Date(girdi.sonTarih) : null, hatirlatmaTarihi: girdi.hatirlatmaTarihi ? new Date(girdi.hatirlatmaTarihi) : null, oncelik: girdi.oncelik } });
    });
  }

  async crmGorevDurum(cariId: string, gorevId: string, durum: "acik" | "tamamlandi" | "iptal") {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const gorev = await tx.crmGorev.findFirst({ where: { id: gorevId, cariId } });
      if (!gorev) throw new NotFoundException("CRM görevi bulunamadı");
      return tx.crmGorev.update({ where: { id: gorevId }, data: { durum, tamamlanmaZamani: durum === "tamamlandi" ? new Date() : null } });
    });
  }

  async hareketEkle(cariId: string, girdi: CariHareketGirdisi) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "cari hareketi oluşturma");
    await this.getir(cariId);
    const tutar = D(girdi.tutar);
    const kur = D(girdi.kur);
    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.create({
        data: {
          tenantId,
          cariId,
          tip: girdi.tip,
          tutar,
          dovizCinsi: girdi.dovizCinsi,
          kur,
          tutarTry: tutar.mul(kur).toDecimalPlaces(2),
          tarih: new Date(girdi.tarih),
          vadeTarihi: girdi.vadeTarihi ? new Date(girdi.vadeTarihi) : undefined,
          aciklama: girdi.aciklama,
        },
      }),
    );
  }

  /** Ekstre (CARI-04): tarih aralığı + yürüyen bakiye (TRY). */
  async ekstre(cariId: string, baslangic?: string, bitis?: string, iptalleriGosterilsin = false) {
    const { tenantId } = aktifBaglam();
    const cari = await this.getir(cariId);
    const bitisTarihi = bitis ? new Date(`${bitis}T23:59:59.999`) : undefined;
    const baslangicTarihi = baslangic ? new Date(`${baslangic}T00:00:00.000`) : undefined;
    const [tumHareketler, tumOncekiHareketler] = await this.prisma.tenantIslem(tenantId, (tx) => Promise.all([
      tx.cariHareket.findMany({
        where: {
          cariId,
          tarih: {
            ...(baslangicTarihi ? { gte: baslangicTarihi } : {}),
            ...(bitisTarihi ? { lte: bitisTarihi } : {}),
          },
        },
        orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
      }),
      baslangicTarihi ? tx.cariHareket.findMany({ where: { cariId, tarih: { lt: baslangicTarihi } }, select: { tip: true, tutarTry: true, dovizCinsi: true, tutar: true, kaynakTur: true, kaynakRef: true } }) : Promise.resolve([]),
    ]));
    // CARI-22: iptal edilmiş faturanın hareketi ile ters hareketi birbirini
    // sıfırlar ve varsayılan olarak gösterilmez. Devirden de düşülür; yoksa
    // tarih aralığı iptali ikiye böldüğünde (satış önce, iptal aralıkta) devir
    // ile dönem sonu arasında gizlenen satır kadar fark kalırdı.
    const iptaller = await this.prisma.tenantIslem(tenantId, (tx) => iptalEdilmisFaturalar(tx, [...tumHareketler, ...tumOncekiHareketler]));
    const gorunur = <T extends { kaynakTur: string; kaynakRef: string | null }>(liste: T[]) =>
      iptalleriGosterilsin ? liste : liste.filter((h) => !iptalCiftiMi(h, iptaller));
    const hareketler = gorunur(tumHareketler);
    const oncekiHareketler = gorunur(tumOncekiHareketler);
    const krediKartiKaynaklari = hareketler.filter((h) => h.kaynakTur === "kredi_karti" && h.kaynakRef).map((h) => h.kaynakRef!);
    const krediKartiHareketleri = krediKartiKaynaklari.length ? await this.prisma.tenantIslem(tenantId, (tx) => tx.krediKartiHareket.findMany({
      where: { tenantId, id: { in: krediKartiKaynaklari } },
      include: { krediKarti: { select: { ad: true, bankaAdi: true, sonDortHane: true } }, fatura: { select: { id: true, no: true } } },
    })) : [];
    const krediKartiHaritasi = new Map(krediKartiHareketleri.map((h) => [h.id, h]));
    const posKaynaklari = hareketler.filter((h) => h.kaynakTur === "pos_tahsilat" && h.kaynakRef).map((h) => h.kaynakRef!);
    const posTahsilatlari = posKaynaklari.length ? await this.prisma.tenantIslem(tenantId, (tx) => tx.posTahsilat.findMany({
      where: { id: { in: posKaynaklari }, durum: "odendi", hareketId: { not: null } },
      select: { id: true, makbuzAnahtari: true },
    })) : [];
    const posMakbuzHaritasi = new Map(posTahsilatlari.map((p) => [p.id, `/pos/makbuz/${tenantId}/${p.id}/${p.makbuzAnahtari}`]));
    const devirBakiyesi = oncekiHareketler.reduce((toplam, h) => h.tip === "borc" ? toplam.add(h.tutarTry) : toplam.sub(h.tutarTry), new Prisma.Decimal(0));
    let bakiye = devirBakiyesi;
    let donemBorc = new Prisma.Decimal(0); let donemAlacak = new Prisma.Decimal(0);
    const dovizOzetleri = new Map<string, { devir: Prisma.Decimal; borc: Prisma.Decimal; alacak: Prisma.Decimal }>();
    for (const h of oncekiHareketler) {
      const ozet = dovizOzetleri.get(h.dovizCinsi) ?? { devir: new Prisma.Decimal(0), borc: new Prisma.Decimal(0), alacak: new Prisma.Decimal(0) };
      ozet.devir = ozet.devir.add(h.tip === "borc" ? h.tutar : h.tutar.neg());
      dovizOzetleri.set(h.dovizCinsi, ozet);
    }
    const satirlar = hareketler.map((h) => {
      if (h.tip === "borc") donemBorc = donemBorc.add(h.tutarTry); else donemAlacak = donemAlacak.add(h.tutarTry);
      const ozet = dovizOzetleri.get(h.dovizCinsi) ?? { devir: new Prisma.Decimal(0), borc: new Prisma.Decimal(0), alacak: new Prisma.Decimal(0) };
      if (h.tip === "borc") ozet.borc = ozet.borc.add(h.tutar); else ozet.alacak = ozet.alacak.add(h.tutar);
      dovizOzetleri.set(h.dovizCinsi, ozet);
      bakiye =
        h.tip === "borc" ? bakiye.add(h.tutarTry) : bakiye.sub(h.tutarTry);
      const kartHareketi = h.kaynakTur === "kredi_karti" && h.kaynakRef ? krediKartiHaritasi.get(h.kaynakRef) : undefined;
      return {
        tarih: h.tarih.toISOString().slice(0, 10),
        vadeTarihi: h.vadeTarihi?.toISOString().slice(0, 10) ?? null,
        tip: h.tip,
        aciklama: h.aciklama,
        kaynakTur: h.kaynakTur,
        iptal: iptalCiftiMi(h, iptaller),
        makbuzYolu: h.kaynakTur === "pos_tahsilat" && h.kaynakRef ? posMakbuzHaritasi.get(h.kaynakRef) ?? null : null,
        odemeYontemi: kartHareketi ? {
          tur: "kredi_karti",
          kartAdi: kartHareketi.krediKarti.ad,
          bankaAdi: kartHareketi.krediKarti.bankaAdi,
          sonDortHane: kartHareketi.krediKarti.sonDortHane,
          taksitSayisi: kartHareketi.taksitSayisi,
          komisyonTutari: kartHareketi.komisyonTutari.toFixed(2),
          karttanCekilenToplam: kartHareketi.tutar.toFixed(2),
          fatura: kartHareketi.fatura,
        } : null,
        dovizCinsi: h.dovizCinsi,
        tutar: h.tutar.toFixed(2),
        kur: h.kur.toFixed(4),
        tutarTry: h.tutarTry.toFixed(2),
        yuruyenBakiye: bakiye.toFixed(2),
      };
    });
    const dovizOzet = [...dovizOzetleri.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dovizCinsi, ozet]) => ({
      dovizCinsi,
      devir: ozet.devir.toFixed(2),
      borc: ozet.borc.toFixed(2),
      alacak: ozet.alacak.toFixed(2),
      bakiye: ozet.devir.add(ozet.borc).sub(ozet.alacak).toFixed(2),
    }));
    return { cari: { id: cari.id, kod: cari.kod, unvan: cari.unvan, eposta: cari.eposta }, devirBakiyesi: devirBakiyesi.toFixed(2), donemBorc: donemBorc.toFixed(2), donemAlacak: donemAlacak.toFixed(2), donemSonuBakiyesi: bakiye.toFixed(2), dovizOzet, satirlar };
  }

  // Yaşlandırma raporu RPR-06 araç setine taşındı: cari.yaslandirma (CARI-12).

  private async bakiyeleriGetir(
    cariIdler: string[],
  ): Promise<Map<string, DovizBakiye[]>> {
    if (cariIdler.length === 0) return new Map();
    const { tenantId } = aktifBaglam();
    const gruplar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHareket.groupBy({
        by: ["cariId", "dovizCinsi", "tip"],
        where: { cariId: { in: cariIdler } },
        _sum: { tutar: true, tutarTry: true },
      }),
    );
    const sonuc = new Map<string, Map<string, { borc: Prisma.Decimal; alacak: Prisma.Decimal; borcTry: Prisma.Decimal; alacakTry: Prisma.Decimal }>>();
    for (const g of gruplar) {
      const cariMap = sonuc.get(g.cariId) ?? new Map();
      const kayit = cariMap.get(g.dovizCinsi) ?? {
        borc: new Prisma.Decimal(0),
        alacak: new Prisma.Decimal(0),
        borcTry: new Prisma.Decimal(0),
        alacakTry: new Prisma.Decimal(0),
      };
      if (g.tip === "borc") { kayit.borc = kayit.borc.add(g._sum.tutar ?? 0); kayit.borcTry = kayit.borcTry.add(g._sum.tutarTry ?? 0); }
      else { kayit.alacak = kayit.alacak.add(g._sum.tutar ?? 0); kayit.alacakTry = kayit.alacakTry.add(g._sum.tutarTry ?? 0); }
      cariMap.set(g.dovizCinsi, kayit);
      sonuc.set(g.cariId, cariMap);
    }
    const donus = new Map<string, DovizBakiye[]>();
    for (const [cariId, dovizler] of sonuc) {
      donus.set(
        cariId,
        [...dovizler.entries()].map(([doviz, t]) => ({
          dovizCinsi: doviz,
          borc: t.borc.toFixed(2),
          alacak: t.alacak.toFixed(2),
          bakiye: t.borc.sub(t.alacak).toFixed(2),
          bakiyeTry: t.borcTry.sub(t.alacakTry).toFixed(2),
        })),
      );
    }
    return donus;
  }

  private eylemler(
    kayit: { aktif: boolean },
    _rol: string,
    hareketSayisi: number,
  ): KayitEylem[] {
    return izinliEylemler(
      "cari",
      { aktif: kayit.aktif, hareketSayisi },
      aktifBaglam(),
    );
  }

  private gorunum(k: {
    id: string;
    kod: string;
    unvan: string;
    kisaAd: string | null;
    tip: string;
    kisiTipi: string;
    ad: string | null;
    soyad: string | null;
    sektor: string | null;
    temsilciUserId: string | null;
    vknTckn: string | null;
    vergiDairesi: string | null;
    mersisNo: string | null;
    ticaretSicilNo: string | null;
    kvkkOnayTarihi: Date | null;
    eposta: string | null;
    telefon: string | null;
    webSitesi: string | null;
    faks: string | null;
    iban: string | null;
    karaListe: boolean;
    karaListeNotu: string | null;
    dovizCinsi: string;
    fiyatListesiId: string | null;
    varsayilanIskonto: Prisma.Decimal | null;
    varsayilanVadeGun: number | null;
    efaturaProfili: string;
    earsivGonderimSekli: string;
    riskLimiti: Prisma.Decimal | null;
    eFaturaMukellefi: boolean | null;
    kamuIdaresi: boolean;
    harcamaBirimiVkn: string | null;
    harcamaBirimiAdi: string | null;
    notlar: string | null;
    aktif: boolean;
  }) {
    return {
      id: k.id,
      kod: k.kod,
      unvan: k.unvan,
      kisaAd: k.kisaAd,
      tip: k.tip,
      kisiTipi: k.kisiTipi,
      ad: k.ad,
      soyad: k.soyad,
      sektor: k.sektor,
      temsilciUserId: k.temsilciUserId,
      vknTckn: k.vknTckn,
      vergiDairesi: k.vergiDairesi,
      mersisNo: k.mersisNo,
      ticaretSicilNo: k.ticaretSicilNo,
      kvkkOnayTarihi: k.kvkkOnayTarihi?.toISOString().slice(0, 10) ?? null,
      eposta: k.eposta,
      telefon: k.telefon,
      webSitesi: k.webSitesi,
      faks: k.faks,
      iban: k.iban,
      karaListe: k.karaListe,
      karaListeNotu: k.karaListeNotu,
      dovizCinsi: k.dovizCinsi,
      fiyatListesiId: k.fiyatListesiId,
      varsayilanIskonto: k.varsayilanIskonto?.toFixed(2) ?? null,
      varsayilanVadeGun: k.varsayilanVadeGun,
      efaturaProfili: k.efaturaProfili,
      earsivGonderimSekli: k.earsivGonderimSekli,
      // KAMU senaryosu (sihirbazda harcama biriminin varsayılanı).
      kamuIdaresi: k.kamuIdaresi,
      harcamaBirimiVkn: k.harcamaBirimiVkn,
      harcamaBirimiAdi: k.harcamaBirimiAdi,
      riskLimiti: k.riskLimiti?.toFixed(2) ?? null,
      eFaturaMukellefi: k.eFaturaMukellefi,
      notlar: k.notlar,
      aktif: k.aktif,
    };
  }

  async excelImport(buffer: Buffer): Promise<{ eklenen: number }> {
    const { tenantId } = aktifBaglam();
    const cariler = await cariExcelOku(buffer);

    await this.prisma.tenantIslem(tenantId, async (tx) => {
      for (const c of cariler) {
        await tx.cariHesap.upsert({
          where: { tenantId_kod: { tenantId, kod: c.kod } },
          create: {
            tenantId,
            kod: c.kod,
            unvan: c.unvan,
            tip: c.tip,
            vknTckn: c.vknTckn,
            eposta: c.eposta,
            telefon: c.telefon,
          },
          update: {
            unvan: c.unvan,
            tip: c.tip,
            vknTckn: c.vknTckn,
            eposta: c.eposta,
            telefon: c.telefon,
          },
        });
      }
    });

    return { eklenen: cariler.length };
  }

  async ekstreExcel(cariId: string, baslangic?: string, bitis?: string, iptalleriGosterilsin = false): Promise<Buffer> {
    const data = await this.ekstre(cariId, baslangic, bitis, iptalleriGosterilsin);
    const hareketSatirlari = data.satirlar.map((s) => ({
      tarih: new Date(s.tarih),
      aciklama: `${s.aciklama || ""}${s.iptal ? " (iptal)" : ""}`,
      borc: s.tip === "borc" ? s.tutarTry : "",
      alacak: s.tip === "alacak" ? s.tutarTry : "",
      bakiye: s.yuruyenBakiye,
    }));
    const mapped = baslangic
      ? [{ tarih: new Date(baslangic), aciklama: "DEVİR BAKİYESİ", borc: Number(data.devirBakiyesi) > 0 ? data.devirBakiyesi : "", alacak: Number(data.devirBakiyesi) < 0 ? String(Math.abs(Number(data.devirBakiyesi))) : "", bakiye: data.devirBakiyesi }, ...hareketSatirlari]
      : hareketSatirlari;

    return cariEkstreExcelYaz(data.cari, mapped);
  }

  /** Ekstre PDF çıktısı (CARI-04, T-02 altyapısıyla). */
  async ekstrePdf(
    cariId: string,
    baslangic?: string,
    bitis?: string,
    iptalleriGosterilsin = false,
  ): Promise<Buffer> {
    const data = await this.ekstre(cariId, baslangic, bitis, iptalleriGosterilsin);
    const aralik =
      baslangic || bitis
        ? ` — dönem: ${baslangic ? tarihBicim(baslangic) : "…"} – ${bitis ? tarihBicim(bitis) : "…"}`
        : "";
    const devirSatiri = baslangic ? `<tr><td class="orta">${tarihBicim(baslangic)}</td><td><b>DEVİR BAKİYESİ</b></td><td></td><td></td><td class="sag"><b>${paraBicim(data.devirBakiyesi)}</b></td></tr>` : "";
    const satirlar = devirSatiri + data.satirlar
      .map(
        (s) => `<tr>
  <td class="orta">${tarihBicim(s.tarih)}</td>
  <td>${kacis(`${s.aciklama ?? ""}${s.iptal ? " (iptal)" : ""}`)}</td>
  <td class="sag">${s.tip === "borc" ? paraBicim(s.tutarTry) : ""}</td>
  <td class="sag">${s.tip === "alacak" ? paraBicim(s.tutarTry) : ""}</td>
  <td class="sag">${paraBicim(s.yuruyenBakiye)}</td>
</tr>`,
      )
      .join("\n");
    const sonBakiye = data.donemSonuBakiyesi;
    const icerik = `<table class="veri">
  <thead><tr>
    <th>Tarih</th><th>Açıklama</th>
    <th class="sag">Borç</th><th class="sag">Alacak</th><th class="sag">Bakiye</th>
  </tr></thead>
  <tbody>${
    satirlar ||
    `<tr><td class="orta" colspan="5">Dönemde hareket bulunamadı</td></tr>`
  }</tbody>
</table>
<p style="margin-top:10px;text-align:right;font-weight:bold">
  Dönem sonu bakiyesi: ${paraBicim(sonBakiye)} TL
</p>`;
    const tema = await this.pdf.belgeTemasi();
    return this.pdf.htmlToPdf(
      sayfaSablonu({
        baslik: "CARİ HESAP EKSTRESİ",
        altBaslik: `${data.cari.kod} — ${data.cari.unvan}${aralik}`,
        icerik,
        tema,
      }),
    );
  }

  async ekstreEpostaGonder(cariId: string, baslangic?: string, bitis?: string, alici?: string, iptalleriGosterilsin = false) {
    const cari = await this.getir(cariId);
    const hedef = alici ?? cari.eposta;
    if (!hedef) throw new BadRequestException("Cari kartında e-posta adresi bulunmuyor");
    const [pdf, excel] = await Promise.all([this.ekstrePdf(cariId, baslangic, bitis, iptalleriGosterilsin), this.ekstreExcel(cariId, baslangic, bitis, iptalleriGosterilsin)]);
    const donem = baslangic || bitis ? `${baslangic ?? "başlangıç"} - ${bitis ?? "bugün"}` : "tüm dönem";
    await this.eposta.ekliIletiGonder({ alici: hedef, konu: `${cari.unvan} cari hesap ekstresi`, metin: `Sayın Yetkili,\n\n${donem} cari hesap ekstreniz PDF ve Excel formatında ekte sunulmuştur.\n\nSaygılarımızla`, ekler: [{ dosyaAdi: `ekstre-${cari.kod}.pdf`, icerik: pdf, mime: "application/pdf" }, { dosyaAdi: `ekstre-${cari.kod}.xlsx`, icerik: excel, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] });
    return { mesaj: `Ekstre ${hedef} adresine gönderildi` };
  }

  /**
   * Dövizli Cari Hesaplar için Kur Farkı (Revalüasyon) Analizi.
   * Belirtilen tarihteki güncel TCMB kuru ile hareketlerdeki kur farkından doğan Kar/Zarar tutarını hesaplar.
   */
  async kurFarkiAnalizi(hedefTarihMetni?: string) {
    const { tenantId } = aktifBaglam();
    const hedefTarih = hedefTarihMetni ? new Date(hedefTarihMetni) : new Date();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Dövizli hareketi olan tüm aktif carileri al
      const cariler = await tx.cariHesap.findMany({
        where: { tenantId, aktif: true },
        select: { id: true, kod: true, unvan: true, vknTckn: true },
      });

      // Değerleme hedef tarihin kuruyla yapılır (DVZ-04). Kuru olmayan para
      // birimi için sabit bir gösterge kuruna düşülmez: işlem açık hatayla durur.
      const kurlar = new Map<string, number>();
      const kurAl = async (doviz: string) => {
        if (!kurlar.has(doviz)) kurlar.set(doviz, Number(await kurZorunlu(tx, doviz, hedefTarih, "alis", tenantId)));
        return kurlar.get(doviz)!;
      };

      const sonuclar = [];

      for (const cari of cariler) {
        const bakiyeler = await this.bakiyeleriGetir([cari.id]);
        const cariDovizBakiyeleri = bakiyeler.get(cari.id) || [];

        for (const b of cariDovizBakiyeleri) {
          if (b.dovizCinsi === "TRY" || Number(b.bakiye) === 0) continue;

          const dovizBakiye = Number(b.bakiye); // Borç - Alacak (Döviz Cinsinden)
          const kayitliTryBakiye = Number(b.bakiyeTry); // Kayıt anındaki TRY Karşılığı bakiye
          const guncelKur = await kurAl(b.dovizCinsi);
          const guncelTryDegeri = dovizBakiye * guncelKur;

          // Kur Farkı = Güncel TRY Değeri - Kayıtlı TRY Değeri
          const kurFarkiTutari = guncelTryDegeri - kayitliTryBakiye;

          if (Math.abs(kurFarkiTutari) > 0.05) { // 5 kuruştan büyük farklar
            sonuclar.push({
              cariId: cari.id,
              cariKod: cari.kod,
              cariUnvan: cari.unvan,
              dovizCinsi: b.dovizCinsi,
              dovizBakiye,
              kayitliTryBakiye,
              guncelKur,
              guncelTryDegeri: Number(guncelTryDegeri.toFixed(2)),
              kurFarkiTutari: Number(kurFarkiTutari.toFixed(2)),
              faturaTipi: kurFarkiTutari > 0 ? "satis" : "alis", // Pozitifse Kur Farkı Satış (Gelir), Negatifse Kur Farkı Alış (Gider)
              aciklama: `${b.dovizCinsi} Döviz Bakiye Kur Değerleme Farkı (GÜNCEL KUR: 1 ${b.dovizCinsi} = ${guncelKur} TL)`,
            });
          }
        }
      }

      return {
        degerlemeTarihi: hedefTarih.toISOString().slice(0, 10),
        guncelKurlar: { TRY: 1, ...Object.fromEntries(kurlar) },
        toplamCariSayisi: sonuclar.length,
        sonuclar,
      };
    });
  }

  /**
   * Kur Farkı Değerlemesinden Otomatik Kur Farkı Faturası Taslağı Keser.
   */
  async kurFarkiFaturasiOlustur(cariId: string, dovizCinsi: string, kurFarkiTutari: number, aciklama: string) {
    const { tenantId } = aktifBaglam();
    const cari = await this.getir(cariId);

    const faturaTip = kurFarkiTutari > 0 ? "satis" : "alis";
    const netTutar = Math.abs(kurFarkiTutari);

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.create({
        data: {
          tenantId,
          cariId: cari.id,
          tip: faturaTip,
          durum: "taslak",
          tarih: new Date(),
          dovizCinsi: "TRY",
          kur: D(1),
          toplamBrut: D(netTutar),
          toplamSatirIskontosu: D(0),
          genelIskontoTutari: D(0),
          genelIskontoToplam: D(0),
          toplamMatrah: D(netTutar),
          toplamKdv: D(0),
          toplamTevkifat: D(0),
          toplamNetKdv: D(0),
          genelToplam: D(netTutar),
          aciklama: aciklama || `Dövizli Cari Kur Farkı Faturası (${dovizCinsi})`,
          satirlar: {
            create: [
              {
                tenantId,
                stokId: (await tx.stokKart.findFirst({ where: { tenantId, tip: "hizmet" } }))?.id || (await tx.stokKart.findFirst({ where: { tenantId } }))!.id,
                miktar: D(1),
                birim: "adet",
                birimFiyat: D(netTutar),
                iskontoOrani: D(0),
                iskontoTutari: D(0),
                matrah: D(netTutar),
                kdvOrani: D(0),
                kdvTutari: D(0),
                netKdvTutari: D(0),
                toplamTutar: D(netTutar),
              },
            ],
          },
        },
      });

      return {
        faturaId: fatura.id,
        faturaNo: fatura.no || "Taslak",
        faturaTip: fatura.tip,
        tutar: netTutar.toFixed(2),
        mesaj: `Kur Farkı Faturası taslak olarak oluşturuldu.`,
      };
    });
  }
}
