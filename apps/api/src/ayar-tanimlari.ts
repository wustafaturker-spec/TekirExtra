import { z } from "zod";
import { registerModulAyar } from "./core/ayarlar/ayar-kayit";
import { BELGE_SABLONLARI, VARSAYILAN_VURGU_RENGI } from "./core/pdf/belge-temasi";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";
import { VARSAYILAN_SABLONLAR } from "./cari/vade-hatirlatma";

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
    varsayilanDoviz: z.enum(DOVIZ_CINSLERI),
    /// CARI-32: risk limiti aşılınca sipariş onayı ve fatura kesinleştirmede davranış.
    riskLimitiPolitikasi: z.enum(["uyar", "engelle", "yonetici_onayi"]),
    // CARI-37 BA/BS eşiği MVZ-13 ile Mevzuat Merkezi'ne taşındı (kanuni_deger/babs_esigi).
    /// CARI-38: vade hatırlatma ve ihtar e-postası şablonları; boş bırakılırsa varsayılan metin.
    vadeHatirlatmaKonusu: z.string().max(200),
    vadeHatirlatmaMetni: z.string().max(5000),
    ihtarKonusu: z.string().max(200),
    ihtarMetni: z.string().max(5000),
  }),
  { varsayilanVadeGun: 14, varsayilanDoviz: "TRY", riskLimitiPolitikasi: "uyar", ...VARSAYILAN_SABLONLAR },
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
    /// FTR-22: basılan tüm belgelerin ve UBL'e gömülen görünümün yerleşimi.
    faturaSablonu: z.enum(BELGE_SABLONLARI).default("standart"),
    /// FTR-23: şablonun vurgu rengi; üzerindeki yazı rengi kontrasta göre seçilir.
    vurguRengi: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Renk #rrggbb biçiminde olmalıdır").default(VARSAYILAN_VURGU_RENGI),
  }),
  {
    varsayilanSeri: "TKR",
    varsayilanKdvOrani: 20,
    faturaSablonu: "standart",
    vurguRengi: VARSAYILAN_VURGU_RENGI,
  },
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
    // EBLG-22 e-Arşiv iptal süresi ve EBLG-82 irsaliye–fatura süresi MVZ-13 ile
    // Mevzuat Merkezi'ne taşındı (kanuni_deger/earsiv_iptal_gun, irsaliye_fatura_gun).
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
  { eirsaliyeYanitGunSayisi: 10, efaturaYanitGunSayisi: 10 },
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

registerModulAyar(
  "calisma_takvimi",
  z.object({
    /// Üretim günü bu saatte başlar; operasyonlar buradan itibaren planlanır.
    gunBaslangicSaati: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat SS:DD biçiminde olmalıdır"),
    /// PRS-08: haftada 6 gün çalışılıyorsa cumartesi yıllık izinde iş günü sayılır.
    cumartesiIzinGunu: z.boolean().default(false),
  }),
  { gunBaslangicSaati: "08:00", cumartesiIzinGunu: false },
);

registerModulAyar(
  "personel",
  z.object({
    /// PRS-17 (P2-8): kapatılırsa İK ekranlarına yalnız yönetici ve İK rolü erişir.
    maasMuhasebeyeAcik: z.boolean().default(true),
  }),
  { maasMuhasebeyeAcik: true },
);

registerModulAyar(
  "tevkifat",
  z.object({
    /**
     * MVZ-09: firmanın kendi listesinden gizlediği tevkifat kodları. Kodlar ve
     * oranlar Mevzuat Merkezi'ndedir; firma değiştiremez (FTR-35'in oran/kod
     * düzenlemesi MVZ-15 ile kalktı, eski `degisiklikler` alanı okunurken
     * yalnız `pasif` işaretleri gizli sayılır).
     */
    gizli: z.array(z.string().regex(/^\d{3}$/, "Tevkifat kodu üç haneli olmalıdır")).max(200),
  }),
  { gizli: [] },
);
