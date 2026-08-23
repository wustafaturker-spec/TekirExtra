import { z } from "zod";

export const b2bSiparisKalemSemasi = z.object({
  stokId: z.string().uuid("Geçersiz stok kartı"),
  miktar: z.coerce.number().positive("Miktar sıfırdan büyük olmalıdır"),
});

export const b2bSiparisOlusturSemasi = z.object({
  cariId: z.string().uuid("Geçersiz cari hesap"),
  kalemler: z.array(b2bSiparisKalemSemasi).min(1, "Siparişte en az bir ürün bulunmalıdır"),
  aciklama: z.string().trim().max(500).optional(),
});
