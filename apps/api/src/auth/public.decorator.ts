import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ANAHTAR = "public";
/** Ucu kimlik doğrulamasız erişime açar (giriş, kayıt, doğrulama, health). */
export const Public = () => SetMetadata(PUBLIC_ANAHTAR, true);

export const PLATFORM_ANAHTAR = "platform";
/**
 * MVZ-04: ucu platform ekibine ayırır. Platform token'ı ayrı anahtarla
 * (PLATFORM_JWT_SECRET) imzalanır; kiracı token'ı bu uçlarda, platform token'ı
 * kiracı uçlarında geçmez.
 */
export const PlatformUcu = () => SetMetadata(PLATFORM_ANAHTAR, true);

export type PlatformRolu = "yonetici" | "mevzuat_editoru";
export const PLATFORM_ROLLER_ANAHTAR = "platformRolleri";
/**
 * PLT-06: platform ucunu açan roller. İşaretsiz platform ucu yalnız platform
 * yöneticisine açıktır (yeni uç unutulursa editöre kendiliğinden açılmasın).
 */
export const PlatformRolleri = (...roller: PlatformRolu[]) => SetMetadata(PLATFORM_ROLLER_ANAHTAR, roller);

/**
 * Platform P0-1: yöntemi POST olsa da veri değiştirmeyen uç (rapor çalıştırma,
 * dışa aktarma, önizleme). Askıdaki (salt okunur) firmada da açık kalır.
 */
export const SALT_OKUMA_ANAHTAR = "saltOkumadaAcik";
export const SaltOkumadaAcik = () => SetMetadata(SALT_OKUMA_ANAHTAR, true);

/**
 * KLN-21: 2FA zorunlu rolde kurulumu bitmemiş kullanıcıya da açık uç
 * (Hesap Güvenliği ekranının kullandıkları). Diğer uçlar 403 döner.
 */
/** PLT-10: destek oturumunda da çağrılabilen, veri yazmayan POST ucu (oturum işaretini koyma). */
export const DESTEK_OTURUMUNDA_ACIK_ANAHTAR = "destekOturumundaAcik";
export const DestekOturumundaAcik = () => SetMetadata(DESTEK_OTURUMUNDA_ACIK_ANAHTAR, true);

export const IKI_ADIM_KURULUMUNDA_ACIK_ANAHTAR = "ikiAdimKurulumundaAcik";
export const IkiAdimKurulumundaAcik = () => SetMetadata(IKI_ADIM_KURULUMUNDA_ACIK_ANAHTAR, true);

/** Rol ve kullanıcı yönetimi: özel rollü kullanıcı okuyabilir, yazamaz (yetki yükseltme yolu olmasın). */
export const OZEL_ROLDE_YAZMA_KAPALI_ANAHTAR = "ozelRoldeYazmaKapali";
export const OzelRoldeYazmaKapali = () => SetMetadata(OZEL_ROLDE_YAZMA_KAPALI_ANAHTAR, true);
