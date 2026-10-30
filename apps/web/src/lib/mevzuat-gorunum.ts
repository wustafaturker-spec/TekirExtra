/** Mevzuat Merkezi ekranlarının ortak etiketleri (platform paneli ve kiracı görünümü). */
export type MevzuatDurum = "taslak" | "onay_bekliyor" | "yayinlandi";
export const DURUM_ADI: Record<MevzuatDurum, string> = { taslak: "Taslak", onay_bekliyor: "Onay bekliyor", yayinlandi: "Yayınlandı" };
export const DURUM_ROZETI: Record<MevzuatDurum, "neutral" | "warning" | "success"> = { taslak: "neutral", onay_bekliyor: "warning", yayinlandi: "success" };
export const ISLEM_ADI: Record<"ekle" | "degistir" | "kaldir", string> = { ekle: "Ekle", degistir: "Değiştir", kaldir: "Kaldır" };
export const OLAY_ADI: Record<string, string> = {
  mevzuat_gorevi_olusturuldu: "Mevzuat görevi oluşturdu", mevzuat_gorevi_guncellendi: "Mevzuat görevini güncelledi",
  platform_gorevi_olusturuldu: "Platform görevi oluşturdu", platform_gorevi_guncellendi: "Platform görevini güncelledi",
  giris: "Giriş yaptı", olusturuldu: "Oluşturdu", guncellendi: "Bilgileri güncelledi", satirlar_guncellendi: "Kalemleri güncelledi",
  onaya_gonderildi: "Onaya gönderdi", taslaga_cekildi: "Taslağa çekti", geri_cevrildi: "Geri çevirdi", yayinlandi: "Yayınladı",
  silindi: "Taslağı sildi", talep_guncellendi: "Talebi güncelledi", platform_kullanicisi_kuruldu: "Platform kullanıcısı kuruldu",
  kabul_senaryolari_guncellendi: "Kabul senaryolarını güncelledi", ilk_dolum: "İlk dolum", dayanak_notu: "Dayanak notu",
  // PLT-07: platform kullanıcıları
  platform_kullanicisi_acildi: "Platform kullanıcısı davet etti", platform_daveti_yenilendi: "Kurulum bağlantısını yeniden gönderdi",
  platform_daveti_kabul_edildi: "Daveti kabul etti", platform_rolu_degisti: "Platform rolünü değiştirdi",
  platform_kullanicisi_pasife_alindi: "Platform kullanıcısını pasife aldı", platform_kullanicisi_aktif_edildi: "Platform kullanıcısını aktif etti",
  platform_2fa_sifirlandi: "Platform kullanıcısının 2FA'sını sıfırladı", platform_2fa_yeniden_kuruldu: "2FA'yı yeniden kurdu", giris_basarisiz: "Başarısız giriş",
  // PLT-10: destek erişimi
  destek_oturumu_acildi: "Destek oturumu açtı", destek_oturumu_kapatildi: "Destek oturumu kapandı", destek_istegi: "Destek oturumunda istek",
};
export const tarihTR = (gun: string | null) => (gun ? new Date(`${gun.slice(0, 10)}T12:00:00`).toLocaleDateString("tr-TR") : "—");
