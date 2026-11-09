import { VERGI_YUKUMLULUKLERI } from "@tekirextra/shared";
import { z } from "zod";

const tutar = z.coerce.number().finite().nonnegative().max(999_999_999_999);
const tarih = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalıdır");
const donem = {
  yukumluluk: z.enum(VERGI_YUKUMLULUKLERI),
  yil: z.coerce.number().int().min(2000).max(2100),
  ay: z.coerce.number().int().min(1).max(12),
};

export const vergiTakvimSorguSemasi = z.object({ yil: z.coerce.number().int().min(2000).max(2100) });
export const vergiAyarSemasi = z.object({
  baslangicYil: z.coerce.number().int().min(2000).max(2100),
  baslangicAy: z.coerce.number().int().min(1).max(12),
  devredenKdv: tutar,
  muhtasarDonemi: z.enum(["aylik", "uc_aylik"]),
});
export const vergiBeyanSemasi = z.object({ ...donem, beyanTutari: tutar.nullable(), beyanDevreden: tutar.nullable().optional(), beyanNotu: z.string().trim().max(500).nullable().optional() });
export const vergiOdemeSemasi = z.object({ ...donem, tarih, tutar: tutar.positive(), kasaBankaHareketId: z.string().uuid().nullable().optional(), not: z.string().trim().max(500).nullable().optional() });
export const vergiHareketSorguSemasi = z.object({ baslangic: tarih, bitis: tarih });
