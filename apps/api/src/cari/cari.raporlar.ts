import { Prisma } from "@prisma/client";
import { registerRapor } from "../core/raporlar/rapor-kayit";
import { cariYaslandirmalari } from "./cari-risk";
import { babsEsigi, babsKalemleri, babsOzeti, type BabsDurumu } from "./babs";

const AY_ADLARI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/**
 * Cari modülü raporları (CARI-12) — RPR-06 ortak araç setine tanım olarak
 * kaydedilir; filtre doğrulama, sıralama, Excel ve kayıtlı görünümler
 * altyapıdan gelir.
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

const ETIKET_FILTRESI = { alan: "etiket", ad: "Etiket", tip: "etiket" as const };

/** Etiket filtresi verildiyse cari sorgusuna atama koşulu ekler. */
const etiketKosulu = (etiketId: unknown) =>
  etiketId ? { etiketler: { some: { etiketId: String(etiketId) } } } : {};

// ─── Ekstre (CARI-04) ───────────────────────────────────────────────────────

registerRapor({
  kod: "cari.ekstre",
  modul: "cari",
  ad: "Cari Hesap Ekstresi",
  aciklama: "Seçilen carinin tarih aralığındaki hareketleri ve yürüyen bakiyesi",
  filtreler: [
    { alan: "cari", ad: "Cari", tip: "cari", zorunlu: true },
    ...TARIH_FILTRELERI,
  ],
  kolonlar: [
    { alan: "tarih", baslik: "Tarih", tip: "tarih" },
    { alan: "vadeTarihi", baslik: "Vade", tip: "tarih" },
    { alan: "tip", baslik: "Tip", tip: "metin" },
    { alan: "aciklama", baslik: "Açıklama", tip: "metin" },
    { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    { alan: "tutar", baslik: "Tutar", tip: "para" },
    { alan: "tutarTry", baslik: "Tutar (TL)", tip: "para" },
    { alan: "yuruyenBakiye", baslik: "Yürüyen Bakiye (TL)", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const hareketler = await tx.cariHareket.findMany({
      where: {
        cariId: String(f.cari),
        tarih: tarihAraligi(f.baslangic, f.bitis),
      },
      orderBy: [{ tarih: "asc" }, { createdAt: "asc" }],
    });
    let bakiye = D(0);
    return hareketler.map((h) => {
      bakiye = h.tip === "borc" ? bakiye.add(h.tutarTry) : bakiye.sub(h.tutarTry);
      return {
        tarih: h.tarih.toISOString().slice(0, 10),
        vadeTarihi: h.vadeTarihi?.toISOString().slice(0, 10) ?? null,
        tip: h.tip === "borc" ? "Borç" : "Alacak",
        aciklama: h.aciklama ?? "",
        dovizCinsi: h.dovizCinsi,
        tutar: h.tutar.toFixed(2),
        tutarTry: h.tutarTry.toFixed(2),
        yuruyenBakiye: bakiye.toFixed(2),
      };
    });
  },
});

// ─── Yaşlandırma (CARI-06) ──────────────────────────────────────────────────

registerRapor({
  kod: "cari.yaslandirma",
  modul: "cari",
  ad: "Yaşlandırma Raporu",
  aciklama: "Açık bakiyelerin vade gecikme kovalarına dağılımı; döviz başına FIFO, TL güncel döviz satış kuruyla",
  filtreler: [
    {
      alan: "yon",
      ad: "Yön",
      tip: "secim",
      secenekler: [
        { deger: "alacaklarimiz", ad: "Alacaklarımız (müşteriler)" },
        { deger: "borclarimiz", ad: "Borçlarımız (tedarikçiler)" },
      ],
    },
    ETIKET_FILTRESI,
  ],
  // RPR-26
  grafik: { tur: "yatay", seriler: ["gun0_30", "gun31_60", "gun61_90", "gun90Ustu"] },
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "unvan", baslik: "Ünvan", tip: "metin" },
    { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    { alan: "dovizToplam", baslik: "Açık (döviz)", tip: "sayi" },
    { alan: "kur", baslik: "Güncel kur", tip: "sayi" },
    { alan: "guncel", baslik: "Güncel (TL)", tip: "para", toplam: true },
    { alan: "gun0_30", baslik: "0-30 Gün (TL)", tip: "para", toplam: true },
    { alan: "gun31_60", baslik: "31-60 Gün (TL)", tip: "para", toplam: true },
    { alan: "gun61_90", baslik: "61-90 Gün (TL)", tip: "para", toplam: true },
    { alan: "gun90Ustu", baslik: "90+ Gün (TL)", tip: "para", toplam: true },
    { alan: "toplam", baslik: "Toplam (TL)", tip: "para", toplam: true },
  ],
  // CARI-33: her cari × döviz bir satır; TL kovaları güncel kurla, iptal çiftleri düşülmüş (kartla aynı kaynak).
  async calistir(girdi, { tx, tenantId }) {
    const yon = girdi.filtreler?.yon === "borclarimiz" ? "borclarimiz" : "alacaklarimiz";
    const cariler = await tx.cariHesap.findMany({
      where: { aktif: true, ...etiketKosulu(girdi.filtreler?.etiket) },
      select: { id: true, kod: true, unvan: true },
      orderBy: { kod: "asc" },
    });
    const yaslandirmalar = await cariYaslandirmalari(tx, tenantId, cariler.map((c) => c.id), { yon });
    const tl = (n: number) => Math.round(n * 100) / 100;
    return cariler.flatMap((c) =>
      yaslandirmalar.get(c.id)!.dovizler.map((d) => ({
        kod: c.kod,
        unvan: c.unvan,
        dovizCinsi: d.kurEksik ? `${d.dovizCinsi} (güncel kur yok)` : d.dovizCinsi,
        dovizToplam: d.toplam,
        kur: Math.round(d.kur * 1e6) / 1e6,
        guncel: tl(d.guncel * d.kur),
        gun0_30: tl(d.gun0_30 * d.kur),
        gun31_60: tl(d.gun31_60 * d.kur),
        gun61_90: tl(d.gun61_90 * d.kur),
        gun90Ustu: tl(d.gun90Ustu * d.kur),
        toplam: tl(d.toplam * d.kur),
      })),
    );
  },
});

// ─── Form BA / BS (CARI-37) ─────────────────────────────────────────────────

const BABS_DURUM_ADLARI: Record<BabsDurumu, string> = { bildirilir: "Bildirilir", esige_yakin: "Eşiğe yakın", esik_alti: "Eşik altı" };

registerRapor({
  kod: "cari.babs",
  modul: "cari",
  ad: "Form BA / BS",
  aciklama: "Aylık, kişi başına KDV hariç alış (BA) ve satış (BS) toplamları; eşik Ayarlar > Cari'den",
  filtreler: [
    { alan: "yil", ad: "Yıl", tip: "sayi", zorunlu: true },
    { alan: "ay", ad: "Ay", tip: "secim", zorunlu: true, secenekler: AY_ADLARI.map((ad, i) => ({ deger: String(i + 1), ad })) },
    { alan: "form", ad: "Form", tip: "secim", zorunlu: true, secenekler: [{ deger: "ba", ad: "Form BA (alışlar)" }, { deger: "bs", ad: "Form BS (satışlar)" }] },
    {
      alan: "kapsam",
      ad: "Kapsam",
      tip: "secim",
      secenekler: [
        { deger: "bildirilir", ad: "Bildirilecekler (eşik ve üstü)" },
        { deger: "esige_yakin", ad: "Eşiğe yakınlar (eşiğin %80'i ve üstü, altında)" },
        { deger: "tumu", ad: "Tümü" },
      ],
    },
  ],
  kolonlar: [
    { alan: "unvan", baslik: "Ünvan", tip: "metin" },
    { alan: "vknTckn", baslik: "VKN / TCKN", tip: "metin" },
    { alan: "ulke", baslik: "Ülke", tip: "metin" },
    { alan: "cariKodlari", baslik: "Cari kodu", tip: "metin" },
    { alan: "belgeSayisi", baslik: "Belge sayısı", tip: "sayi", toplam: true },
    { alan: "tutar", baslik: "KDV hariç tutar (TL)", tip: "para", toplam: true },
    { alan: "durum", baslik: "Durum", tip: "metin" },
  ],
  async calistir(girdi, { tx, tenantId }) {
    const f = girdi.filtreler ?? {};
    const yil = Number(f.yil);
    const ay = Number(f.ay);
    if (!Number.isInteger(yil) || yil < 2000 || yil > 2100 || !Number.isInteger(ay) || ay < 1 || ay > 12) return [];
    const kapsam = f.kapsam === "tumu" || f.kapsam === "esige_yakin" ? f.kapsam : "bildirilir";
    const [kalemler, esik] = await Promise.all([babsKalemleri(tx, yil, ay), babsEsigi(tx, yil, ay)]);
    return babsOzeti(kalemler.filter((k) => k.form === f.form), esik)
      .filter((s) => kapsam === "tumu" || s.durum === kapsam)
      .map((s) => ({
        unvan: s.unvan,
        vknTckn: s.vknTckn ?? "Kimlik yok",
        ulke: s.ulke,
        cariKodlari: s.cariKodlari.join(", ") || "—",
        belgeSayisi: s.belgeSayisi,
        tutar: s.tutar,
        durum: BABS_DURUM_ADLARI[s.durum],
      }));
  },
});

// ─── Cari bazlı satış/alış özeti ────────────────────────────────────────────

registerRapor({
  kod: "cari.satis-alis-ozeti",
  modul: "cari",
  ad: "Cari Bazlı Satış/Alış Özeti",
  aciklama: "Kesinleşmiş faturaların cari kırılımında toplamları (TL)",
  filtreler: [...TARIH_FILTRELERI, ETIKET_FILTRESI],
  // RPR-26
  grafik: { tur: "yatay", kategori: "unvan", seriler: ["netSatis"], enCok: 10 },
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "unvan", baslik: "Ünvan", tip: "metin" },
    { alan: "satis", baslik: "Satış", tip: "para", toplam: true },
    { alan: "satisIade", baslik: "Satış İade", tip: "para", toplam: true },
    { alan: "alis", baslik: "Alış", tip: "para", toplam: true },
    { alan: "alisIade", baslik: "Alış İade", tip: "para", toplam: true },
    { alan: "netSatis", baslik: "Net Satış", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const faturalar = await tx.fatura.findMany({
      where: {
        durum: "kesin",
        tarih: tarihAraligi(f.baslangic, f.bitis),
        cari: { ...etiketKosulu(f.etiket) },
      },
      select: {
        tip: true,
        genelToplam: true,
        kur: true,
        cari: { select: { id: true, kod: true, unvan: true } },
      },
    });
    const gruplar = new Map<
      string,
      { kod: string; unvan: string; toplamlar: Record<string, Prisma.Decimal> }
    >();
    for (const ft of faturalar) {
      const grup = gruplar.get(ft.cari.id) ?? {
        kod: ft.cari.kod,
        unvan: ft.cari.unvan,
        toplamlar: {},
      };
      const tutarTry = ft.genelToplam.mul(ft.kur);
      grup.toplamlar[ft.tip] = (grup.toplamlar[ft.tip] ?? D(0)).add(tutarTry);
      gruplar.set(ft.cari.id, grup);
    }
    return [...gruplar.values()].map((g) => {
      const al = (tip: string): Prisma.Decimal => g.toplamlar[tip] ?? D(0);
      return {
        kod: g.kod,
        unvan: g.unvan,
        satis: al("satis").toFixed(2),
        satisIade: al("satis_iade").toFixed(2),
        alis: al("alis").toFixed(2),
        alisIade: al("alis_iade").toFixed(2),
        netSatis: al("satis").sub(al("satis_iade")).toFixed(2),
      };
    });
  },
});

// ─── Tahsilat performansı ───────────────────────────────────────────────────

registerRapor({
  kod: "cari.tahsilat-performansi",
  modul: "cari",
  ad: "Tahsilat Performansı",
  aciklama:
    "Borçların alacak kayıtlarıyla FIFO kapanmasına göre ortalama tahsilat süresi",
  filtreler: [ETIKET_FILTRESI],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "unvan", baslik: "Ünvan", tip: "metin" },
    { alan: "tahsilEdilen", baslik: "Tahsil Edilen (TL)", tip: "para", toplam: true },
    { alan: "ortalamaGun", baslik: "Ortalama Süre (Gün)", tip: "sayi" },
    { alan: "acikBakiye", baslik: "Açık Bakiye (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const cariler = await tx.cariHesap.findMany({
      where: { aktif: true, ...etiketKosulu(girdi.filtreler?.etiket) },
      select: {
        kod: true,
        unvan: true,
        hareketler: {
          select: { tip: true, tutarTry: true, tarih: true },
          orderBy: { tarih: "asc" },
        },
      },
      orderBy: { kod: "asc" },
    });
    const GUN_MS = 24 * 60 * 60 * 1000;
    const sonuc = [];
    for (const c of cariler) {
      // FIFO: her alacak, en eski açık borçları kapatır; kapanan tutar için
      // borç→alacak gün farkı tutar ağırlığıyla toplanır.
      const acikBorclar: { tarih: Date; kalan: number }[] = [];
      let agirlikliGunToplami = 0;
      let tahsilEdilen = 0;
      for (const h of c.hareketler) {
        const tutar = Number(h.tutarTry);
        if (h.tip === "borc") {
          acikBorclar.push({ tarih: h.tarih, kalan: tutar });
          continue;
        }
        let kalanAlacak = tutar;
        while (kalanAlacak > 0.005 && acikBorclar.length > 0) {
          const borc = acikBorclar[0];
          const kapanan = Math.min(borc.kalan, kalanAlacak);
          const gun = Math.max(
            0,
            Math.floor((h.tarih.getTime() - borc.tarih.getTime()) / GUN_MS),
          );
          agirlikliGunToplami += gun * kapanan;
          tahsilEdilen += kapanan;
          borc.kalan -= kapanan;
          kalanAlacak -= kapanan;
          if (borc.kalan <= 0.005) acikBorclar.shift();
        }
      }
      if (tahsilEdilen <= 0.005 && acikBorclar.length === 0) continue;
      const acikBakiye = acikBorclar.reduce((t, b) => t + b.kalan, 0);
      sonuc.push({
        kod: c.kod,
        unvan: c.unvan,
        tahsilEdilen: tahsilEdilen.toFixed(2),
        ortalamaGun:
          tahsilEdilen > 0
            ? Math.round(agirlikliGunToplami / tahsilEdilen)
            : null,
        acikBakiye: acikBakiye.toFixed(2),
      });
    }
    return sonuc;
  },
});

// ─── En yüksek bakiyeli cariler ─────────────────────────────────────────────

registerRapor({
  kod: "cari.en-yuksek-bakiyeliler",
  modul: "cari",
  ad: "En Yüksek Bakiyeli Cariler",
  aciklama: "TL karşılığı açık bakiyesi en yüksek cariler",
  filtreler: [
    { alan: "adet", ad: "Kayıt Sayısı", tip: "sayi" },
    ETIKET_FILTRESI,
  ],
  // RPR-26
  grafik: { tur: "yatay", kategori: "unvan", seriler: ["bakiye"], enCok: 10 },
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "unvan", baslik: "Ünvan", tip: "metin" },
    { alan: "borc", baslik: "Borç (TL)", tip: "para", toplam: true },
    { alan: "alacak", baslik: "Alacak (TL)", tip: "para", toplam: true },
    { alan: "bakiye", baslik: "Bakiye (TL)", tip: "para", toplam: true },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const adet = typeof f.adet === "number" && f.adet > 0 ? f.adet : 20;
    const cariler = await tx.cariHesap.findMany({
      where: { aktif: true, ...etiketKosulu(f.etiket) },
      select: {
        kod: true,
        unvan: true,
        hareketler: { select: { tip: true, tutarTry: true } },
      },
    });
    return cariler
      .map((c) => {
        let borc = D(0);
        let alacak = D(0);
        for (const h of c.hareketler) {
          if (h.tip === "borc") borc = borc.add(h.tutarTry);
          else alacak = alacak.add(h.tutarTry);
        }
        const bakiye = borc.sub(alacak);
        return {
          kod: c.kod,
          unvan: c.unvan,
          borcD: borc,
          alacakD: alacak,
          bakiyeD: bakiye,
        };
      })
      .filter((c) => !c.bakiyeD.isZero())
      .sort((a, b) => b.bakiyeD.comparedTo(a.bakiyeD))
      .slice(0, adet)
      .map((c) => ({
        kod: c.kod,
        unvan: c.unvan,
        borc: c.borcD.toFixed(2),
        alacak: c.alacakD.toFixed(2),
        bakiye: c.bakiyeD.toFixed(2),
      }));
  },
});
