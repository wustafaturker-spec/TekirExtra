import { Prisma } from "@prisma/client";
import { registerRapor } from "../core/raporlar/rapor-kayit";
import { iptalCiftiMi, iptalEdilmisFaturalar, iptalleriGoster } from "../fatura/iptal-cifti";

/** Stok modülü raporları (STK-13) — RPR-06 araç seti tanımları. */

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal =>
  new Prisma.Decimal(deger);

const tarihAraligi = (baslangic?: unknown, bitis?: unknown) => ({
  ...(baslangic ? { gte: new Date(String(baslangic)) } : {}),
  ...(bitis ? { lte: new Date(String(bitis)) } : {}),
});

const TARIH_FILTRELERI = [
  { alan: "baslangic", ad: "Başlangıç", tip: "tarih" as const },
  { alan: "bitis", ad: "Bitiş", tip: "tarih" as const },
];

/**
 * Hareket türlerinin giriş/çıkış kovaları (STK-19, StokService ile uyumlu).
 * Depolar arası transfer (STK-07) ayrı kovadadır: firma toplamında alım/satım
 * gibi görünmemesi için giriş/çıkışa karışmaz.
 */
const GIRIS_TURLERI = new Set(["giris", "acilis"]);
const CIKIS_TURLERI = new Set(["cikis", "fire", "zayi", "numune", "promosyon"]);
const TRANSFER_TURLERI = new Set(["transfer_giris", "transfer_cikis"]);

/** Bugünden `gun` gün öncesinin YYYY-MM-DD karşılığı. */
const gunOnce = (gun: number): string =>
  new Date(Date.now() - gun * 86_400_000).toISOString().slice(0, 10);

/** Tarih aralığındaki kesin satış satırlarını stok bilgisiyle çeker. */
async function satisSatirlari(
  tx: Prisma.TransactionClient,
  baslangic?: unknown,
  bitis?: unknown,
) {
  return tx.faturaSatir.findMany({
    where: {
      fatura: {
        tip: "satis",
        durum: "kesin",
        tarih: tarihAraligi(baslangic, bitis),
      },
    },
    select: {
      stokId: true,
      miktar: true,
      matrah: true,
      fatura: { select: { kur: true } },
      stok: {
        select: {
          kod: true,
          ad: true,
          mevcutMiktar: true,
          ortalamaMaliyet: true,
        },
      },
    },
  });
}

// ─── Envanter değeri (STK-03) ───────────────────────────────────────────────

registerRapor({
  kod: "stok.envanter",
  modul: "stok",
  ad: "Envanter Değeri",
  aciklama: "Anlık stok miktarı ve ağırlıklı ortalama maliyetle envanter değeri",
  filtreler: [
    { alan: "kritikAlti", ad: "Yalnız kritik altı", tip: "onay" },
    { alan: "depo", ad: "Depo", tip: "depo" },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "depo", baslik: "Depo", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "miktar", baslik: "Miktar", tip: "sayi" },
    { alan: "rezerve", baslik: "Rezerve", tip: "sayi" },
    { alan: "kullanilabilir", baslik: "Kullanılabilir", tip: "sayi" },
    { alan: "yoldaki", baslik: "Yoldaki", tip: "sayi" },
    { alan: "ortalamaMaliyet", baslik: "Ort. Maliyet", tip: "para" },
    { alan: "envanterDegeri", baslik: "Envanter Değeri", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const depoId = girdi.filtreler?.depo ? String(girdi.filtreler.depo) : null;
    const kartlar = await tx.stokKart.findMany({
      where: { aktif: true, tip: "urun" },
      orderBy: { kod: "asc" },
    });

    // Depo seçiliyse miktarlar o deponun bakiyesinden okunur (STK-07);
    // seçili değilse kart üzerindeki firma toplamı kullanılır.
    const bakiyeler = depoId
      ? new Map(
          (await tx.stokDepoBakiye.findMany({ where: { depoId } })).map((b) => [
            b.stokId,
            b,
          ]),
        )
      : null;
    const depoAd = depoId
      ? ((await tx.depo.findUnique({ where: { id: depoId } }))?.ad ?? "")
      : "Tüm depolar";

    return kartlar
      .map((k) => {
        const b = bakiyeler?.get(k.id);
        const mevcut = bakiyeler ? D(b?.mevcutMiktar ?? 0) : k.mevcutMiktar;
        const rezerve = bakiyeler ? D(b?.rezerveMiktar ?? 0) : k.rezerveMiktar;
        const yoldaki = bakiyeler ? D(b?.yoldakiMiktar ?? 0) : k.yoldakiMiktar;
        return { k, mevcut, rezerve, yoldaki };
      })
      .filter(
        ({ k, mevcut }) =>
          !girdi.filtreler?.kritikAlti ||
          (k.kritikSeviye !== null && mevcut.lessThan(k.kritikSeviye)),
      )
      .map(({ k, mevcut, rezerve, yoldaki }) => ({
        kod: k.kod,
        ad: k.ad,
        depo: depoAd,
        birim: k.anaBirim,
        miktar: Number(mevcut),
        rezerve: Number(rezerve),
        kullanilabilir: Number(mevcut.sub(rezerve)),
        yoldaki: Number(yoldaki),
        ortalamaMaliyet: k.ortalamaMaliyet.toFixed(2),
        envanterDegeri: mevcut.mul(k.ortalamaMaliyet).toFixed(2),
      }));
  },
});

// ─── Stok hareket özeti ─────────────────────────────────────────────────────

registerRapor({
  kod: "stok.hareket-ozeti",
  modul: "stok",
  ad: "Stok Hareket Özeti",
  aciklama:
    "Tarih aralığında giriş (açılış dahil) / çıkış (fire, zayi, numune, promosyon dahil) / sayım düzeltme / depo transferi toplamları (ana birim)",
  filtreler: [
    ...TARIH_FILTRELERI,
    { alan: "stok", ad: "Ürün", tip: "stok" },
    { alan: "depo", ad: "Depo", tip: "depo" },
    { alan: "iptaller", ad: "İptalleri de göster", tip: "onay" },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "giris", baslik: "Giriş", tip: "sayi" },
    { alan: "cikis", baslik: "Çıkış", tip: "sayi" },
    { alan: "duzeltme", baslik: "Sayım Düzeltme", tip: "sayi" },
    { alan: "transfer", baslik: "Depo Transferi", tip: "sayi" },
    { alan: "net", baslik: "Net Değişim", tip: "sayi" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const hareketler = await tx.stokHareket.findMany({
      where: {
        tarih: tarihAraligi(f.baslangic, f.bitis),
        ...(f.stok ? { stokId: String(f.stok) } : {}),
        ...(f.depo ? { depoId: String(f.depo) } : {}),
      },
      select: {
        stokId: true,
        tip: true,
        miktar: true,
        kaynakTur: true,
        kaynakRef: true,
        stok: { select: { kod: true, ad: true } },
      },
    });
    // STK-22: iptal edilmiş faturanın hareketleri net değişimi etkilemez ama
    // giriş ve çıkış sütunlarını şişirir; seçenek işaretlenmedikçe sayılmaz.
    const iptaller = await iptalEdilmisFaturalar(tx, hareketler);
    const iptalleriSay = iptalleriGoster(f.iptaller);
    const gruplar = new Map<
      string,
      {
        kod: string;
        ad: string;
        giris: number;
        cikis: number;
        duzeltme: number;
        transfer: number;
      }
    >();
    for (const h of hareketler) {
      if (!iptalleriSay && iptalCiftiMi(h, iptaller)) continue;
      const g = gruplar.get(h.stokId) ?? {
        kod: h.stok.kod,
        ad: h.stok.ad,
        giris: 0,
        cikis: 0,
        duzeltme: 0,
        transfer: 0,
      };
      // miktar imzalı saklanır (çıkış türleri negatif). Kovalar işaretle
      // toplanır, mutlak değerle değil: işareti tipine uymayan hareket (fatura
      // iptalinin eskiden yazdığı eksi girişler) mutlak alınınca giriş sayılıp
      // net değişimi stok bakiyesinden saptırıyordu. Doğru veride sonuç aynı.
      const m = Number(h.miktar);
      if (GIRIS_TURLERI.has(h.tip)) g.giris += m;
      else if (CIKIS_TURLERI.has(h.tip)) g.cikis -= m;
      // Transfer imzalı toplanır: depo süzgeci yoksa firma genelinde sıfırlanır
      else if (TRANSFER_TURLERI.has(h.tip)) g.transfer += m;
      else g.duzeltme += m;
      gruplar.set(h.stokId, g);
    }
    return [...gruplar.values()]
      .sort((a, b) => a.kod.localeCompare(b.kod, "tr"))
      .map((g) => ({
        ...g,
        net: g.giris - g.cikis + g.duzeltme + g.transfer,
      }));
  },
});

// ─── En çok / en az satanlar ────────────────────────────────────────────────

registerRapor({
  kod: "stok.en-cok-satanlar",
  modul: "stok",
  ad: "En Çok / En Az Satanlar",
  aciklama: "Kesin satış faturalarına göre miktar ve ciro sıralaması",
  filtreler: [
    ...TARIH_FILTRELERI,
    {
      alan: "yon",
      ad: "Sıralama",
      tip: "secim",
      secenekler: [
        { deger: "cok", ad: "En çok satan" },
        { deger: "az", ad: "En az satan" },
      ],
    },
    { alan: "adet", ad: "Kayıt Sayısı", tip: "sayi" },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "miktar", baslik: "Satılan Miktar", tip: "sayi" },
    { alan: "ciro", baslik: "Ciro (TL)", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await satisSatirlari(tx, f.baslangic, f.bitis);
    const gruplar = new Map<
      string,
      { kod: string; ad: string; miktar: number; ciro: Prisma.Decimal }
    >();
    for (const s of satirlar) {
      const g = gruplar.get(s.stokId) ?? {
        kod: s.stok.kod,
        ad: s.stok.ad,
        miktar: 0,
        ciro: D(0),
      };
      g.miktar += Number(s.miktar);
      g.ciro = g.ciro.add(s.matrah.mul(s.fatura.kur));
      gruplar.set(s.stokId, g);
    }
    const adet = typeof f.adet === "number" && f.adet > 0 ? f.adet : 20;
    const isaret = f.yon === "az" ? 1 : -1;
    return [...gruplar.values()]
      .sort((a, b) => isaret * (a.miktar - b.miktar))
      .slice(0, adet)
      .map((g) => ({
        kod: g.kod,
        ad: g.ad,
        miktar: g.miktar,
        ciro: g.ciro.toFixed(2),
      }));
  },
});

// ─── Stok devir hızı ────────────────────────────────────────────────────────

registerRapor({
  kod: "stok.devir-hizi",
  modul: "stok",
  ad: "Stok Devir Hızı",
  aciklama:
    "Dönem satış miktarının mevcut stoğa oranı; stok tükenme süresi tahmini",
  filtreler: TARIH_FILTRELERI,
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "satilanMiktar", baslik: "Dönem Satışı", tip: "sayi" },
    { alan: "mevcutMiktar", baslik: "Mevcut Stok", tip: "sayi" },
    { alan: "devirHizi", baslik: "Devir Hızı", tip: "sayi" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await satisSatirlari(tx, f.baslangic, f.bitis);
    const gruplar = new Map<
      string,
      { kod: string; ad: string; satilan: number; mevcut: number }
    >();
    for (const s of satirlar) {
      const g = gruplar.get(s.stokId) ?? {
        kod: s.stok.kod,
        ad: s.stok.ad,
        satilan: 0,
        mevcut: Number(s.stok.mevcutMiktar),
      };
      g.satilan += Number(s.miktar);
      gruplar.set(s.stokId, g);
    }
    return [...gruplar.values()]
      .sort((a, b) => b.satilan - a.satilan)
      .map((g) => ({
        kod: g.kod,
        ad: g.ad,
        satilanMiktar: g.satilan,
        mevcutMiktar: g.mevcut,
        devirHizi:
          g.mevcut > 0 ? Math.round((g.satilan / g.mevcut) * 100) / 100 : null,
      }));
  },
});

// ─── Ürün bazlı kârlılık (STK-08 ağırlıklı ortalama maliyet) ────────────────

registerRapor({
  kod: "stok.urun-karlilik",
  modul: "stok",
  ad: "Ürün Bazlı Kârlılık",
  aciklama: "Satış matrahı ile ağırlıklı ortalama maliyet farkından kâr marjı",
  filtreler: TARIH_FILTRELERI,
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "satilanMiktar", baslik: "Miktar", tip: "sayi" },
    { alan: "ciro", baslik: "Ciro (TL)", tip: "para" },
    { alan: "maliyet", baslik: "Maliyet (TL)", tip: "para" },
    { alan: "kar", baslik: "Kâr (TL)", tip: "para" },
    { alan: "marj", baslik: "Marj", tip: "yuzde" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const satirlar = await satisSatirlari(tx, f.baslangic, f.bitis);
    const gruplar = new Map<
      string,
      { kod: string; ad: string; miktar: number; ciro: Prisma.Decimal; maliyet: Prisma.Decimal }
    >();
    for (const s of satirlar) {
      const g = gruplar.get(s.stokId) ?? {
        kod: s.stok.kod,
        ad: s.stok.ad,
        miktar: 0,
        ciro: D(0),
        maliyet: D(0),
      };
      g.miktar += Number(s.miktar);
      g.ciro = g.ciro.add(s.matrah.mul(s.fatura.kur));
      g.maliyet = g.maliyet.add(s.stok.ortalamaMaliyet.mul(s.miktar));
      gruplar.set(s.stokId, g);
    }
    return [...gruplar.values()]
      .sort((a, b) => a.kod.localeCompare(b.kod, "tr"))
      .map((g) => {
        const kar = g.ciro.sub(g.maliyet);
        return {
          kod: g.kod,
          ad: g.ad,
          satilanMiktar: g.miktar,
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

// ─── Kritik stok listesi (STK-04) ───────────────────────────────────────────

registerRapor({
  kod: "stok.kritik-stok",
  modul: "stok",
  ad: "Kritik Stok Listesi",
  aciklama: "Mevcut miktarı kritik seviyenin altına düşen ürünler",
  filtreler: [],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "mevcut", baslik: "Mevcut", tip: "sayi" },
    { alan: "kritikSeviye", baslik: "Kritik Seviye", tip: "sayi" },
    { alan: "eksik", baslik: "Eksik", tip: "sayi" },
  ],
  async calistir(_girdi, { tx }) {
    const kartlar = await tx.stokKart.findMany({
      where: { aktif: true, kritikSeviye: { not: null } },
      orderBy: { kod: "asc" },
    });
    return kartlar
      .filter((k) => k.kritikSeviye && k.mevcutMiktar.lessThan(k.kritikSeviye))
      .map((k) => ({
        kod: k.kod,
        ad: k.ad,
        mevcut: Number(k.mevcutMiktar),
        kritikSeviye: Number(k.kritikSeviye),
        eksik: Number(D(k.kritikSeviye ?? 0).sub(k.mevcutMiktar)),
      }));
  },
});

// ─── Sipariş önerisi (STK-16, STK-18) ───────────────────────────────────────

registerRapor({
  kod: "stok.siparis-onerisi",
  modul: "stok",
  ad: "Sipariş Önerisi",
  aciklama:
    "Yeniden sipariş noktası (ort. günlük satış × tedarik süresi + güvenlik stoğu) " +
    "altına düşen ürünler; varsayılan tedarikçi bilgisiyle",
  filtreler: [{ alan: "gun", ad: "Satış Ortalaması Dönemi (gün)", tip: "sayi" }],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "mevcut", baslik: "Mevcut", tip: "sayi" },
    { alan: "gunlukSatis", baslik: "Ort. Günlük Satış", tip: "sayi" },
    { alan: "tedarikSuresi", baslik: "Tedarik Süresi (gün)", tip: "sayi" },
    { alan: "siparisNoktasi", baslik: "Sipariş Noktası", tip: "sayi" },
    { alan: "oneriMiktar", baslik: "Önerilen Miktar", tip: "sayi" },
    { alan: "tedarikci", baslik: "Varsayılan Tedarikçi", tip: "metin" },
    { alan: "alisFiyati", baslik: "Alış Fiyatı", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const gun = typeof f.gun === "number" && f.gun > 0 ? f.gun : 90;

    const satirlar = await satisSatirlari(tx, gunOnce(gun));
    const satislar = new Map<string, Prisma.Decimal>();
    for (const s of satirlar) {
      satislar.set(s.stokId, (satislar.get(s.stokId) ?? D(0)).add(s.miktar));
    }

    const kartlar = await tx.stokKart.findMany({
      where: { aktif: true, tip: { in: ["urun", "sarf"] } },
      include: {
        tedarikciler: {
          where: { varsayilan: true },
          take: 1,
          include: { cari: { select: { unvan: true } } },
        },
      },
      orderBy: { kod: "asc" },
    });

    const sonuc = [];
    for (const k of kartlar) {
      const tedarikci = k.tedarikciler[0];
      const gunlukSatis = (satislar.get(k.id) ?? D(0)).div(gun);
      const tedarikSuresi =
        k.tedarikSuresiGun ?? tedarikci?.tedarikSuresiGun ?? 0;
      const guvenlik = D(k.guvenlikStogu ?? 0);
      // Sipariş noktası; minimum stok tanımlıysa alt sınır olarak uygulanır
      let nokta = gunlukSatis.mul(tedarikSuresi).add(guvenlik);
      if (k.minStok && nokta.lt(k.minStok)) nokta = D(k.minStok);
      // FTR-12: karşılaştırma eldeki tahmini üzerinden — rezerve düşülür,
      // açık alış siparişlerinden gelecek (yoldaki) miktar eklenir
      const eldeki = k.mevcutMiktar
        .sub(k.rezerveMiktar)
        .add(k.yoldakiMiktar);
      if (nokta.lte(0) || eldeki.gt(nokta)) continue;

      // Hedef: maksimum stok tanımlıysa oraya, değilse sipariş noktasına tamamla
      const hedef =
        k.maksStok && D(k.maksStok).gt(nokta) ? D(k.maksStok) : nokta;
      sonuc.push({
        kod: k.kod,
        ad: k.ad,
        mevcut: Number(k.mevcutMiktar),
        gunlukSatis: gunlukSatis.toDecimalPlaces(3).toNumber(),
        tedarikSuresi,
        siparisNoktasi: nokta.toDecimalPlaces(3).toNumber(),
        oneriMiktar: hedef.sub(eldeki).toDecimalPlaces(3).toNumber(),
        tedarikci: tedarikci?.cari.unvan ?? null,
        alisFiyati:
          (tedarikci?.alisFiyati ?? k.alisFiyati)?.toFixed(2) ?? null,
      });
    }
    return sonuc;
  },
});

// ─── Fire / zayi (STK-19) ───────────────────────────────────────────────────

registerRapor({
  kod: "stok.fire-zayi",
  modul: "stok",
  ad: "Fire / Zayi",
  aciklama:
    "Tarih aralığındaki fire ve zayi çıkışları; hareket anındaki ortalama maliyetle tutar",
  filtreler: [
    ...TARIH_FILTRELERI,
    {
      alan: "tur",
      ad: "Tür",
      tip: "secim",
      secenekler: [
        { deger: "fire", ad: "Fire" },
        { deger: "zayi", ad: "Zayi" },
      ],
    },
  ],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "tur", baslik: "Tür", tip: "metin" },
    { alan: "miktar", baslik: "Miktar", tip: "sayi" },
    { alan: "tutar", baslik: "Tutar (TL)", tip: "para" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const hareketler = await tx.stokHareket.findMany({
      where: {
        tip: f.tur ? (f.tur as "fire" | "zayi") : { in: ["fire", "zayi"] },
        tarih: tarihAraligi(f.baslangic, f.bitis),
      },
      select: {
        stokId: true,
        tip: true,
        miktar: true,
        maliyet: true,
        stok: { select: { kod: true, ad: true } },
      },
    });
    const gruplar = new Map<
      string,
      { kod: string; ad: string; tur: string; miktar: Prisma.Decimal; tutar: Prisma.Decimal }
    >();
    for (const h of hareketler) {
      const anahtar = `${h.stokId}:${h.tip}`;
      const g = gruplar.get(anahtar) ?? {
        kod: h.stok.kod,
        ad: h.stok.ad,
        tur: h.tip === "fire" ? "Fire" : "Zayi",
        miktar: D(0),
        tutar: D(0),
      };
      const miktar = h.miktar.abs(); // çıkış türleri negatif saklanır
      g.miktar = g.miktar.add(miktar);
      g.tutar = g.tutar.add(miktar.mul(h.maliyet));
      gruplar.set(anahtar, g);
    }
    return [...gruplar.values()]
      .sort(
        (a, b) => a.kod.localeCompare(b.kod, "tr") || a.tur.localeCompare(b.tur, "tr"),
      )
      .map((g) => ({
        kod: g.kod,
        ad: g.ad,
        tur: g.tur,
        miktar: Number(g.miktar),
        tutar: g.tutar.toFixed(2),
      }));
  },
});

// ─── Hareketsiz stok ────────────────────────────────────────────────────────

registerRapor({
  kod: "stok.hareketsiz",
  modul: "stok",
  ad: "Hareketsiz Stok",
  aciklama:
    "Belirtilen gün sayısı boyunca hiç hareket görmemiş, stoğu bulunan ürünler",
  filtreler: [{ alan: "gun", ad: "Gün", tip: "sayi" }],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "mevcut", baslik: "Mevcut", tip: "sayi" },
    { alan: "envanterDegeri", baslik: "Envanter Değeri", tip: "para" },
    { alan: "sonHareket", baslik: "Son Hareket", tip: "tarih" },
  ],
  async calistir(girdi, { tx }) {
    const f = girdi.filtreler ?? {};
    const gun = typeof f.gun === "number" && f.gun > 0 ? f.gun : 90;
    const sinir = new Date(gunOnce(gun));

    const sonHareketler = await tx.stokHareket.groupBy({
      by: ["stokId"],
      _max: { tarih: true },
    });
    const sonTarih = new Map(
      sonHareketler.map((h) => [h.stokId, h._max.tarih]),
    );

    const kartlar = await tx.stokKart.findMany({
      where: { aktif: true, tip: { in: ["urun", "sarf"] }, mevcutMiktar: { gt: 0 } },
      orderBy: { kod: "asc" },
    });
    return kartlar
      .filter((k) => {
        const son = sonTarih.get(k.id);
        return !son || son < sinir;
      })
      .map((k) => ({
        kod: k.kod,
        ad: k.ad,
        mevcut: Number(k.mevcutMiktar),
        envanterDegeri: k.mevcutMiktar.mul(k.ortalamaMaliyet).toFixed(2),
        sonHareket:
          sonTarih.get(k.id)?.toISOString().slice(0, 10) ?? null,
      }));
  },
});

// ─── Eksi stok (STK-17) ─────────────────────────────────────────────────────

registerRapor({
  kod: "stok.eksi-stok",
  modul: "stok",
  ad: "Eksi Stok",
  aciklama: "Mevcut miktarı eksiye düşmüş ürünler (eksi stok politikası takibi)",
  filtreler: [],
  kolonlar: [
    { alan: "kod", baslik: "Kod", tip: "metin" },
    { alan: "ad", baslik: "Ürün", tip: "metin" },
    { alan: "birim", baslik: "Birim", tip: "metin" },
    { alan: "mevcut", baslik: "Mevcut", tip: "sayi" },
    { alan: "sonHareket", baslik: "Son Hareket", tip: "tarih" },
  ],
  async calistir(_girdi, { tx }) {
    const kartlar = await tx.stokKart.findMany({
      where: { mevcutMiktar: { lt: 0 } },
      orderBy: { kod: "asc" },
    });
    if (kartlar.length === 0) return [];
    const sonHareketler = await tx.stokHareket.groupBy({
      by: ["stokId"],
      where: { stokId: { in: kartlar.map((k) => k.id) } },
      _max: { tarih: true },
    });
    const sonTarih = new Map(
      sonHareketler.map((h) => [h.stokId, h._max.tarih]),
    );
    return kartlar.map((k) => ({
      kod: k.kod,
      ad: k.ad,
      birim: k.anaBirim,
      mevcut: Number(k.mevcutMiktar),
      sonHareket: sonTarih.get(k.id)?.toISOString().slice(0, 10) ?? null,
    }));
  },
});
