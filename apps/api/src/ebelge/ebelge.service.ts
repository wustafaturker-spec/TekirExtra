import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { BelgeDurum, EbelgeTur, GelenEbelgeDurum, Prisma } from "@prisma/client";
import type { EntegratorConfig } from "@tekirextra/baglanti";
import { vknTcknGecerliMi } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { coz } from "../core/kripto";
import { PrismaService } from "../core/prisma.service";
import { FaturaService } from "../fatura/fatura.service";
import { BaglantilarService } from "../tenant/baglantilar.service";
import { UblOkumaHatasi, faturaUblOku, type UblFatura, type UblSatir } from "./ubl-oku";
import { faturaUblUret } from "./xml-uretec";

/** Onay ekranında satırın hangi ipucuyla eşleştiği. */
export type EslesmeKaynagi =
  | "alici_urun_kodu"
  | "barkod"
  | "tedarikci_urun_kodu"
  | "uretici_urun_kodu"
  | "ad"
  | null;

const YEDI_GUN_MS = 7 * 24 * 60 * 60 * 1_000;

function gonderimTarihiGecerliMi(tarih: Date, simdi = new Date()): boolean {
  const fark = simdi.getTime() - tarih.getTime();
  return fark >= 0 && fark <= YEDI_GUN_MS;
}

@Injectable()
export class EbelgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly baglantilarService: BaglantilarService,
    @Inject(forwardRef(() => FaturaService))
    private readonly faturaService: FaturaService,
  ) {}

  // ─── E-BELGE GÖNDERİMİ (EBLG-01/02/06/07) ──────────────────────────────────

  /** Gönderim öncesi wizard önizlemesi. Fatura kesinleşmiş olabilir ancak
   * bu çağrı e-belge kaydı oluşturmaz ve dış sisteme belge göndermez; yalnızca
   * mükellefiyet/bağlantı kontrolünü yapar. */
  async wizardBilgisi(faturaId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({
        where: { id: faturaId },
        include: { cari: true, ebelge: { select: { id: true, durum: true, tur: true } } },
      });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "kesin") throw new BadRequestException("e-Fatura wizard'ı yalnızca kesinleşmiş faturalar için açılabilir");
      if (fatura.ebelge && !["hata", "ret"].includes(fatura.ebelge.durum)) {
        throw new BadRequestException("Bu fatura için zaten e-belge gönderim süreci başlatılmış");
      }
      const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" }, select: { saglayici: true } });
      if (!baglanti) return { gonderilebilir: false, neden: "Aktif bir e-belge entegratör bağlantısı bulunamadı.", faturaNo: fatura.no, cari: fatura.cari.unvan };
      if (!fatura.cari.vknTckn || !vknTcknGecerliMi(fatura.cari.vknTckn)) {
        return { gonderilebilir: false, neden: "Alıcının geçerli bir VKN/TCKN bilgisi olmalıdır.", faturaNo: fatura.no, cari: fatura.cari.unvan, vknTckn: fatura.cari.vknTckn, saglayici: baglanti.saglayici };
      }
      if (!gonderimTarihiGecerliMi(fatura.tarih)) {
        return { gonderilebilir: false, neden: "Fatura tarihi bugün veya en fazla 7 gün önce olmalıdır.", faturaNo: fatura.no, cari: fatura.cari.unvan, vknTckn: fatura.cari.vknTckn, saglayici: baglanti.saglayici };
      }
      return {
        gonderilebilir: true,
        faturaNo: fatura.no,
        cari: fatura.cari.unvan,
        vknTckn: fatura.cari.vknTckn,
        saglayici: baglanti.saglayici,
        mevcutEbelge: fatura.ebelge,
        not: "Mükellefiyet kontrolü gönderim onayında tekrar doğrulanır.",
      };
    });
  }

  async gonder(faturaId: string) {
    const { tenantId } = aktifBaglam();
    // Önce veritabanında tekil bir gönderim rezervasyonu oluşturulur. Böylece
    // çift tıklama/iki sekme aynı UUID'yi entegratöre iki kez gönderemez.
    const hazirlik = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({
        where: { id: faturaId },
        include: {
          satirlar: { include: { stok: { select: { kod: true, ad: true } } } },
          cari: true,
          ebelge: true,
        },
      });

      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "kesin") {
        throw new BadRequestException("Yalnızca kesinleşmiş faturalar gönderilebilir");
      }
      if (!fatura.cari.vknTckn || !vknTcknGecerliMi(fatura.cari.vknTckn)) {
        throw new BadRequestException("Alıcının geçerli bir VKN/TCKN bilgisi olmalıdır");
      }
      if (!gonderimTarihiGecerliMi(fatura.tarih)) {
        throw new BadRequestException("Fatura tarihi bugün veya en fazla 7 gün önce olmalıdır");
      }
      if (fatura.ebelge && !["hata", "ret"].includes(fatura.ebelge.durum)) {
        throw new ConflictException("Bu fatura için e-belge gönderim süreci zaten başlatılmış");
      }

      // 2. Aktif e-belge bağlantısını bul
      const baglanti = await tx.baglanti.findFirst({
        where: { tenantId, aile: "ebelge", durum: "aktif" },
      });

      if (!baglanti) {
        throw new BadRequestException(
          "Aktif bir e-belge entegratör bağlantısı bulunamadı. Lütfen ayarlardan aktifleştirin.",
        );
      }

      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException("Tenant bulunamadı");
      if (!vknTcknGecerliMi(tenant.vkn)) {
        throw new BadRequestException("Gönderen firmanın geçerli bir VKN/TCKN bilgisi olmalıdır");
      }

      let rezervasyon: { id: string };
      if (fatura.ebelge) {
        const kilit = await tx.ebelgeKayit.updateMany({
          where: { id: fatura.ebelge.id, durum: { in: ["hata", "ret"] } },
          data: { durum: "kuyrukta", entegratorRef: null, hataMesaji: null },
        });
        if (kilit.count !== 1) {
          throw new ConflictException("Bu fatura için başka bir gönderim işlemi devam ediyor");
        }
        rezervasyon = { id: fatura.ebelge.id };
      } else {
        try {
          rezervasyon = await tx.ebelgeKayit.create({
            data: { tenantId, faturaId, tur: "earsiv", durum: "kuyrukta", hataMesaji: null },
            select: { id: true },
          });
        } catch (hata) {
          if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") {
            throw new ConflictException("Bu fatura için başka bir gönderim işlemi devam ediyor");
          }
          throw hata;
        }
      }

      return {
        fatura,
        tenant,
        rezervasyonId: rezervasyon.id,
        saglayici: baglanti.saglayici,
        cfg: JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig,
      };
    });

    const adapter = this.baglantilarService.adapterCoz(hazirlik.saglayici);
    try {
      const mukellefiyet = await adapter.mukellefSorgula(hazirlik.cfg, hazirlik.fatura.cari.vknTckn!);
      if (mukellefiyet.eFaturaMukellefi && !mukellefiyet.postaKutusu) {
        throw new BadRequestException("Alıcı e-Fatura mükellefi ancak GİB posta kutusu (alias) bulunamadı");
      }
      const tur: EbelgeTur = mukellefiyet.eFaturaMukellefi ? "efatura" : "earsiv";

      const xml = faturaUblUret(hazirlik.fatura, {
        unvan: hazirlik.tenant.unvan,
        vkn: hazirlik.tenant.vkn,
        vergiDairesi: hazirlik.tenant.vergiDairesi || undefined,
      });

      const gonderimResult = await adapter.belgeGonder(hazirlik.cfg, {
        uuid: hazirlik.fatura.id,
        belgeNo: hazirlik.fatura.no || "TASLAK",
        xml,
        tur,
        aliciPostaKutusu: mukellefiyet.postaKutusu,
      });
      const durum: BelgeDurum = gonderimResult.basarili ? "iletildi" : "hata";

      await this.prisma.tenantIslem(tenantId, async (tx) => {
        await tx.cariHesap.update({
          where: { id: hazirlik.fatura.cariId },
          data: { eFaturaMukellefi: mukellefiyet.eFaturaMukellefi, mukellefiyetSorguZamani: new Date() },
        });
        await tx.ebelgeKayit.update({
          where: { id: hazirlik.rezervasyonId },
          data: { tur, durum, entegratorRef: gonderimResult.belgeRef || null, hataMesaji: gonderimResult.hataMesaji || null },
        });
        if (gonderimResult.basarili) {
          await tx.ebelgeArsiv.upsert({
            where: { ebelgeId: hazirlik.rezervasyonId },
            create: { tenantId, ebelgeId: hazirlik.rezervasyonId, xmlIcerik: xml, pdfDosyaUrl: `/panel/fatura/${faturaId}/pdf` },
            update: { xmlIcerik: xml },
          });
        }
      });

      return {
        basarili: gonderimResult.basarili,
        durum,
        tur,
        ebelgeRef: gonderimResult.belgeRef,
        hataMesaji: gonderimResult.hataMesaji,
      };
    } catch (hata) {
      const mesaj = hata instanceof Error ? hata.message : "e-Belge gönderimi sırasında beklenmeyen hata";
      await this.prisma.tenantIslem(tenantId, (tx) => tx.ebelgeKayit.update({
        where: { id: hazirlik.rezervasyonId },
        data: { durum: "hata", hataMesaji: mesaj },
      }));
      throw hata;
    }
  }

  // ─── DURUM SORGULAMA (EBLG-03/06) ──────────────────────────────────────────

  async durumSorgula(faturaId: string) {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const ebelge = await tx.ebelgeKayit.findUnique({
        where: { faturaId },
      });

      if (!ebelge) throw new NotFoundException("Faturaya ait e-belge kaydı bulunamadı");
      if (!ebelge.entegratorRef) {
        throw new BadRequestException("Gönderimi yapılmamış belgenin durumu sorgulanamaz");
      }

      // Eğer zaten son duruma (kabul/ret/hata) ulaşmışsa entegratöre gitme
      if (["kabul", "ret", "hata"].includes(ebelge.durum)) {
        return ebelge;
      }

      const baglanti = await tx.baglanti.findFirst({
        where: { tenantId, aile: "ebelge", durum: "aktif" },
      });
      if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");

      const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
      const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);

      // Entegratörden güncel durumu sorgula
      const sonuc = await adapter.durumSorgula(cfg, ebelge.entegratorRef);

      // Durumu veritabanında güncelle
      return tx.ebelgeKayit.update({
        where: { id: ebelge.id },
        data: {
          durum: sonuc.durum,
          hataMesaji: sonuc.detay || null,
        },
      });
    });
  }

  // ─── GELEN E-BELGE KUTUSU (EBLG-05/06) ─────────────────────────────────────

  /**
   * Entegratörden son 30 günün gelen belgelerini çeker ve **yalnızca gelen
   * kutusuna** yazar (EBLG-05). Fatura üretilmez — bu, kullanıcı onayıyla
   * {@link gelenOnayla} üzerinden olur. Tekrar çekimde aynı belge
   * `[tenantId, uuid]` teklik kısıtıyla yinelenmez.
   */
  async gelenBelgeleriCek() {
    const { tenantId } = aktifBaglam();

    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({
        where: { tenantId, aile: "ebelge", durum: "aktif" },
      }),
    );

    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");

    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);

    const otuzGunOnce = new Date();
    otuzGunOnce.setDate(otuzGunOnce.getDate() - 30);

    const belgeler = await adapter.gelenBelgeleriCek(cfg, otuzGunOnce);

    let yeniBelgeSayisi = 0;

    for (const b of belgeler) {
      // Profil bilgisi kabul/ret düğmesini belirlediği için çekimde okunur;
      // bozuk XML çekimi düşürmesin — belge yine de kutuya girsin.
      let profilId: string | null = null;
      try {
        profilId = faturaUblOku(b.xml).profilId;
      } catch {
        profilId = null;
      }

      const oncesi = await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.findUnique({
          where: { tenantId_uuid: { tenantId, uuid: b.uuid } },
          select: { id: true },
        }),
      );

      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.upsert({
          where: { tenantId_uuid: { tenantId, uuid: b.uuid } },
          create: {
            tenantId,
            uuid: b.uuid,
            belgeNo: b.belgeNo,
            gonderenVkn: b.gonderenVkn,
            gonderenUnvan: b.gonderenUnvan,
            tarih: b.tarih,
            profilId,
            xmlIcerik: b.xml,
          },
          // Yalnızca entegratör tarafındaki gövde tazelenir; durum/yanıt
          // bizim iş akışımıza ait olduğu için korunur.
          update: { xmlIcerik: b.xml, profilId },
        }),
      );

      if (!oncesi) yeniBelgeSayisi += 1;
    }

    return {
      toplamCekilen: belgeler.length,
      yeniBelgeSayisi,
    };
  }

  /**
   * Manuel XML fatura yükleme: UBL XML'i doğrular, alıcı VKN/TCKN bilgisinin
   * mevcut kiracı (şirket) VKN'si ile eşleştiğini kontrol eder ve gelen kutusuna yazar.
   */
  async gelenXmlYukle(xmlIcerik: string) {
    const { tenantId } = aktifBaglam();

    let ubl: UblFatura;
    try {
      ubl = faturaUblOku(xmlIcerik);
    } catch (hata) {
      throw new BadRequestException(
        hata instanceof UblOkumaHatasi
          ? `Yüklenen XML okunamadı: ${hata.message}`
          : "Yüklenen XML geçerli bir UBL-TR faturası değil",
      );
    }

    const tenant = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { vkn: true } }),
    );

    if (tenant?.vkn && ubl.alici.vknTckn && ubl.alici.vknTckn !== tenant.vkn) {
      throw new BadRequestException(
        `Fatura alıcı VKN/TCKN (${ubl.alici.vknTckn}) bilgisi, firmanızın VKN (${tenant.vkn}) bilgisi ile eşleşmiyor. Farklı bir firmaya kesilmiş faturalar yüklenemez.`,
      );
    }

    const tarih = new Date(ubl.tarih);
    const gecerliTarih = Number.isNaN(tarih.getTime()) ? new Date() : tarih;

    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.upsert({
        where: { tenantId_uuid: { tenantId, uuid: ubl.uuid } },
        create: {
          tenantId,
          uuid: ubl.uuid,
          belgeNo: ubl.belgeNo,
          gonderenVkn: ubl.gonderen.vknTckn,
          gonderenUnvan: ubl.gonderen.unvan,
          tarih: gecerliTarih,
          profilId: ubl.profilId,
          xmlIcerik,
        },
        update: { xmlIcerik, profilId: ubl.profilId },
      }),
    );

    return {
      id: kayit.id,
      uuid: kayit.uuid,
      belgeNo: kayit.belgeNo,
      gonderenVkn: kayit.gonderenVkn,
      gonderenUnvan: kayit.gonderenUnvan,
      aliciVkn: ubl.alici.vknTckn,
      profilId: kayit.profilId,
      tarih: kayit.tarih.toISOString().slice(0, 10),
      durum: kayit.durum,
    };
  }

  /** Gelen kutusu listesi; XML gövdesi yerine ayrıştırılmış özeti döner. */
  async gelenListele(durum?: GelenEbelgeDurum) {
    const { tenantId } = aktifBaglam();

    const kayitlar = await this.prisma.tenantIslem(tenantId, async (tx) => {
      // Taslak faturası silinen belgeler yeniden onaya düşsün (bkz. kayitTazele).
      await tx.gelenEbelge.updateMany({
        where: { durum: "islendi", faturaId: null },
        data: { durum: "beklemede" },
      });

      return tx.gelenEbelge.findMany({
        where: durum ? { durum } : undefined,
        orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
        include: { fatura: { select: { id: true, no: true, durum: true } } },
      });
    });

    return kayitlar.map((k) => {
      const ubl = this.ublCoz(k.xmlIcerik);
      return {
        id: k.id,
        uuid: k.uuid,
        belgeNo: k.belgeNo,
        gonderenVkn: k.gonderenVkn,
        gonderenUnvan: k.gonderenUnvan,
        tarih: k.tarih.toISOString().slice(0, 10),
        profilId: k.profilId,
        durum: k.durum,
        yanit: k.yanit,
        yanitGerekce: k.yanitGerekce,
        faturaId: k.faturaId,
        fatura: k.fatura,
        satirSayisi: ubl?.satirlar.length ?? 0,
        genelToplam: ubl ? ubl.toplamlar.genelToplam.toFixed(2) : null,
        dovizCinsi: ubl?.dovizCinsi ?? "TRY",
        okunabilir: ubl !== null,
      };
    });
  }

  /**
   * Onay ekranının verisi: ayrıştırılmış belge + her satır için otomatik stok
   * eşleştirme önerisi (S-01: barkod → tedarikçi ürün kodu → ad).
   */
  async gelenGetir(id: string) {
    const { tenantId } = aktifBaglam();

    await this.kayitTazele(tenantId, id);
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.findUnique({
        where: { id },
        include: { fatura: { select: { id: true, no: true, durum: true } } },
      }),
    );
    if (!kayit) throw new NotFoundException("Gelen belge bulunamadı");

    let ubl: UblFatura;
    try {
      ubl = faturaUblOku(kayit.xmlIcerik);
    } catch (hata) {
      throw new BadRequestException(
        hata instanceof UblOkumaHatasi
          ? `Belgenin XML'i okunamadı: ${hata.message}`
          : "Belgenin XML'i okunamadı",
      );
    }

    const cari = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findFirst({
        where: { tenantId, vknTckn: kayit.gonderenVkn },
        select: { id: true, kod: true, unvan: true, karaListe: true },
      }),
    );

    const satirlar = await this.eslesmeOner(tenantId, ubl.satirlar, cari?.id ?? null);

    return {
      id: kayit.id,
      uuid: kayit.uuid,
      belgeNo: kayit.belgeNo,
      gonderenVkn: kayit.gonderenVkn,
      gonderenUnvan: kayit.gonderenUnvan,
      tarih: kayit.tarih.toISOString().slice(0, 10),
      profilId: kayit.profilId ?? ubl.profilId,
      durum: kayit.durum,
      yanit: kayit.yanit,
      yanitGerekce: kayit.yanitGerekce,
      faturaId: kayit.faturaId,
      fatura: kayit.fatura,
      /** Kabul/ret yalnızca ticari faturada anlamlı (EBLG-06). */
      yanitGerekiyor: (kayit.profilId ?? ubl.profilId) === "TICARIFATURA",
      cari,
      dovizCinsi: ubl.dovizCinsi,
      belgeToplamlari: {
        satirToplami: ubl.toplamlar.satirToplami.toFixed(2),
        iskontoToplami: ubl.toplamlar.iskontoToplami.toFixed(2),
        matrah: ubl.toplamlar.matrah.toFixed(2),
        kdv: ubl.toplamlar.kdv.toFixed(2),
        genelToplam: ubl.toplamlar.genelToplam.toFixed(2),
      },
      satirlar,
      xmlIcerik: kayit.xmlIcerik,
    };
  }

  /**
   * EBLG-05 onay kapısı: eşleştirilmiş satırlarla taslak **alış** faturası
   * üretir. Her satır bir stok kartına bağlanmak zorundadır — kesinleştirmede
   * satır başına stok hareketi yazılıyor ve `FaturaSatir.stokId` zorunlu.
   */
  async gelenOnayla(
    id: string,
    girdi: { satirEslesmeleri: { siraNo: number; stokId: string }[]; yeniCariOnay?: boolean },
  ) {
    const { tenantId } = aktifBaglam();

    const kayit = await this.kayitTazele(tenantId, id);
    if (kayit.durum === "islendi") {
      throw new ConflictException("Bu belge zaten faturaya işlenmiş");
    }
    if (kayit.durum === "reddedildi") {
      throw new BadRequestException("Reddedilen belge faturaya işlenemez");
    }

    let ubl: UblFatura;
    try {
      ubl = faturaUblOku(kayit.xmlIcerik);
    } catch {
      throw new BadRequestException("Belgenin XML'i okunamadı; faturaya işlenemez");
    }
    if (ubl.satirlar.length === 0) {
      throw new BadRequestException("Belgede fatura satırı bulunamadı");
    }

    // Tüm satırlar eşleşmeden fatura üretilmez (S-01).
    const eslesme = new Map(girdi.satirEslesmeleri.map((e) => [e.siraNo, e.stokId]));
    const eksik = ubl.satirlar.filter((s) => !eslesme.get(s.siraNo));
    if (eksik.length > 0) {
      throw new BadRequestException(
        `Şu satırlar bir stok kartıyla eşleştirilmedi: ${eksik
          .map((s) => `${s.siraNo}. ${s.ad}`)
          .join(", ")}`,
      );
    }

    // Eşleştirilen kartlar gerçekten bu kiracıya ait mi?
    const stokIdler = [...new Set([...eslesme.values()])];
    const stoklar = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.stokKart.findMany({ where: { id: { in: stokIdler } }, select: { id: true } }),
    );
    if (stoklar.length !== stokIdler.length) {
      throw new BadRequestException("Eşleştirilen stok kartlarından biri bulunamadı");
    }

    const mevcutCari = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.cariHesap.findFirst({
        where: { tenantId, vknTckn: kayit.gonderenVkn },
        select: { id: true },
      }),
    );

    if (!mevcutCari && !girdi.yeniCariOnay) {
      throw new BadRequestException(
        `Gönderen firma (${kayit.gonderenUnvan} - VKN: ${kayit.gonderenVkn}) sisteminizde kayıtlı bir cari hesap değil. Lütfen yeni cari hesap açılmasını onaylayın.`,
      );
    }

    const cariId = await this.gonderenCariBulVeyaOlustur(
      tenantId,
      kayit.gonderenVkn,
      kayit.gonderenUnvan,
    );

    const fatura = await this.faturaService.olustur({
      tip: "alis",
      no: kayit.belgeNo,
      tarih: kayit.tarih.toISOString().slice(0, 10),
      vadeTarihi: ubl.vadeTarihi ?? null,
      cariId,
      dovizCinsi: (["TRY", "USD", "EUR"] as const).includes(
        ubl.dovizCinsi as "TRY" | "USD" | "EUR",
      )
        ? (ubl.dovizCinsi as "TRY" | "USD" | "EUR")
        : "TRY",
      kur: "1",
      genelIskontoYuzdesi: "0",
      genelIskontoTutari: "0",
      aciklama: `Gelen e-Fatura ${kayit.belgeNo} — ${kayit.gonderenUnvan}`,
      notlar: null,
      satirlar: ubl.satirlar.map((s) => ({
        stokId: eslesme.get(s.siraNo) as string,
        miktar: s.miktar.toFixed(3),
        birim: s.birim,
        birimFiyat: s.birimFiyat.toFixed(4),
        iskontoOrani: Math.max(0, s.iskontoOrani).toFixed(2),
        kdvOrani: Math.max(0, s.kdvOrani).toFixed(2),
        tevkifatPay: null,
        tevkifatPayda: null,
        gibIstisnaKodu: null,
      })),
    });

    try {
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.update({
          where: { id },
          data: { durum: "islendi", faturaId: fatura.id },
        }),
      );
    } catch (hata) {
      // Bağ kurulamadıysa taslak ortada kalmasın: geri al ve hatayı yükselt.
      await this.faturaService.sil(fatura.id).catch(() => undefined);
      throw hata;
    }

    return {
      gelenEbelgeId: id,
      faturaId: fatura.id,
      belgeToplami: ubl.toplamlar.genelToplam.toFixed(2),
      hesaplananToplam: fatura.genelToplam,
      /** Belge ile hesaplanan toplam tutmuyorsa kullanıcıya gösterilir. */
      toplamFarki:
        Math.abs(Number(fatura.genelToplam) - ubl.toplamlar.genelToplam) > 0.01
          ? (Number(fatura.genelToplam) - ubl.toplamlar.genelToplam).toFixed(2)
          : null,
    };
  }

  /**
   * Oluşturulan taslak alış faturasını siler ve gelen e-belgeyi
   * tekrar 'beklemede' durumuna getirerek yeniden stok eşleştirmesi yapılmasına olanak tanır.
   */
  async gelenTaslakIptalEt(id: string) {
    const { tenantId } = aktifBaglam();

    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.findUnique({
        where: { id },
        include: { fatura: true },
      }),
    );

    if (!kayit) throw new NotFoundException("Gelen belge bulunamadı");
    if (!kayit.faturaId || !kayit.fatura) {
      await this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.update({
          where: { id },
          data: { durum: "beklemede", faturaId: null },
        }),
      );
      return { basarili: true, mesaj: "Belge tekrar onaya düştü" };
    }

    if (kayit.fatura.durum === "kesin") {
      throw new BadRequestException(
        "Kesinleşmiş alış faturası iptal edilemez; öncelikle faturanın durumunu taslağa çekin veya silin.",
      );
    }

    const faturaId = kayit.faturaId;
    await this.faturaService.sil(faturaId);

    return {
      basarili: true,
      gelenEbelgeId: id,
      mesaj: "Taslak fatura silindi ve belge tekrar onaya düştü",
    };
  }

  /**
   * EBLG-06: ticari faturaya kabul/ret yanıtı gönderir. Temel faturada yanıt
   * kavramı yoktur; ret gerekçe ister ve belgeyi işlenemez hale getirir.
   */
  async gelenYanitGonder(
    id: string,
    girdi: { yanit: "kabul" | "ret"; gerekce?: string | null },
  ) {
    const { tenantId } = aktifBaglam();

    const kayit = await this.kayitTazele(tenantId, id);
    if (kayit.yanit) {
      throw new ConflictException(
        `Bu belgeye zaten '${kayit.yanit}' yanıtı gönderilmiş`,
      );
    }
    if (kayit.profilId !== "TICARIFATURA") {
      throw new BadRequestException(
        "Kabul/ret yanıtı yalnızca ticari fatura (TICARIFATURA) profilinde gönderilebilir",
      );
    }
    if (girdi.yanit === "ret") {
      if (!girdi.gerekce?.trim()) {
        throw new BadRequestException("Ret yanıtı için gerekçe zorunludur");
      }
      if (kayit.durum === "islendi") {
        throw new BadRequestException(
          "Faturaya işlenmiş belge reddedilemez; önce oluşan taslak faturayı silin",
        );
      }
    }

    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }),
    );
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");

    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);

    const sonuc = await adapter.yanitGonder(cfg, kayit.uuid, girdi.yanit, girdi.gerekce ?? undefined, {
      gonderenVkn: kayit.gonderenVkn || "",
      xml: kayit.xmlIcerik || "",
    });
    if (!sonuc.basarili) {
      throw new BadRequestException(
        sonuc.hataMesaji ?? "Yanıt entegratöre iletilemedi",
      );
    }

    return this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.update({
        where: { id },
        data: {
          yanit: girdi.yanit,
          yanitGerekce: girdi.gerekce?.trim() || null,
          yanitZamani: new Date(),
          ...(girdi.yanit === "ret" ? { durum: "reddedildi" as GelenEbelgeDurum } : {}),
        },
      }),
    );
  }

  async earsivIptalBildir(faturaId: string, girdi: { iptalTarihi: Date; sube?: string }) {
    const { tenantId } = aktifBaglam();
    const veri = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, include: { ebelge: true } });
      if (!fatura) throw new NotFoundException("Fatura bulunamadı");
      if (fatura.durum !== "iptal") throw new BadRequestException("Sovos iptal bildirimi için fatura önce TekirExtra'da iptal edilmelidir");
      if (!fatura.no || fatura.ebelge?.tur !== "earsiv") throw new BadRequestException("Faturaya bağlı bir e-Arşiv kaydı bulunamadı");
      const baglanti = await tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } });
      if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");
      return { fatura, baglanti };
    });
    const cfg = JSON.parse(coz(veri.baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(veri.baglanti.saglayici);
    if (!adapter.earsivIptal) throw new BadRequestException("Aktif entegratör e-Arşiv iptal bildirimini desteklemiyor");
    const sonuc = await adapter.earsivIptal(cfg, { faturaNo: veri.fatura.no!, toplamTutar: veri.fatura.genelToplam.toFixed(2), iptalTarihi: girdi.iptalTarihi, sube: girdi.sube });
    if (!sonuc.basarili) throw new BadRequestException(sonuc.mesaj || "e-Arşiv iptali Sovos'a bildirilemedi");
    return sonuc;
  }

  async earsivRaporListele(baslangic: Date, bitis: Date) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }));
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");
    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);
    if (!adapter.earsivRaporListele) throw new BadRequestException("Aktif entegratör e-Arşiv raporlarını desteklemiyor");
    return adapter.earsivRaporListele(cfg, baslangic, bitis);
  }

  async earsivRaporDurum(uuid: string) {
    const { tenantId } = aktifBaglam();
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findFirst({ where: { tenantId, aile: "ebelge", durum: "aktif" } }));
    if (!baglanti) throw new BadRequestException("Aktif e-belge bağlantısı bulunamadı");
    const cfg = JSON.parse(coz(baglanti.sifreliConfig)) as EntegratorConfig;
    const adapter = this.baglantilarService.adapterCoz(baglanti.saglayici);
    if (!adapter.earsivRaporDurum) throw new BadRequestException("Aktif entegratör e-Arşiv rapor durumunu desteklemiyor");
    return adapter.earsivRaporDurum(cfg, uuid);
  }

  // ─── GELEN BELGE YARDIMCILARI ──────────────────────────────────────────────

  /**
   * Kaydı okur; oluşan taslak fatura sonradan silinmişse (FK SET NULL ile
   * `faturaId` boşalır) belgeyi tekrar onaylanabilir hale getirir — aksi hâlde
   * ortada faturası olmayan "işlendi" kaydı kilitli kalırdı.
   */
  private async kayitTazele(tenantId: string, id: string) {
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.gelenEbelge.findUnique({ where: { id } }),
    );
    if (!kayit) throw new NotFoundException("Gelen belge bulunamadı");

    if (kayit.durum === "islendi" && !kayit.faturaId) {
      return this.prisma.tenantIslem(tenantId, (tx) =>
        tx.gelenEbelge.update({ where: { id }, data: { durum: "beklemede" } }),
      );
    }
    return kayit;
  }

  /** Listeleme sırasında bozuk XML tek belgeyi düşürsün, listeyi değil. */
  private ublCoz(xml: string): UblFatura | null {
    try {
      return faturaUblOku(xml);
    } catch {
      return null;
    }
  }

  /**
   * Satır başına otomatik stok eşleştirme. Sıra, en güvenilir ipucundan en
   * zayıfına doğrudur: bizim ürün kodumuz → barkod → tedarikçinin bizde kayıtlı
   * ürün kodu (STK-18) → üretici kodu → birebir ad.
   */
  private async eslesmeOner(
    tenantId: string,
    satirlar: UblSatir[],
    cariId: string | null,
  ) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = [];

      for (const s of satirlar) {
        let stokId: string | null = null;
        let kaynak: EslesmeKaynagi = null;

        if (s.aliciUrunKodu) {
          const k = await tx.stokKart.findFirst({
            where: { tenantId, kod: s.aliciUrunKodu, aktif: true },
            select: { id: true },
          });
          if (k) {
            stokId = k.id;
            kaynak = "alici_urun_kodu";
          }
        }

        if (!stokId && s.barkod) {
          const barkodKaydi = await tx.stokBarkod.findFirst({
            where: { tenantId, barkod: s.barkod },
            select: { stokId: true },
          });
          if (barkodKaydi) {
            stokId = barkodKaydi.stokId;
            kaynak = "barkod";
          } else {
            const k = await tx.stokKart.findFirst({
              where: { tenantId, barkod: s.barkod, aktif: true },
              select: { id: true },
            });
            if (k) {
              stokId = k.id;
              kaynak = "barkod";
            }
          }
        }

        if (!stokId && s.saticiUrunKodu) {
          const ted = await tx.stokTedarikci.findFirst({
            where: {
              tenantId,
              tedarikciUrunKodu: s.saticiUrunKodu,
              ...(cariId ? { cariId } : {}),
            },
            select: { stokId: true },
          });
          if (ted) {
            stokId = ted.stokId;
            kaynak = "tedarikci_urun_kodu";
          }
        }

        if (!stokId && s.ureticiUrunKodu) {
          const k = await tx.stokKart.findFirst({
            where: { tenantId, ureticiUrunKodu: s.ureticiUrunKodu, aktif: true },
            select: { id: true },
          });
          if (k) {
            stokId = k.id;
            kaynak = "uretici_urun_kodu";
          }
        }

        if (!stokId && s.ad) {
          const k = await tx.stokKart.findFirst({
            where: { tenantId, ad: { equals: s.ad, mode: "insensitive" }, aktif: true },
            select: { id: true },
          });
          if (k) {
            stokId = k.id;
            kaynak = "ad";
          }
        }

        const stok = stokId
          ? await tx.stokKart.findUnique({
              where: { id: stokId },
              select: { id: true, kod: true, ad: true, anaBirim: true, kdvOrani: true },
            })
          : null;

        sonuc.push({
          siraNo: s.siraNo,
          ad: s.ad,
          saticiUrunKodu: s.saticiUrunKodu ?? null,
          aliciUrunKodu: s.aliciUrunKodu ?? null,
          ureticiUrunKodu: s.ureticiUrunKodu ?? null,
          barkod: s.barkod ?? null,
          miktar: s.miktar.toFixed(3),
          birim: s.birim,
          birimFiyat: s.birimFiyat.toFixed(4),
          iskontoOrani: s.iskontoOrani.toFixed(2),
          iskontoTutari: s.iskontoTutari.toFixed(2),
          kdvOrani: s.kdvOrani.toFixed(2),
          kdvTutari: s.kdvTutari.toFixed(2),
          matrah: s.matrah.toFixed(2),
          onerilenStokId: stok?.id ?? null,
          onerilenStok: stok
            ? {
                id: stok.id,
                kod: stok.kod,
                ad: stok.ad,
                anaBirim: stok.anaBirim,
                kdvOrani: stok.kdvOrani.toFixed(2),
              }
            : null,
          eslesmeKaynagi: kaynak,
        });
      }

      return sonuc;
    });
  }

  /** Gönderen VKN'siyle cari bulur; yoksa tedarikçi carisi açar. */
  private async gonderenCariBulVeyaOlustur(
    tenantId: string,
    vkn: string,
    unvan: string,
  ): Promise<string> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.cariHesap.findFirst({
        where: { tenantId, vknTckn: vkn },
        select: { id: true },
      });
      if (mevcut) return mevcut.id;

      // Kod çakışabilir (aynı VKN'li kayıt silinip yeniden açılmışsa vb.)
      let kod = `TED-${vkn}`;
      let sayac = 1;
      while (
        await tx.cariHesap.findUnique({
          where: { tenantId_kod: { tenantId, kod } },
          select: { id: true },
        })
      ) {
        kod = `TED-${vkn}-${++sayac}`;
      }

      const yeni = await tx.cariHesap.create({
        data: { tenantId, kod, unvan, vknTckn: vkn, tip: "tedarikci" },
      });
      return yeni.id;
    });
  }

  /**
   * Manuel XML e-Fatura / e-Arşiv Yükleme (UBL-TR 1.2 XML Ayrıştırma & Taslak Gelen Belge Kaydı)
   */
  async xmlYukleVeParseEt(xmlIcerik: string) {
    const { tenantId } = aktifBaglam();

    let ubl: UblFatura;
    try {
      ubl = faturaUblOku(xmlIcerik);
    } catch (hata) {
      throw new BadRequestException(
        hata instanceof UblOkumaHatasi
          ? `Yüklenen XML dosyası ayrıştırılamadı: ${hata.message}`
          : "Yüklenen XML dosyası geçerli bir UBL-TR e-Fatura formatında değil",
      );
    }

    // Gelen e-Belge tablosuna taslak olarak kaydet (varsa güncelle, yoksa ekle)
    const kayit = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.gelenEbelge.findFirst({
        where: { tenantId, uuid: ubl.uuid },
      });

      if (mevcut) {
        return tx.gelenEbelge.update({
          where: { id: mevcut.id },
          data: {
            xmlIcerik,
            belgeNo: ubl.belgeNo,
            gonderenVkn: ubl.gonderen.vknTckn,
            gonderenUnvan: ubl.gonderen.unvan,
            tarih: new Date(ubl.tarih),
            profilId: ubl.profilId,
          },
        });
      }

      return tx.gelenEbelge.create({
        data: {
          tenantId,
          uuid: ubl.uuid,
          belgeNo: ubl.belgeNo,
          gonderenVkn: ubl.gonderen.vknTckn,
          gonderenUnvan: ubl.gonderen.unvan,
          tarih: new Date(ubl.tarih),
          profilId: ubl.profilId,
          xmlIcerik,
          durum: "beklemede",
        },
      });
    });

    return {
      gelenEbelgeId: kayit.id,
      uuid: kayit.uuid,
      belgeNo: kayit.belgeNo,
      gonderenUnvan: kayit.gonderenUnvan,
      gonderenVkn: kayit.gonderenVkn,
      tarih: kayit.tarih.toISOString().slice(0, 10),
      toplamTutar: ubl.toplamlar.genelToplam.toFixed(2),
      dovizCinsi: ubl.dovizCinsi,
      satirSayisi: ubl.satirlar.length,
      mesaj: "XML e-Fatura başarıyla içeri aktarıldı ve gelen kutusuna eklendi.",
    };
  }
}
