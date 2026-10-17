/** CARI-48: asistanın açıldığı ekranın kaydı; sunucu kimliği rol kontrolüyle doğrular. */
export interface AsistanBaglami {
  cari: { id: string; unvan: string };
}

export const ASISTAN_AC_OLAYI = "tekir-asistan-ac";

/** Asistanı her ekrandan açar; bağlam verilmezse genel sohbet açılır. */
export function asistaniAc(baglam?: AsistanBaglami) {
  window.dispatchEvent(new CustomEvent<AsistanBaglami | undefined>(ASISTAN_AC_OLAYI, { detail: baglam }));
}
