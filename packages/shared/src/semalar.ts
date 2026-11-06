import { z } from "zod";

/**
 * SEC-10: zod 4 nesne şeması oluşturulurken `Function("")` ile eval desteğini
 * yoklar; tarayıcıda bu, web'in CSP'sinde ('unsafe-eval' yok) ihlal üretir.
 * Tarayıcıda derlemesiz kip kullanılır (sonuç aynı); sunucu hızlı yolu korur.
 * Şemalardan önce çalışmalıdır.
 */
if (typeof (globalThis as { document?: unknown }).document !== "undefined") z.config({ jitless: true });

/** VKN (10 hane) veya TCKN (11 hane). */
export const vknTcknSemasi = z
  .string()
  .regex(/^\d{10,11}$/, "VKN 10, TCKN 11 haneli rakam olmalıdır");

/** Firma kaydı (onboarding) girdisi — KLN-07. */
export const tenantKayitSemasi = z.object({
  unvan: z.string().min(2).max(255),
  kisiTuru: z.enum(["gercek", "tuzel"]).default("tuzel"),
  vkn: z.string().regex(/^\d{10,11}$/, "Vergi numarası 10 veya 11 haneli olmalıdır"),
  vergiDairesi: z.string().min(2).max(120),
  vergiDairesiKodu: z.string().trim().min(1).max(10),
  adres: z.string().trim().max(300).optional(),
  postaKodu: z.string().trim().regex(/^\d{5}$/, "Posta kodu 5 haneli olmalıdır").optional(),
  ilce: z.string().trim().min(2).max(80),
  il: z.string().trim().min(2).max(80),
  telefon: z.string().trim().max(30).optional(),
  firmaEposta: z.union([z.email(), z.literal("")]).optional(),
  webSitesi: z.string().trim().url("Geçerli bir web adresi girin").max(200).optional(),
  yoneticiEposta: z.email().transform((deger) => deger.trim().toLowerCase()),
  yoneticiAdSoyad: z.string().min(2).max(120),
  paketSurumId: z.uuid().optional(),
}).superRefine((g, ctx) => {
  if (g.kisiTuru === "gercek" && g.vkn.length !== 11) ctx.addIssue({ code: "custom", path: ["vkn"], message: "Gerçek kişi için 11 haneli TCKN girin" });
  if (g.kisiTuru === "tuzel" && g.vkn.length !== 10) ctx.addIssue({ code: "custom", path: ["vkn"], message: "Tüzel kişi için 10 haneli VKN girin" });
});
export type TenantKayitGirdisi = z.infer<typeof tenantKayitSemasi>;
