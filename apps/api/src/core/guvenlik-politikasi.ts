/** KLN-22: yöneticinin seçebileceği hareketsizlik süreleri (dakika); null = kapalı. */
export const HAREKETSIZLIK_SECENEKLERI = [15, 30, 60, 240] as const;
export const OTURUM_SURESI_EN_COK_GUN = 30;

export interface GuvenlikPolitikasi {
  ikiAdimZorunluRoller: string[];
  oturumSuresiGun: number;
  hareketsizlikDk: number | null;
}

/** KLN-21: rol 2FA zorunlu listede ve kullanıcı kurmamışsa yalnız Hesap Güvenliği açıktır. */
export function ikiAdimEksikMi(politika: Pick<GuvenlikPolitikasi, "ikiAdimZorunluRoller">, rol: string, totpAktif: boolean): boolean {
  return !totpAktif && politika.ikiAdimZorunluRoller.includes(rol);
}

export const IKI_ADIM_KURULUMU_GEREKLI = "IKI_ADIM_KURULUMU_GEREKLI";
