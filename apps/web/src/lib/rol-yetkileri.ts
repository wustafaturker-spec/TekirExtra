import { ozelRolPanelYoluKapali, paketPanelYoluKapali } from "@tekirextra/shared";

// AI-04/05: asistan ve onay talepleri (/panel/ai) her iç role açık; araçlar rolün yetkisine göre süzülür.
const ROL_YOLLARI: Record<string, string[]> = {
  muhasebe: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/is-kutusu", "/panel/eposta", "/panel/islemler", "/panel/donem-kapatma", "/panel/nakit-akisi", "/panel/butce", "/panel/cari", "/panel/fatura", "/panel/ebelge", "/panel/belgeler", "/panel/satin-alma", "/panel/masraflar", "/panel/gelirler", "/panel/kasa-banka", "/panel/demirbas", "/panel/araclar", "/panel/projeler", "/panel/stok", "/panel/raporlar", "/panel/mali-musavir", "/panel/personel", "/panel/pazaryeri", "/panel/ayarlar/depolar", "/panel/ayarlar/doviz-kurlari", "/panel/ayarlar/araclar", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  satis: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/is-kutusu", "/panel/eposta", "/panel/satin-alma/talepler", "/panel/ebelge/irsaliye-giden", "/panel/satis", "/panel/crm", "/panel/fatura", "/panel/belgeler", "/panel/cari", "/panel/projeler", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  salt_okunur: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/islemler", "/panel/cari", "/panel/fatura", "/panel/belgeler", "/panel/kasa-banka", "/panel/demirbas", "/panel/araclar", "/panel/projeler", "/panel/stok", "/panel/raporlar", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  mali_musavir: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/islemler", "/panel/mali-musavir", "/panel/raporlar", "/panel/fatura", "/panel/cari", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  b2b_bayi: ["/panel/b2b", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  uretim_planlama: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/satin-alma/talepler", "/panel/uretim", "/panel/stok", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  uretim_operatoru: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/satin-alma/talepler", "/panel/uretim", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  depo: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/satin-alma/talepler", "/panel/uretim", "/panel/stok", "/panel/araclar", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  kalite: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/satin-alma/talepler", "/panel/uretim/kalite", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  calisan: ["/panel/self-servis", "/panel/bildirimler", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  ik: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/personel", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
  maliyet_muhasebesi: ["/panel", "/panel/bildirimler", "/panel/ai", "/panel/satin-alma/talepler", "/panel/uretim", "/panel/stok", "/panel/raporlar", "/panel/ayarlar/hesap", "/panel/ayarlar/bildirimler"],
};

/** RPR-11: finansal özet ve raporları gören roller (yönetici her zaman); API'deki `FINANS_ROLLERI` ile aynı. */
export const FINANS_ROLLERI = ["muhasebe", "mali_musavir", "salt_okunur"];

/**
 * RPR-11: genel izinli bir yolun altında daha dar rolle açılan sayfalar
 * (ör. /panel/raporlar'ı gören maliyet muhasebesi Gelir-Gider'i görmez).
 * API aynı rolleri uygular; burada menü ve sayfa erişimi için.
 */
const KISITLI_YOLLAR: { yol: string; roller: string[] }[] = [
  { yol: "/panel/cari/tahsilat", roller: FINANS_ROLLERI },
  { yol: "/panel/cari/mutabakatlar", roller: FINANS_ROLLERI }, // API cari/mutabakatlar ile aynı roller.
  { yol: "/panel/ai/hafiza", roller: ["muhasebe", "satis"] }, // AI-59: API ile aynı roller.
  { yol: "/panel/raporlar/maliyet-eksikleri", roller: [...FINANS_ROLLERI, "maliyet_muhasebesi"] },
  { yol: "/panel/raporlar/tahmin-isabeti", roller: FINANS_ROLLERI },
  { yol: "/panel/uretim/maliyet", roller: ["muhasebe", "salt_okunur", "uretim_planlama", "maliyet_muhasebesi"] }, // API uretim/maliyet-raporu ile aynı roller.
  { yol: "/panel/stok/maliyet", roller: [] }, // Yeniden hesaplama API'si yalnız yöneticiye açık.
  { yol: "/panel/raporlar/gelir-gider", roller: FINANS_ROLLERI },
  { yol: "/panel/raporlar/kdv-disi-vergiler", roller: ["muhasebe", "mali_musavir"] },
  { yol: "/panel/raporlar/pesin-vergiler", roller: ["muhasebe", "mali_musavir"] },
  { yol: "/panel/stok/smm", roller: [...FINANS_ROLLERI, "maliyet_muhasebesi"] },
  // RPR-21: API /rapor/fatura-pivot ile aynı roller.
  { yol: "/panel/fatura/pivot", roller: [...FINANS_ROLLERI, "satis"] },
];

/** Panel özetindeki finansal kartlar (nakit, alacak/borç, vadesi geçenler). */
export function finansalOzetGorebilir(rol: string | null): boolean {
  return rol === "yonetici" || (rol !== null && FINANS_ROLLERI.includes(rol));
}

/**
 * KLN-20: oturumdaki kullanıcının özel rolünün kapattığı kutular (/auth/ben).
 * Panel yerleşimi yazar; menü, komut paleti ve sayfa erişimi aynı kuralı okur.
 */
let ozelRolKapali: string[] = [];
let paketModulleri: string[] | null = null;
export function paketModulleriAyarla(moduller: string[] | null): void { paketModulleri = moduller; }
export function ozelRolKapaliAyarla(kapali: string[]): void {
  ozelRolKapali = kapali;
}

export function rolMenuYoluGorebilir(rol: string | null, href: string): boolean {
  if (!rol) return false;
  const yol = href.split("?")[0];
  if (paketPanelYoluKapali(paketModulleri, yol)) return false;
  if (ozelRolPanelYoluKapali(ozelRolKapali, yol)) return false;
  // PRS-21: self-servis yalnız çalışan rolünün menüsünde (yöneticinin kartı yoktur).
  if (yol === "/panel/self-servis" || yol.startsWith("/panel/self-servis/")) return rol === "calisan";
  if (yol === "/panel/duyurular" || yol.startsWith("/panel/duyurular/")) return rol === "yonetici" || Object.hasOwn(ROL_YOLLARI, rol);
  if (rol === "yonetici") return true;
  const kisit = KISITLI_YOLLAR.find((k) => yol === k.yol || yol.startsWith(`${k.yol}/`));
  if (kisit && !kisit.roller.includes(rol)) return false;
  return (ROL_YOLLARI[rol] ?? []).some((izinli) =>
    izinli === "/panel" ? yol === izinli : yol === izinli || yol.startsWith(`${izinli}/`),
  );
}
