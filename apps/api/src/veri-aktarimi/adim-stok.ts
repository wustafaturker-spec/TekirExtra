import { Prisma } from "@prisma/client";
import { birimCoz } from "@tekirextra/shared";
import { sayiCoz } from "../cari/cari-ice-aktarma";
import type { SatirSonucu } from "./adim";
import type { SutunTanimi, TabloSatiri } from "./tablo";

type Tx = Prisma.TransactionClient;

/** VAK-01/03: stok kartı sütunları; kaynak programların başlıkları eşanlamlıdır. */
export const STOK_SUTUNLARI = [
  { anahtar: "kod", baslik: "Stok kodu", aciklama: "Zorunlu. Mevcut kod güncellenir, yoksa yeni kart açılır", ornek: "URN-001", esanlamlilar: ["kod", "stok kod", "malzeme kodu", "urun kodu", "mal kodu", "stok no"] },
  { anahtar: "ad", baslik: "Stok adı", aciklama: "Yeni kartta zorunlu", ornek: "Örnek ürün", esanlamlilar: ["ad", "stok ismi", "stok adi", "malzeme adi", "malzeme aciklamasi", "urun adi", "mal adi", "urun ismi"] },
  { anahtar: "tip", baslik: "Tip", aciklama: "Ürün ya da Hizmet (boşsa yeni kartta Ürün)", ornek: "Ürün", esanlamlilar: ["stok tipi", "kart tipi", "urun tipi"] },
  { anahtar: "barkod", baslik: "Barkod", aciklama: "", ornek: "8690000000001", esanlamlilar: ["barkod 1", "barkod no", "ean"] },
  { anahtar: "birim", baslik: "Birim", aciklama: "adet, kg, litre, metre, paket, kutu… (boşsa yeni kartta adet). Hareketi olan kartın birimi değişmez", ornek: "adet", esanlamlilar: ["ana birim", "olcu birimi", "birim 1", "birim 1 adi", "birim adi", "birim seti"] },
  { anahtar: "kdvOrani", baslik: "KDV oranı", aciklama: "Yürürlükteki oranlardan biri (boşsa yeni kartta 20)", ornek: "20", esanlamlilar: ["kdv", "kdv %", "kdv orani %", "vergi orani", "perakende vergi"] },
  { anahtar: "alisFiyati", baslik: "Alış fiyatı", aciklama: "KDV hariç, TL", ornek: "", esanlamlilar: ["alis fiyati 1", "son alis fiyati", "alis fiyati tl"] },
  { anahtar: "satisFiyati", baslik: "Satış fiyatı", aciklama: "KDV hariç, TL", ornek: "", esanlamlilar: ["satis fiyati 1", "liste fiyati", "satis fiyati tl", "fiyat"] },
] as const satisfies readonly SutunTanimi[];

export type StokAnahtari = (typeof STOK_SUTUNLARI)[number]["anahtar"];

export interface StokPlani extends SatirSonucu {
  eslesenId: string | null;
  veri: { kod: string; ad?: string; tip?: "urun" | "hizmet"; barkod?: string; anaBirim?: string; kdvOrani?: number; alisFiyati?: number; satisFiyati?: number };
}

/** KDV oranının yürürlükte olup olmadığı (Mevzuat Merkezi); kontrol yoksa her oran geçer. */
export type KdvDenetimi = (oran: number) => Promise<string | null>;

export async function stokPlanla(tx: Tx, satirlar: TabloSatiri<StokAnahtari>[], kdvDenetle: KdvDenetimi): Promise<StokPlani[]> {
  const kodlar = [...new Set(satirlar.map((s) => s.hucreler.kod).filter((k): k is string => Boolean(k)))];
  const mevcutlar = kodlar.length
    ? await tx.stokKart.findMany({
        where: { kod: { in: kodlar } },
        select: { id: true, kod: true, ad: true, tip: true, barkod: true, anaBirim: true, kdvOrani: true, alisFiyati: true, satisFiyati: true, _count: { select: { hareketler: true } } },
      })
    : [];
  const kodla = new Map(mevcutlar.map((m) => [m.kod, m]));
  const gorulen = new Map<string, number>();
  const plan: StokPlani[] = [];
  for (const ham of satirlar) {
    const h = ham.hucreler;
    const hatalar: string[] = [];
    const uyarilar: string[] = [];
    const kod = h.kod?.trim() ?? "";
    if (!kod) hatalar.push("Stok kodu zorunludur");
    else if (kod.length > 60) hatalar.push("Stok kodu en fazla 60 karakter olabilir");
    if (kod && gorulen.has(kod)) hatalar.push(`Aynı kod dosyada ${gorulen.get(kod)}. satırda da var`);
    else if (kod) gorulen.set(kod, ham.satir);
    const eslesen = kod ? kodla.get(kod) : undefined;
    const veri: StokPlani["veri"] = { kod };
    if (h.ad) { if (h.ad.length > 200) hatalar.push("Stok adı en fazla 200 karakter olabilir"); else veri.ad = h.ad; }
    else if (!eslesen) hatalar.push("Yeni kartta stok adı zorunludur");
    if (h.tip) {
      const t = h.tip.toLocaleLowerCase("tr-TR");
      if (t.startsWith("hizmet")) veri.tip = "hizmet";
      else if (t.startsWith("ürün") || t.startsWith("urun") || t.startsWith("mal") || t.startsWith("stok")) veri.tip = "urun";
      else hatalar.push(`Tip "${h.tip}" tanınmadı (Ürün ya da Hizmet)`);
    } else if (!eslesen) veri.tip = "urun";
    if (eslesen && veri.tip && veri.tip !== eslesen.tip && eslesen._count.hareketler > 0) hatalar.push("Hareketi olan kartın tipi değiştirilemez");
    if (h.barkod) { if (h.barkod.length > 64) hatalar.push("Barkod en fazla 64 karakter olabilir"); else veri.barkod = h.barkod; }
    if (h.birim) {
      const b = birimCoz(h.birim);
      if (!b) hatalar.push(`Birim "${h.birim}" tanınmadı; şablonun Açıklama sayfasındaki birimlerden birini yazın`);
      else if (eslesen && b !== eslesen.anaBirim && eslesen._count.hareketler > 0) hatalar.push("Hareketi olan kartın birimi değiştirilemez");
      else veri.anaBirim = b;
    } else if (!eslesen) veri.anaBirim = "adet";
    if (h.kdvOrani) {
      const k = sayiCoz(h.kdvOrani.replace("%", ""), "KDV oranı", 0, 100);
      if ("hata" in k) hatalar.push(k.hata);
      else { const kdvHatasi = await kdvDenetle(k.deger); if (kdvHatasi) hatalar.push(kdvHatasi); else veri.kdvOrani = k.deger; }
    } else if (!eslesen) veri.kdvOrani = 20;
    for (const [alan, baslik] of [["alisFiyati", "Alış fiyatı"], ["satisFiyati", "Satış fiyatı"]] as const) {
      if (!h[alan]) continue;
      const f = sayiCoz(h[alan]!, baslik, 0);
      if ("hata" in f) hatalar.push(f.hata); else veri[alan] = f.deger;
    }
    // Eşleşen kartta yalnız farklı değerler yazılır.
    const degisen: string[] = [];
    if (eslesen) {
      const once: Record<string, unknown> = { ad: eslesen.ad, tip: eslesen.tip, barkod: eslesen.barkod, anaBirim: eslesen.anaBirim, kdvOrani: Number(eslesen.kdvOrani), alisFiyati: eslesen.alisFiyati === null ? null : Number(eslesen.alisFiyati), satisFiyati: eslesen.satisFiyati === null ? null : Number(eslesen.satisFiyati) };
      for (const alan of ["ad", "tip", "barkod", "anaBirim", "kdvOrani", "alisFiyati", "satisFiyati"] as const) {
        if (veri[alan] === undefined) continue;
        if (once[alan] === veri[alan]) delete veri[alan];
        else degisen.push(STOK_SUTUNLARI.find((s) => s.anahtar === (alan === "anaBirim" ? "birim" : alan))!.baslik);
      }
      if (degisen.length) uyarilar.push(`Değişecek: ${degisen.join(", ")} (güncelleme geri alınamaz)`);
    }
    plan.push({
      satir: ham.satir,
      durum: hatalar.length ? "hatali" : !eslesen ? "yeni" : degisen.length ? "guncelle" : "degisiklik_yok",
      etiket: kod,
      aciklama: veri.ad ?? eslesen?.ad ?? "",
      hatalar, uyarilar, eslesenId: eslesen?.id ?? null, veri,
    });
  }
  return plan;
}

/** Hatasız satırları yazar; yeni açılan kartların kimlikleri döner. */
export async function stokYaz(tx: Tx, tenantId: string, plan: StokPlani[]): Promise<string[]> {
  const yeniler: string[] = [];
  for (const p of plan) {
    if (p.durum === "yeni") {
      const k = await tx.stokKart.create({
        select: { id: true },
        data: {
          tenantId, kod: p.veri.kod, ad: p.veri.ad!, tip: p.veri.tip ?? "urun", barkod: p.veri.barkod ?? null, anaBirim: p.veri.anaBirim ?? "adet",
          kdvOrani: p.veri.kdvOrani ?? 20, alisFiyati: p.veri.alisFiyati ?? null, satisFiyati: p.veri.satisFiyati ?? null, mevcutMiktar: 0, ortalamaMaliyet: 0,
        },
      });
      yeniler.push(k.id);
    } else if (p.durum === "guncelle" && p.eslesenId) {
      const { kod: _kod, ...degisen } = p.veri;
      await tx.stokKart.update({ where: { id: p.eslesenId }, data: degisen });
    }
  }
  return yeniler;
}
