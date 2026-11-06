import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { ROLLER } from "@tekirextra/shared";

// Başlık ve bağlantı etiketleri düz metindir; duyuru içeriği sınırlı Markdown kullanır.
const metin = (min: number, max: number) => z.string().trim().min(min).max(max)
  .refine((v) => !/[<>\u0000]/u.test(v), "HTML ve kontrol karakterleri kullanılamaz.");
export function duyuruIceriginiHtmlYap(v: string) {
  const kacir = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const satirlar = v.split(/\r?\n/u), cikti: string[] = [];
  const satirIcerigi = (s: string) => kacir(s)
    .replace(/!\[([^\]]{0,200})\]\((\/api\/v1\/duyurular\/gorseller\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/giu, (_m, alt: string, src: string) => `<img src="${src}" alt="${alt}" />`)
    .replace(/\*\*(.+?)\*\*/gu, "<strong>$1</strong>").replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, "<em>$1</em>");
  for (let i = 0; i < satirlar.length;) {
    if (!satirlar[i].trim()) { i++; continue; }
    const tur = /^\s*[-*]\s+/u.test(satirlar[i]) ? "ul" : /^\s*\d+[.)]\s+/u.test(satirlar[i]) ? "ol" : null;
    if (tur) {
      const maddeler: string[] = [];
      while (i < satirlar.length && (tur === "ul" ? /^\s*[-*]\s+/u.test(satirlar[i]) : /^\s*\d+[.)]\s+/u.test(satirlar[i]))) {
        maddeler.push(`<li>${satirIcerigi(satirlar[i].replace(/^\s*(?:[-*]|\d+[.)])\s+/u, ""))}</li>`); i++;
      }
      cikti.push(`<${tur}>${maddeler.join("")}</${tur}>`);
    } else {
      const paragraf: string[] = [];
      while (i < satirlar.length && satirlar[i].trim() && !/^\s*(?:[-*]|\d+[.)])\s+/u.test(satirlar[i])) paragraf.push(satirIcerigi(satirlar[i++]));
      cikti.push(`<p>${paragraf.join("<br>")}</p>`);
    }
  }
  return cikti.join("");
}
export const duyuruIcerigiHtmlTemizle = (v: string) => sanitizeHtml(duyuruIceriginiHtmlYap(v), {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "img"],
  allowedAttributes: { img: ["src", "alt"] }, allowedSchemes: ["https"], allowProtocolRelative: false,
});
const duyuruIcerikMetni = z.string().trim().min(1).max(20000)
  .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v), "Kontrol karakterleri kullanılamaz.")
  .refine((v) => !/[<>]/u.test(v), "HTML etiketleri yerine biçimlendirme araçlarını kullanın.")
  .refine((v) => duyuruIcerigiHtmlTemizle(v).replace(/<[^>]*>/gu, "").trim().length > 0 || [...v.matchAll(/!\[[^\]]*\]\((\/api\/v1\/duyurular\/gorseller\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/giu)].length > 0, "İçerik boş olamaz.");
export const duyuruIcerikSemasi = z.object({
  baslik: metin(3, 200), icerik: duyuruIcerikMetni,
  butonMetni: metin(1, 80).nullable(),
  butonUrl: z.string().max(2000).nullable().refine((v) => {
    if (v === null) return true;
    if (/[\s\\\u0000-\u001f\u007f]/u.test(v)) return false;
    if (/^\/panel(?:\/|\?|$)/u.test(v)) {
      const u = new URL(v, "https://tekir.invalid");
      return u.pathname === "/panel" || u.pathname.startsWith("/panel/");
    }
    try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; }
    catch { return false; }
  }, "Bağlantı HTTPS adresi veya /panel yolu olmalı."),
}).strict().refine((g) => (g.butonMetni === null) === (g.butonUrl === null), { message: "Buton metni ve bağlantısını birlikte girin." });
export const duyuruGuncelleSemasi = duyuruIcerikSemasi.safeExtend({ surum: z.number().int().min(1) });
export const duyuruArsivSemasi = z.object({ surum: z.number().int().min(1) }).strict();
export const duyuruListeSemasi = z.object({ sayfa: z.coerce.number().int().min(1).max(100000).default(1), durum: z.enum(["taslak", "arsiv", "yayinlandi", "durduruldu"]).optional() }).strict();
const kimlikler = z.array(z.uuid()).max(200).refine((v) => new Set(v).size === v.length, "Tekrarlanan seçim var.");
export const duyuruHedefSemasi = z.object({
  kapsam: z.enum(["tum", "secili"]),
  firmaIds: kimlikler,
  haricFirmaIds: kimlikler,
  paketIds: kimlikler,
  durumlar: z.array(z.enum(["deneme", "aktif", "askida", "iptal"])).max(4),
  roller: z.array(z.enum(ROLLER)).min(1).max(ROLLER.length),
  yeniUygunlar: z.literal("katilmaz"),
  gosterimYerleri: z.array(z.enum(["merkez", "ust_bant", "popup", "modul_karti"])).min(1).max(4),
  modulYollari: z.array(z.enum(["genel", "finans", "satis", "satin_alma", "stok", "uretim", "raporlar", "ayarlar", "ebelge", "cari", "personel", "crm"])).max(12).refine((v) => new Set(v).size === v.length, "Tekrarlanan modül seçimi var."),
  tekrarPolitikasi: z.enum(["her_zaman", "bir_kez", "gunde_bir", "haftada_bir"]),
  popupOnceligi: z.number().int().min(1).max(100),
  popupTuru: z.enum(["normal", "kritik"]),
  ertelemeDakika: z.union([z.literal(60), z.literal(1440), z.literal(10080)]),
}).strict().refine((g) => g.kapsam === "secili" ? g.firmaIds.length > 0 : g.firmaIds.length === 0, { message: "Seçili kapsamda firma seçin; tüm firmalarda dahil listesi boş olmalı." })
  .refine((g) => !g.firmaIds.some((id) => g.haricFirmaIds.includes(id)), { message: "Aynı firma hem dahil hem hariç olamaz." })
  .refine((g) => g.gosterimYerleri.includes("modul_karti") ? g.modulYollari.length > 0 : g.modulYollari.length === 0, { message: "Modül kartı için en az bir modül seçin; modül kartı kapalıyken seçim boş olmalı." });
export const duyuruYayinOnizlemeSemasi = z.object({
  surum: z.number().int().min(1), hedef: duyuruHedefSemasi,
  baslangic: z.iso.datetime({ offset: true }).nullable(),
  bitis: z.iso.datetime({ offset: true }),
}).strict().refine((g) => g.baslangic === null || new Date(g.bitis) > new Date(g.baslangic), { message: "Bitiş, başlangıçtan sonra olmalı." });
export const duyuruYayinOnaySemasi = z.object({ onizlemeId: z.uuid() }).strict();
export const tenantDuyuruListeSemasi = z.object({ sayfa: duyuruListeSemasi.shape.sayfa, gecmis: z.enum(["true", "false"]).default("false") }).strict();
export const duyuruOlaySemasi = z.object({ tur: z.enum(["gosterim", "okudum", "tiklama"]) }).strict();
export const duyuruTercihSemasi = z.object({ tur: z.enum(["ertele", "kapat"]) }).strict();
export type DuyuruHedefi = z.infer<typeof duyuruHedefSemasi>;
export type DuyuruYayinGirdisi = z.infer<typeof duyuruYayinOnizlemeSemasi>;
export type DuyuruIcerigi = z.infer<typeof duyuruIcerikSemasi>;
