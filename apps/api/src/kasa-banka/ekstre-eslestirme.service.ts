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
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { type DovizCinsi, type EkstreEslesmeTuru, Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { kurZorunlu } from "../doviz/kur-coz";
import { FATURA_ODEME_SECIMI, faturaOdemeDurumu } from "../fatura/odeme-durumu";
import { kuralAnahtari, kuralBul, satirYonu } from "./ekstre-kural";
import { metniNormalle } from "./ekstre-oku";
import { cariyiAdlaBul, karsiTarafAdaylari, kendiAdlariniBul, maasOdemesiMi } from "./ekstre-karsi-taraf";
import { OdemeTalimatiService } from "./odeme-talimati.service";
import { DovizIslemService } from "./doviz-islem.service";
import { KasaBankaService } from "./kasa-banka.service";
import type { ekstreEslestirSemasi, ekstreKuralGuncelleSemasi } from "./kasa-banka.semalar";
import { KrediKartiService } from "./kredi-karti.service";
import { KrediService } from "./kredi.service";
import { MevzuatService } from "../mevzuat/mevzuat.service";
import { z as zod } from "zod";
import { kiraciSaglayicisi } from "../ai/saglayici/kiraci-saglayici";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const GUN = 86_400_000;

export type CariEslesmeKaynagi = "aciklama" | "iban" | "vkn" | "unvan" | "kural" | "fatura_no" | "tutar" | "yapay_zeka" | null;
type EslestirGirdisi = z.infer<typeof ekstreEslestirSemasi>;

@Injectable()
export class EkstreEslestirmeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kasaBanka: KasaBankaService,
    private readonly krediKarti: KrediKartiService,
    private readonly donemKilidi: DonemKilidiService,
    private readonly odemeTalimati: OdemeTalimatiService,
    private readonly dovizIslem: DovizIslemService,
    private readonly kredi: KrediService,
    @Optional() private readonly mevzuat?: MevzuatService,
  ) {}

  // ─── ÖNERİLER ──────────────────────────────────────────────────────────────

  /** Seçilen satır için bütün eşleme türlerinin önerileri ve seçenekleri. */
  async oneriler(id: string) {
    const { tenantId } = aktifBaglam();
    const satir = await this.satirGetir(tenantId, id);
    const giris = !satir.tutar.isNegative();
    const mutlak = satir.tutar.abs();
    const doviz = satir.bankaHesap.dovizCinsi;
    const sonuc = await this.temelOneriler(tenantId, satir, giris, mutlak, doviz);
    // Açıklamadan ad çıktıysa ama cari belirsizse (ör. aynı unvanlı iki kart) model de aynı adı bulur; çağrılmaz.
    if (sonuc.onerilenCari || sonuc.kural || sonuc.adAdayiVar) return sonuc;
    // AI-19: kurallar cari bulamadıysa dil modeli açıklamadan karşı tarafı çıkarır.
    // Çağrı veritabanı işleminin dışında yapılır; hata ya da onay yoksa öneri yalnız atlanır.
    const ai = await this.yapayZekaCariOnerisi(tenantId, satir).catch(() => null);
    if (!ai) return sonuc;
    const faturalar = await this.prisma.tenantIslem(tenantId, (tx) => this.acikFaturalar(tx, ai.cari.id, giris, mutlak, doviz));
    return { ...sonuc, onerilenCari: ai.cari, cariEslesmeKaynagi: "yapay_zeka" as CariEslesmeKaynagi, cariGerekcesi: ai.gerekce, faturalar };
  }

  private async temelOneriler(
    tenantId: string,
    satir: Awaited<ReturnType<EkstreEslestirmeService["satirGetir"]>>,
    giris: boolean,
    mutlak: Prisma.Decimal,
    doviz: DovizCinsi,
  ) {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kurallar = await tx.ekstreKurali.findMany({ where: { aktif: true } });
      const kural = kuralBul(kurallar, satir);
      const { cari, kaynak, gerekce, adAdayiVar } = kural?.cariId
        ? { cari: await tx.cariHesap.findUnique({ where: { id: kural.cariId }, select: { id: true, kod: true, unvan: true } }), kaynak: "kural" as const, gerekce: undefined, adAdayiVar: false }
        : await this.cariOner(tx, tenantId, satir, { giris, mutlak, doviz });

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
        ...(cari && gerekce ? { cariGerekcesi: gerekce } : {}),
        adAdayiVar: Boolean(adAdayiVar),
        faturalar,
        mevcutFisler,
        cekler: cekler
          .map((c) => ({ ...c, vadeTarihi: c.vadeTarihi.toISOString().slice(0, 10), tutar: c.tutar.toFixed(2), tamEslesme: c.tutar.equals(mutlak), _yakinlik: yakinlik(c.vadeTarihi) }))
          .sort((a, b) => Number(b.tamEslesme) - Number(a.tamEslesme) || a._yakinlik - b._yakinlik)
          .slice(0, 15)
          .map(({ _yakinlik, ...c }) => c),
        kartlar,
        virmanHesaplari: [...kasalar.map((k) => ({ tur: "kasa" as const, ...k })), ...bankalar.map((b) => ({ tur: "banka" as const, id: b.id, ad: b.ad, bankaAdi: b.bankaAdi }))],
        // P1-2a: döviz alım/satımının karşı tarafı olabilecek, başka dövizdeki hesaplar.
        dovizHesaplari: [
          ...(await tx.kasa.findMany({ where: { aktif: true, dovizCinsi: { not: doviz } }, select: { id: true, ad: true, dovizCinsi: true }, orderBy: { ad: "asc" } })).map((k) => ({ tur: "kasa" as const, ...k })),
          ...(await tx.bankaHesap.findMany({ where: { aktif: true, dovizCinsi: { not: doviz } }, select: { id: true, ad: true, dovizCinsi: true }, orderBy: { ad: "asc" } })).map((b) => ({ tur: "banka" as const, ...b })),
        ],
        masrafKategorileri: masrafKategorileri.map((k) => ({ ...k, varsayilanKdvOrani: k.varsayilanKdvOrani?.toFixed(2) ?? null })),
        gelirKategorileri,
        // ENT-07: bu hesaptan aynı tutarda gönderilmiş/onaylı ödeme talimatları.
        odemeTalimatlari: giris ? [] : (await tx.bankaOdemeTalimati.findMany({
          where: { bankaHesapId: satir.bankaHesapId, durum: { in: ["gonderildi", "onaylandi"] }, tutar: mutlak },
          orderBy: { odemeTarihi: "asc" },
          select: { id: true, no: true, aliciUnvan: true, tutar: true, odemeTarihi: true, durum: true, aciklama: true },
        })).map((t) => ({ ...t, tutar: t.tutar.toFixed(2), odemeTarihi: t.odemeTarihi.toISOString().slice(0, 10), aciklamadaGeciyor: Boolean(t.no && satir.aciklama.includes(t.no)) })),
        // KRD-04: bu hesaba bağlı aktif krediler; taksitlide ilk ödenmemiş taksit, tutarı satırla aynıysa öne.
        krediler: (await tx.bankaKredisi.findMany({
          // Çıkışta kredinin dövizindeki bütün krediler (ödeme başka hesaptan olabilir); girişte yalnız bu hesabın rotatifi.
          where: { durum: "aktif", ...(giris ? { tur: "rotatif", bankaHesapId: satir.bankaHesapId } : { dovizCinsi: doviz }) },
          include: { taksitler: { where: { islemId: null }, orderBy: { sira: "asc" }, take: 1 } },
          orderBy: { kullanimTarihi: "asc" },
        })).map((k) => {
          const t = k.taksitler[0];
          const toplam = t ? t.anapara.add(t.faiz).add(t.bsmv).add(t.kkdf) : null;
          return {
            id: k.id, ad: k.ad, tur: k.tur,
            siradakiTaksit: t ? { id: t.id, sira: t.sira, vadeTarihi: t.vadeTarihi.toISOString().slice(0, 10), anapara: t.anapara.toFixed(2), faiz: t.faiz.toFixed(2), bsmv: t.bsmv.toFixed(2), kkdf: t.kkdf.toFixed(2), toplam: toplam!.toFixed(2), tutarTutuyor: toplam!.equals(mutlak) } : null,
          };
        }),
      };
    });
  }

  // ─── TOPLU ONAY (KSB-33) ───────────────────────────────────────────────────

  /**
   * Satırın belirsizliği olmayan eşleşmesi; yoksa null. Yalnız şunlar kesindir:
   * - ödeme talimatı: aynı tutarda, numarası açıklamada geçen TEK talimat;
   * - kural: hedefi tanımlı masraf / gelir / virman kuralı;
   * - cari: kural, IBAN, VKN ya da fatura numarasıyla bulunmuş cari ve kalan
   *   tutarı satırla birebir aynı TEK açık fatura.
   * Ad benzerliği, yapay zekâ ve yalnız tutar eşleşmesi kesin sayılmaz; o
   * satırlar tek tek onaylanır.
   */
  async kesinOneri(id: string): Promise<{ girdi: EslestirGirdisi; ozet: string } | null> {
    const { tenantId } = aktifBaglam();
    const satir = await this.satirGetir(tenantId, id);
    if (satir.durum !== "beklemede") return null;
    const giris = !satir.tutar.isNegative();
    const mutlak = satir.tutar.abs();
    const o = await this.temelOneriler(tenantId, satir, giris, mutlak, satir.bankaHesap.dovizCinsi);

    const anilanlar = o.odemeTalimatlari.filter((t) => t.aciklamadaGeciyor);
    if (anilanlar.length === 1) {
      const t = anilanlar[0];
      return { girdi: { tur: "odeme_talimati", talimatId: t.id }, ozet: `${t.no} ödeme talimatı (${t.aliciUnvan})` };
    }

    const k = o.kural;
    if (k?.eslesmeTuru === "masraf" && k.masrafKategoriId && !giris) {
      const kategori = o.masrafKategorileri.find((m) => m.id === k.masrafKategoriId);
      if (kategori) return { girdi: { tur: "masraf", kategoriId: kategori.id, kdvOrani: kategori.varsayilanKdvOrani ? String(Number(kategori.varsayilanKdvOrani)) : "0", kuralId: k.id }, ozet: `Masraf: ${kategori.ad} (kural "${k.anahtar}")` };
    }
    if (k?.eslesmeTuru === "gelir" && k.gelirKategoriId && giris) {
      const kategori = o.gelirKategorileri.find((g) => g.id === k.gelirKategoriId);
      if (kategori) return { girdi: { tur: "gelir", kategoriId: kategori.id, kuralId: k.id }, ozet: `Gelir: ${kategori.ad} (kural "${k.anahtar}")` };
    }
    if (k?.eslesmeTuru === "virman" && (k.hedefKasaId || k.hedefBankaHesapId)) {
      const hedef = o.virmanHesaplari.find((h) => h.id === (k.hedefKasaId ?? k.hedefBankaHesapId));
      if (hedef) return { girdi: { tur: "virman", karsiKasaId: k.hedefKasaId ?? null, karsiBankaHesapId: k.hedefBankaHesapId ?? null, kuralId: k.id }, ozet: `Virman: ${hedef.ad} (kural "${k.anahtar}")` };
    }

    const kesinKaynak: CariEslesmeKaynagi[] = ["kural", "iban", "vkn", "fatura_no"];
    const tamFaturalar = o.faturalar.filter((f) => f.tamEslesme);
    if (o.onerilenCari && kesinKaynak.includes(o.cariEslesmeKaynagi) && tamFaturalar.length === 1) {
      const f = tamFaturalar[0];
      return {
        girdi: { tur: "cari", cariId: o.onerilenCari.id, dagitim: [{ faturaId: f.id, tutar: mutlak.toFixed(2) }], ...(o.cariEslesmeKaynagi === "kural" && k ? { kuralId: k.id } : {}) },
        ozet: `${o.onerilenCari.unvan}, ${f.no ?? "fatura"} kapanır`,
      };
    }
    return null;
  }

  /** Bekleyen satırlardan kesin önerisi olanlar; toplu onay ekranı için. */
  async kesinOneriler(bankaHesapId?: string) {
    const { tenantId } = aktifBaglam();
    const satirlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.bankaEkstreSatir.findMany({
      where: { durum: "beklemede", ...(bankaHesapId ? { bankaHesapId } : {}) },
      orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
      take: 200,
      select: { id: true, tarih: true, tutar: true, aciklama: true, bankaHesap: { select: { ad: true, dovizCinsi: true } } },
    }));
    const sonuc = [];
    for (const s of satirlar) {
      const oneri = await this.kesinOneri(s.id);
      if (oneri) sonuc.push({ satirId: s.id, tarih: s.tarih.toISOString().slice(0, 10), tutar: s.tutar.toFixed(2), dovizCinsi: s.bankaHesap.dovizCinsi, bankaHesap: s.bankaHesap.ad, aciklama: s.aciklama, tur: oneri.girdi.tur, ozet: oneri.ozet });
    }
    return sonuc;
  }

  /**
   * Seçilen satırları kesin önerileriyle eşleştirir. Öneri sunucuda yeniden
   * hesaplanır (istemcinin gönderdiği eşleşmeye güvenilmez); arada değişen ya
   * da artık kesin olmayan satır atlanır. Her satır kendi işlemindedir; biri
   * başarısız olursa diğerleri etkilenmez.
   */
  async topluEslestir(satirIdleri: string[]) {
    const sonuclar: { satirId: string; durum: "eslesti" | "atlandi" | "hata"; mesaj: string }[] = [];
    for (const satirId of satirIdleri) {
      try {
        const oneri = await this.kesinOneri(satirId);
        if (!oneri) { sonuclar.push({ satirId, durum: "atlandi", mesaj: "Satırın artık kesin bir eşleşmesi yok; tek tek eşleştirin" }); continue; }
        await this.eslestir(satirId, oneri.girdi);
        sonuclar.push({ satirId, durum: "eslesti", mesaj: oneri.ozet });
      } catch (hata) {
        sonuclar.push({ satirId, durum: "hata", mesaj: hata instanceof Error ? hata.message : "Eşleştirilemedi" });
      }
    }
    return { eslesen: sonuclar.filter((s) => s.durum === "eslesti").length, atlanan: sonuclar.filter((s) => s.durum === "atlandi").length, hatali: sonuclar.filter((s) => s.durum === "hata").length, sonuclar };
  }

  // ─── EŞLEŞTİRME ────────────────────────────────────────────────────────────

  async eslestir(id: string, girdi: EslestirGirdisi) {
    const { tenantId } = aktifBaglam();
    const satir = await this.satirGetir(tenantId, id);
    if (satir.durum === "eslesti") throw new ConflictException("Bu satır zaten eşleştirilmiş");
    await this.donemKilidi.tarihDogrula(tenantId, satir.tarih, "ekstre satırını eşleştirme");
    // MVZ-11: KDV oranı belge tarihindeki merkezi listeden olmalı.
    if (girdi.tur === "masraf") await this.mevzuat?.kdvOranlariniDogrula([girdi.kdvOrani], satir.tarih);

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
    if (girdi.tur === "kredi" && giris !== (girdi.islem === "kullanim")) throw new BadRequestException(giris ? "Hesaba giriş yalnız rotatif kredi kullanımıyla eşleştirilir" : "Kredi kullanımı yalnız hesaba girişle eşleştirilir");

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
          const kur = doviz === "TRY" ? D(1) : await kurZorunlu(tx, doviz, satir.tarih, "alis");
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
        case "kredi": {
          // KRD-04: taksitte tutar verilmezse plandaki tutarlar; toplam satırla tutmalıdır.
          const taksit = girdi.islem === "taksit" && girdi.taksitId ? await tx.bankaKrediTaksiti.findUnique({ where: { id: girdi.taksitId } }) : null;
          const parca = (deger: string | null | undefined, plan: Prisma.Decimal | undefined) => (deger ?? plan?.toFixed(2) ?? "0");
          const tutarlar = {
            anapara: parca(girdi.anapara, taksit?.anapara ?? (girdi.islem === "faiz" ? undefined : mutlak)),
            faiz: parca(girdi.faiz, taksit?.faiz),
            bsmv: parca(girdi.bsmv, taksit?.bsmv),
            kkdf: parca(girdi.kkdf, taksit?.kkdf),
          };
          const toplam = girdi.islem === "kullanim" ? D(tutarlar.anapara) : Object.values(tutarlar).reduce((t, v) => t.add(v), D(0));
          if (!toplam.equals(mutlak)) throw new BadRequestException(`Kredi tutarları toplamı ${toplam.toFixed(2)}, ekstre satırı ${mutlak.toFixed(2)}; anapara, faiz ve vergileri bankanın tahsil ettiğine göre düzeltin`);
          // Kullanım kredinin hesabına girer; ödeme kredinin dövizindeki herhangi bir hesaptan olabilir.
          const kredi = await tx.bankaKredisi.findUnique({ where: { id: girdi.krediId }, select: { bankaHesapId: true } });
          if (girdi.islem === "kullanim" && kredi?.bankaHesapId !== satir.bankaHesapId) throw new BadRequestException("Kredi kullanımı yalnız kredinin bağlı olduğu hesabın ekstresinden eşleştirilir");
          hareketIdleri.push(await this.kredi.islemTx(tx, tenantId, girdi.krediId, { tip: girdi.islem, taksitId: girdi.taksitId ?? null, bankaHesapId: satir.bankaHesapId, tarih, ...tutarlar, aciklama, eksiBakiyeOnay: true }, id));
          break;
        }
        case "doviz_islem": {
          // Satır işlemin bu hesaptaki bacağıdır: giriş satırı giren, çıkış satırı çıkan taraftır.
          const karsi = { kasaId: girdi.karsiKasaId ?? null, bankaHesapId: girdi.karsiBankaHesapId ?? null };
          const islem = await this.dovizIslem.olusturTx(tx, tenantId, {
            kaynakKasaId: giris ? karsi.kasaId : null, kaynakBankaHesapId: giris ? karsi.bankaHesapId : satir.bankaHesapId,
            hedefKasaId: giris ? null : karsi.kasaId, hedefBankaHesapId: giris ? satir.bankaHesapId : karsi.bankaHesapId,
            cikanTutar: giris ? girdi.karsiTutar : mutlak.toFixed(2), girenTutar: giris ? mutlak.toFixed(2) : girdi.karsiTutar,
            tarih, aciklama: girdi.aciklama || aciklama, masrafHesabi: "cikan",
          });
          hareketIdleri.push(giris ? islem.gelisHareketId : islem.gidisHareketId);
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
      } else if (tur === "doviz_islem") {
        const islemId = hareketler.find((h) => h.kaynakTur === "doviz_islem")?.kaynakRef;
        if (islemId) await this.dovizIslem.geriAlTx(tx, tenantId, islemId, neden, id);
      } else if (tur === "pos") {
        await this.posMutabakatiniSil(tx, tenantId, idler);
      } else if (tur === "kredi") {
        for (const hareketId of idler) await this.kredi.islemSilTx(tx, hareketId);
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

  /**
   * Cari önerisi: açıklamadaki karşı taraf adı (KSB-17) → karşı IBAN →
   * açıklamadaki VKN → açıklamada geçen tam unvan → fatura no → tek tutan fatura.
   */
  private async cariOner(
    tx: Prisma.TransactionClient,
    tenantId: string,
    satir: { aciklama: string; karsiIban: string | null; karsiUnvan: string | null },
    tutar?: { giris: boolean; mutlak: Prisma.Decimal; doviz: DovizCinsi },
  ): Promise<{ cari: { id: string; kod: string; unvan: string } | null; kaynak: CariEslesmeKaynagi; gerekce?: string; adAdayiVar?: boolean }> {
    const sec = { id: true, kod: true, unvan: true } as const;
    // KSB-17: bankalar karşı tarafı çoğu kez yalnız açıklamaya yazar (IBAN/unvan sütunu boş).
    // Firmanın kendi adı son ekstre satırlarından öğrenilir ki gönderen/alıcıdaki kendi adı aday olmasın.
    let adAdayiVar = false;
    if (tutar) {
      const sonSatirlar = await tx.bankaEkstreSatir.findMany({ where: { tenantId }, orderBy: { tarih: "desc" }, take: 300, select: { aciklama: true, tutar: true } });
      const kendiAdlari = kendiAdlariniBul(sonSatirlar.map((x) => ({ aciklama: x.aciklama, giris: !x.tutar.isNegative() })));
      const adaylar = karsiTarafAdaylari(satir.aciklama, satir.karsiUnvan, tutar.giris, kendiAdlari);
      if (adaylar.length) {
        adAdayiVar = true;
        const cariler = await tx.cariHesap.findMany({ where: { tenantId, aktif: true }, select: { ...sec, tip: true } });
        // KSB-18: maaş ödemesinde aynı kişinin müşteri kartı da olabilir; önce personel kartları denenir.
        const personeller = !tutar.giris && maasOdemesiMi(satir.aciklama) ? cariler.filter((c) => c.tip === "personel") : [];
        const maas = personeller.length ? cariyiAdlaBul(adaylar, personeller) : null;
        const bulunan = maas ?? cariyiAdlaBul(adaylar, cariler);
        if (bulunan) {
          const { tip: _tip, ...cari } = bulunan.cari;
          return { cari, kaynak: "aciklama", gerekce: `Açıklamadaki ${bulunan.kaynak}: “${bulunan.ad}” (benzerlik %${Math.round(bulunan.puan * 100)})${maas ? "; maaş ödemesi, personel kartı" : ""}.` };
        }
      }
    }
    if (satir.karsiIban) {
      const iban = satir.karsiIban.replace(/\s/g, "").toUpperCase();
      const bankaKaydi = await tx.cariBankaHesap.findFirst({ where: { tenantId, iban }, select: { cari: { select: sec } } });
      const cari = bankaKaydi?.cari ?? await tx.cariHesap.findFirst({ where: { tenantId, iban }, select: sec });
      if (cari) return { cari, kaynak: "iban" as CariEslesmeKaynagi };
    }
    // Açıklamada VKN/TCKN geçiyorsa en güvenilir ikinci ipucudur.
    for (const aday of satir.aciklama.match(/\d{10,11}/g) ?? []) {
      const cari = await tx.cariHesap.findFirst({ where: { tenantId, vknTckn: aday, birlestigiCariId: null }, select: sec });
      if (cari) return { cari, kaynak: "vkn" as CariEslesmeKaynagi };
    }
    // Son çare: açıklamada ya da karşı unvanda cari unvanı geçiyor mu? Karşılaştırma
    // ASCII'ye indirgenir (bankalar aksansız yazıyor); en uzun eşleşen unvan kazanır.
    const metin = metniNormalle(`${satir.aciklama} ${satir.karsiUnvan ?? ""}`);
    let enIyi: { id: string; kod: string; unvan: string } | null = null;
    let esUnvanli = false;
    for (const c of await tx.cariHesap.findMany({ where: { tenantId, aktif: true }, select: sec })) {
      const unvan = metniNormalle(c.unvan);
      if (unvan.length < 4 || !metin.includes(unvan)) continue;
      const enIyiUnvan = enIyi ? metniNormalle(enIyi.unvan) : "";
      if (unvan === enIyiUnvan) esUnvanli = true;
      else if (unvan.length > enIyiUnvan.length) { enIyi = c; esUnvanli = false; }
    }
    // Aynı unvanlı iki kart varsa (mükerrer cari) hangisi olduğu bilinemez; rastgele seçilmez.
    if (enIyi && !esUnvanli) return { cari: enIyi, kaynak: "unvan" as CariEslesmeKaynagi };
    // AI-19: açıklamada GİB biçimli fatura numarası (3 harf + 13 rakam) geçiyorsa o faturanın carisi.
    for (const no of `${satir.aciklama} ${satir.karsiUnvan ?? ""}`.toUpperCase().match(/\b[A-Z0-9]{3}20\d{11}\b/g) ?? []) {
      const f = await tx.fatura.findFirst({ where: { tenantId, no, durum: "kesin" }, select: { cari: { select: sec } } });
      if (f) return { cari: f.cari, kaynak: "fatura_no" as CariEslesmeKaynagi };
    }
    // AI-19: kalanı satırla birebir tutan açık fatura yalnız bir carideyse o cari.
    if (tutar) {
      const adaylar = await tx.fatura.findMany({
        where: { tenantId, durum: "kesin", dovizCinsi: tutar.doviz, tip: { in: tutar.giris ? ["satis", "alis_iade"] : ["alis", "satis_iade"] }, genelToplam: { gte: tutar.mutlak } },
        select: { durum: true, genelToplam: true, cari: { select: sec }, ...FATURA_ODEME_SECIMI },
        take: 500,
      });
      const tutanlar = new Map(adaylar.filter((f) => faturaOdemeDurumu(f).kalan.equals(tutar.mutlak)).map((f) => [f.cari.id, f.cari]));
      if (tutanlar.size === 1) return { cari: [...tutanlar.values()][0], kaynak: "tutar" as CariEslesmeKaynagi };
    }
    return { cari: null, kaynak: null as CariEslesmeKaynagi, adAdayiVar };
  }

  /**
   * AI-19: dil modeline yalnız satırın açıklaması ve karşı unvanı verilir; dönen
   * karşı taraf adı cari unvanlarında aranır. Tek aday çıkarsa öneri olur.
   */
  private async yapayZekaCariOnerisi(tenantId: string, satir: { aciklama: string; karsiUnvan: string | null }) {
    const { saglayici } = await kiraciSaglayicisi(this.prisma, tenantId, { ozellik: "ekstre" });
    if (saglayici.saglayiciAdi === "tanimsiz") return null;
    const sonuc = await saglayici.yapilandirilmisUretim(
      {
        sistemRol: "Banka ekstresi satırının açıklamasından ödemeyi yapan/alan karşı tarafın (firma ya da kişi) adını çıkarırsın. Banka adı, işlem türü (EFT, HAVALE, FAST), referans ve tutarı ad sayma. Emin değilsen null ver.",
        prompt: `Açıklama: ${satir.aciklama}\nKarşı unvan: ${satir.karsiUnvan ?? "-"}\nJSON: {"karsiTarafAdi": string | null, "gerekce": string}`,
        // Kısa çıkarım; qwen düşünmeyle 60 sn'yi aşabiliyor (kullanıcı ekranda bekliyor).
        dusunmeKapali: true,
      },
      zod.object({ karsiTarafAdi: zod.string().nullable(), gerekce: zod.string().default("") }),
    );
    const kelimeler = metniNormalle(sonuc.karsiTarafAdi ?? "").split(/\s+/).filter((k) => k.length >= 3 && !/\d/.test(k) && !["LTD", "STI", "SAN", "TIC", "VE", "A.S", "AS"].includes(k.toUpperCase()));
    if (!kelimeler.length) return null;
    const sec = { id: true, kod: true, unvan: true } as const;
    const cariler = await this.prisma.tenantIslem(tenantId, (tx) => tx.cariHesap.findMany({ where: { tenantId, aktif: true }, select: sec }));
    const puanli = cariler
      .map((c) => ({ c, puan: kelimeler.filter((k) => metniNormalle(c.unvan).includes(k)).length }))
      .filter((x) => x.puan > 0)
      .sort((a, b) => b.puan - a.puan);
    if (!puanli.length || (puanli[1] && puanli[1].puan === puanli[0].puan)) return null;
    return { cari: puanli[0].c, gerekce: `Yapay zekâ açıklamadan “${sonuc.karsiTarafAdi}” adını çıkardı${sonuc.gerekce ? `: ${sonuc.gerekce}` : ""}.` };
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
