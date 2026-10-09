/** Mevzuat Merkezi ekranlarının ortak etiketleri (platform paneli ve kiracı görünümü). */
export type MevzuatDurum = "taslak" | "onay_bekliyor" | "yayinlandi";
export const DURUM_ADI: Record<MevzuatDurum, string> = { taslak: "Taslak", onay_bekliyor: "Onay bekliyor", yayinlandi: "Yayınlandı" };
export const DURUM_ROZETI: Record<MevzuatDurum, "neutral" | "warning" | "success"> = { taslak: "neutral", onay_bekliyor: "warning", yayinlandi: "success" };
export const ISLEM_ADI: Record<"ekle" | "degistir" | "kaldir", string> = { ekle: "Ekle", degistir: "Değiştir", kaldir: "Kaldır" };
export const OLAY_ADI: Record<string, string> = {
  giris: "Giriş yaptı", olusturuldu: "Oluşturdu", guncellendi: "Bilgileri güncelledi", satirlar_guncellendi: "Kalemleri güncelledi",
  onaya_gonderildi: "Onaya gönderdi", taslaga_cekildi: "Taslağa çekti", geri_cevrildi: "Geri çevirdi", yayinlandi: "Yayınladı",
  silindi: "Taslağı sildi", talep_guncellendi: "Talebi güncelledi", platform_kullanicisi_kuruldu: "Platform kullanıcısı kuruldu",
};
export const tarihTR = (gun: string | null) => (gun ? new Date(`${gun.slice(0, 10)}T12:00:00`).toLocaleDateString("tr-TR") : "—");
