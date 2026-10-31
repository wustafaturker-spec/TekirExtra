/**
 * PLT-26: mevzuat editörünün görebileceği denetim olayları açık listeyle
 * tanımlanır. Eskiden yönetim olayları `notIn` listesiyle çıkarılıyordu;
 * listeye eklenmeyen her yeni olay (kullanıcı, destek, giriş, ödeme
 * sağlayıcısı, sistem alarmı…) editöre sızıyordu. Artık listede olmayan
 * olay varsayılan olarak yalnız yöneticiye görünür.
 */
export const MEVZUAT_EDITOR_OLAYLARI = [
  // Mevzuat değişikliği yaşam döngüsü (platform-mevzuat.service)
  "olusturuldu", "guncellendi", "silindi", "satirlar_guncellendi", "onaya_gonderildi", "taslaga_cekildi", "geri_cevrildi", "yayinlandi", "kabul_senaryolari_guncellendi",
  // Kiracı bildirimleri ve yürürlük hatırlatması
  "talep_guncellendi", "hatirlatma",
  // Migration'ların yazdığı ilk dolum ve dayanak notları
  "ilk_dolum", "dayanak_notu",
  // PLT-24 mevzuat kapsamlı görevler (platform görevleri hariç)
  "mevzuat_gorevi_olusturuldu", "mevzuat_gorevi_guncellendi",
] as const;

const EDITOR_OLAYLARI: ReadonlySet<string> = new Set(MEVZUAT_EDITOR_OLAYLARI);

export function editorGorebilirMi(olay: string): boolean {
  return EDITOR_OLAYLARI.has(olay);
}

/** Olay ayrıntısında gizli değer taşıyabilecek alan adları; değer hiçbir rolde dönmez. */
const GIZLI_ALAN = /(parola|sifre|password|secret|totp|token|api_?key|private_?key)/i;

/** Olay ayrıntısındaki gizli alanları (iç içe dahil) "•••" ile değiştirir; bugün yazılmıyorlar, yazılırsa da dışarı çıkmasınlar. */
export function olayDetayiniMaskele<T>(detay: T): T {
  if (Array.isArray(detay)) return detay.map((d) => olayDetayiniMaskele(d)) as T;
  if (detay === null || typeof detay !== "object") return detay;
  return Object.fromEntries(Object.entries(detay).map(([ad, deger]) => [ad, GIZLI_ALAN.test(ad) ? "•••" : olayDetayiniMaskele(deger)])) as T;
}
