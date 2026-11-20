import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { arac, cagir, uuid, type AracBaglami } from "./arac";
import type { UcTanimi } from "../uc-cagirici";
import { UC } from "./uclar";

/**
 * AI-118: dosya araçları ekranın kendi dışa aktarım ucunu çağırır; rol, paket, özel rol ve
 * denetim kaydı ekranla aynıdır, yeni dosya biçimi yazılmaz. Uç yanıtı `res.send` ile
 * yazdığı için çağrıya yanıtı yakalayan bir nesne verilir. Dosya içeriği modele gitmez:
 * araç sonucunun `_dosya` alanı yürütücüde ayrılır, model yalnız adı ve boyutu görür.
 */

export interface YakalananDosya { tampon: Buffer; mimeType: string; dosyaAdi: string | null }

/** `res.setHeader`/`res.send` kullanan ucun yazdığı gövdeyi ve başlıkları toplar. */
export function yanitYakalayici() {
  const basliklar = new Map<string, string>();
  let govde: Buffer | null = null;
  const res = {
    setHeader(ad: string, deger: unknown) { basliklar.set(ad.toLowerCase(), String(deger)); return res; },
    status() { return res; },
    send(veri: unknown) { govde = Buffer.isBuffer(veri) ? veri : Buffer.from(veri instanceof Uint8Array ? veri : String(veri)); return res; },
    end(veri?: unknown) { if (veri !== undefined) res.send(veri); return res; },
  };
  return {
    res,
    sonuc(): YakalananDosya {
      if (!govde?.length) throw new BadRequestException("Dosya üretilemedi.");
      return { tampon: govde, mimeType: basliklar.get("content-type") ?? "application/octet-stream", dosyaAdi: dosyaAdiCoz(basliklar.get("content-disposition")) };
    },
  };
}

/** `attachment; filename="..."` ya da `filename=...` (yüzde kodlu olabilir). */
export function dosyaAdiCoz(baslik: string | undefined): string | null {
  const eslesme = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(baslik ?? "");
  if (!eslesme) return null;
  try { return decodeURIComponent(eslesme[1]!); } catch { return eslesme[1]!; }
}

/** Ekranın dosya ucunu yanıt yakalayıcıyla çağırır; argümanların sonuna `res` eklenir. */
export async function dosyaUcunuCagir(b: AracBaglami, uc: UcTanimi, argumanlar: unknown[], varlikId?: string | null): Promise<YakalananDosya> {
  const y = yanitYakalayici();
  await cagir(b, uc, [...argumanlar, y.res], varlikId);
  return y.sonuc();
}

const MIME = { excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" } as const;

/** Dosya adını güvenli ve okunur yapar (Türkçe harfler korunur). */
export function guvenliDosyaAdi(ad: string, uzanti: "xlsx" | "pdf"): string {
  const govde = (ad.split(/[\\/]/).pop() ?? "").replace(/\.(xlsx|pdf)$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || "dosya";
  return `${govde}.${uzanti}`;
}

const sonucMetni = (dosyaAdi: string, tampon: Buffer) => ({
  basarili: true,
  dosyaAdi,
  boyutKb: Math.max(1, Math.round(tampon.length / 1024)),
  mesaj: `${dosyaAdi} hazırlandı ve sohbete dosya olarak eklendi. Dosya içeriğini yanıtta tekrar etme.`,
});

export const DOSYA_ARACLARI = [
  arac({
    ad: "rapor_dosyasi",
    aciklama:
      "Rapor kataloğundaki bir raporu süzgeçlerle Excel ya da PDF dosyası olarak hazırlar ve sohbete ekler (rapor ekranındaki dışa aktarımla aynı dosya). Kullanıcı raporu, listeyi ya da dökümü dosya, Excel, PDF olarak istediğinde kullan; önce rapor_katalogu ile kodu ve süzgeç alanlarını bul.",
    sinif: "okuma",
    girdi: z.object({
      kod: z.string().min(1).describe("rapor_katalogu'ndaki rapor kodu"),
      format: z.enum(["excel", "pdf"]).default("excel").describe("Dosya biçimi"),
      suzgecler: z
        .array(z.object({ alan: z.string().describe("katalogdaki suzgecler[].alan (ör. baslangic, bitis)"), deger: z.string() }))
        .optional()
        .describe("Süzgeç değerleri"),
      gruplama: z.string().optional(),
    }),
    uc: UC.raporExcel,
    async calistir(b, g) {
      const filtreler = Object.fromEntries((g.suzgecler ?? []).map((x) => [x.alan, x.deger === "true" ? true : x.deger === "false" ? false : x.deger]));
      const govde = { filtreler, ...(g.gruplama ? { gruplama: g.gruplama } : {}) };
      const d = await dosyaUcunuCagir(b, g.format === "pdf" ? UC.raporPdf : UC.raporExcel, [g.kod, govde], g.kod);
      const uzanti = g.format === "pdf" ? "pdf" : "xlsx";
      const dosyaAdi = guvenliDosyaAdi(d.dosyaAdi ?? `rapor-${g.kod}`, uzanti);
      return { _dosya: { tampon: d.tampon, dosyaAdi, mimeType: MIME[g.format] }, ...sonucMetni(dosyaAdi, d.tampon) };
    },
  }),
  arac({
    ad: "belge_pdf",
    aciklama:
      "Bir faturanın ya da teklif/sipariş/irsaliye belgesinin PDF'ini (yazdırma görünümü) hazırlar ve sohbete ekler. Kimliği bilmiyorsan önce fatura_ara ya da belge_ara ile bul. Kullanıcı faturayı/teklifi PDF olarak, yazdırmak ya da indirmek için istediğinde kullan.",
    sinif: "okuma",
    girdi: z.object({
      tur: z.enum(["fatura", "belge"]).describe("fatura: satış/alış faturası; belge: teklif, sipariş, irsaliye"),
      id: uuid("Fatura ya da belge kimliği (UUID)"),
      kopya: z.boolean().optional().describe("Belgeye KOPYA damgası basılsın mı"),
    }),
    uc: UC.faturaPdf,
    async calistir(b, g) {
      const uc = g.tur === "fatura" ? UC.faturaPdf : UC.belgePdf;
      const d = await dosyaUcunuCagir(b, uc, [g.id, g.kopya ? "1" : undefined], g.id);
      const dosyaAdi = guvenliDosyaAdi(d.dosyaAdi ?? `${g.tur}-${g.id.slice(0, 8)}`, "pdf");
      return { _dosya: { tampon: d.tampon, dosyaAdi, mimeType: MIME.pdf }, ...sonucMetni(dosyaAdi, d.tampon) };
    },
  }),
];
