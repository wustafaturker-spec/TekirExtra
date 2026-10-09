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
