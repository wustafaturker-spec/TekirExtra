import type { EbelgeUygulamalari, EbelgeUygulamaKodu } from "@tekirextra/shared";
import { uygulamaAcik } from "@tekirextra/shared";

/**
 * EBLG-77: hangi ekranın hangi e-belge uygulamasına bağlı olduğu. Firma o
 * uygulamaya kayıtlı değilse yol menüden kalkar; sunucu tarafında aynı kapı
 * `@EbelgeUygulamasi` guard'ıyla kuruludur.
 *
 * Listede olmayan yollar (fatura, belgeler, cari…) e-belgeden bağımsızdır:
 * kağıt fatura kesen firma da uygulamayı ön muhasebe olarak kullanır.
 */
const YOL_UYGULAMALARI: { yol: string; uygulamalar: EbelgeUygulamaKodu[] }[] = [
  { yol: "/panel/ebelge/fatura-gelen", uygulamalar: ["efatura"] },
  { yol: "/panel/ebelge/irsaliye-gelen", uygulamalar: ["eirsaliye"] },
  { yol: "/panel/ebelge/irsaliye-giden", uygulamalar: ["eirsaliye"] },
  { yol: "/panel/ebelge/kuyruk", uygulamalar: ["efatura", "earsiv"] },
  { yol: "/panel/fatura/earsiv-raporlari", uygulamalar: ["earsiv"] },
  // e-Belge ayarları (entegratör bağlantısı, mükellef listesi) yalnız e-belge
  // kullanan firmada anlamlıdır.
  { yol: "/panel/ayarlar/entegratorler", uygulamalar: ["efatura", "earsiv", "eirsaliye"] },
];

/**
 * Uygulamalar henüz okunmadıysa (ilk çizim) yol gizlenmez: menünün yüklenme
 * sırasında titremesindense, kapalı ucu guard'ın reddetmesi yeğdir.
 */
export function ebelgeYoluGorunur(uygulamalar: EbelgeUygulamalari | null, href: string): boolean {
  if (!uygulamalar) return true;
  const yol = href.split("?")[0];
  const kayit = YOL_UYGULAMALARI.find((k) => yol === k.yol || yol.startsWith(`${k.yol}/`));
  if (!kayit) return true;
  return kayit.uygulamalar.some((kod) => uygulamaAcik(uygulamalar, kod));
}
