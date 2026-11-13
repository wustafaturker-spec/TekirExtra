import { Prisma } from "@prisma/client";
import { ETICARET_SAGLAYICILARI } from "@tekirextra/shared";
import { gonderenCariSec, tedarikciCariBulVeyaOlustur } from "../cari/tedarikci-cari";

/**
 * ETC-05: e-ticaret sitesi siparişinin alıcı carisi.
 * - VKN'li (10 hane) alıcı: VKN'siyle müşteri carisi bulunur; yoksa fatura adresiyle açılır.
 * - Bireysel alıcı (VKN yok ya da TCKN): bağlantının varsayılan carisi; asıl alıcı faturada nihai
 *   tüketici olarak tutulur. Varsayılan cari seçilmemişse cari boş kalır, siparişte elle seçilir.
 * Pazaryerlerinde davranış değişmez (cari elle seçilir).
 */
export const eticaretMi = (saglayici: string) => (ETICARET_SAGLAYICILARI as readonly string[]).includes(saglayici);

interface FaturaAdresi { ad?: string; firma?: string; adres?: string; il?: string; ilce?: string; postaKodu?: string; ulke?: string; vergiDairesi?: string }
interface SiparisAlicisi { musteriUnvani: string; musteriEposta?: string | null; vknTckn?: string | null; teslimatAdresi?: unknown }

export function faturaAdresi(teslimat: unknown): FaturaAdresi {
  const f = (teslimat as { fatura?: FaturaAdresi } | null | undefined)?.fatura;
  return f && typeof f === "object" ? f : {};
}

export const kurumsalMi = (vknTckn?: string | null) => /^\d{10}$/.test(vknTckn?.trim() ?? "");

export async function eticaretCarisi(tx: Prisma.TransactionClient, tenantId: string, baglanti: { saglayici: string; varsayilanAliciCariId: string | null }, s: SiparisAlicisi): Promise<string | null> {
  if (!eticaretMi(baglanti.saglayici)) return null;
  if (!kurumsalMi(s.vknTckn)) return baglanti.varsayilanAliciCariId;
  const vkn = s.vknTckn!.trim();
  const { cari } = await gonderenCariSec(tx, tenantId, vkn, "musteri");
  if (cari) return cari.id;
  const fa = faturaAdresi(s.teslimatAdresi);
  const id = await tedarikciCariBulVeyaOlustur(tx, tenantId, vkn, (fa.firma || s.musteriUnvani).slice(0, 200), "musteri");
  await tx.cariHesap.update({ where: { id }, data: { ...(fa.vergiDairesi ? { vergiDairesi: fa.vergiDairesi.slice(0, 100) } : {}), ...(s.musteriEposta ? { eposta: s.musteriEposta.slice(0, 200) } : {}) } });
  if (fa.adres?.trim()) {
    await tx.cariAdres.create({ data: { tenantId, cariId: id, tip: "fatura", baslik: "Fatura adresi", adres: fa.adres.slice(0, 500), il: fa.il || null, ilce: fa.ilce || null, postaKodu: fa.postaKodu || null, ulke: (fa.ulke || "TR").slice(0, 2).toUpperCase() } });
  }
  return id;
}

/** Faturaya yazılacak nihai tüketici (yalnız bireysel alıcı varsayılan cariye kesildiğinde). */
export function nihaiAlici(s: SiparisAlicisi) {
  const fa = faturaAdresi(s.teslimatAdresi);
  const tckn = /^\d{11}$/.test(s.vknTckn?.trim() ?? "") ? s.vknTckn!.trim() : null;
  return {
    nihaiAliciAdSoyad: (fa.ad?.trim() || s.musteriUnvani).slice(0, 200),
    nihaiAliciTckn: tckn,
    nihaiAliciAdres: fa.adres?.trim().slice(0, 500) || null,
    nihaiAliciIl: fa.il?.trim() || null,
    nihaiAliciIlce: fa.ilce?.trim() || null,
    nihaiAliciPostaKodu: fa.postaKodu?.trim() || null,
    nihaiAliciEposta: s.musteriEposta?.trim() || null,
  };
}

/** e-Arşiv internet satışı alanı için mağaza adresi. */
export function magazaWebAdresi(saglayici: string, config: { servisAdresi?: string; kullaniciAdi?: string }): string | null {
  const ad = (config.kullaniciAdi ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (saglayici === "shopify" && ad) return `https://${ad.replace(/\.myshopify\.com$/, "")}.myshopify.com`;
  if (saglayici === "ikas" && ad) return `https://${ad.replace(/\.myikas\.com$/, "")}.myikas.com`;
  return config.servisAdresi?.trim().replace(/\/+$/, "") || null;
}
