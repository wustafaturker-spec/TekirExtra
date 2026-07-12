import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ANAHTAR = "public";
/** Ucu kimlik doğrulamasız erişime açar (giriş, kayıt, doğrulama, health). */
export const Public = () => SetMetadata(PUBLIC_ANAHTAR, true);
