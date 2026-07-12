export const ROLLER = ["yonetici", "muhasebe", "satis", "salt_okunur"] as const;
export type Rol = (typeof ROLLER)[number];

export const FATURA_DURUMLARI = ["taslak", "kesin", "iptal"] as const;
export type FaturaDurum = (typeof FATURA_DURUMLARI)[number];

/** e-Belge durumları — sağlayıcı durum kodları adaptörlerde bu kümeye normalize edilir (EBLG-04). */
export const BELGE_DURUMLARI = ["kuyrukta", "iletildi", "kabul", "ret", "hata"] as const;
export type BelgeDurum = (typeof BELGE_DURUMLARI)[number];

/** Dış bağlantı aileleri (ENT-01). */
export const BAGLANTI_AILELERI = ["ebelge", "pazaryeri", "pos", "banka"] as const;
export type BaglantiAile = (typeof BAGLANTI_AILELERI)[number];

export const EBELGE_SAGLAYICILARI = ["izibiz", "foriba", "elogo", "uyumsoft"] as const;
export type EbelgeSaglayici = (typeof EBELGE_SAGLAYICILARI)[number];

/** Kayıt eylem kural motorunun eylem kümesi (AYR-04). */
export const KAYIT_EYLEMLERI = ["duzenle", "sil", "kopyala", "iptal", "pasife_al"] as const;
export type KayitEylem = (typeof KAYIT_EYLEMLERI)[number];
