import { z } from "zod";
import { registerModulAyar } from "./core/ayarlar/ayar-kayit";

/**
 * Modül ayar tanımları (AYR-01/03). Her modül geldiği aşamada kendi
 * tanımını buraya ekler; saklama/doğrulama/API altyapıdan gelir.
 */
registerModulAyar(
  "arayuz",
  z.object({
    tema: z.enum(["acik", "koyu"]),
    sayfaBoyutu: z.number().int().min(10).max(200),
  }),
  { tema: "acik", sayfaBoyutu: 50 },
);

registerModulAyar(
  "cari",
  z.object({
    varsayilanVadeGun: z.number().int().min(0).max(365),
    varsayilanDoviz: z.enum(["TRY", "USD", "EUR"]),
  }),
  { varsayilanVadeGun: 14, varsayilanDoviz: "TRY" },
);

registerModulAyar(
  "stok",
  z.object({
    varsayilanBirim: z.string().min(1).max(20),
    kritikSeviyeUyarisi: z.boolean(),
    /// STK-17: eksi stok politikası — çıkışta stok eksiye düşerse
    eksiStokPolitikasi: z.enum(["izin", "uyar", "engelle"]),
  }),
  {
    varsayilanBirim: "adet",
    kritikSeviyeUyarisi: true,
    eksiStokPolitikasi: "uyar",
  },
);

registerModulAyar(
  "fatura",
  z.object({
    varsayilanSeri: z.string().regex(/^[A-Z]{3}$/).default("TKR"),
    varsayilanKdvOrani: z.number().min(0).max(100).default(20),
    faturaSablonu: z.enum(["standart", "modern", "klasik"]).default("standart"),
  }),
  { varsayilanSeri: "TKR", varsayilanKdvOrani: 20, faturaSablonu: "standart" },
);

registerModulAyar(
  "kasaBanka",
  z.object({
    varsayilanKasaId: z.string().uuid().optional().nullable(),
    varsayilanBankaHesapId: z.string().uuid().optional().nullable(),
  }),
  { varsayilanKasaId: null, varsayilanBankaHesapId: null },
);

registerModulAyar(
  "ebelge",
  z.object({
    /**
     * e-Arşiv faturasının kaç gün içinde iptal edilebileceği (EBLG-22).
     * Süre geçtikten sonra düzeltme yolu iade faturasıdır.
     *
     * Varsayılan 8 gün yaygın uygulamadır; tebliğ metninden değil sektör
     * kaynağından geldiği için mali müşavirin söylediği süreyle
     * değiştirilebilsin diye ayar yapıldı.
     */
    earsivIptalGunSayisi: z.number().int().min(0).max(90),
    /**
     * Alıcı yanıt vermezse giden e-İrsaliyenin gönderimden sonra kaç gün
     * otomatik sorgulanacağı (EBLG-36). GİB yanıt için 7 gün öngörür; varsayılan
     * 3 gün pay bırakır. Süre dolunca elle sorgu açık kalır. Planlayıcı en fazla
     * 60 güne kadar bakar.
     */
    eirsaliyeYanitGunSayisi: z.number().int().min(1).max(60),
    /**
     * Alıcı yanıt vermezse giden ticari e-Faturanın gönderimden sonra kaç gün
     * otomatik sorgulanacağı (EBLG-40). Mevzuat yanıt için 8 gün öngörür;
     * varsayılan 2 gün teslim payı bırakır. Süre dolunca elle sorgu açık kalır,
     * geç gelen yanıtı gelen tarama okur. Planlayıcı en fazla 60 güne bakar.
     */
    efaturaYanitGunSayisi: z.number().int().min(1).max(60),
  }),
  { earsivIptalGunSayisi: 8, eirsaliyeYanitGunSayisi: 10, efaturaYanitGunSayisi: 10 },
);

registerModulAyar(
  "satin_alma",
  z.object({
    /**
     * Satın alma talebinin onay eşiği, TL (SAT-03). Tahmini toplam eşik ve
     * altındaysa muhasebe, üstündeyse yönetici onaylar.
     */
    onayEsigi: z.number().min(0).max(1_000_000_000),
    /**
     * SAT-11: üçlü eşleştirmede fark sayılmayan sapma (%). Faturanın miktarı
     * mal kabulden, birim fiyatı siparişten bu oranın üstünde ayrılırsa
     * Düzeltme Merkezi'ne kayıt düşer; fatura yine de kesilebilir.
     */
    miktarToleransYuzde: z.number().min(0).max(100),
    fiyatToleransYuzde: z.number().min(0).max(100),
  }),
  { onayEsigi: 25_000, miktarToleransYuzde: 1, fiyatToleransYuzde: 1 },
);
