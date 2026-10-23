/**
 * KSB-07: gerçekleşen kur farkı ve dönem sonu döviz değerlemesi.
 *
 * Dövizli faturanın tahsil/ödemesi fatura kurundan farklı bir kurla
 * gerçekleşince kur farkı doğar (`kurFarkiTry`: mahsubun ödeme günü TL değeri −
 * fatura kurundaki TL değeri). Bu fark vergi açısından faturalanır:
 * - **Lehimize** fark (tahsilatta fazla TL, ödemede eksik TL) için biz karşı
 *   tarafa KDV'li TL kur farkı faturası keseriz; burada taslağı oluşturulur.
 * - **Aleyhimize** farkta faturayı karşı taraf keser; gelen fatura bu
 *   ödemelerle eşleştirilir.
 * Kur farkı KDV dahil bedel sayılır (asıl faturanın oranı, iç yüzdeyle).
 * Fatura gerektirmeyen önemsiz farklar kapatılabilir.
 *
 * Dönem sonu değerleme yalnız bilgi raporudur; kayıt ve fatura üretmez.
 */
import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { bugunTR } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { kurZorunlu } from "../doviz/kur-coz";
import { FaturaService } from "./fatura.service";
import { faturaOlusturSemasi } from "./fatura.semalar";
import { kurFarkiSatirlari, kurFarkiYonu } from "./kur-farki-kural";
import { kurFarkiTry } from "./odeme-durumu";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const KUR_FARKI_STOK_KODU = "KUR-FARKI";

export type KurFarkiDurumu = "bekleyen" | "islenen";

@Injectable()
export class KurFarkiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fatura: FaturaService,
  ) {}

  /**
   * Gerçekleşen kur farkları. "bekleyen": henüz faturalanmamış ya da
   * kapatılmamış (faturası iptal edilen de buraya döner); "islenen":
   * faturalanmış, gelen faturayla eşleşmiş ya da kapatılmış.
   */
  async liste(durum: KurFarkiDurumu, baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => this.kalemleriOku(tx, { durum, baslangic, bitis }));
  }

  /**
   * Lehimize kur farklarından taslak TL satış faturası oluşturur. Seçilen
   * ödemeler aynı cariye ait ve "biz keseriz" yönünde olmalıdır.
   */
  async faturaOlustur(hareketIdleri: string[]) {
    const { tenantId } = aktifBaglam();
    const kalemler = await this.prisma.tenantIslem(tenantId, (tx) => this.kalemleriOku(tx, { durum: "bekleyen", hareketIdleri }));
    if (kalemler.length !== new Set(hareketIdleri).size) throw new BadRequestException("Seçilen ödemelerden biri artık bekleyen kur farkı değil; listeyi yenileyin");
    if (new Set(kalemler.map((k) => k.cari.id)).size !== 1) throw new BadRequestException("Bir kur farkı faturası yalnız tek bir cari için kesilir");
    if (kalemler.some((k) => k.yon !== "biz_keseriz")) throw new BadRequestException("Aleyhimize kur farkının faturasını karşı taraf keser; gelen faturayla eşleştirin");

    const stokId = await this.kurFarkiKarti(tenantId);
    // Tedarikçiye ödemede lehimize fark doğduysa ona satış faturası kesilir;
    // satış faturası müşteri tipi istediğinden cari "her ikisi"ne genişletilir.
    const cariGenisletildi = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const sonuc = await tx.cariHesap.updateMany({ where: { id: kalemler[0].cari.id, tip: "tedarikci" }, data: { tip: "her_ikisi" } });
      return sonuc.count > 0;
    });
    const faturaNolari = [...new Set(kalemler.map((k) => k.fatura.no ?? "numarasız"))];
    const girdi = faturaOlusturSemasi.parse({
      tip: "satis",
      cariId: kalemler[0].cari.id,
      tarih: bugunTR(),
      dovizCinsi: "TRY",
      aciklama: faturaNolari.length > 1
        ? `Kur farkı faturası — ${faturaNolari.join(", ")} numaralı faturaların ödemelerinden doğan kur farkı`
        : `Kur farkı faturası — ${faturaNolari[0]} numaralı faturanın ödemesinden doğan kur farkı`,
      // Kur farkı KDV dahil bedeldir; matrah iç yüzdeyle ayrılır.
      satirlar: kurFarkiSatirlari(kalemler).map((s) => ({
        stokId,
        miktar: "1",
        birim: "adet",
        birimFiyat: s.matrah.toFixed(2),
        kdvOrani: s.kdvOrani.toFixed(2),
        gibIstisnaKodu: s.gibIstisnaKodu,
      })),
    });
    const fatura = await this.fatura.olustur(girdi);
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.kasaBankaHareket.updateMany({ where: { id: { in: hareketIdleri } }, data: { kurFarkiFaturaId: fatura.id } });
      await tx.faturaKapama.updateMany({ where: { id: { in: hareketIdleri } }, data: { kurFarkiFaturaId: fatura.id } });
    });
    return { faturaId: fatura.id, cariGenisletildi, toplam: kalemler.reduce((t, k) => t.add(D(k.kurFarkiTry).abs()), D(0)).toFixed(2) };
  }

  /** Karşı tarafın kestiği (gelen) kur farkı faturasını ödemelere bağlar. */
  async gelenFaturaylaEslestir(hareketIdleri: string[], faturaId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kalemler = await this.kalemleriOku(tx, { durum: "bekleyen", hareketIdleri });
      if (kalemler.length !== new Set(hareketIdleri).size) throw new BadRequestException("Seçilen ödemelerden biri artık bekleyen kur farkı değil; listeyi yenileyin");
      if (kalemler.some((k) => k.yon !== "karsi_taraf_keser")) throw new BadRequestException("Lehimize kur farkının faturasını biz keseriz; gelen faturayla eşleştirilmez");
      const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, select: { id: true, tip: true, cariId: true, durum: true } });
      if (!fatura || fatura.durum === "iptal") throw new BadRequestException("Fatura bulunamadı");
      if (fatura.tip !== "alis") throw new BadRequestException("Karşı tarafın kestiği kur farkı faturası alış faturası olarak kayıtlı olmalıdır");
      if (kalemler.some((k) => k.cari.id !== fatura.cariId)) throw new BadRequestException("Fatura seçilen ödemelerin carisine ait değil");
      await tx.kasaBankaHareket.updateMany({ where: { id: { in: hareketIdleri } }, data: { kurFarkiFaturaId: faturaId } });
      await tx.faturaKapama.updateMany({ where: { id: { in: hareketIdleri } }, data: { kurFarkiFaturaId: faturaId } });
      return { eslesen: kalemler.length };
    });
  }

  /** Fatura gerektirmeyen (ör. önemsiz) kur farklarını listeden kapatır. */
  async kapat(hareketIdleri: string[]) {
    const { tenantId } = aktifBaglam();
    const kapatilan = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const hareket = await tx.kasaBankaHareket.updateMany({
        where: { id: { in: hareketIdleri }, OR: [{ kurFarkiFaturaId: null }, { kurFarkiFatura: { durum: "iptal" } }] },
        data: { kurFarkiKapandi: true, kurFarkiFaturaId: null },
      });
      const iptaller = await this.iptalKurFarkiFaturalari(tx, hareketIdleri);
      const kapama = await tx.faturaKapama.updateMany({
        where: { id: { in: hareketIdleri }, OR: [{ kurFarkiFaturaId: null }, { kurFarkiFaturaId: { in: iptaller } }] },
        data: { kurFarkiKapandi: true, kurFarkiFaturaId: null },
      });
      return hareket.count + kapama.count;
    });
    return { kapatilan };
  }

  /** KSB-22: elle bağlamaların kur farkı faturalarından iptal edilmiş olanlar. */
  private async iptalKurFarkiFaturalari(tx: Prisma.TransactionClient, kapamaIdleri: string[]) {
    const kapamalar = await tx.faturaKapama.findMany({ where: { id: { in: kapamaIdleri }, kurFarkiFaturaId: { not: null } }, select: { kurFarkiFaturaId: true } });
    if (!kapamalar.length) return [];
    return (await tx.fatura.findMany({ where: { id: { in: kapamalar.map((k) => k.kurFarkiFaturaId!) }, durum: "iptal" }, select: { id: true } })).map((f) => f.id);
  }

  /**
   * Kapatılmış ya da gelen faturayla eşleştirilmiş kur farklarını yeniden
   * bekleyenlere alır. Bizim kestiğimiz kur farkı faturası bağı buradan
   * çözülmez: taslak silinir ya da fatura iptal edilir, kalem kendiliğinden döner.
   */
  async geriAc(hareketIdleri: string[]) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const hareketler = await tx.kasaBankaHareket.findMany({
        where: { id: { in: hareketIdleri } },
        select: { id: true, kurFarkiKapandi: true, kurFarkiFatura: { select: { tip: true, durum: true, no: true } } },
      });
      const kapamalar = await tx.faturaKapama.findMany({ where: { id: { in: hareketIdleri } }, select: { id: true, kurFarkiKapandi: true, kurFarkiFaturaId: true } });
      const kapamaFaturalari = new Map((await tx.fatura.findMany({
        where: { id: { in: kapamalar.map((k) => k.kurFarkiFaturaId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, tip: true, durum: true, no: true },
      })).map((f) => [f.id, f]));
      const tumu = [
        ...hareketler,
        ...kapamalar.map((k) => ({ id: k.id, kurFarkiKapandi: k.kurFarkiKapandi, kurFarkiFatura: k.kurFarkiFaturaId ? kapamaFaturalari.get(k.kurFarkiFaturaId) ?? null : null })),
      ];
      const kendiFaturamiz = tumu.find((h) => h.kurFarkiFatura && h.kurFarkiFatura.tip === "satis" && h.kurFarkiFatura.durum !== "iptal");
      if (kendiFaturamiz) {
        const f = kendiFaturamiz.kurFarkiFatura!;
        throw new BadRequestException(
          f.durum === "taslak"
            ? "Bu kur farkı için taslak satış faturası var; taslağı silin, kalem bekleyenlere kendiliğinden döner"
            : `Bu kur farkı ${f.no ?? ""} numaralı satış faturasıyla faturalandı; geri almak için faturayı iptal edin`,
        );
      }
      const sonuc = await tx.kasaBankaHareket.updateMany({
        where: { id: { in: hareketler.map((h) => h.id) } },
        data: { kurFarkiKapandi: false, kurFarkiFaturaId: null },
      });
      const kapamaSonuc = await tx.faturaKapama.updateMany({ where: { id: { in: kapamalar.map((k) => k.id) } }, data: { kurFarkiKapandi: false, kurFarkiFaturaId: null } });
      return { acilan: sonuc.count + kapamaSonuc.count };
    });
  }

  /**
   * Dönem sonu döviz değerlemesi (bilgi): açık dövizli cari bakiyeleri ve
   * döviz kasa/banka hesapları seçilen günün TCMB döviz alış kuruyla yeniden
   * değerlenir; doğacak kur farkı gelir/gider olarak raporlanır.
   */
  async degerleme(tarihMetni?: string) {
    const { tenantId } = aktifBaglam();
    const tarih = tarihMetni ? new Date(tarihMetni) : new Date(bugunTR());
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kurlar = new Map<string, Prisma.Decimal>();
      const kurAl = async (doviz: string) => {
        if (!kurlar.has(doviz)) kurlar.set(doviz, await kurZorunlu(tx, doviz, tarih, "alis", tenantId));
        return kurlar.get(doviz)!;
      };
      const tarihSonu = { lte: tarih };

      const cariGruplari = await tx.cariHareket.groupBy({
        by: ["cariId", "dovizCinsi", "tip"],
        where: { dovizCinsi: { not: "TRY" }, tarih: tarihSonu },
        _sum: { tutar: true, tutarTry: true },
      });
      const cariBakiye = new Map<string, { cariId: string; doviz: string; doviz_: Prisma.Decimal; try_: Prisma.Decimal }>();
      for (const g of cariGruplari) {
        const anahtar = `${g.cariId}|${g.dovizCinsi}`;
        const b = cariBakiye.get(anahtar) ?? { cariId: g.cariId, doviz: g.dovizCinsi, doviz_: D(0), try_: D(0) };
        const isaret = g.tip === "borc" ? 1 : -1;
        b.doviz_ = b.doviz_.add(D(g._sum.tutar ?? 0).mul(isaret));
        b.try_ = b.try_.add(D(g._sum.tutarTry ?? 0).mul(isaret));
        cariBakiye.set(anahtar, b);
      }
      const acikCariler = [...cariBakiye.values()].filter((b) => !b.doviz_.isZero());
      const cariAdlari = new Map((await tx.cariHesap.findMany({ where: { id: { in: acikCariler.map((b) => b.cariId) } }, select: { id: true, kod: true, unvan: true } })).map((c) => [c.id, c]));

      const cariler = [];
      for (const b of acikCariler) {
        const kur = await kurAl(b.doviz);
        const guncel = b.doviz_.mul(kur).toDecimalPlaces(2);
        cariler.push({
          cari: cariAdlari.get(b.cariId) ?? { id: b.cariId, kod: "", unvan: "" },
          dovizCinsi: b.doviz,
          dovizBakiye: b.doviz_.toFixed(2),
          kayitliTry: b.try_.toFixed(2),
          kur: kur.toFixed(4),
          guncelTry: guncel.toFixed(2),
          // Alacak bakiyesinde (borç > 0) kur artışı gelir; borç bakiyesinde gider.
          kurFarki: guncel.sub(b.try_).toFixed(2),
        });
      }

      const hesapHareketleri = await tx.kasaBankaHareket.groupBy({
        by: ["kasaId", "bankaHesapId", "dovizCinsi", "tip"],
        where: { dovizCinsi: { not: "TRY" }, posHesapId: null, tarih: tarihSonu },
        _sum: { tutar: true, tutarTry: true },
      });
      const hesapBakiye = new Map<string, { kasaId: string | null; bankaHesapId: string | null; doviz: string; doviz_: Prisma.Decimal; try_: Prisma.Decimal }>();
      for (const g of hesapHareketleri) {
        const anahtar = `${g.kasaId ?? ""}|${g.bankaHesapId ?? ""}`;
        const b = hesapBakiye.get(anahtar) ?? { kasaId: g.kasaId, bankaHesapId: g.bankaHesapId, doviz: g.dovizCinsi, doviz_: D(0), try_: D(0) };
        const isaret = g.tip === "tahsilat" || g.tip === "virman_gelis" ? 1 : -1;
        b.doviz_ = b.doviz_.add(D(g._sum.tutar ?? 0).mul(isaret));
        b.try_ = b.try_.add(D(g._sum.tutarTry ?? 0).mul(isaret));
        hesapBakiye.set(anahtar, b);
      }
      const [kasalar, bankalar] = await Promise.all([
        tx.kasa.findMany({ where: { dovizCinsi: { not: "TRY" } }, select: { id: true, ad: true } }),
        tx.bankaHesap.findMany({ where: { dovizCinsi: { not: "TRY" } }, select: { id: true, ad: true } }),
      ]);
      const hesapAdi = new Map([...kasalar.map((k) => [k.id, `Kasa · ${k.ad}`] as const), ...bankalar.map((b) => [b.id, `Banka · ${b.ad}`] as const)]);
      const hesaplar = [];
      for (const b of [...hesapBakiye.values()].filter((x) => !x.doviz_.isZero())) {
        const kur = await kurAl(b.doviz);
        const guncel = b.doviz_.mul(kur).toDecimalPlaces(2);
        hesaplar.push({
          hesap: hesapAdi.get(b.kasaId ?? b.bankaHesapId ?? "") ?? "—",
          dovizCinsi: b.doviz,
          dovizBakiye: b.doviz_.toFixed(2),
          kayitliTry: b.try_.toFixed(2),
          kur: kur.toFixed(4),
          guncelTry: guncel.toFixed(2),
          kurFarki: guncel.sub(b.try_).toFixed(2),
        });
      }
      const toplam = (liste: Array<{ kurFarki: string }>) => liste.reduce((t, x) => t.add(x.kurFarki), D(0)).toFixed(2);
      return {
        degerlemeTarihi: tarih.toISOString().slice(0, 10),
        kurTipi: "TCMB döviz alış",
        kurlar: Object.fromEntries([...kurlar].map(([d, k]) => [d, k.toFixed(4)])),
        cariler,
        hesaplar,
        toplamCariKurFarki: toplam(cariler),
        toplamHesapKurFarki: toplam(hesaplar),
      };
    });
  }

  // ─── YARDIMCILAR ───────────────────────────────────────────────────────────

  private async kalemleriOku(tx: Prisma.TransactionClient, suzgec: { durum: KurFarkiDurumu; hareketIdleri?: string[]; baslangic?: string; bitis?: string }) {
    const bekleyenKosulu: Prisma.KasaBankaHareketWhereInput = {
      kurFarkiKapandi: false,
      OR: [{ kurFarkiFaturaId: null }, { kurFarkiFatura: { durum: "iptal" } }],
    };
    const hareketler = await tx.kasaBankaHareket.findMany({
      where: {
        ...(suzgec.durum === "bekleyen" ? bekleyenKosulu : { NOT: bekleyenKosulu }),
        ...(suzgec.hareketIdleri ? { id: { in: suzgec.hareketIdleri } } : {}),
        ...(suzgec.baslangic || suzgec.bitis ? { tarih: { ...(suzgec.baslangic ? { gte: new Date(suzgec.baslangic) } : {}), ...(suzgec.bitis ? { lte: new Date(suzgec.bitis) } : {}) } } : {}),
        faturaId: { not: null },
        faturaMahsubu: { gt: 0 },
        kaynakTur: { not: "ters_kayit" },
        fatura: { dovizCinsi: { not: "TRY" } },
      },
      orderBy: [{ tarih: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, tip: true, tarih: true, tutar: true, dovizCinsi: true, tutarTry: true, faturaKarsiligi: true, faturaMahsubu: true,
        kurFarkiKapandi: true,
        kurFarkiFatura: { select: { id: true, no: true, tip: true, durum: true, tarih: true } },
        kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } }, posHesap: { select: { ad: true } },
        fatura: {
          select: {
            id: true, no: true, tip: true, dovizCinsi: true, kur: true,
            cari: { select: { id: true, kod: true, unvan: true } },
            satirlar: { select: { kdvOrani: true, matrah: true, gibIstisnaKodu: true } },
          },
        },
      },
    });
    const geriAlinan = new Set((await tx.kasaBankaHareket.findMany({
      where: { kaynakTur: "ters_kayit", kaynakRef: { in: hareketler.map((h) => h.id) } },
      select: { kaynakRef: true },
    })).map((t) => t.kaynakRef));

    const hareketKalemleri = hareketler
      .filter((h) => !geriAlinan.has(h.id) && h.fatura)
      .map((h) => {
        const fatura = h.fatura!;
        const fark = D(kurFarkiTry(h, fatura.kur));
        // Asıl faturanın en büyük matrahlı satırının KDV oranı / istisna kodu.
        const baskin = [...fatura.satirlar].sort((a, b) => b.matrah.comparedTo(a.matrah))[0];
        const karsilik = h.faturaKarsiligi ?? h.faturaMahsubu!;
        return {
          hareketId: h.id,
          tarih: h.tarih.toISOString().slice(0, 10),
          tip: h.tip,
          hesap: h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "—",
          tutar: h.tutar.toFixed(2),
          dovizCinsi: h.dovizCinsi,
          cari: fatura.cari,
          fatura: { id: fatura.id, no: fatura.no, tip: fatura.tip, dovizCinsi: fatura.dovizCinsi, kur: fatura.kur.toFixed(4) },
          mahsup: h.faturaMahsubu!.toFixed(2),
          odemeKuru: karsilik.gt(0) ? h.tutarTry.div(karsilik).toFixed(4) : null,
          kurFarkiTry: fark.toFixed(2),
          yon: kurFarkiYonu(h.tip, fark),
          kdvOrani: (baskin?.kdvOrani ?? D(20)).toFixed(2),
          gibIstisnaKodu: baskin?.gibIstisnaKodu ?? null,
          kapandi: h.kurFarkiKapandi,
          kurFarkiFaturasi: h.kurFarkiFatura && h.kurFarkiFatura.durum !== "iptal"
            ? { id: h.kurFarkiFatura.id, no: h.kurFarkiFatura.no, tip: h.kurFarkiFatura.tip, durum: h.kurFarkiFatura.durum, tarih: h.kurFarkiFatura.tarih.toISOString().slice(0, 10) }
            : null,
        };
      })
      .filter((k) => D(k.kurFarkiTry).abs().gte(D("0.01")));
    return [...hareketKalemleri, ...(await this.baglamaKalemleri(tx, suzgec))]
      .sort((a, b) => b.tarih.localeCompare(a.tarih));
  }

  /**
   * KSB-22: fişin sonradan (elle) farklı dövizli faturaya bağlanan kısmı. Kalem
   * kimliği kapamanınkidir; fark = ödemenin TL değeri − karşılığın fatura kurundaki TL değeri.
   */
  private async baglamaKalemleri(tx: Prisma.TransactionClient, suzgec: { durum: KurFarkiDurumu; hareketIdleri?: string[]; baslangic?: string; bitis?: string }) {
    const kapamalar = await tx.faturaKapama.findMany({
      where: {
        kaynakTutari: { not: null },
        kasaBankaHareketId: { not: null },
        fatura: { dovizCinsi: { not: "TRY" } },
        ...(suzgec.hareketIdleri ? { id: { in: suzgec.hareketIdleri } } : {}),
        ...(suzgec.baslangic || suzgec.bitis ? { kasaBankaHareket: { tarih: { ...(suzgec.baslangic ? { gte: new Date(suzgec.baslangic) } : {}), ...(suzgec.bitis ? { lte: new Date(suzgec.bitis) } : {}) } } } : {}),
      },
      select: {
        id: true, tutar: true, kaynakTutari: true, kaynakTutariTry: true, kurFarkiFaturaId: true, kurFarkiKapandi: true,
        kasaBankaHareket: { select: { tip: true, tarih: true, dovizCinsi: true, kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } }, posHesap: { select: { ad: true } } } },
        fatura: { select: { id: true, no: true, tip: true, dovizCinsi: true, kur: true, cari: { select: { id: true, kod: true, unvan: true } }, satirlar: { select: { kdvOrani: true, matrah: true, gibIstisnaKodu: true } } } },
      },
    });
    const kfIdleri = kapamalar.map((k) => k.kurFarkiFaturaId).filter((x): x is string => Boolean(x));
    const kfFaturalari = new Map((kfIdleri.length ? await tx.fatura.findMany({ where: { id: { in: kfIdleri } }, select: { id: true, no: true, tip: true, durum: true, tarih: true } }) : []).map((f) => [f.id, f]));
    return kapamalar.map((k) => {
      const kf = k.kurFarkiFaturaId ? kfFaturalari.get(k.kurFarkiFaturaId) : undefined;
      const faturali = Boolean(kf && kf.durum !== "iptal");
      return { k, kf: faturali ? kf! : null, bekleyen: !k.kurFarkiKapandi && !faturali };
    }).filter((x) => (suzgec.durum === "bekleyen") === x.bekleyen).map(({ k, kf }) => {
      const h = k.kasaBankaHareket!;
      const fatura = k.fatura;
      const fark = k.kaynakTutariTry!.sub(k.tutar.mul(fatura.kur)).toDecimalPlaces(2);
      const baskin = [...fatura.satirlar].sort((a, b) => b.matrah.comparedTo(a.matrah))[0];
      return {
        hareketId: k.id,
        tarih: h.tarih.toISOString().slice(0, 10),
        tip: h.tip,
        hesap: h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "—",
        tutar: k.kaynakTutari!.toFixed(2),
        dovizCinsi: h.dovizCinsi,
        cari: fatura.cari,
        fatura: { id: fatura.id, no: fatura.no, tip: fatura.tip, dovizCinsi: fatura.dovizCinsi, kur: fatura.kur.toFixed(4) },
        mahsup: k.tutar.toFixed(2),
        odemeKuru: k.kaynakTutariTry!.div(k.tutar).toFixed(4),
        kurFarkiTry: fark.toFixed(2),
        yon: kurFarkiYonu(h.tip, fark),
        kdvOrani: (baskin?.kdvOrani ?? D(20)).toFixed(2),
        gibIstisnaKodu: baskin?.gibIstisnaKodu ?? null,
        kapandi: k.kurFarkiKapandi,
        kurFarkiFaturasi: kf ? { id: kf.id, no: kf.no, tip: kf.tip, durum: kf.durum, tarih: kf.tarih.toISOString().slice(0, 10) } : null,
      };
    }).filter((x) => D(x.kurFarkiTry).abs().gte(D("0.01")));
  }

  /** Kur farkı faturalarının hizmet kartı; yoksa bir kez oluşturulur. */
  private async kurFarkiKarti(tenantId: string): Promise<string> {
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await tx.stokKart.findFirst({ where: { kod: KUR_FARKI_STOK_KODU }, select: { id: true } });
      if (mevcut) return mevcut.id;
      const kart = await tx.stokKart.create({ data: { tenantId, kod: KUR_FARKI_STOK_KODU, ad: "Kur farkı", tip: "hizmet" } });
      return kart.id;
    });
  }
}
