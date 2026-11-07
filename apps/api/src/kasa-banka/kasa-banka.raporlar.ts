import { Prisma } from "@prisma/client";
import { registerRapor, type RaporFiltreDegerleri } from "../core/raporlar/rapor-kayit";
import { kurBul } from "../doviz/kur-coz";
import { mutabakatHesapla } from "./ekstre-mutabakat";
import { girisMi } from "./hesap-ekstresi";

/**
 * Kasa/Banka raporları (KSB-14, RPR-08) — ortak rapor araç setine tanım olarak
 * kaydedilir; süzgeç doğrulama, sıralama, Excel ve kayıtlı görünümler
 * altyapıdan gelir. Hesap süzgeci "kasa:<id>", "banka:<id>" ya da "pos:<id>"
 * değerini taşır.
 */

const D = (deger: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(deger);
const gun = (t: Date) => t.toISOString().slice(0, 10);
const gunTarihi = (deger: unknown) => new Date(`${String(deger)}T00:00:00.000Z`);
const bugun = () => gun(new Date());

type HesapTuru = "kasa" | "banka" | "pos";
const HESAP_TURU_ADI: Record<HesapTuru, string> = { kasa: "Kasa", banka: "Banka", pos: "POS" };

/** "kasa:<id>" → hareket sorgusu koşulu; boş ya da bozuk değerde koşul yok. */
function hesapKosulu(deger: unknown): Prisma.KasaBankaHareketWhereInput {
  const [tur, id] = String(deger ?? "").split(":");
  if (!id) return {};
  return tur === "kasa" ? { kasaId: id } : tur === "banka" ? { bankaHesapId: id } : tur === "pos" ? { posHesapId: id } : {};
}

const tarihKosulu = (f: RaporFiltreDegerleri): Prisma.DateTimeFilter | undefined =>
  f.baslangic || f.bitis
    ? { ...(f.baslangic ? { gte: gunTarihi(f.baslangic) } : {}), ...(f.bitis ? { lte: gunTarihi(f.bitis) } : {}) }
    : undefined;

const TARIH_FILTRELERI = [
  { alan: "baslangic", ad: "Başlangıç", tip: "tarih" as const },
  { alan: "bitis", ad: "Bitiş", tip: "tarih" as const },
];
const HESAP_FILTRESI = { alan: "hesap", ad: "Hesap", tip: "hesap" as const };

interface HesapKaydi { tur: HesapTuru; id: string; ad: string; dovizCinsi: string; aktif: boolean }

async function hesaplariGetir(tx: Prisma.TransactionClient, hesap?: unknown): Promise<HesapKaydi[]> {
  const [secilenTur, secilenId] = String(hesap ?? "").split(":");
  const istenen = (tur: HesapTuru) => !secilenId || secilenTur === tur;
  const kosul = secilenId ? { id: secilenId } : {};
  const sec = { id: true, ad: true, dovizCinsi: true, aktif: true } as const;
  const [kasalar, bankalar, poslar] = await Promise.all([
    istenen("kasa") ? tx.kasa.findMany({ where: kosul, select: sec, orderBy: { ad: "asc" } }) : [],
    istenen("banka") ? tx.bankaHesap.findMany({ where: kosul, select: sec, orderBy: { ad: "asc" } }) : [],
    istenen("pos") ? tx.posHesap.findMany({ where: kosul, select: sec, orderBy: { ad: "asc" } }) : [],
  ]);
  return [
    ...kasalar.map((h) => ({ tur: "kasa" as const, ...h })),
    ...bankalar.map((h) => ({ tur: "banka" as const, ...h })),
    ...poslar.map((h) => ({ tur: "pos" as const, ...h })),
  ];
}

const hesapAnahtari = (h: { kasaId: string | null; bankaHesapId: string | null; posHesapId: string | null }) =>
  h.kasaId ? `kasa:${h.kasaId}` : h.bankaHesapId ? `banka:${h.bankaHesapId}` : h.posHesapId ? `pos:${h.posHesapId}` : "";

/** Haftanın pazartesisi (YYYY-AA-GG). */
function haftaBasi(t: Date): string {
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return gun(d);
}
const donemAnahtari = (t: Date, kirilim: string) => (kirilim === "ay" ? gun(t).slice(0, 7) : kirilim === "hafta" ? haftaBasi(t) : gun(t));

const KAYNAK_ADI: Record<string, string> = {
  manuel: "Elle girilen fiş",
  fatura_kapama: "Fatura kapama",
  ters_kayit: "Ters kayıt",
  masraf: "Masraf",
  pos_tahsilat: "POS tahsilatı",
  pos_mutabakat: "POS aktarımı",
  pos_iade: "POS iadesi",
  cek_senet: "Çek/senet",
  kredi_karti_ekstre: "Kredi kartı ödemesi",
  faturasiz_gelir: "Faaliyet dışı gelir",
  pazaryeri_kesinti: "Pazaryeri kesintisi",
  pazaryeri_stopaj: "Pazaryeri stopajı (mahsup edilecek)",
  personel_maas: "Personel maaşı",
  personel_maas_iptal: "Maaş iptali",
  personel_avans: "Personel avansı",
  personel_avans_iptal: "Avans iptali",
  doviz_islem: "Döviz alım/satımı",
  odeme_talimati: "Ödeme talimatı",
};
const kaynakAdi = (k: string) => KAYNAK_ADI[k] ?? k.replaceAll("_", " ");

// ─── Hesap bakiyeleri ───────────────────────────────────────────────────────

registerRapor({
  kod: "kasa_banka.bakiyeler",
  modul: "kasa_banka",
  ad: "Hesap Bakiyeleri",
  aciklama:
    "Seçilen tarih itibarıyla kasa, banka ve POS bakiyeleri. Tarihsel TL hareketlerin kendi kurlarıyla, değerlenmiş TL rapor tarihindeki TCMB alış kuruyla hesaplanır.",
  filtreler: [
    { alan: "tarih", ad: "Tarih (itibarıyla)", tip: "tarih" },
    HESAP_FILTRESI,
    { alan: "pasifler", ad: "Pasif hesaplar da", tip: "onay" },
  ],
  kolonlar: [
    { alan: "tur", baslik: "Tür", tip: "metin" },
    { alan: "hesap", baslik: "Hesap", tip: "metin" },
    { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    { alan: "bakiye", baslik: "Bakiye", tip: "para", dovizAlani: "dovizCinsi" },
    { alan: "tarihselTry", baslik: "Tarihsel TL", tip: "para", toplam: true },
    { alan: "kur", baslik: "TCMB alış", tip: "sayi" },
    { alan: "degerlenmisTry", baslik: "Değerlenmiş TL", tip: "para", toplam: true },
    { alan: "degerlemeFarki", baslik: "Değerleme farkı", tip: "para", toplam: true },
    { alan: "not", baslik: "Not", tip: "metin" },
  ],
  async calistir(girdi, { tenantId, tx }) {
    const f = girdi.filtreler ?? {};
    const tarih = gunTarihi(f.tarih || bugun());
    const hesaplar = (await hesaplariGetir(tx, f.hesap)).filter((h) => h.aktif || f.pasifler === true);
    const gruplar = await tx.kasaBankaHareket.groupBy({
      by: ["kasaId", "bankaHesapId", "posHesapId", "tip"],
      where: { tarih: { lte: tarih }, ...hesapKosulu(f.hesap) },
      _sum: { tutar: true, tutarTry: true },
    });
    const toplam = new Map<string, { bakiye: Prisma.Decimal; tarihsel: Prisma.Decimal }>();
    for (const g of gruplar) {
      const t = toplam.get(hesapAnahtari(g)) ?? { bakiye: D(0), tarihsel: D(0) };
      const isaret = girisMi(g.tip) ? 1 : -1;
      t.bakiye = t.bakiye.add(D(g._sum.tutar ?? 0).mul(isaret));
      t.tarihsel = t.tarihsel.add(D(g._sum.tutarTry ?? 0).mul(isaret));
      toplam.set(hesapAnahtari(g), t);
    }
    const kurlar = new Map<string, Prisma.Decimal | null>();
    for (const doviz of new Set(hesaplar.map((h) => h.dovizCinsi).filter((d) => d !== "TRY"))) {
      kurlar.set(doviz, (await kurBul(tx, tenantId, doviz, tarih))?.alis ?? null);
    }
    return hesaplar.map((h) => {
      const t = toplam.get(`${h.tur}:${h.id}`) ?? { bakiye: D(0), tarihsel: D(0) };
      const kur = h.dovizCinsi === "TRY" ? D(1) : kurlar.get(h.dovizCinsi) ?? null;
      const degerlenmis = kur ? t.bakiye.mul(kur).toDecimalPlaces(2) : null;
      return {
        tur: HESAP_TURU_ADI[h.tur],
        hesap: h.aktif ? h.ad : `${h.ad} (pasif)`,
        dovizCinsi: h.dovizCinsi,
        bakiye: t.bakiye.toFixed(2),
        tarihselTry: t.tarihsel.toFixed(2),
        kur: h.dovizCinsi === "TRY" ? null : kur ? Number(kur) : null,
        degerlenmisTry: degerlenmis?.toFixed(2) ?? null,
        degerlemeFarki: degerlenmis ? degerlenmis.sub(t.tarihsel).toFixed(2) : null,
        not: kur ? "" : `${h.dovizCinsi} için ${gun(tarih)} ve öncesindeki 10 günde kur yok`,
      };
    });
  },
});

// ─── Tahsilat/ödeme özeti ───────────────────────────────────────────────────

registerRapor({
  kod: "kasa_banka.tahsilat_odeme",
  modul: "kasa_banka",
  ad: "Tahsilat/Ödeme Özeti",
  aciklama: "Dönemdeki giriş, çıkış ve net; döviz bazında. Açılış fişi sayılmaz.",
  filtreler: [
    ...TARIH_FILTRELERI,
    HESAP_FILTRESI,
    { alan: "cari", ad: "Cari", tip: "cari" },
    { alan: "virmanHaric", ad: "Virmanları dışarıda bırak", tip: "onay" },
  ],
  gruplamalar: [
    { deger: "ay", ad: "Ay" },
    { deger: "gun", ad: "Gün" },
    { deger: "hesap", ad: "Hesap" },
    { deger: "cari", ad: "Cari" },
    { deger: "kaynak", ad: "Kaynak" },
  ],
  // RPR-26
  grafik: { tur: "sutun", kategori: "grup", seriler: ["girisTry", "cikisTry"] },
  kolonlar: [
    { alan: "grup", baslik: "Grup", tip: "metin" },
    { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    { alan: "adet", baslik: "Fiş", tip: "sayi", toplam: true },
    { alan: "giris", baslik: "Giriş", tip: "para", dovizAlani: "dovizCinsi", toplam: true },
    { alan: "cikis", baslik: "Çıkış", tip: "para", dovizAlani: "dovizCinsi", toplam: true },
    { alan: "net", baslik: "Net", tip: "para", dovizAlani: "dovizCinsi", toplam: true },
    { alan: "girisTry", baslik: "Giriş (TL)", tip: "para", toplam: true },
    { alan: "cikisTry", baslik: "Çıkış (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const gruplama = girdi.gruplama ?? "ay";
    const hareketler = await tx.kasaBankaHareket.findMany({
      where: {
        kaynakTur: { not: "acilis" },
        ...(tarihKosulu(f) ? { tarih: tarihKosulu(f) } : {}),
        ...hesapKosulu(f.hesap),
        ...(f.cari ? { cariId: String(f.cari) } : {}),
        ...(f.virmanHaric === true ? { tip: { in: ["tahsilat", "tediye"] } } : {}),
      },
      select: {
        tarih: true, tip: true, tutar: true, tutarTry: true, dovizCinsi: true, kaynakTur: true,
        kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } }, posHesap: { select: { ad: true } },
        cari: { select: { unvan: true } },
      },
    });
    const gruplar = new Map<string, { grup: string; doviz: string; adet: number; giris: Prisma.Decimal; cikis: Prisma.Decimal; girisTry: Prisma.Decimal; cikisTry: Prisma.Decimal }>();
    for (const h of hareketler) {
      const grup =
        gruplama === "gun" ? gun(h.tarih)
        : gruplama === "hesap" ? h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "—"
        : gruplama === "cari" ? h.cari?.unvan ?? "(Carisiz)"
        : gruplama === "kaynak" ? kaynakAdi(h.kaynakTur)
        : gun(h.tarih).slice(0, 7);
      const anahtar = `${grup}\u0000${h.dovizCinsi}`;
      const t = gruplar.get(anahtar) ?? { grup, doviz: h.dovizCinsi, adet: 0, giris: D(0), cikis: D(0), girisTry: D(0), cikisTry: D(0) };
      t.adet++;
      if (girisMi(h.tip)) { t.giris = t.giris.add(h.tutar); t.girisTry = t.girisTry.add(h.tutarTry); }
      else { t.cikis = t.cikis.add(h.tutar); t.cikisTry = t.cikisTry.add(h.tutarTry); }
      gruplar.set(anahtar, t);
    }
    const zamanli = gruplama === "ay" || gruplama === "gun";
    return [...gruplar.values()]
      .sort((a, b) => (zamanli ? a.grup.localeCompare(b.grup) : b.girisTry.add(b.cikisTry).cmp(a.girisTry.add(a.cikisTry))) || a.doviz.localeCompare(b.doviz))
      .map((t) => ({
        grup: t.grup,
        dovizCinsi: t.doviz,
        adet: t.adet,
        giris: t.giris.toFixed(2),
        cikis: t.cikis.toFixed(2),
        net: t.giris.sub(t.cikis).toFixed(2),
        girisTry: t.girisTry.toFixed(2),
        cikisTry: t.cikisTry.toFixed(2),
      }));
  },
});

// ─── Mutabakat durumu ───────────────────────────────────────────────────────

registerRapor({
  kod: "kasa_banka.mutabakat",
  modul: "kasa_banka",
  ad: "Banka Mutabakat Durumu",
  aciklama:
    "Her banka hesabının yüklenen ekstre satırları (eşleşen/bekleyen/yok sayılan), son ekstre günü ve o günkü ekstre bakiyesi ile sistem bakiyesinin farkı. Fark, Banka Ekstreleri ekranındaki mutabakatla aynı kuralla hesaplanır.",
  filtreler: [...TARIH_FILTRELERI, HESAP_FILTRESI],
  kolonlar: [
    { alan: "hesap", baslik: "Banka hesabı", tip: "metin" },
    { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    { alan: "satir", baslik: "Ekstre satırı", tip: "sayi", toplam: true },
    { alan: "eslesen", baslik: "Eşleşen", tip: "sayi", toplam: true },
    { alan: "bekleyen", baslik: "Bekleyen", tip: "sayi", toplam: true },
    { alan: "bekleyenTutar", baslik: "Bekleyen tutar", tip: "para", dovizAlani: "dovizCinsi", toplam: true },
    { alan: "yoksayilan", baslik: "Yok sayılan", tip: "sayi", toplam: true },
    { alan: "sonEkstreTarihi", baslik: "Son ekstre günü", tip: "tarih" },
    { alan: "ekstreBakiyesi", baslik: "Ekstre bakiyesi", tip: "para", dovizAlani: "dovizCinsi" },
    { alan: "sistemBakiyesi", baslik: "Sistem bakiyesi", tip: "para", dovizAlani: "dovizCinsi" },
    { alan: "fark", baslik: "Fark", tip: "para", dovizAlani: "dovizCinsi" },
    { alan: "durum", baslik: "Durum", tip: "metin" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const hesaplar = (await hesaplariGetir(tx, f.hesap)).filter((h) => h.tur === "banka" && (h.aktif || f.hesap));
    const satirTarihi = tarihKosulu(f);
    const sonuc = [];
    for (const h of hesaplar) {
      const [satirlar, hareketler] = await Promise.all([
        tx.bankaEkstreSatir.findMany({
          where: { bankaHesapId: h.id, ...(satirTarihi ? { tarih: satirTarihi } : {}) },
          orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
          select: { tarih: true, tutar: true, bakiye: true, durum: true },
        }),
        tx.kasaBankaHareket.findMany({ where: { bankaHesapId: h.id }, select: { tarih: true, tip: true, tutar: true } }),
      ]);
      const say = (durum: string) => satirlar.filter((s) => s.durum === durum);
      // Sistem bakiyesi tüm hareketlerden yürür; süzgeç yalnız ekstre satırlarını daraltır.
      const mutabakat = satirlar.length ? mutabakatHesapla(satirlar, hareketler) : null;
      const son = mutabakat?.son ?? null;
      const sonSatir = satirlar[satirlar.length - 1];
      const fark = son ? D(son.fark) : null;
      sonuc.push({
        hesap: h.ad,
        dovizCinsi: h.dovizCinsi,
        satir: satirlar.length,
        eslesen: say("eslesti").length,
        bekleyen: say("beklemede").length,
        bekleyenTutar: say("beklemede").reduce((t, s) => t.add(s.tutar), D(0)).toFixed(2),
        yoksayilan: say("yoksayildi").length,
        sonEkstreTarihi: sonSatir ? gun(sonSatir.tarih) : null,
        ekstreBakiyesi: son?.banka ?? null,
        sistemBakiyesi: son?.sistem ?? null,
        fark: son?.fark ?? null,
        durum: !satirlar.length
          ? "Ekstre yüklenmemiş"
          : !son
            ? "Ekstrede bakiye sütunu yok"
            : fark!.isZero()
              ? say("beklemede").length ? "Bakiye tutuyor, bekleyen satır var" : "Mutabık"
              : mutabakat!.acilisBakiyesiEksikOlabilir
                ? "Fark var · açılış bakiyesi girilmemiş olabilir"
                : "Fark var",
      });
    }
    return sonuc;
  },
});

// ─── Komisyon ve banka giderleri ───────────────────────────────────────────

/** KSB-14: bu kategorilerdeki masraflar banka/POS/kart kaynaklı finansman giderleridir. */
const GIDER_KATEGORILERI = ["Banka ve POS Komisyonları", "Finansman Giderleri", "Kambiyo Zararları"];

registerRapor({
  kod: "kasa_banka.komisyonlar",
  modul: "kasa_banka",
  ad: "Komisyon ve Banka Giderleri",
  aciklama: `POS komisyonu, banka masrafı, kart faizi/aidatı ve kambiyo zararı. Kaynak: onaylı masraflar (${GIDER_KATEGORILERI.join(", ")}). TL karşılığı masrafın kendi kuruyla.`,
  filtreler: [...TARIH_FILTRELERI],
  gruplamalar: [
    { deger: "ay", ad: "Ay" },
    { deger: "tur", ad: "Gider türü" },
    { deger: "hesap", ad: "Hesap / kart" },
    { deger: "detay", ad: "Kayıt kayıt" },
  ],
  kolonlar: [
    { alan: "grup", baslik: "Grup", tip: "metin" },
    { alan: "tarih", baslik: "Tarih", tip: "tarih" },
    { alan: "aciklama", baslik: "Açıklama", tip: "metin" },
    { alan: "adet", baslik: "Kayıt", tip: "sayi", toplam: true },
    { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    { alan: "tutar", baslik: "Tutar", tip: "para", dovizAlani: "dovizCinsi", toplam: true },
    { alan: "tutarTry", baslik: "Tutar (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const gruplama = girdi.gruplama ?? "ay";
    const masraflar = await tx.masraf.findMany({
      where: { durum: "onaylandi", kategori: { ad: { in: GIDER_KATEGORILERI } }, ...(tarihKosulu(f) ? { tarih: tarihKosulu(f) } : {}) },
      orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
      select: {
        tarih: true, toplam: true, kur: true, dovizCinsi: true, aciklama: true, saticiUnvan: true, kaynakTur: true,
        kategori: { select: { ad: true } },
        kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } },
        hareket: { select: { posHesapId: true, kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } }, posHesap: { select: { ad: true } } } },
        odemeler: { take: 1, select: { krediKarti: { select: { ad: true } }, kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } } } },
      },
    });
    const satirlar = masraflar.map((m) => {
      const odeme = m.odemeler[0];
      const tur =
        m.kategori.ad === "Kambiyo Zararları" ? "Kambiyo zararı"
        : m.hareket?.posHesapId ? "POS komisyonu"
        : m.kaynakTur === "kredi_karti" ? (m.kategori.ad === "Finansman Giderleri" ? "Kart faizi / vade farkı" : "Kart aidatı / ücreti")
        : m.kategori.ad === "Finansman Giderleri" ? "Finansman gideri"
        : "Banka masrafı";
      const hesap = m.hareket?.posHesap?.ad ?? m.hareket?.bankaHesap?.ad ?? m.hareket?.kasa?.ad
        ?? odeme?.krediKarti?.ad ?? odeme?.bankaHesap?.ad ?? odeme?.kasa?.ad
        ?? m.bankaHesap?.ad ?? m.kasa?.ad ?? (m.kaynakTur === "doviz_islem" ? "Döviz işlemi" : "—");
      return { m, tur, hesap, tutarTry: m.toplam.mul(m.kur).toDecimalPlaces(2) };
    });
    if (gruplama === "detay") {
      return satirlar.map(({ m, tur, hesap, tutarTry }) => ({
        grup: `${tur} · ${hesap}`,
        tarih: gun(m.tarih),
        aciklama: m.aciklama ?? m.saticiUnvan ?? "",
        adet: 1,
        dovizCinsi: m.dovizCinsi,
        tutar: m.toplam.toFixed(2),
        tutarTry: tutarTry.toFixed(2),
      }));
    }
    const gruplar = new Map<string, { grup: string; doviz: string; adet: number; tutar: Prisma.Decimal; tutarTry: Prisma.Decimal }>();
    for (const s of satirlar) {
      const grup = gruplama === "tur" ? s.tur : gruplama === "hesap" ? s.hesap : gun(s.m.tarih).slice(0, 7);
      const anahtar = `${grup}\u0000${s.m.dovizCinsi}`;
      const t = gruplar.get(anahtar) ?? { grup, doviz: s.m.dovizCinsi, adet: 0, tutar: D(0), tutarTry: D(0) };
      t.adet++;
      t.tutar = t.tutar.add(s.m.toplam);
      t.tutarTry = t.tutarTry.add(s.tutarTry);
      gruplar.set(anahtar, t);
    }
    return [...gruplar.values()]
      .sort((a, b) => (gruplama === "ay" ? a.grup.localeCompare(b.grup) : b.tutarTry.cmp(a.tutarTry)))
      .map((t) => ({ grup: t.grup, tarih: null, aciklama: "", adet: t.adet, dovizCinsi: t.doviz, tutar: t.tutar.toFixed(2), tutarTry: t.tutarTry.toFixed(2) }));
  },
});

// ─── Hesap bazlı nakit akışı ───────────────────────────────────────────────

registerRapor({
  kod: "kasa_banka.nakit_akisi",
  modul: "kasa_banka",
  ad: "Hesap Bazlı Nakit Akışı",
  aciklama:
    "Gerçekleşen hareketlerden her hesabın dönem başı bakiyesi, giriş, çıkış ve dönem sonu bakiyesi (hesap dövizinde). Açılış fişi devire eklenir. Planlanan tahsilat/ödemeler için Nakit Akışı ekranı.",
  filtreler: [
    { alan: "baslangic", ad: "Başlangıç", tip: "tarih", zorunlu: true },
    { alan: "bitis", ad: "Bitiş", tip: "tarih", zorunlu: true },
    HESAP_FILTRESI,
    { alan: "hareketsizler", ad: "Hareketsiz dönemler de", tip: "onay" },
  ],
  gruplamalar: [
    { deger: "ay", ad: "Ay" },
    { deger: "hafta", ad: "Hafta" },
    { deger: "gun", ad: "Gün" },
  ],
  // RPR-26
  grafik: { tur: "sutun", kategori: "donem", seriler: ["giris", "cikis"] },
  kolonlar: [
    { alan: "hesap", baslik: "Hesap", tip: "metin" },
    { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    { alan: "donem", baslik: "Dönem", tip: "metin" },
    { alan: "devir", baslik: "Dönem başı", tip: "para", dovizAlani: "dovizCinsi" },
    { alan: "giris", baslik: "Giriş", tip: "para", dovizAlani: "dovizCinsi", toplam: true },
    { alan: "cikis", baslik: "Çıkış", tip: "para", dovizAlani: "dovizCinsi", toplam: true },
    { alan: "net", baslik: "Net", tip: "para", dovizAlani: "dovizCinsi", toplam: true },
    { alan: "kapanis", baslik: "Dönem sonu", tip: "para", dovizAlani: "dovizCinsi" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const kirilim = girdi.gruplama ?? "ay";
    const bas = gunTarihi(f.baslangic);
    const bit = gunTarihi(f.bitis);
    const hesaplar = (await hesaplariGetir(tx, f.hesap)).filter((h) => h.aktif || f.hesap);
    const [onceki, hareketler] = await Promise.all([
      tx.kasaBankaHareket.groupBy({ by: ["kasaId", "bankaHesapId", "posHesapId", "tip"], where: { tarih: { lt: bas }, ...hesapKosulu(f.hesap) }, _sum: { tutar: true } }),
      tx.kasaBankaHareket.findMany({
        where: { tarih: { gte: bas, lte: bit }, ...hesapKosulu(f.hesap) },
        select: { kasaId: true, bankaHesapId: true, posHesapId: true, tip: true, tutar: true, tarih: true, kaynakTur: true },
      }),
    ]);
    const devirler = new Map<string, Prisma.Decimal>();
    for (const g of onceki) {
      const k = hesapAnahtari(g);
      devirler.set(k, (devirler.get(k) ?? D(0)).add(D(g._sum.tutar ?? 0).mul(girisMi(g.tip) ? 1 : -1)));
    }
    // Hesap → dönem → { açılış, giriş, çıkış }
    const akis = new Map<string, Map<string, { acilis: Prisma.Decimal; giris: Prisma.Decimal; cikis: Prisma.Decimal }>>();
    for (const h of hareketler) {
      const k = hesapAnahtari(h);
      const donemler = akis.get(k) ?? new Map();
      const d = donemAnahtari(h.tarih, kirilim);
      const t = donemler.get(d) ?? { acilis: D(0), giris: D(0), cikis: D(0) };
      const isaretli = h.tutar.mul(girisMi(h.tip) ? 1 : -1);
      if (h.kaynakTur === "acilis") t.acilis = t.acilis.add(isaretli);
      else if (girisMi(h.tip)) t.giris = t.giris.add(h.tutar);
      else t.cikis = t.cikis.add(h.tutar);
      donemler.set(d, t);
      akis.set(k, donemler);
    }
    // Hareketsiz dönemler de istenirse aralıktaki bütün dönem anahtarları.
    const tumDonemler: string[] = [];
    if (f.hareketsizler === true) {
      for (const t = new Date(bas); t <= bit; t.setUTCDate(t.getUTCDate() + 1)) {
        const d = donemAnahtari(t, kirilim);
        if (tumDonemler[tumDonemler.length - 1] !== d) tumDonemler.push(d);
      }
    }
    const satirlar = [];
    for (const h of hesaplar) {
      const k = `${h.tur}:${h.id}`;
      const donemler = akis.get(k) ?? new Map();
      let bakiye = devirler.get(k) ?? D(0);
      const anahtarlar = f.hareketsizler === true ? tumDonemler : [...donemler.keys()].sort();
      for (const d of anahtarlar) {
        const t = donemler.get(d) ?? { acilis: D(0), giris: D(0), cikis: D(0) };
        const devir = bakiye.add(t.acilis);
        bakiye = devir.add(t.giris).sub(t.cikis);
        satirlar.push({
          hesap: `${HESAP_TURU_ADI[h.tur]} · ${h.ad}`,
          dovizCinsi: h.dovizCinsi,
          donem: d,
          devir: devir.toFixed(2),
          giris: t.giris.toFixed(2),
          cikis: t.cikis.toFixed(2),
          net: t.giris.sub(t.cikis).toFixed(2),
          kapanis: bakiye.toFixed(2),
        });
      }
    }
    return satirlar;
  },
});
