/**
 * KSB-06: banka ekstresi satırını eşleştirme, öneriler, geri alma ve kurallar.
 *
 * Satır yedi biçimde işlenir:
 * - **cari**: cariye tahsilat/tediye; isteğe bağlı birden çok faturaya dağıtılır,
 *   dağıtılmayan kısım carinin avansı olarak kalır.
 * - **mevcut_fis**: önceden elle girilmiş fiş(ler) satıra bağlanır, yeni kayıt üretilmez.
 * - **masraf** / **gelir**: kategoriyle masraf ya da faaliyet dışı gelir kaydı + fiş.
 * - **virman**: kendi hesaplar arası transfer; karşı hesabın ekstresi gelince
 *   oradaki satır aynı virmanın diğer bacağına "mevcut fiş" olarak bağlanır.
 * - **cek**: tahsilde/portföydeki alınan çekin tahsili ya da verilen çekin ödenmesi.
 * - **kredi_karti**: kredi kartı ekstre ödemesi.
 *
 * Satır önce sahiplenilir (eşzamanlı iki eşleştirme ikisi birden kayıt
 * üretemez). Geri alma eşleme türüne göre çalışır: mevcut fiş yalnız bağdan
 * çözülür, üretilen kayıtlar silinir.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { type EkstreEslesmeTuru, Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { kurZorunlu } from "../doviz/kur-coz";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { kuralAnahtari, kuralBul, satirYonu } from "./ekstre-kural";
import { metniNormalle } from "./ekstre-oku";
import { OdemeTalimatiService } from "./odeme-talimati.service";
import { KasaBankaService } from "./kasa-banka.service";
import type { ekstreEslestirSemasi, ekstreKuralGuncelleSemasi } from "./kasa-banka.semalar";
import { KrediKartiService } from "./kredi-karti.service";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const GUN = 86_400_000;

export type CariEslesmeKaynagi = "iban" | "vkn" | "unvan" | "kural" | null;
type EslestirGirdisi = z.infer<typeof ekstreEslestirSemasi>;

@Injectable()
export class EkstreEslestirmeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kasaBanka: KasaBankaService,
    private readonly krediKarti: KrediKartiService,
    private readonly donemKilidi: DonemKilidiService,
    private readonly odemeTalimati: OdemeTalimatiService,
  ) {}

  // ─── ÖNERİLER ──────────────────────────────────────────────────────────────

  /** Seçilen satır için bütün eşleme türlerinin önerileri ve seçenekleri. */
  async oneriler(id: string) {
    const { tenantId } = aktifBaglam();
    const satir = await this.satirGetir(tenantId, id);
    const giris = !satir.tutar.isNegative();
    const mutlak = satir.tutar.abs();
    const doviz = satir.bankaHesap.dovizCinsi;

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kurallar = await tx.ekstreKurali.findMany({ where: { aktif: true } });
      const kural = kuralBul(kurallar, satir);
      const { cari, kaynak } = kural?.cariId
        ? { cari: await tx.cariHesap.findUnique({ where: { id: kural.cariId }, select: { id: true, kod: true, unvan: true } }), kaynak: "kural" as const }
        : await this.cariOner(tx, tenantId, satir);

      const [faturalar, mevcutFisler, cekler, kartlar, kasalar, bankalar, masrafKategorileri, gelirKategorileri] = await Promise.all([
        cari ? this.acikFaturalar(tx, cari.id, giris, mutlak, doviz) : Promise.resolve([]),
        this.mevcutFisAdaylari(tx, satir.bankaHesapId, giris, satir.tarih, mutlak),
        tx.cekSenet.findMany({
          where: giris
            ? { yon: "alinan", durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi"] }, dovizCinsi: doviz }
            : { yon: "verilen", durum: "verildi", dovizCinsi: doviz },
          select: { id: true, tur: true, portfoyNo: true, cekNo: true, vadeTarihi: true, tutar: true, durum: true, borclu: true, banka: true, cari: { select: { unvan: true } } },
          orderBy: { vadeTarihi: "asc" },
          take: 100,
        }),
        giris ? Promise.resolve([]) : this.kartlar(tx, doviz),
        tx.kasa.findMany({ where: { aktif: true, dovizCinsi: doviz }, select: { id: true, ad: true }, orderBy: { ad: "asc" } }),
        tx.bankaHesap.findMany({ where: { aktif: true, dovizCinsi: doviz, id: { not: satir.bankaHesapId } }, select: { id: true, ad: true, bankaAdi: true }, orderBy: { ad: "asc" } }),
        giris ? Promise.resolve([]) : tx.masrafKategori.findMany({ where: { aktif: true }, select: { id: true, ad: true, varsayilanKdvOrani: true }, orderBy: { ad: "asc" } }),
        giris ? tx.gelirKategori.findMany({ where: { aktif: true }, select: { id: true, ad: true }, orderBy: { ad: "asc" } }) : Promise.resolve([]),
      ]);

      const yakinlik = (vade: Date) => Math.abs(vade.getTime() - satir.tarih.getTime());
      return {
        satir: { id: satir.id, tarih: satir.tarih.toISOString().slice(0, 10), tutar: satir.tutar.toFixed(2), dovizCinsi: doviz, yon: giris ? "tahsilat" : "tediye", aciklama: satir.aciklama, karsiUnvan: satir.karsiUnvan, karsiIban: satir.karsiIban },
        kural: kural && { ...kural, satirAnahtari: kuralAnahtari(`${satir.aciklama} ${satir.karsiUnvan ?? ""}`) },
        onerilenCari: cari,
        cariEslesmeKaynagi: cari ? kaynak : null,
        faturalar,
        mevcutFisler,
        cekler: cekler
          .map((c) => ({ ...c, vadeTarihi: c.vadeTarihi.toISOString().slice(0, 10), tutar: c.tutar.toFixed(2), tamEslesme: c.tutar.equals(mutlak), _yakinlik: yakinlik(c.vadeTarihi) }))
          .sort((a, b) => Number(b.tamEslesme) - Number(a.tamEslesme) || a._yakinlik - b._yakinlik)
          .slice(0, 15)
          .map(({ _yakinlik, ...c }) => c),
        kartlar,
        virmanHesaplari: [...kasalar.map((k) => ({ tur: "kasa" as const, ...k })), ...bankalar.map((b) => ({ tur: "banka" as const, id: b.id, ad: b.ad, bankaAdi: b.bankaAdi }))],
        masrafKategorileri: masrafKategorileri.map((k) => ({ ...k, varsayilanKdvOrani: k.varsayilanKdvOrani?.toFixed(2) ?? null })),
        gelirKategorileri,
        // ENT-07: bu hesaptan aynı tutarda gönderilmiş/onaylı ödeme talimatları.
        odemeTalimatlari: giris ? [] : (await tx.bankaOdemeTalimati.findMany({
          where: { bankaHesapId: satir.bankaHesapId, durum: { in: ["gonderildi", "onaylandi"] }, tutar: mutlak },
          orderBy: { odemeTarihi: "asc" },
          select: { id: true, no: true, aliciUnvan: true, tutar: true, odemeTarihi: true, durum: true, aciklama: true },
        })).map((t) => ({ ...t, tutar: t.tutar.toFixed(2), odemeTarihi: t.odemeTarihi.toISOString().slice(0, 10), aciklamadaGeciyor: Boolean(t.no && satir.aciklama.includes(t.no)) })),
      };
    });
  }

  // ─── EŞLEŞTİRME ────────────────────────────────────────────────────────────

  async eslestir(id: string, girdi: EslestirGirdisi) {
    const { tenantId } = aktifBaglam();
    const satir = await this.satirGetir(tenantId, id);
    if (satir.durum === "eslesti") throw new ConflictException("Bu satır zaten eşleştirilmiş");
    await this.donemKilidi.tarihDogrula(tenantId, satir.tarih, "ekstre satırını eşleştirme");

    const giris = !satir.tutar.isNegative();
    const mutlak = satir.tutar.abs();
    const tarih = satir.tarih.toISOString().slice(0, 10);
    const tip = giris ? "tahsilat" : "tediye";
    const doviz = satir.bankaHesap.dovizCinsi;
    const aciklama = satir.aciklama.slice(0, 500);

    if (girdi.tur === "masraf" && giris) throw new BadRequestException("Masraf yalnız hesaptan para çıkışıyla eşleştirilir");
    if (girdi.tur === "gelir" && !giris) throw new BadRequestException("Gelir yalnız hesaba para girişiyle eşleştirilir");
    if (girdi.tur === "kredi_karti" && giris) throw new BadRequestException("Kredi kartı ödemesi yalnız hesaptan para çıkışıyla eşleştirilir");
    if (girdi.tur === "odeme_talimati" && giris) throw new BadRequestException("Ödeme talimatı yalnız hesaptan para çıkışıyla eşleştirilir");

    // Çek ve kredi kartı kendi servislerinin işleminde yürür: satır önce ayrıca sahiplenilir.
    if (girdi.tur === "cek" || girdi.tur === "kredi_karti") {
      await this.prisma.tenantIslem(tenantId, (tx) => this.sahiplen(tx, id, girdi.tur));
      try {
        const hareketId = girdi.tur === "cek"
          ? await this.cekIsle(tenantId, girdi.cekSenetId, satir.bankaHesapId, giris, mutlak, doviz, tarih)
          : (await this.krediKarti.ekstreOdeme({ krediKartiId: girdi.krediKartiId, bankaHesapId: satir.bankaHesapId, tarih, tutar: mutlak.toFixed(2), aciklama: aciklama.slice(0, 200) || "Kredi kartı ekstre ödemesi", belgeNo: satir.dekontNo })).bankaHareketId!;
        await this.prisma.tenantIslem(tenantId, (tx) => tx.kasaBankaHareket.update({ where: { id: hareketId }, data: { ekstreSatirId: id } }));
      } catch (hata) {
        await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaEkstreSatir.update({ where: { id }, data: { durum: satir.durum, eslesmeTuru: null, cariId: null } })).catch(() => undefined);
        throw hata;
      }
      return this.satirGetir(tenantId, id);
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const cariId = girdi.tur === "cari" ? girdi.cariId : null;
      const tekFatura = girdi.tur === "cari" && girdi.dagitim.length === 1 ? girdi.dagitim[0].faturaId : null;
      await this.sahiplen(tx, id, girdi.tur, cariId, tekFatura);
      const ortak = { kasaId: null, posHesapId: null, bankaHesapId: satir.bankaHesapId, dovizCinsi: doviz, tarih, aciklama };
      const hareketIdleri: string[] = [];

      switch (girdi.tur) {
        case "cari": {
          const dagitilan = girdi.dagitim.reduce((t, d) => t.add(d.tutar), D(0));
          if (dagitilan.greaterThan(mutlak)) throw new BadRequestException(`Faturalara dağıtılan ${dagitilan.toFixed(2)} ekstre tutarını (${mutlak.toFixed(2)}) aşamaz`);
          for (const d of girdi.dagitim) {
            hareketIdleri.push((await this.kasaBanka.hareketOlustur(tx, tenantId, { ...ortak, tip, tutar: D(d.tutar).toFixed(2), cariId: girdi.cariId, faturaId: d.faturaId })).id);
          }
          // Faturaya dağıtılmayan kısım carinin avansı / cari bakiyesi olarak işlenir.
          const kalan = mutlak.sub(dagitilan);
          if (kalan.gt(0)) hareketIdleri.push((await this.kasaBanka.hareketOlustur(tx, tenantId, { ...ortak, tip, tutar: kalan.toFixed(2), cariId: girdi.cariId, faturaId: null })).id);
          break;
        }
        case "mevcut_fis": {
          const fisler = await tx.kasaBankaHareket.findMany({ where: { id: { in: girdi.hareketIdleri } } });
          const uygun = fisler.filter((f) =>
            f.bankaHesapId === satir.bankaHesapId && !f.ekstreSatirId && f.kaynakTur !== "ters_kayit" && f.kaynakTur !== "acilis"
            && (giris ? ["tahsilat", "virman_gelis"] : ["tediye", "virman_gidis"]).includes(f.tip));
          if (uygun.length !== girdi.hareketIdleri.length) throw new BadRequestException("Seçilen fişlerden biri bu hesaba ait değil, yönü uyuşmuyor ya da zaten başka bir satıra bağlı");
          const toplam = uygun.reduce((t, f) => t.add(f.tutar), D(0));
          if (!toplam.equals(mutlak)) throw new BadRequestException(`Seçilen fişlerin toplamı ${toplam.toFixed(2)}, ekstre satırı ${mutlak.toFixed(2)}; tutarlar eşit olmalı`);
          hareketIdleri.push(...uygun.map((f) => f.id));
          break;
        }
        case "masraf": {
          const kategori = await tx.masrafKategori.findFirst({ where: { id: girdi.kategoriId, aktif: true } });
          if (!kategori) throw new BadRequestException("Aktif masraf kategorisi bulunamadı");
          const kur = doviz === "TRY" ? D(1) : await kurZorunlu(tx, doviz, satir.tarih);
          const kdvOrani = D(girdi.kdvOrani);
          const matrah = mutlak.div(kdvOrani.div(100).add(1)).toDecimalPlaces(2);
          const hareket = await tx.kasaBankaHareket.create({
            data: { tenantId, bankaHesapId: satir.bankaHesapId, tip: "tediye", tutar: mutlak, dovizCinsi: doviz, kur, tutarTry: mutlak.mul(kur).toDecimalPlaces(2), tarih: satir.tarih, aciklama: girdi.aciklama || aciklama, kaynakTur: "masraf" },
          });
          await tx.masraf.create({
            data: {
              tenantId, kategoriId: kategori.id, belgeTuru: "dekont", belgeNo: satir.dekontNo, tarih: satir.tarih, saticiUnvan: satir.karsiUnvan ?? satir.bankaHesap.ad,
              aciklama: girdi.aciklama || aciklama, matrah, kdvOrani, kdvTutari: mutlak.sub(matrah), toplam: mutlak, dovizCinsi: doviz, kur,
              durum: "onaylandi", odemeDurumu: "odendi", odenenTutar: mutlak, odemeTarihi: satir.tarih, bankaHesapId: satir.bankaHesapId, hareketId: hareket.id,
            },
          });
          hareketIdleri.push(hareket.id);
          break;
        }
        case "gelir": {
          const kategori = await tx.gelirKategori.findFirst({ where: { id: girdi.kategoriId, aktif: true } });
          if (!kategori) throw new BadRequestException("Aktif gelir kategorisi bulunamadı");
          const kur = doviz === "TRY" ? D(1) : await kurZorunlu(tx, doviz, satir.tarih);
          const tutarTry = mutlak.mul(kur).toDecimalPlaces(2);
          const hareket = await tx.kasaBankaHareket.create({
            data: { tenantId, bankaHesapId: satir.bankaHesapId, tip: "tahsilat", tutar: mutlak, dovizCinsi: doviz, kur, tutarTry, tarih: satir.tarih, aciklama: girdi.aciklama || aciklama, kaynakTur: "faturasiz_gelir" },
          });
          await tx.gelirKaydi.create({
            data: { tenantId, kategoriId: kategori.id, tarih: satir.tarih, brutTutar: mutlak, netTutar: mutlak, dovizCinsi: doviz, kur, netTutarTry: tutarTry, aciklama: girdi.aciklama || aciklama, belgeNo: satir.dekontNo, bankaHesapId: satir.bankaHesapId, hareketId: hareket.id },
          });
          hareketIdleri.push(hareket.id);
          break;
        }
        case "odeme_talimati": {
          const talimat = await tx.bankaOdemeTalimati.findUnique({ where: { id: girdi.talimatId }, select: { bankaHesapId: true, tutar: true, no: true } });
          if (!talimat || talimat.bankaHesapId !== satir.bankaHesapId) throw new BadRequestException("Talimat bu banka hesabından verilmemiş");
          if (!talimat.tutar.equals(mutlak)) throw new BadRequestException(`${talimat.no ?? "Talimat"} tutarı ${talimat.tutar.toFixed(2)}, ekstre satırı ${mutlak.toFixed(2)}; tutarlar eşit olmalı`);
          hareketIdleri.push(...(await this.odemeTalimati.gerceklestirTx(tx, tenantId, girdi.talimatId, tarih, null)).hareketIdleri);
          break;
        }
        case "virman": {
          const karsi = { kasaId: girdi.karsiKasaId ?? null, bankaHesapId: girdi.karsiBankaHesapId ?? null };
          const virman = {
            kaynakKasaId: giris ? karsi.kasaId : null, kaynakBankaHesapId: giris ? karsi.bankaHesapId : satir.bankaHesapId, kaynakPosHesapId: null,
            hedefKasaId: giris ? null : karsi.kasaId, hedefBankaHesapId: giris ? satir.bankaHesapId : karsi.bankaHesapId, hedefPosHesapId: null,
            tutar: mutlak.toFixed(2), tarih, aciklama: girdi.aciklama || aciklama,
          };
          const dovizCinsi = await this.kasaBanka.virmanKurallariniDenetle(virman);
          const { gidis, gelis } = await this.kasaBanka.virmanOlustur(tx, tenantId, virman, dovizCinsi, mutlak);
          // Yalnız bu hesabın bacağı bu satıra bağlanır; karşı bacak kendi ekstresini bekler.
          hareketIdleri.push(giris ? gelis.id : gidis.id);
          break;
        }
      }

      await tx.kasaBankaHareket.updateMany({ where: { id: { in: hareketIdleri } }, data: { ekstreSatirId: id } });
      if (girdi.kuralId) await tx.ekstreKurali.updateMany({ where: { id: girdi.kuralId }, data: { kullanimSayisi: { increment: 1 }, sonKullanim: new Date() } });
      if (girdi.kural) await this.kuralKaydet(tx, tenantId, satir, girdi);
      return tx.bankaEkstreSatir.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Banka masrafı, faiz gibi listeden düşürülecek satır; bakiyeye yansımaz. */
  async yoksay(id: string) {
    const { tenantId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.bankaEkstreSatir.updateMany({ where: { id, durum: { not: "eslesti" } }, data: { durum: "yoksayildi" } }),
    );
    if (sonuc.count !== 1) throw new ConflictException("Bu satır az önce eşleştirildi; listeyi yenileyin");
    return this.satirGetir(tenantId, id);
  }

  // ─── GERİ ALMA ─────────────────────────────────────────────────────────────

  /**
   * Eşleşmeyi bozar ve satırı yeniden onaya düşürür. Mevcut fiş yalnız bağdan
   * çözülür; eşleştirmenin ürettiği fiş, cari hareketi, masraf/gelir kaydı
   * silinir. Çek ve kredi kartı kendi geri almasıyla geri alınır.
   */
  async geriAl(id: string) {
    const { tenantId, userId } = aktifBaglam();
    const satir = await this.satirGetir(tenantId, id);
    if (satir.durum === "beklemede") throw new BadRequestException("Bu satır zaten onay bekliyor");
    const sifirla = { durum: "beklemede" as const, cariId: null, faturaId: null, eslesmeTuru: null };
    if (satir.durum === "yoksayildi") {
      return this.prisma.tenantIslem(tenantId, (tx) => tx.bankaEkstreSatir.update({ where: { id }, data: sifirla }));
    }
    await this.donemKilidi.tarihDogrula(tenantId, satir.tarih, "ekstre eşleşmesini geri alma");

    const hareketler = await this.prisma.tenantIslem(tenantId, (tx) => tx.kasaBankaHareket.findMany({
      where: { ekstreSatirId: id },
      include: { krediKartiOdemesi: { select: { id: true } } },
    }));
    const tur: EkstreEslesmeTuru = satir.eslesmeTuru ?? (hareketler.some((h) => h.kaynakTur === "pos_mutabakat") ? "pos" : "cari");
    const neden = "Banka ekstresi eşleşmesi geri alındı";

    if (tur === "cek") {
      const cekId = hareketler.find((h) => h.kaynakTur === "cek_senet")?.kaynakRef;
      if (cekId) await this.kasaBanka.cekSenetSonIslemiGeriAl(cekId, neden);
    } else if (tur === "kredi_karti") {
      const kartHareketi = hareketler.find((h) => h.krediKartiOdemesi)?.krediKartiOdemesi;
      if (kartHareketi) await this.krediKarti.hareketGeriAl(kartHareketi.id, neden);
    }

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const idler = hareketler.map((h) => h.id);
      if (tur === "mevcut_fis") {
        await tx.kasaBankaHareket.updateMany({ where: { id: { in: idler } }, data: { ekstreSatirId: null } });
      } else if (tur === "pos") {
        await this.posMutabakatiniSil(tx, tenantId, idler);
      } else if (tur !== "cek" && tur !== "kredi_karti") {
        let silinecek = idler;
        if (tur === "virman") {
          const karsiIdler = hareketler.map((h) => h.karsiHareketId).filter((x): x is string => Boolean(x));
          const karsilar = await tx.kasaBankaHareket.findMany({ where: { id: { in: karsiIdler } }, include: { ekstreSatir: { select: { tarih: true, aciklama: true } } } });
          const bagli = karsilar.find((k) => k.ekstreSatir && k.ekstreSatirId !== id);
          if (bagli?.ekstreSatir) throw new BadRequestException(`Virmanın karşı bacağı ${bagli.ekstreSatir.tarih.toISOString().slice(0, 10)} tarihli "${bagli.ekstreSatir.aciklama}" ekstre satırına da bağlı; önce onu geri alın`);
          silinecek = [...idler, ...karsiIdler];
        }
        await tx.masrafOdeme.deleteMany({ where: { tenantId, hareketId: { in: silinecek } } });
        await tx.masraf.deleteMany({ where: { hareketId: { in: silinecek } } });
        await tx.gelirKaydi.deleteMany({ where: { hareketId: { in: silinecek } } });
        await tx.cariHareket.deleteMany({ where: { kaynakTur: "kasa_banka", kaynakRef: { in: silinecek } } });
        await tx.kasaBankaHareket.deleteMany({ where: { id: { in: silinecek } } });
        if (tur === "odeme_talimati") {
          const talimatId = hareketler.find((h) => h.kaynakTur === "odeme_talimati")?.kaynakRef;
          if (talimatId) await this.odemeTalimati.ekstreEslesmesiGeriAlindi(tx, talimatId);
        }
      }
      await tx.auditLog.create({
        data: { tenantId, userId, islem: "ekstre_eslesmesi_geri_alindi", varlik: "kasa-banka", varlikId: id, detay: JSON.parse(JSON.stringify({ eslesmeTuru: tur, satir: { ...satir, bankaHesap: undefined }, hareketler })) as Prisma.InputJsonValue },
      });
      return tx.bankaEkstreSatir.update({ where: { id }, data: sifirla });
    });
  }

  // ─── KURALLAR ──────────────────────────────────────────────────────────────

  async kurallar() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kurallar = await tx.ekstreKurali.findMany({ orderBy: [{ aktif: "desc" }, { kullanimSayisi: "desc" }, { createdAt: "desc" }] });
      // Ad çözümü: kural kayıtları kimlik taşır, ekran adla gösterir.
      const idler = (alan: keyof (typeof kurallar)[number]) => [...new Set(kurallar.map((k) => k[alan]).filter((x): x is string => typeof x === "string"))];
      const [cariler, masraflar, gelirler, kasalar, bankalar] = await Promise.all([
        tx.cariHesap.findMany({ where: { id: { in: idler("cariId") } }, select: { id: true, unvan: true } }),
        tx.masrafKategori.findMany({ where: { id: { in: idler("masrafKategoriId") } }, select: { id: true, ad: true } }),
        tx.gelirKategori.findMany({ where: { id: { in: idler("gelirKategoriId") } }, select: { id: true, ad: true } }),
        tx.kasa.findMany({ where: { id: { in: idler("hedefKasaId") } }, select: { id: true, ad: true } }),
        tx.bankaHesap.findMany({ where: { id: { in: [...idler("hedefBankaHesapId"), ...idler("bankaHesapId")] } }, select: { id: true, ad: true } }),
      ]);
      const ad = new Map<string, string>([...cariler.map((c) => [c.id, c.unvan] as const), ...[...masraflar, ...gelirler, ...kasalar, ...bankalar].map((x) => [x.id, x.ad] as const)]);
      return kurallar.map((k) => ({
        ...k,
        hesapAdi: k.bankaHesapId ? ad.get(k.bankaHesapId) ?? null : null,
        hedefAdi: ad.get(k.cariId ?? k.masrafKategoriId ?? k.gelirKategoriId ?? k.hedefKasaId ?? k.hedefBankaHesapId ?? "") ?? null,
      }));
    });
  }

  async kuralGuncelle(id: string, girdi: z.infer<typeof ekstreKuralGuncelleSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.ekstreKurali.updateMany({ where: { id }, data: { ...girdi, ...(girdi.anahtar ? { anahtar: kuralAnahtari(girdi.anahtar) } : {}) } });
      if (sonuc.count !== 1) throw new NotFoundException("Kural bulunamadı");
      return tx.ekstreKurali.findUniqueOrThrow({ where: { id } });
    });
  }

  async kuralSil(id: string) {
    const { tenantId } = aktifBaglam();
    const sonuc = await this.prisma.tenantIslem(tenantId, (tx) => tx.ekstreKurali.deleteMany({ where: { id } }));
    if (sonuc.count !== 1) throw new NotFoundException("Kural bulunamadı");
  }

  // ─── YARDIMCILAR ───────────────────────────────────────────────────────────

  private async satirGetir(tenantId: string, id: string) {
    const satir = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaEkstreSatir.findUnique({
      where: { id },
      include: { bankaHesap: { select: { ad: true, dovizCinsi: true } }, _count: { select: { hareketler: true } } },
    }));
    if (!satir) throw new NotFoundException("Ekstre satırı bulunamadı");
    // Bağlı fiş başka ekrandan silinmişse satır kilitli kalmasın.
    if (satir.durum === "eslesti" && satir.eslesmeTuru && satir._count.hareketler === 0) {
      await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaEkstreSatir.update({ where: { id }, data: { durum: "beklemede", cariId: null, faturaId: null, eslesmeTuru: null } }));
      return { ...satir, durum: "beklemede" as const, eslesmeTuru: null };
    }
    return satir;
  }

  /** Satırı atomik olarak alır; eşzamanlı ikinci eşleştirme burada durur. */
  private async sahiplen(tx: Prisma.TransactionClient, id: string, tur: EkstreEslesmeTuru, cariId: string | null = null, faturaId: string | null = null) {
    const sonuc = await tx.bankaEkstreSatir.updateMany({
      where: { id, durum: { not: "eslesti" }, hareketler: { none: {} } },
      data: { durum: "eslesti", eslesmeTuru: tur, cariId, faturaId },
    });
    if (sonuc.count !== 1) throw new ConflictException("Bu satır az önce başka bir işlemle eşleştirildi; listeyi yenileyin");
  }

  /** Çeki tahsil eder / öder ve ürettiği banka fişinin kimliğini döner. */
  private async cekIsle(tenantId: string, cekSenetId: string, bankaHesapId: string, giris: boolean, mutlak: Prisma.Decimal, doviz: string, tarih: string): Promise<string> {
    const cek = await this.kasaBanka.cekSenetGetir(cekSenetId);
    if (cek.dovizCinsi !== doviz) throw new BadRequestException(`Çek ${cek.dovizCinsi}, banka hesabı ${doviz} cinsinden`);
    if (!cek.tutar.equals(mutlak)) throw new BadRequestException(`Çek tutarı ${cek.tutar.toFixed(2)}, ekstre satırı ${mutlak.toFixed(2)}; tutarlar eşit olmalı`);
    if ((cek.yon === "alinan") !== giris) throw new BadRequestException(giris ? "Para girişi yalnız alınan çekle eşleşir" : "Para çıkışı yalnız verilen çekle eşleşir");
    await this.kasaBanka.cekSenetGuncelle(cekSenetId, { durum: giris ? "tahsil_edildi" : "odendi", hesapBankaHesapId: bankaHesapId, islemTarihi: tarih, aciklama: "Banka ekstresinden" });
    const fis = await this.prisma.tenantIslem(tenantId, (tx) => tx.kasaBankaHareket.findFirst({
      where: { kaynakTur: "cek_senet", kaynakRef: cekSenetId, ekstreSatirId: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }));
    if (!fis) throw new BadRequestException("Çekin tahsil fişi oluşturulamadı");
    return fis.id;
  }

  /** POS mutabakatının virman bacaklarını ve komisyon masrafını siler. */
  private async posMutabakatiniSil(tx: Prisma.TransactionClient, tenantId: string, gelisIdleri: string[]) {
    const gelisler = await tx.kasaBankaHareket.findMany({ where: { id: { in: gelisIdleri } }, select: { id: true, karsiHareketId: true } });
    const gidisIdleri = gelisler.map((g) => g.karsiHareketId).filter((x): x is string => Boolean(x));
    const komisyonlar = (await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "pos_mutabakat", kaynakRef: { in: gidisIdleri } }, select: { id: true } })).map((k) => k.id);
    await tx.masrafOdeme.deleteMany({ where: { tenantId, hareketId: { in: komisyonlar } } });
    await tx.masraf.deleteMany({ where: { hareketId: { in: komisyonlar } } });
    await tx.kasaBankaHareket.deleteMany({ where: { id: { in: [...komisyonlar, ...gidisIdleri, ...gelisIdleri] } } });
  }

  private async kuralKaydet(tx: Prisma.TransactionClient, tenantId: string, satir: { bankaHesapId: string; tutar: Prisma.Decimal }, girdi: EslestirGirdisi) {
    if (!girdi.kural || !["cari", "masraf", "gelir", "virman"].includes(girdi.tur)) return;
    const anahtar = kuralAnahtari(girdi.kural.anahtar);
    if (anahtar.length < 3) throw new BadRequestException("Kural metni en az 3 karakter olmalıdır");
    const hedef = {
      cariId: girdi.tur === "cari" ? girdi.cariId : null,
      masrafKategoriId: girdi.tur === "masraf" ? girdi.kategoriId : null,
      gelirKategoriId: girdi.tur === "gelir" ? girdi.kategoriId : null,
      hedefKasaId: girdi.tur === "virman" ? girdi.karsiKasaId ?? null : null,
      hedefBankaHesapId: girdi.tur === "virman" ? girdi.karsiBankaHesapId ?? null : null,
    };
    const bankaHesapId = girdi.kural.tumHesaplar ? null : satir.bankaHesapId;
    const yon = satirYonu(satir.tutar);
    const mevcut = await tx.ekstreKurali.findFirst({ where: { bankaHesapId, anahtar, yon } });
    const veri = { eslesmeTuru: girdi.tur as EkstreEslesmeTuru, ...hedef, aktif: true };
    if (mevcut) await tx.ekstreKurali.update({ where: { id: mevcut.id }, data: veri });
    else await tx.ekstreKurali.create({ data: { tenantId, bankaHesapId, anahtar, yon, ...veri, kullanimSayisi: 1, sonKullanim: new Date() } });
  }

  /** Cari önerisi: karşı IBAN → açıklamadaki VKN → açıklamada geçen unvan. */
  private async cariOner(tx: Prisma.TransactionClient, tenantId: string, satir: { aciklama: string; karsiIban: string | null; karsiUnvan: string | null }) {
    const sec = { id: true, kod: true, unvan: true } as const;
    if (satir.karsiIban) {
      const iban = satir.karsiIban.replace(/\s/g, "").toUpperCase();
      const bankaKaydi = await tx.cariBankaHesap.findFirst({ where: { tenantId, iban }, select: { cari: { select: sec } } });
      const cari = bankaKaydi?.cari ?? await tx.cariHesap.findFirst({ where: { tenantId, iban }, select: sec });
      if (cari) return { cari, kaynak: "iban" as CariEslesmeKaynagi };
    }
    // Açıklamada VKN/TCKN geçiyorsa en güvenilir ikinci ipucudur.
    for (const aday of satir.aciklama.match(/\d{10,11}/g) ?? []) {
      const cari = await tx.cariHesap.findFirst({ where: { tenantId, vknTckn: aday }, select: sec });
      if (cari) return { cari, kaynak: "vkn" as CariEslesmeKaynagi };
    }
    // Son çare: açıklamada ya da karşı unvanda cari unvanı geçiyor mu? Karşılaştırma
    // ASCII'ye indirgenir (bankalar aksansız yazıyor); en uzun eşleşen unvan kazanır.
    const metin = metniNormalle(`${satir.aciklama} ${satir.karsiUnvan ?? ""}`);
    let enIyi: { id: string; kod: string; unvan: string } | null = null;
    for (const c of await tx.cariHesap.findMany({ where: { tenantId, aktif: true }, select: sec })) {
      const unvan = metniNormalle(c.unvan);
      if (unvan.length >= 4 && metin.includes(unvan) && unvan.length > (enIyi ? metniNormalle(enIyi.unvan).length : 0)) enIyi = c;
    }
    return { cari: enIyi, kaynak: (enIyi ? "unvan" : null) as CariEslesmeKaynagi };
  }

  /** Carinin bu yönde kalanı olan kesin faturaları; en eski vade önce (dağıtım sırası). */
  private async acikFaturalar(tx: Prisma.TransactionClient, cariId: string, giris: boolean, mutlak: Prisma.Decimal, hesapDovizi: string) {
    const faturalar = await tx.fatura.findMany({
      where: { cariId, durum: "kesin", tip: { in: giris ? ["satis", "alis_iade"] : ["alis", "satis_iade"] } },
      orderBy: [{ vadeTarihi: "asc" }, { tarih: "asc" }],
      take: 200,
      select: { id: true, no: true, tarih: true, vadeTarihi: true, durum: true, dovizCinsi: true, kur: true, genelToplam: true, ...FATURA_ODEME_SECIMI },
    });
    return faturalar
      .map((f) => ({ f, odeme: faturaOdemeDurumu(f) }))
      .filter(({ odeme }) => odeme.kalan.gt(0))
      .slice(0, 50)
      .map(({ f, odeme }) => ({
        id: f.id, no: f.no, tarih: f.tarih.toISOString().slice(0, 10), vadeTarihi: f.vadeTarihi?.toISOString().slice(0, 10) ?? null,
        dovizCinsi: f.dovizCinsi, kur: f.kur.toFixed(6), genelToplam: f.genelToplam.toFixed(2), odenen: odeme.odenen.toFixed(2), kalan: odeme.kalan.toFixed(2),
        /** Kalan tutar ekstre satırıyla aynı dövizde birebir aynıysa güçlü öneri. */
        tamEslesme: f.dovizCinsi === hesapDovizi && odeme.kalan.equals(mutlak),
      }));
  }

  /** Aynı hesapta, satıra bağlanmamış, yönü uyan ve tarihi ±7 gün içindeki fişler. */
  private async mevcutFisAdaylari(tx: Prisma.TransactionClient, bankaHesapId: string, giris: boolean, tarih: Date, mutlak: Prisma.Decimal) {
    const adaylar = await tx.kasaBankaHareket.findMany({
      where: {
        bankaHesapId, ekstreSatirId: null, kaynakTur: { notIn: ["ters_kayit", "acilis"] },
        tip: { in: giris ? ["tahsilat", "virman_gelis"] : ["tediye", "virman_gidis"] },
        tarih: { gte: new Date(tarih.getTime() - 7 * GUN), lte: new Date(tarih.getTime() + 7 * GUN) },
        tutar: { lte: mutlak },
      },
      orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: { id: true, tip: true, tarih: true, tutar: true, aciklama: true, kaynakTur: true, cari: { select: { unvan: true } }, fatura: { select: { no: true } } },
    });
    const geriAlinan = new Set((await tx.kasaBankaHareket.findMany({ where: { kaynakTur: "ters_kayit", kaynakRef: { in: adaylar.map((a) => a.id) } }, select: { kaynakRef: true } })).map((t) => t.kaynakRef));
    return adaylar
      .filter((a) => !geriAlinan.has(a.id))
      .map((a) => ({ ...a, tarih: a.tarih.toISOString().slice(0, 10), tutar: a.tutar.toFixed(2), tamEslesme: a.tutar.equals(mutlak) }))
      .sort((a, b) => Number(b.tamEslesme) - Number(a.tamEslesme));
  }

  /** Kart ekstre ödemesi için aynı dövizdeki aktif kartlar ve güncel borçları. */
  private async kartlar(tx: Prisma.TransactionClient, doviz: string) {
    const kartlar = await tx.krediKarti.findMany({ where: { aktif: true, dovizCinsi: doviz as never }, select: { id: true, ad: true, bankaAdi: true, sonDortHane: true }, orderBy: { ad: "asc" } });
    const gruplar = await tx.krediKartiHareket.groupBy({ by: ["krediKartiId", "tip"], where: { krediKartiId: { in: kartlar.map((k) => k.id) } }, _sum: { tutar: true } });
    return kartlar.map((k) => {
      const borc = gruplar.filter((g) => g.krediKartiId === k.id).reduce((t, g) => (["harcama", "faiz", "aidat"].includes(g.tip) ? t.add(g._sum.tutar ?? 0) : t.sub(g._sum.tutar ?? 0)), D(0));
      return { ...k, borc: Prisma.Decimal.max(borc, 0).toFixed(2) };
    });
  }
}
