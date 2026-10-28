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
import { cariDenklestir } from "./denklestirme";
import { kurFarkiKalemleri, type KurFarkiDurumu } from "./kur-farki-kalem";
import { kurFarkiKarsiligiYaz, kurFarkiKarsiliginiCoz } from "./kur-farki-karsilik";
import { kurFarkiSatirlari } from "./kur-farki-kural";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);
const KUR_FARKI_STOK_KODU = "KUR-FARKI";

export type { KurFarkiDurumu };

@Injectable()
export class KurFarkiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fatura: FaturaService,
  ) {}

  /**
   * Gerçekleşen kur farkları (KSB-26: her kapamadan). "bekleyen": henüz
   * faturalanmamış ya da kapatılmamış (faturası iptal edilen de buraya
   * döner); "islenen": faturalanmış, gelen faturayla eşleşmiş ya da kapatılmış.
   */
  async liste(durum: KurFarkiDurumu, baslangic?: string, bitis?: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => kurFarkiKalemleri(tx, tenantId, { durum, baslangic, bitis }));
  }

  /** Seçilen bekleyen kalemler; eksik varsa liste bayattır. */
  private async bekleyenler(tx: Prisma.TransactionClient, tenantId: string, kalemIdleri: string[]) {
    const kalemler = await kurFarkiKalemleri(tx, tenantId, { durum: "bekleyen", kalemIdleri });
    if (kalemler.length !== new Set(kalemIdleri).size) throw new BadRequestException("Seçilen kalemlerden biri artık bekleyen kur farkı değil; listeyi yenileyin");
    return kalemler;
  }

  /** KSB-26: işlenen kalemin otomatik kapaması sabitlenir; yeniden denkleştirme onu dağıtmaz. */
  private async kalemleriYaz(tx: Prisma.TransactionClient, kalemIdleri: string[], veri: { kurFarkiFaturaId: string | null; kurFarkiKapandi: boolean }) {
    await tx.faturaKapama.updateMany({ where: { id: { in: kalemIdleri } }, data: { ...veri, otomatik: false } });
  }

  /**
   * Lehimize kur farklarından taslak TL satış faturası oluşturur. Seçilen
   * kalemler aynı cariye ait, "biz keseriz" yönünde ve yurt içi olmalıdır.
   */
  async faturaOlustur(kalemIdleri: string[]) {
    const { tenantId } = aktifBaglam();
    const kalemler = await this.prisma.tenantIslem(tenantId, (tx) => this.bekleyenler(tx, tenantId, kalemIdleri));
    if (new Set(kalemler.map((k) => k.cari.id)).size !== 1) throw new BadRequestException("Bir kur farkı faturası yalnız tek bir cari için kesilir");
    if (kalemler.some((k) => k.yon !== "biz_keseriz")) throw new BadRequestException("Aleyhimize kur farkının faturasını karşı taraf keser; gelen faturayla eşleştirin");
    // KSB-28: yurt dışı işlemde kur farkı faturası kesilmez; fark 646/656'ya kapatılır.
    if (kalemler.some((k) => k.yurtDisi)) throw new BadRequestException("Yurt dışı işlemde kur farkı faturası kesilmez; kalemi \"kur farkı geliri/gideri olarak kapat\" ile işleyin");

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
      // KSB-27: fark asıl faturanın KDV/istisna/tevkifat gruplarına bölünür; ödenecek tutardan matrah bulunur.
      satirlar: kurFarkiSatirlari(kalemler).map((s) => ({
        stokId,
        miktar: "1",
        birim: "adet",
        birimFiyat: s.matrah.toFixed(2),
        kdvOrani: s.kdvOrani.toFixed(2),
        gibIstisnaKodu: s.gibIstisnaKodu,
        tevkifatKodu: s.tevkifatKodu,
      })),
    });
    const fatura = await this.fatura.olustur(girdi);
    await this.prisma.tenantIslem(tenantId, (tx) => this.kalemleriYaz(tx, kalemIdleri, { kurFarkiFaturaId: fatura.id, kurFarkiKapandi: false }));
    return { faturaId: fatura.id, cariGenisletildi, toplam: kalemler.reduce((t, k) => t.add(D(k.kurFarkiTry).abs()), D(0)).toFixed(2) };
  }

  /** Karşı tarafın kestiği (gelen) kur farkı faturasını kalemlere bağlar; fatura kesinse ödenmez sayılır (KSB-29). */
  async gelenFaturaylaEslestir(kalemIdleri: string[], faturaId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kalemler = await this.bekleyenler(tx, tenantId, kalemIdleri);
      if (kalemler.some((k) => k.yon !== "karsi_taraf_keser")) throw new BadRequestException("Lehimize kur farkının faturasını biz keseriz; gelen faturayla eşleştirilmez");
      const fatura = await tx.fatura.findUnique({ where: { id: faturaId }, select: { id: true, tip: true, cariId: true, durum: true } });
      if (!fatura || fatura.durum === "iptal") throw new BadRequestException("Fatura bulunamadı");
      if (fatura.tip !== "alis") throw new BadRequestException("Karşı tarafın kestiği kur farkı faturası alış faturası olarak kayıtlı olmalıdır");
      if (kalemler.some((k) => k.cari.id !== fatura.cariId)) throw new BadRequestException("Fatura seçilen kalemlerin carisine ait değil");
      await this.kalemleriYaz(tx, kalemIdleri, { kurFarkiFaturaId: faturaId, kurFarkiKapandi: false });
      await kurFarkiKarsiligiYaz(tx, tenantId, faturaId);
      await cariDenklestir(tx, tenantId, fatura.cariId);
      return { eslesen: kalemler.length };
    });
  }

  /**
   * Fatura gerektirmeyen kur farklarını kapatır: önemsiz farklar ve (KSB-28)
   * yurt dışı işlemler. Kapatılan fark muhasebe aktarımında 646/656'ya gider.
   */
  async kapat(kalemIdleri: string[]) {
    const { tenantId } = aktifBaglam();
    const kapatilan = await this.prisma.tenantIslem(tenantId, async (tx) => {
      const kalemler = await this.bekleyenler(tx, tenantId, kalemIdleri);
      await this.kalemleriYaz(tx, kalemler.map((k) => k.hareketId), { kurFarkiFaturaId: null, kurFarkiKapandi: true });
      return kalemler.length;
    });
    return { kapatilan };
  }

  /**
   * Kapatılmış ya da gelen faturayla eşleştirilmiş kur farklarını yeniden
   * bekleyenlere alır. Bizim kestiğimiz kur farkı faturası bağı buradan
   * çözülmez: taslak silinir ya da fatura iptal edilir, kalem kendiliğinden döner.
   */
  async geriAc(kalemIdleri: string[]) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kapamalar = await tx.faturaKapama.findMany({
        where: { id: { in: kalemIdleri } },
        select: { id: true, cariId: true, kurFarkiFatura: { select: { id: true, tip: true, durum: true, no: true } } },
      });
      const kendiFaturamiz = kapamalar.find((k) => k.kurFarkiFatura && k.kurFarkiFatura.tip === "satis" && k.kurFarkiFatura.durum !== "iptal");
      if (kendiFaturamiz) {
        const f = kendiFaturamiz.kurFarkiFatura!;
        throw new BadRequestException(
          f.durum === "taslak"
            ? "Bu kur farkı için taslak satış faturası var; taslağı silin, kalem bekleyenlere kendiliğinden döner"
            : `Bu kur farkı ${f.no ?? ""} numaralı satış faturasıyla faturalandı; geri almak için faturayı iptal edin`,
        );
      }
      const gelenler = [...new Set(kapamalar.map((k) => k.kurFarkiFatura?.id).filter((x): x is string => Boolean(x)))];
      const sonuc = await tx.faturaKapama.updateMany({ where: { id: { in: kapamalar.map((k) => k.id) } }, data: { kurFarkiKapandi: false, kurFarkiFaturaId: null } });
      // KSB-29: kalemi kalmayan gelen kur farkı faturasının karşılığı çözülür (fatura yeniden açık borç olur).
      for (const id of gelenler) {
        if (!(await tx.faturaKapama.count({ where: { kurFarkiFaturaId: id } })) && !(await tx.kasaBankaHareket.count({ where: { kurFarkiFaturaId: id } }))) {
          await kurFarkiKarsiliginiCoz(tx, tenantId, id);
        }
      }
      for (const cariId of new Set(kapamalar.map((k) => k.cariId))) await cariDenklestir(tx, tenantId, cariId);
      return { acilan: sonuc.count };
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
