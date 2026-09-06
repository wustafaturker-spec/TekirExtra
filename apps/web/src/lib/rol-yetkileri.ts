const ROL_YOLLARI: Record<string, string[]> = {
  muhasebe: ["/panel", "/panel/bildirimler", "/panel/islemler", "/panel/donem-kapatma", "/panel/cari", "/panel/fatura", "/panel/ebelge", "/panel/belgeler", "/panel/satin-alma", "/panel/masraflar", "/panel/gelirler", "/panel/kasa-banka", "/panel/projeler", "/panel/stok", "/panel/raporlar", "/panel/mali-musavir", "/panel/personel", "/panel/pazaryeri", "/panel/ayarlar/eposta", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  satis: ["/panel", "/panel/bildirimler", "/panel/satis", "/panel/crm", "/panel/fatura", "/panel/belgeler", "/panel/cari", "/panel/projeler", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  salt_okunur: ["/panel", "/panel/bildirimler", "/panel/islemler", "/panel/cari", "/panel/fatura", "/panel/belgeler", "/panel/kasa-banka", "/panel/projeler", "/panel/stok", "/panel/raporlar", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  mali_musavir: ["/panel", "/panel/bildirimler", "/panel/islemler", "/panel/mali-musavir", "/panel/raporlar", "/panel/fatura", "/panel/cari", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  b2b_bayi: ["/panel/b2b", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  uretim_planlama: ["/panel", "/panel/bildirimler", "/panel/uretim", "/panel/stok", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  uretim_operatoru: ["/panel", "/panel/bildirimler", "/panel/uretim", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  depo: ["/panel", "/panel/bildirimler", "/panel/uretim", "/panel/stok", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  kalite: ["/panel", "/panel/bildirimler", "/panel/uretim/kalite", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  maliyet_muhasebesi: ["/panel", "/panel/bildirimler", "/panel/uretim", "/panel/stok", "/panel/raporlar", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
};

export function rolMenuYoluGorebilir(rol: string | null, href: string): boolean {
  if (!rol) return false;
  if (rol === "yonetici") return true;
  const yol = href.split("?")[0];
  return (ROL_YOLLARI[rol] ?? []).some((izinli) =>
    izinli === "/panel" ? yol === izinli : yol === izinli || yol.startsWith(`${izinli}/`),
  );
}
