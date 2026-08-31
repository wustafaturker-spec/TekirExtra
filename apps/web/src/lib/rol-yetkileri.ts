const ROL_YOLLARI: Record<string, string[]> = {
  muhasebe: ["/panel", "/panel/islemler", "/panel/cari", "/panel/fatura", "/panel/ebelge", "/panel/belgeler", "/panel/satin-alma", "/panel/masraflar", "/panel/gelirler", "/panel/kasa-banka", "/panel/projeler", "/panel/stok", "/panel/raporlar", "/panel/mali-musavir", "/panel/personel", "/panel/pazaryeri", "/panel/ayarlar/eposta", "/panel/ayarlar/hesap"],
  satis: ["/panel", "/panel/satis", "/panel/crm", "/panel/fatura", "/panel/belgeler", "/panel/cari", "/panel/projeler", "/panel/ayarlar/hesap"],
  salt_okunur: ["/panel", "/panel/islemler", "/panel/cari", "/panel/fatura", "/panel/belgeler", "/panel/kasa-banka", "/panel/projeler", "/panel/stok", "/panel/raporlar", "/panel/ayarlar/hesap"],
  mali_musavir: ["/panel", "/panel/islemler", "/panel/mali-musavir", "/panel/raporlar", "/panel/fatura", "/panel/cari", "/panel/ayarlar/hesap"],
  b2b_bayi: ["/panel/b2b", "/panel/ayarlar/hesap"],
  uretim_planlama: ["/panel", "/panel/uretim", "/panel/stok", "/panel/ayarlar/hesap"],
  uretim_operatoru: ["/panel", "/panel/uretim", "/panel/ayarlar/hesap"],
  depo: ["/panel", "/panel/uretim", "/panel/stok", "/panel/ayarlar/hesap"],
  kalite: ["/panel", "/panel/uretim/kalite", "/panel/ayarlar/hesap"],
  maliyet_muhasebesi: ["/panel", "/panel/uretim", "/panel/stok", "/panel/raporlar", "/panel/ayarlar/hesap"],
};

export function rolMenuYoluGorebilir(rol: string | null, href: string): boolean {
  if (!rol) return false;
  if (rol === "yonetici") return true;
  const yol = href.split("?")[0];
  return (ROL_YOLLARI[rol] ?? []).some((izinli) =>
    izinli === "/panel" ? yol === izinli : yol === izinli || yol.startsWith(`${izinli}/`),
  );
}
