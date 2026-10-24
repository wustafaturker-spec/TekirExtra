import type { Rol } from "@tekirextra/shared";

/** Rollerin ekranda görünen adları; Kullanıcılar ve Rol Yetkileri ekranları aynı adları kullanır. */
export const ROL_ADI: Record<Rol, string> = {
  yonetici: "Yönetici",
  muhasebe: "Muhasebe",
  satis: "Satış",
  salt_okunur: "Salt Okunur",
  mali_musavir: "Mali Müşavir",
  b2b_bayi: "B2B Bayi",
  uretim_planlama: "Üretim Planlama",
  uretim_operatoru: "Üretim Operatörü",
  depo: "Depo Sorumlusu",
  kalite: "Kalite Sorumlusu",
  maliyet_muhasebesi: "Maliyet Muhasebesi",
  ik: "İnsan Kaynakları",
  calisan: "Çalışan (self-servis)",
};
