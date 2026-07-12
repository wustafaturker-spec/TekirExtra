import { SetMetadata } from "@nestjs/common";
import type { Rol } from "@tekirextra/shared";

export const ROLLER_ANAHTAR = "roller";
/**
 * Ucu belirtilen rollerle sınırlar (KLN-02). `yonetici` her uca erişir;
 * dekoratör yoksa oturum açmış her kullanıcı erişir.
 */
export const Roller = (...roller: Rol[]) => SetMetadata(ROLLER_ANAHTAR, roller);
