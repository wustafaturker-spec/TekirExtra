import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";

export const TAHSILAT_MODULU = "tahsilat_operasyonu";
export const tahsilatAyariSemasi = z.object({ surum: z.literal(1).default(1), mod: z.enum(["kapali", "salt_okunur", "pilot", "acik"]).default("kapali") }).strict();

export async function tahsilatErisiminiDogrula(tx: Prisma.TransactionClient, yazma = false) {
  const { tenantId, rol } = aktifBaglam();
  const okur = ["yonetici", "muhasebe", "mali_musavir", "salt_okunur"].includes(rol);
  const ayarlar = await tx.$queryRaw<{ ayarlar: unknown }[]>`SELECT ayarlar FROM modul_ayarlari WHERE tenant_id = ${tenantId}::uuid AND modul = ${TAHSILAT_MODULU} FOR SHARE`;
  const sonuc = tahsilatAyariSemasi.safeParse(ayarlar[0]?.ayarlar ?? {});
  if (!okur || !sonuc.success || sonuc.data.mod === "kapali") throw new ForbiddenException("Tahsilat operasyonu bu şirket veya kullanıcı için açık değil");
  if (yazma && (sonuc.data.mod === "salt_okunur" || !["yonetici", "muhasebe"].includes(rol))) throw new ForbiddenException("Tahsilat işlemi yazma yetkisi yok");
  return sonuc.data.mod;
}
