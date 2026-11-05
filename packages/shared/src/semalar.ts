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
  vkn: vknTcknSemasi,
  vergiDairesi: z.string().min(2).max(120).optional(),
  yoneticiEposta: z.email(),
  yoneticiAdSoyad: z.string().min(2).max(120),
  paketSurumId: z.uuid().optional(),
});
export type TenantKayitGirdisi = z.infer<typeof tenantKayitSemasi>;
