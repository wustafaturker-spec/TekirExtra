import { Prisma } from "@prisma/client";
import { kdvMatrahinaDahilToplam } from "./ek-vergi";
import { FINANS_ROLLERI, registerRapor } from "../core/raporlar/rapor-kayit";

/**
 * Fatura modülü raporları (FTR-15; KDV dökümü RPR-02'yi karşılar) —
 * RPR-06 araç seti tanımları. Tutarlar TL karşılığıdır (tutar × kur).
 */

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(deger);

const tarihAraligi = (baslangic?: unknown, bitis?: unknown) => ({
  ...(baslangic ? { gte: new Date(String(baslangic)) } : {}),
  ...(bitis
    ? { lte: new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(bitis)) ? `${String(bitis)}T23:59:59.999` : String(bitis)) }
    : {}),
});

const TARIH_FILTRELERI = [
  { alan: "baslangic", ad: "Başlangıç", tip: "tarih" as const },
  { alan: "bitis", ad: "Bitiş", tip: "tarih" as const },
];

const TIP_ADLARI: Record<string, string> = {
  satis: "Satış",
  alis: "Alış",
  satis_iade: "Satış İade",
  alis_iade: "Alış İade",
  proforma: "Proforma",
};

const ay = (tarih: Date): string => tarih.toISOString().slice(0, 7);

// ─── Dönemsel satış/alış özeti ──────────────────────────────────────────────

registerRapor({
  kod: "fatura.donemsel-ozet",
  modul: "fatura",
  ad: "Dönemsel Satış/Alış Özeti",
  aciklama: "Kesin faturaların seçilen kırılımda belge sayısı ve toplamları",
  filtreler: [
    ...TARIH_FILTRELERI,
    {
      alan: "tip",
      ad: "Belge Tipi",
      tip: "secim",
      secenekler: Object.entries(TIP_ADLARI)
        .filter(([deger]) => deger !== "proforma")
        .map(([deger, ad]) => ({ deger, ad })),
    },
  ],
  gruplamalar: [
    { deger: "ay", ad: "Ay" },
    { deger: "cari", ad: "Cari" },
    { deger: "tip", ad: "Belge Tipi" },
  ],
  kolonlar: [
    { alan: "grup", baslik: "Kırılım", tip: "metin" },
    { alan: "belgeSayisi", baslik: "Belge Sayısı", tip: "sayi", toplam: true },
    { alan: "matrah", baslik: "Matrah (TL)", tip: "para", toplam: true },
    { alan: "kdv", baslik: "KDV (TL)", tip: "para", toplam: true },
    { alan: "toplam", baslik: "Genel Toplam (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const faturalar = await tx.fatura.findMany({
      where: {
        durum: "kesin",
        tip: f.tip
          ? (String(f.tip) as "satis" | "alis" | "satis_iade" | "alis_iade")
          : { not: "proforma" },
        tarih: tarihAraligi(f.baslangic, f.bitis),
      },
      select: {
        tip: true,
        tarih: true,
        toplamMatrah: true,
        toplamNetKdv: true,
        genelToplam: true,
        kur: true,
        cari: { select: { unvan: true } },
      },
    });
    const gruplama = girdi.gruplama ?? "ay";
    const gruplar = new Map<
      string,
      { belgeSayisi: number; matrah: Prisma.Decimal; kdv: Prisma.Decimal; toplam: Prisma.Decimal }
    >();
    for (const ft of faturalar) {
      const anahtar =
        gruplama === "cari"
          ? ft.cari.unvan
          : gruplama === "tip"
            ? TIP_ADLARI[ft.tip]
            : ay(ft.tarih);
      const g = gruplar.get(anahtar) ?? {
        belgeSayisi: 0,
        matrah: D(0),
        kdv: D(0),
        toplam: D(0),
      };
      g.belgeSayisi += 1;
      g.matrah = g.matrah.add(ft.toplamMatrah.mul(ft.kur));
      g.kdv = g.kdv.add(ft.toplamNetKdv.mul(ft.kur));
      g.toplam = g.toplam.add(ft.genelToplam.mul(ft.kur));
      gruplar.set(anahtar, g);
    }
    return [...gruplar.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "tr"))
      .map(([grup, g]) => ({
        grup,
        belgeSayisi: g.belgeSayisi,
        matrah: g.matrah.toFixed(2),
        kdv: g.kdv.toFixed(2),
        toplam: g.toplam.toFixed(2),
      }));
  },
});

// ─── Kâr marjı analizi (eski /rapor/kar-zarar buraya taşındı) ───────────────

registerRapor({
  kod: "fatura.kar-marji",
  modul: "fatura",
  ad: "Kâr Marjı Analizi",
  aciklama:
    "Satış matrahı - ağırlıklı ortalama maliyet; ürün/cari/ay kırılımında",
  // RPR-11: kâr bilgisi; satış/depo rolleri görmez.
  roller: FINANS_ROLLERI,
  filtreler: TARIH_FILTRELERI,
  gruplamalar: [
    { deger: "urun", ad: "Ürün" },
    { deger: "cari", ad: "Cari" },
    { deger: "ay", ad: "Ay" },
  ],
  kolonlar: [
    { alan: "grup", baslik: "Kırılım", tip: "metin" },
    { alan: "ciro", baslik: "Ciro (TL)", tip: "para", toplam: true },
    { alan: "maliyet", baslik: "Maliyet (TL)", tip: "para", toplam: true },
    { alan: "kar", baslik: "Kâr (TL)", tip: "para", toplam: true },
    { alan: "marj", baslik: "Marj", tip: "yuzde" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await tx.faturaSatir.findMany({
      where: {
        fatura: {
          tip: "satis",
          durum: "kesin",
          tarih: tarihAraligi(f.baslangic, f.bitis),
        },
      },
      select: {
        miktar: true,
        matrah: true,
        stok: { select: { ad: true, ortalamaMaliyet: true } },
        fatura: {
          select: { tarih: true, kur: true, cari: { select: { unvan: true } } },
        },
      },
    });
    const gruplama = girdi.gruplama ?? "urun";
    const gruplar = new Map<string, { ciro: Prisma.Decimal; maliyet: Prisma.Decimal }>();
    for (const s of satirlar) {
      const anahtar =
        gruplama === "cari"
          ? s.fatura.cari.unvan
          : gruplama === "ay"
            ? ay(s.fatura.tarih)
            : s.stok.ad;
      const g = gruplar.get(anahtar) ?? { ciro: D(0), maliyet: D(0) };
      g.ciro = g.ciro.add(s.matrah.mul(s.fatura.kur));
      g.maliyet = g.maliyet.add(s.stok.ortalamaMaliyet.mul(s.miktar));
      gruplar.set(anahtar, g);
    }
    return [...gruplar.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "tr"))
      .map(([grup, g]) => {
        const kar = g.ciro.sub(g.maliyet);
        return {
          grup,
          ciro: g.ciro.toFixed(2),
          maliyet: g.maliyet.toFixed(2),
          kar: kar.toFixed(2),
          marj: g.ciro.greaterThan(0)
            ? kar.div(g.ciro).mul(100).toDecimalPlaces(2).toNumber()
            : null,
        };
      });
  },
});

// ─── İskonto analizi ────────────────────────────────────────────────────────

registerRapor({
  kod: "fatura.iskonto-analizi",
  modul: "fatura",
  ad: "İskonto Analizi",
  aciklama: "Satır ve genel iskonto toplamları; brüte oranı",
  filtreler: TARIH_FILTRELERI,
  gruplamalar: [
    { deger: "cari", ad: "Cari" },
    { deger: "urun", ad: "Ürün" },
    { deger: "ay", ad: "Ay" },
  ],
  kolonlar: [
    { alan: "grup", baslik: "Kırılım", tip: "metin" },
    { alan: "brut", baslik: "Brüt (TL)", tip: "para", toplam: true },
    { alan: "satirIskonto", baslik: "Satır İskontosu (TL)", tip: "para", toplam: true },
    { alan: "genelIskonto", baslik: "Genel İskonto Payı (TL)", tip: "para", toplam: true },
    { alan: "toplamIskonto", baslik: "Toplam İskonto (TL)", tip: "para", toplam: true },
    { alan: "oran", baslik: "İskonto Oranı", tip: "yuzde" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await tx.faturaSatir.findMany({
      where: {
        fatura: {
          tip: "satis",
          durum: "kesin",
          tarih: tarihAraligi(f.baslangic, f.bitis),
        },
      },
      select: {
        miktar: true,
        birimFiyat: true,
        iskontoTutari: true,
        genelIskontoPayi: true,
        stok: { select: { ad: true } },
        fatura: {
          select: { tarih: true, kur: true, cari: { select: { unvan: true } } },
        },
      },
    });
    const gruplama = girdi.gruplama ?? "cari";
    const gruplar = new Map<
      string,
      { brut: Prisma.Decimal; satir: Prisma.Decimal; genel: Prisma.Decimal }
    >();
    for (const s of satirlar) {
      const anahtar =
        gruplama === "urun"
          ? s.stok.ad
          : gruplama === "ay"
            ? ay(s.fatura.tarih)
            : s.fatura.cari.unvan;
      const g = gruplar.get(anahtar) ?? { brut: D(0), satir: D(0), genel: D(0) };
      g.brut = g.brut.add(s.miktar.mul(s.birimFiyat).mul(s.fatura.kur));
      g.satir = g.satir.add(s.iskontoTutari.mul(s.fatura.kur));
      g.genel = g.genel.add(s.genelIskontoPayi.mul(s.fatura.kur));
      gruplar.set(anahtar, g);
    }
    return [...gruplar.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "tr"))
      .map(([grup, g]) => {
        const toplam = g.satir.add(g.genel);
        return {
          grup,
          brut: g.brut.toFixed(2),
          satirIskonto: g.satir.toFixed(2),
          genelIskonto: g.genel.toFixed(2),
          toplamIskonto: toplam.toFixed(2),
          oran: g.brut.greaterThan(0)
            ? toplam.div(g.brut).mul(100).toDecimalPlaces(2).toNumber()
            : null,
        };
      });
  },
});

// ─── KDV dökümü (RPR-02) ────────────────────────────────────────────────────

registerRapor({
  kod: "fatura.kdv-dokumu",
  modul: "fatura",
  ad: "KDV Dökümü",
  aciklama:
    "Oran kırılımında hesaplanan (satış) ve indirilecek (alış) KDV; iadeler düşülür",
  filtreler: TARIH_FILTRELERI,
  kolonlar: [
    { alan: "kdvOrani", baslik: "KDV Oranı", tip: "yuzde" },
    { alan: "yon", baslik: "Yön", tip: "metin" },
    { alan: "matrah", baslik: "Matrah (TL)", tip: "para" },
    { alan: "kdv", baslik: "KDV (TL)", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await tx.faturaSatir.findMany({
      where: {
        fatura: {
          durum: "kesin",
          tip: { not: "proforma" },
          tarih: tarihAraligi(f.baslangic, f.bitis),
        },
      },
      select: {
        kdvOrani: true,
        matrah: true,
        netKdvTutari: true,
        ekVergiler: true,
        fatura: { select: { tip: true, kur: true } },
      },
    });
    // satış ve satış_iade "Hesaplanan", alış ve alış_iade "İndirilecek";
    // iadeler kendi yönünden düşülür.
    const gruplar = new Map<
      string,
      { kdvOrani: number; yon: string; matrah: Prisma.Decimal; kdv: Prisma.Decimal }
    >();
    for (const s of satirlar) {
      const yon = ["satis", "satis_iade"].includes(s.fatura.tip)
        ? "Hesaplanan"
        : "İndirilecek";
      const isaret = s.fatura.tip.endsWith("_iade") ? -1 : 1;
      const anahtar = `${s.kdvOrani}|${yon}`;
      const g = gruplar.get(anahtar) ?? {
        kdvOrani: Number(s.kdvOrani),
        yon,
        matrah: D(0),
        kdv: D(0),
      };
      // EBLG-128: KDV matrahı, KDV matrahına dahil vergilerle (ÖTV, elektrik tüketim…) birlikte.
      g.matrah = g.matrah.add(s.matrah.add(kdvMatrahinaDahilToplam(s.ekVergiler)).mul(s.fatura.kur).mul(isaret));
      g.kdv = g.kdv.add(s.netKdvTutari.mul(s.fatura.kur).mul(isaret));
      gruplar.set(anahtar, g);
    }
    return [...gruplar.values()]
      .sort((a, b) => a.yon.localeCompare(b.yon, "tr") || a.kdvOrani - b.kdvOrani)
      .map((g) => ({
        kdvOrani: g.kdvOrani,
        yon: g.yon,
        matrah: g.matrah.toFixed(2),
        kdv: g.kdv.toFixed(2),
      }));
  },
});

// ─── İade oranları ──────────────────────────────────────────────────────────

registerRapor({
  kod: "fatura.iade-oranlari",
  modul: "fatura",
  ad: "İade Oranları",
  aciklama: "Satış iadelerinin satışa oranı (TL, cari veya ay kırılımında)",
  filtreler: TARIH_FILTRELERI,
  gruplamalar: [
    { deger: "cari", ad: "Cari" },
    { deger: "ay", ad: "Ay" },
  ],
  kolonlar: [
    { alan: "grup", baslik: "Kırılım", tip: "metin" },
    { alan: "satis", baslik: "Satış (TL)", tip: "para", toplam: true },
    { alan: "iade", baslik: "İade (TL)", tip: "para", toplam: true },
    { alan: "oran", baslik: "İade Oranı", tip: "yuzde" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const faturalar = await tx.fatura.findMany({
      where: {
        durum: "kesin",
        tip: { in: ["satis", "satis_iade"] },
        tarih: tarihAraligi(f.baslangic, f.bitis),
      },
      select: {
        tip: true,
        tarih: true,
        genelToplam: true,
        kur: true,
        cari: { select: { unvan: true } },
      },
    });
    const gruplama = girdi.gruplama ?? "cari";
    const gruplar = new Map<string, { satis: Prisma.Decimal; iade: Prisma.Decimal }>();
    for (const ft of faturalar) {
      const anahtar = gruplama === "ay" ? ay(ft.tarih) : ft.cari.unvan;
      const g = gruplar.get(anahtar) ?? { satis: D(0), iade: D(0) };
      const tutar = ft.genelToplam.mul(ft.kur);
      if (ft.tip === "satis") g.satis = g.satis.add(tutar);
      else g.iade = g.iade.add(tutar);
      gruplar.set(anahtar, g);
    }
    return [...gruplar.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "tr"))
      .map(([grup, g]) => ({
        grup,
        satis: g.satis.toFixed(2),
        iade: g.iade.toFixed(2),
        oran: g.satis.greaterThan(0)
          ? g.iade.div(g.satis).mul(100).toDecimalPlaces(2).toNumber()
          : null,
      }));
  },
});

// ─── Taslakta bekleyen belgeler ─────────────────────────────────────────────

registerRapor({
  kod: "fatura.taslaklar",
  modul: "fatura",
  ad: "Taslakta Bekleyen Belgeler",
  aciklama: "Kesinleştirilmemiş fatura ve proformalar",
  filtreler: [],
  kolonlar: [
    { alan: "tip", baslik: "Tip", tip: "metin" },
    { alan: "tarih", baslik: "Belge Tarihi", tip: "tarih" },
    { alan: "cari", baslik: "Cari", tip: "metin" },
    { alan: "toplam", baslik: "Genel Toplam (TL)", tip: "para", toplam: true },
    { alan: "bekleyenGun", baslik: "Bekleme (Gün)", tip: "sayi" },
  ],
  async calistir(_girdi, { tx }) {
    const taslaklar = await tx.fatura.findMany({
      where: { durum: "taslak" },
      select: {
        tip: true,
        tarih: true,
        genelToplam: true,
        kur: true,
        createdAt: true,
        cari: { select: { unvan: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const simdi = Date.now();
    return taslaklar.map((ft) => ({
      tip: TIP_ADLARI[ft.tip],
      tarih: ft.tarih.toISOString().slice(0, 10),
      cari: ft.cari.unvan,
      toplam: ft.genelToplam.mul(ft.kur).toFixed(2),
      bekleyenGun: Math.floor(
        (simdi - ft.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      ),
    }));
  },
});

// ─── Kâr/Zarar Özeti (RPR-05) ───────────────────────────────────────────────

registerRapor({
  kod: "genel.kar-zarar-ozeti",
  modul: "genel" as any,
  ad: "Kâr/Zarar Özeti",
  aciklama: "Satış Matrahı − Alış Matrahı − Kasa/Banka Tediye Giderleri formülüyle kâr/zarar özeti",
  // RPR-11: kâr bilgisi; satış/depo rolleri görmez.
  roller: FINANS_ROLLERI,
  filtreler: TARIH_FILTRELERI,
  gruplamalar: [
    { deger: "ay", ad: "Ay" },
    { deger: "yok", ad: "Genel Toplam" },
  ],
  kolonlar: [
    { alan: "grup", baslik: "Dönem", tip: "metin" },
    { alan: "satisMatrah", baslik: "Satış Matrahı (TL)", tip: "para", toplam: true },
    { alan: "alisMatrah", baslik: "Alış Matrahı (TL)", tip: "para", toplam: true },
    { alan: "tediyeGiderleri", baslik: "Tediye Giderleri (TL)", tip: "para", toplam: true },
    { alan: "netKarZarar", baslik: "Net Kâr/Zarar (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};

    // 1. Kesinleşmiş satış ve alış faturalarının matrahlarını çekelim
    const faturalar = await tx.fatura.findMany({
      where: {
        durum: "kesin",
        tip: { not: "proforma" },
        tarih: tarihAraligi(f.baslangic, f.bitis),
      },
      select: {
        tip: true,
        tarih: true,
        toplamMatrah: true,
        kur: true,
      },
    });

    // 2. Kasa/banka tediye giderlerini çekelim
    const tediyeler = await tx.kasaBankaHareket.findMany({
      where: {
        tip: "tediye",
        tarih: tarihAraligi(f.baslangic, f.bitis),
      },
      select: {
        tarih: true,
        tutarTry: true,
      },
    });

    const gruplama = girdi.gruplama ?? "ay";
    const gruplar = new Map<
      string,
      { satis: Prisma.Decimal; alis: Prisma.Decimal; tediye: Prisma.Decimal }
    >();

    const getGrupAnahtari = (tarih: Date) => {
      if (gruplama === "yok") return "Toplam";
      return ay(tarih);
    };

    // Faturaları işle
    for (const ft of faturalar) {
      const anahtar = getGrupAnahtari(ft.tarih);
      const g = gruplar.get(anahtar) ?? { satis: D(0), alis: D(0), tediye: D(0) };
      const tutar = ft.toplamMatrah.mul(ft.kur);

      if (ft.tip === "satis") {
        g.satis = g.satis.add(tutar);
      } else if (ft.tip === "satis_iade") {
        g.satis = g.satis.sub(tutar);
      } else if (ft.tip === "alis") {
        g.alis = g.alis.add(tutar);
      } else if (ft.tip === "alis_iade") {
        g.alis = g.alis.sub(tutar);
      }

      gruplar.set(anahtar, g);
    }

    // Tediyeleri işle
    for (const td of tediyeler) {
      const anahtar = getGrupAnahtari(td.tarih);
      const g = gruplar.get(anahtar) ?? { satis: D(0), alis: D(0), tediye: D(0) };
      g.tediye = g.tediye.add(td.tutarTry);
      gruplar.set(anahtar, g);
    }

    return [...gruplar.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "tr"))
      .map(([grup, g]) => {
        const net = g.satis.sub(g.alis).sub(g.tediye);
        return {
          grup,
          satisMatrah: g.satis.toFixed(2),
          alisMatrah: g.alis.toFixed(2),
          tediyeGiderleri: g.tediye.toFixed(2),
          netKarZarar: net.toFixed(2),
        };
      });
  },
});
