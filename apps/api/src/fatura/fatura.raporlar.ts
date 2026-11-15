import { BadRequestException } from "@nestjs/common";
import { planOzelligiAcik } from "../core/abonelik-erisim.service";
import { endeksVerisi } from "../fiyat-endeks/fiyat-endeks-veri";
import { reelDegerleyici } from "../fiyat-endeks/reel";
import { Prisma } from "@prisma/client";
import { KDV_BEYAN_YONLERI, kdvBeyanFaturalari, kdvBeyanSatirlari } from "./kdv-beyan";
import { FINANS_ROLLERI, registerRapor } from "../core/raporlar/rapor-kayit";
import { karZararHesapla, karZararVerisi } from "../rapor/kar-zarar";
import { bilinenMarj, maliyetBilinmiyor, satisSatirlari } from "../stok/satis-ozeti";
import { satisKirilimi } from "./satis-kirilimi";

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
  aciklama: "Kesin faturaların KDV hariç tutarları; satış ve alış ayrı sütunlarda, iadeler düşülerek net",
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
    // END-18: seçilirse net tutarlar dönem sonu fiyatlarıyla (endeksle) yan sütunda.
    { alan: "reelEndeks", ad: "Reel göster (boşsa yalnız nominal)", tip: "secim", secenekler: [{ deger: "TUFE", ad: "TÜFE ile" }, { deger: "YIUFE", ad: "Yİ-ÜFE ile" }] },
  ],
  gruplamalar: [
    { deger: "ay", ad: "Ay" },
    { deger: "cari", ad: "Cari" },
    { deger: "tip", ad: "Belge Tipi" },
  ],
  // RPR-13 (inceleme P1-2): önceden filtre boşken satış, alış ve iadeler aynı
  // "Matrah" sütununda toplanıyordu (iadeler artı); sayının anlamı yoktu.
  // RPR-26
  grafik: { tur: "sutun", kategori: "grup", seriler: ["netSatis", "netAlis"] },
  kolonlar: [
    { alan: "grup", baslik: "Kırılım", tip: "metin" },
    { alan: "satis", baslik: "Satış (TL)", tip: "para", toplam: true },
    { alan: "satisIade", baslik: "Satış İadesi (TL)", tip: "para", toplam: true },
    { alan: "netSatis", baslik: "Net Satış (TL)", tip: "para", toplam: true },
    { alan: "alis", baslik: "Alış (TL)", tip: "para", toplam: true },
    { alan: "alisIade", baslik: "Alış İadesi (TL)", tip: "para", toplam: true },
    { alan: "netAlis", baslik: "Net Alış (TL)", tip: "para", toplam: true },
    { alan: "belgeSayisi", baslik: "Belge Sayısı", tip: "sayi", toplam: true },
    { alan: "reelNetSatis", baslik: "Reel Net Satış (TL)", tip: "para", toplam: true },
    { alan: "reelNetAlis", baslik: "Reel Net Alış (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx, tenantId }) {
    const f = girdi.filtreler ?? {};
    const reel = await reelHazirla(tx, tenantId, f.reelEndeks, f.bitis);
    const faturalar = await tx.fatura.findMany({
      where: {
        durum: "kesin",
        tip: f.tip
          ? (String(f.tip) as "satis" | "alis" | "satis_iade" | "alis_iade")
          : { not: "proforma" },
        tarih: tarihAraligi(f.baslangic, f.bitis),
      },
      select: { tip: true, tarih: true, toplamMatrah: true, kur: true, cari: { select: { unvan: true } } },
    });
    const gruplama = girdi.gruplama ?? "ay";
    type Grup = { satis: Prisma.Decimal; satisIade: Prisma.Decimal; alis: Prisma.Decimal; alisIade: Prisma.Decimal; belgeSayisi: number; reelSatis: Prisma.Decimal; reelAlis: Prisma.Decimal };
    const gruplar = new Map<string, Grup>();
    for (const ft of faturalar) {
      const anahtar = gruplama === "cari" ? ft.cari.unvan : gruplama === "tip" ? TIP_ADLARI[ft.tip] : ay(ft.tarih);
      const g = gruplar.get(anahtar) ?? { satis: D(0), satisIade: D(0), alis: D(0), alisIade: D(0), belgeSayisi: 0, reelSatis: D(0), reelAlis: D(0) };
      const tutar = ft.toplamMatrah.mul(ft.kur);
      const alan = ({ satis: "satis", satis_iade: "satisIade", alis: "alis", alis_iade: "alisIade" } as const)[ft.tip as "satis"];
      if (alan) g[alan] = g[alan].add(tutar);
      if (reel) {
        const c = reel.carpan(ft.tarih) ?? D(1);
        const isaret = ft.tip.endsWith("_iade") ? -1 : 1;
        if (ft.tip.startsWith("satis")) g.reelSatis = g.reelSatis.add(tutar.mul(c).mul(isaret));
        else if (ft.tip.startsWith("alis")) g.reelAlis = g.reelAlis.add(tutar.mul(c).mul(isaret));
      }
      g.belgeSayisi += 1;
      gruplar.set(anahtar, g);
    }
    return [...gruplar.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "tr"))
      .map(([grup, g]) => ({
        grup,
        satis: g.satis.toFixed(2),
        satisIade: g.satisIade.toFixed(2),
        netSatis: g.satis.sub(g.satisIade).toFixed(2),
        alis: g.alis.toFixed(2),
        alisIade: g.alisIade.toFixed(2),
        netAlis: g.alis.sub(g.alisIade).toFixed(2),
        belgeSayisi: g.belgeSayisi,
        reelNetSatis: reel ? g.reelSatis.toFixed(2) : null,
        reelNetAlis: reel ? g.reelAlis.toFixed(2) : null,
      }));
  },
});

// ─── Kâr marjı analizi (eski /rapor/kar-zarar buraya taşındı) ───────────────

registerRapor({
  kod: "fatura.kar-marji",
  modul: "fatura",
  ad: "Kâr Marjı Analizi",
  aciklama:
    "Net satış (iadeler düşülmüş) − satış anındaki maliyet; ürün/cari/ay kırılımında. Maliyeti bilinmeyen ciro ayrı, marja girmez",
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
    { alan: "maliyetsizCiro", baslik: "Maliyeti Bilinmeyen Ciro (TL)", tip: "para", toplam: true },
  ],
  // RPR-13 (inceleme P1-6): önceden kartın bugünkü ortalama maliyeti × satır
  // miktarı (ek birim çevrilmeden), iadeler düşülmeden; artık SMM ile aynı kaynak.
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const gruplama = girdi.gruplama ?? "urun";
    const gruplar = new Map<string, { ciro: Prisma.Decimal; maliyet: Prisma.Decimal; maliyetsiz: Prisma.Decimal }>();
    for (const s of await satisSatirlari(tx, tarihAraligi(f.baslangic, f.bitis))) {
      const anahtar = gruplama === "cari" ? s.cariUnvan : gruplama === "ay" ? ay(s.tarih) : `${s.kod} · ${s.ad}`;
      const g = gruplar.get(anahtar) ?? { ciro: D(0), maliyet: D(0), maliyetsiz: D(0) };
      g.ciro = g.ciro.add(s.ciro);
      g.maliyet = g.maliyet.add(s.maliyet);
      if (maliyetBilinmiyor(s)) g.maliyetsiz = g.maliyetsiz.add(s.ciro);
      gruplar.set(anahtar, g);
    }
    return [...gruplar.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "tr"))
      .map(([grup, g]) => ({
        grup,
        ciro: g.ciro.toFixed(2),
        maliyet: g.maliyet.toFixed(2),
        kar: g.ciro.sub(g.maliyet).toFixed(2),
        marj: bilinenMarj(g.ciro, g.maliyet, g.maliyetsiz),
        maliyetsizCiro: g.maliyetsiz.toFixed(2),
      }));
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
    "Beyanname yerleşimiyle oran kırılımı: hesaplanan (satış, alıştan iade), indirilecek (alış tam KDV, satıştan iade), KDV-2 tevkifatı ve bilgi satırları; KDV ön analiziyle aynı hesap",
  // RPR-13: beyan bilgisi; satış rolü görmez.
  roller: FINANS_ROLLERI,
  filtreler: TARIH_FILTRELERI,
  kolonlar: [
    { alan: "yon", baslik: "Beyan Satırı", tip: "metin" },
    { alan: "kdvOrani", baslik: "KDV Oranı", tip: "yuzde" },
    { alan: "matrah", baslik: "Matrah (TL)", tip: "para" },
    { alan: "kdv", baslik: "KDV (TL)", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    // RPR-13: önceden her iki yönde net KDV alınıyor, iadeler kendi yönünden
    // düşülüyordu; tevkifatlı alışta ön analizle farklı indirilecek KDV çıkıyordu.
    return kdvBeyanSatirlari(await kdvBeyanFaturalari(tx, tarihAraligi(f.baslangic, f.bitis))).map((s) => ({
      yon: KDV_BEYAN_YONLERI[s.yon],
      kdvOrani: s.kdvOrani,
      matrah: s.matrah.toFixed(2),
      kdv: s.kdv.toFixed(2),
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
    { alan: "tip", baslik: "Tip", tip: "metin", kayit: { tur: "fatura", idAlani: "faturaId" } },
    { alan: "tarih", baslik: "Belge Tarihi", tip: "tarih" },
    { alan: "cari", baslik: "Cari", tip: "metin", kayit: { tur: "cari", idAlani: "cariId" } },
    { alan: "toplam", baslik: "Genel Toplam (TL)", tip: "para", toplam: true },
    { alan: "bekleyenGun", baslik: "Bekleme (Gün)", tip: "sayi" },
  ],
  async calistir(_girdi, { tx }) {
    const taslaklar = await tx.fatura.findMany({
      where: { durum: "taslak" },
      select: {
        id: true,
        tip: true,
        tarih: true,
        genelToplam: true,
        kur: true,
        createdAt: true,
        cari: { select: { id: true, unvan: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const simdi = Date.now();
    return taslaklar.map((ft) => ({
      faturaId: ft.id,
      cariId: ft.cari.id,
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

// ─── Kâr/Zarar Özeti (RPR-05, RPR-12) ───────────────────────────────────────

registerRapor({
  kod: "genel.kar-zarar-ozeti",
  modul: "genel",
  ad: "Kâr/Zarar Özeti",
  aciklama:
    "Net satış − satılan malın maliyeti = brüt kâr; + diğer gelirler − hizmet alışı, masraf ve bordro = net kâr. Tahakkuk esaslı, KDV hariç; mal alışı gider değil (stoğa girer), ödemeler kâra girmez.",
  // RPR-11: kâr bilgisi; satış/depo rolleri görmez.
  roller: FINANS_ROLLERI,
  filtreler: TARIH_FILTRELERI.map((f) => ({ ...f, zorunlu: true })),
  gruplamalar: [
    { deger: "ay", ad: "Ay" },
    { deger: "yok", ad: "Dönem toplamı" },
  ],
  // RPR-26
  grafik: { tur: "cizgi", kategori: "grup", seriler: ["netSatis", "brutKar", "netKar"] },
  kolonlar: [
    { alan: "grup", baslik: "Dönem", tip: "metin" },
    { alan: "netSatis", baslik: "Net Satış (TL)", tip: "para", toplam: true },
    { alan: "smm", baslik: "Satılan Malın Maliyeti (TL)", tip: "para", toplam: true },
    { alan: "brutKar", baslik: "Brüt Kâr (TL)", tip: "para", toplam: true },
    { alan: "digerGelirler", baslik: "Diğer Gelirler (TL)", tip: "para", toplam: true },
    { alan: "faaliyetGiderleri", baslik: "Giderler (TL)", tip: "para", toplam: true },
    { alan: "netKar", baslik: "Net Kâr/Zarar (TL)", tip: "para", toplam: true },
    { alan: "maliyetsizCiro", baslik: "Maliyeti Bilinmeyen Satış (TL)", tip: "para", toplam: true },
  ],
  // RPR-12: eski formül (satış − alış − bütün tediyeler) tedarikçi ödemelerini
  // de düşüp alışı iki kez sayıyordu (1–11 Ekim: −795 bin; doğrusu SMM bazlı).
  async calistir(girdi, { tx, tenantId }) {
    const f = girdi.filtreler ?? {};
    const baslangic = new Date(`${String(f.baslangic)}T00:00:00.000Z`);
    const bitis = new Date(`${String(f.bitis)}T23:59:59.999Z`);
    const { kalemler, satirlar } = await karZararVerisi(tx, tenantId, baslangic, bitis);
    const gruplama = girdi.gruplama ?? "ay";
    const anahtar = (tarih: string) => (gruplama === "yok" ? "Dönem" : tarih.slice(0, 7));
    const gruplar = new Set([...kalemler.map((k) => anahtar(k.tarih)), ...satirlar.map((s) => anahtar(s.tarih.toISOString()))]);
    return [...gruplar].sort().map((grup) => {
      const kz = karZararHesapla(
        kalemler.filter((k) => anahtar(k.tarih) === grup),
        satirlar.filter((s) => anahtar(s.tarih.toISOString()) === grup),
      );
      return {
        grup,
        netSatis: kz.netSatis.toFixed(2),
        smm: kz.smm.toFixed(2),
        brutKar: kz.brutKar.toFixed(2),
        digerGelirler: kz.digerGelirler.toFixed(2),
        faaliyetGiderleri: kz.faaliyetGiderleri.toFixed(2),
        netKar: kz.netKar.toFixed(2),
        maliyetsizCiro: kz.maliyetsizSatis.ciro.toFixed(2),
      };
    });
  },
});

// ─── Satış kırılımları (RPR-29, RPR-03) ─────────────────────────────────────

registerRapor({
  kod: "fatura.satis-kirilimlari",
  modul: "fatura",
  ad: "Satış Kırılımları",
  aciklama:
    "Net satış (iadeler düşülmüş, KDV hariç TL) temsilci, ürün kategorisi, il ya da ülke kırılımında; temsilci carinin bugünkü temsilcisidir",
  filtreler: TARIH_FILTRELERI.map((f) => ({ ...f, zorunlu: true })),
  gruplamalar: [
    { deger: "temsilci", ad: "Satış temsilcisi" },
    { deger: "kategori", ad: "Ürün kategorisi" },
    { deger: "il", ad: "İl" },
    { deger: "ulke", ad: "Ülke" },
  ],
  // RPR-26
  grafik: { tur: "yatay", kategori: "grup", seriler: ["netSatis"], enCok: 10 },
  kolonlar: [
    { alan: "grup", baslik: "Kırılım", tip: "metin" },
    { alan: "netSatis", baslik: "Net Satış (TL)", tip: "para", toplam: true },
    { alan: "pay", baslik: "Pay", tip: "yuzde" },
    { alan: "faturaSayisi", baslik: "Fatura", tip: "sayi" },
    { alan: "cariSayisi", baslik: "Cari", tip: "sayi" },
    { alan: "miktar", baslik: "Miktar (ana birim)", tip: "sayi" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await satisSatirlari(tx, tarihAraligi(f.baslangic, f.bitis));
    const gruplama = girdi.gruplama ?? "temsilci";
    if (gruplama === "kategori") {
      const kartlar = await tx.stokKart.findMany({ where: { id: { in: [...new Set(satirlar.map((s) => s.stokId))] } }, select: { id: true, kategori: { select: { ad: true } } } });
      const kategori = new Map(kartlar.map((k) => [k.id, k.kategori?.ad ?? null]));
      return satisKirilimi(satirlar, (s) => kategori.get(s.stokId) ?? null);
    }
    const cariler = await tx.cariHesap.findMany({
      where: { id: { in: [...new Set(satirlar.map((s) => s.cariId))] } },
      select: { id: true, temsilci: { select: { adSoyad: true } }, adresler: { select: { tip: true, il: true, ulke: true } } },
    });
    // Fatura adresi, yoksa ilk adres.
    const adres = (c: (typeof cariler)[number]) => c.adresler.find((a) => a.tip === "fatura") ?? c.adresler[0];
    const deger = new Map(cariler.map((c) => [c.id,
      // Yazım farkı (İstanbul / İSTANBUL) ayrı satır açmasın.
      gruplama === "il" ? adres(c)?.il?.trim().toLocaleUpperCase("tr-TR") || null
      : gruplama === "ulke" ? adres(c)?.ulke ?? null
      : c.temsilci?.adSoyad ?? null]));
    return satisKirilimi(satirlar, (s) => deger.get(s.cariId) ?? null);
  },
});

/**
 * END-18: reel göster süzgeci. Seçiliyse fiyat–endeks plan özelliği ister;
 * baz bitiş ayına (boşsa bugüne) kadar son açıklanan aydır.
 */
async function reelHazirla(tx: Prisma.TransactionClient, tenantId: string, kod: unknown, bitis: unknown) {
  if (kod !== "TUFE" && kod !== "YIUFE") return null;
  if (!(await planOzelligiAcik(tx, tenantId, "fiyatEndeksAnalizi"))) throw new BadRequestException("Reel gösterim fiyat ve endeks analizi plan özelliğini gerektirir.");
  const bitisAyi = (typeof bitis === "string" && /^\d{4}-\d{2}/.test(bitis) ? bitis.slice(0, 7) : new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }).slice(0, 7)) + "-01";
  const r = reelDegerleyici((await endeksVerisi(tx, kod, "2000-01-01", bitisAyi)).degerler, bitisAyi);
  if (!r) throw new BadRequestException("Seçilen endeksin dönem için açıklanmış değeri yok.");
  return r;
}
