export const ROLLER = ["yonetici", "muhasebe", "satis", "salt_okunur", "mali_musavir", "b2b_bayi", "uretim_planlama", "uretim_operatoru", "depo", "kalite", "maliyet_muhasebesi", "ik", "calisan"] as const;
export type Rol = (typeof ROLLER)[number];

export const FATURA_DURUMLARI = ["taslak", "kesin", "iptal"] as const;
export type FaturaDurum = (typeof FATURA_DURUMLARI)[number];

/** e-Belge durumları — sağlayıcı durum kodları adaptörlerde bu kümeye normalize edilir (EBLG-04). */
export const BELGE_DURUMLARI = ["kuyrukta", "iletildi", "kabul", "ret", "hata"] as const;
export type BelgeDurum = (typeof BELGE_DURUMLARI)[number];

/** Dış bağlantı aileleri (ENT-01). */
export const BAGLANTI_AILELERI = ["ebelge", "pazaryeri", "pos", "banka", "sms"] as const;
export type BaglantiAile = (typeof BAGLANTI_AILELERI)[number];

export const EBELGE_SAGLAYICILARI = ["sovos", "nes", "izibiz", "foriba", "elogo", "uyumsoft"] as const;
export type EbelgeSaglayici = (typeof EBELGE_SAGLAYICILARI)[number];
/** ETC-03: pazaryerleri ve e-ticaret siteleri aynı aileyi (pazaryeri) paylaşır. */
export const PAZARYERI_SAGLAYICILARI = ["trendyol", "hepsiburada", "n11", "amazon_tr", "woocommerce", "shopify", "ikas", "ticimax", "ideasoft"] as const;
export type PazaryeriSaglayici = (typeof PAZARYERI_SAGLAYICILARI)[number];
export const POS_SAGLAYICILARI = ["iyzico", "paytr"] as const;
export type PosSaglayici = (typeof POS_SAGLAYICILARI)[number];

export const SMS_SAGLAYICILARI = ["netgsm"] as const;
export type SmsSaglayici = (typeof SMS_SAGLAYICILARI)[number];

export const BANKA_SAGLAYICILARI = ["webhook", "vomsis"] as const;
export type BankaSaglayici = (typeof BANKA_SAGLAYICILARI)[number];

/** Kayıt eylem kural motorunun eylem kümesi (AYR-04). */
export const KAYIT_EYLEMLERI = ["duzenle", "sil", "kopyala", "iptal", "pasife_al"] as const;
export type KayitEylem = (typeof KAYIT_EYLEMLERI)[number];
