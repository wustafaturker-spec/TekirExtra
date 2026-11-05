import { z } from "zod";
import { YETKI_MODULLERI, yolModulu } from "./yetki-modulleri";
import { ayBasiTR } from "./tarih";

/** Ayarlar/abonelik hesap yönetimi paket seçimiyle kapatılamaz. */
export const PAKET_MODUL_KODLARI = ["satis", "fatura", "ebelge", "cari", "kasa_banka", "masraf_gelir", "satin_alma", "stok", "uretim", "personel", "demirbas_arac", "projeler", "butce_nakit", "raporlar", "mali_musavir", "donem_kapatma", "yapay_zeka"] as const;
export type PaketModulKodu = (typeof PAKET_MODUL_KODLARI)[number];
export const PAKET_MODUL_ADLARI = Object.fromEntries(PAKET_MODUL_KODLARI.map((kod) => [kod, YETKI_MODULLERI.find((m) => m.kod === kod)!.ad])) as Record<PaketModulKodu, string>;
export const PAKET_MODUL_BAGIMLILIKLARI: Partial<Record<PaketModulKodu, readonly PaketModulKodu[]>> = {
  fatura: ["cari"], ebelge: ["fatura"], uretim: ["stok"],
};

export const PAKET_KOTA_KODLARI = ["kullanici", "cari", "stok", "aylikFatura"] as const;
export type PaketKotaKodu = (typeof PAKET_KOTA_KODLARI)[number];
/** Ölçüm kaynağı sabittir; yönetici JSON içinden birim/dönem veya ücret uyduramaz. */
export const PAKET_KOTA_TANIMLARI: Record<PaketKotaKodu, { ad: string; birim: string; donem: "anlik" | "takvim_ayi"; aciklama: string }> = {
  kullanici: { ad: "Aktif kullanıcı", birim: "hesap", donem: "anlik", aciklama: "Aktif ve çalışan self-servis rolü dışında kalan kullanıcı hesapları." },
  cari: { ad: "Aktif cari", birim: "kart", donem: "anlik", aciklama: "Aktif cari kartları; pasife alınan kart sayımdan çıkar." },
  stok: { ad: "Aktif stok kartı", birim: "kart", donem: "anlik", aciklama: "Aktif stok kartları; varyant veya stok miktarı değildir." },
  aylikFatura: { ad: "Aylık oluşturulan fatura", birim: "fatura", donem: "takvim_ayi", aciklama: "Oluşturulma zamanına göre Türkiye takvim ayındaki tüm faturalar; taslak ve iptaller dahil. Belge tarihi esas alınmaz." },
};
const kotaSemasi = z.object({ sinir: z.number().int().min(0).max(2147483647).nullable(), uyariYuzdesi: z.number().int().min(1).max(99) }).strict();
export const paketKapsamSemasi = z.object({
  semaSurumu: z.literal(1),
  moduller: z.array(z.enum(PAKET_MODUL_KODLARI)).min(1).max(PAKET_MODUL_KODLARI.length),
  kotalar: z.object({ kullanici: kotaSemasi, cari: kotaSemasi, stok: kotaSemasi, aylikFatura: kotaSemasi }).strict(),
  depolama: z.object({
    sinirBayt: z.string().regex(/^(0|[1-9]\d{0,18})$/).refine((v) => /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= BigInt("9223372036854775807"), "Depolama sınırı geçersiz.").nullable(),
    uyariYuzdesi: z.number().int().min(1).max(99),
  }).strict().optional(),
}).strict().superRefine((g, ctx) => {
  const secili = new Set(g.moduller);
  if (secili.size !== g.moduller.length) ctx.addIssue({ code: "custom", path: ["moduller"], message: "Modüller tekrar edemez." });
  for (const kod of g.moduller) for (const gerekli of PAKET_MODUL_BAGIMLILIKLARI[kod] ?? []) {
    if (!secili.has(gerekli)) ctx.addIssue({ code: "custom", path: ["moduller"], message: `${PAKET_MODUL_ADLARI[kod]} için ${PAKET_MODUL_ADLARI[gerekli]} seçilmeli.` });
  }
});
export type PaketKapsamSozlesmesi = z.infer<typeof paketKapsamSemasi>;

/** Null eski koşuldur; tanımlı kapsam yalnız daraltır. Hesap ayarları ve ortak uçlar korunur. */
export function paketApiYoluKapali(moduller: readonly string[] | null | undefined, yol: string): boolean {
  if (moduller == null) return false;
  const temiz = yol.replace(/^\/+/, "").replace(/^api\/v\d+\//, "").split("?")[0];
  // Satışa bağlı AI alt uçları iki modülü de gerektirir; en uzun yol eşleşmesi AI sınırını kaldırmaz.
  if (temiz.split("/").some((parca) => /^ai(?:-|$)/.test(parca)) && !moduller.includes("yapay_zeka")) return true;
  if (temiz === "self-servis" || temiz.startsWith("self-servis/")) return !moduller.includes("personel");
  const m = yolModulu(yol);
  return !!m && m.kod !== "ayarlar" && !moduller.includes(m.kod);
}
export function paketPanelYoluKapali(moduller: readonly string[] | null | undefined, href: string): boolean {
  if (moduller == null) return false;
  const yol = href.split("?")[0];
  if (yol === "/panel/b2b" || yol.startsWith("/panel/b2b/")) return !moduller.includes("satis");
  if (yol === "/panel/self-servis" || yol.startsWith("/panel/self-servis/")) return !moduller.includes("personel");
  let enUzun: { kod: string; uzunluk: number } | null = null;
  for (const m of YETKI_MODULLERI) for (const p of m.panel) {
    if ((yol === p || yol.startsWith(`${p}/`)) && (!enUzun || p.length > enUzun.uzunluk)) enUzun = { kod: m.kod, uzunluk: p.length };
  }
  return !!enUzun && enUzun.kod !== "ayarlar" && !moduller.includes(enUzun.kod);
}

/** Null sınırsızdır; 0 yeni kayıt hakkı olmadığı anlamına gelir. */
export function paketKotaDurumu(kullanim: number, sinir: number | null, uyariYuzdesi = 80) {
  if (!Number.isSafeInteger(kullanim) || kullanim < 0) throw new Error("Kullanım negatif olmayan güvenli bir tam sayı olmalı.");
  kotaSemasi.parse({ sinir, uyariYuzdesi });
  if (sinir === null) return { durum: "sinirsiz" as const, kalan: null, yuzde: null };
  const durum = kullanim > sinir ? "asim" : kullanim === sinir ? "dolu" : kullanim * 100 >= sinir * uyariYuzdesi ? "uyari" : "normal";
  return { durum, kalan: Math.max(0, sinir - kullanim), yuzde: sinir === 0 ? 100 : Math.min(100, kullanim / sinir * 100) };
}

/** [başlangıç, bitiş) aralığı; sunucunun işletim sistemi saat diliminden bağımsızdır. */
export function paketKotaAyi(an = new Date()) {
  const ilk = ayBasiTR(an), [yil, ay] = ilk.split("-").map(Number);
  const sonraki = `${String(ay === 12 ? yil + 1 : yil).padStart(4, "0")}-${String(ay === 12 ? 1 : ay + 1).padStart(2, "0")}-01`;
  return { baslangic: new Date(`${ilk}T00:00:00+03:00`), bitis: new Date(`${sonraki}T00:00:00+03:00`) };
}
