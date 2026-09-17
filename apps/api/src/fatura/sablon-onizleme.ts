import type { FaturaPdfVerisi } from "./fatura-pdf";

/**
 * Şablon önizlemesinin örnek faturası (FTR-24).
 *
 * Önizleme gerçek PDF üretecinden geçer; bu yüzden burada yalnız veri durur,
 * ayrı bir çizim yolu yoktur — kullanıcı ne görüyorsa bastığında onu alır.
 * Veri uydurmadır ve hiçbir kiracı kaydına dokunmaz; tutarlar KDV'li/KDV'siz
 * ve iskontolu satırları birlikte göstersin diye seçilmiştir.
 */
export function ornekFatura(): FaturaPdfVerisi {
  return {
    tip: "satis",
    durum: "kesin",
    no: "TKR2026000000042",
    tarih: new Date(),
    vadeTarihi: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    dovizCinsi: "TRY",
    kur: "1",
    toplamBrut: "12500.00",
    toplamSatirIskontosu: "500.00",
    genelIskontoToplam: "0.00",
    toplamMatrah: "12000.00",
    toplamKdv: "2360.00",
    toplamTevkifat: "0.00",
    genelToplam: "14360.00",
    aciklama: "Bu bir örnek faturadır; yalnız şablon önizlemesi için üretilmiştir.",
    cari: { kod: "MUS-042", unvan: "ÖRNEK MÜŞTERİ TİCARET A.Ş.", vknTckn: "1234567890" },
    satirlar: [
      {
        stokKod: "URN-001",
        stokAd: "Danışmanlık hizmeti",
        miktar: "10",
        birim: "saat",
        birimFiyat: "750.00",
        iskontoOrani: "0",
        matrah: "7500.00",
        kdvOrani: "20",
        kdvTutari: "1500.00",
        toplamTutar: "9000.00",
      },
      {
        stokKod: "URN-002",
        stokAd: "Yıllık bakım paketi",
        miktar: "1",
        birim: "adet",
        birimFiyat: "5000.00",
        iskontoOrani: "10",
        matrah: "4500.00",
        kdvOrani: "20",
        kdvTutari: "860.00",
        toplamTutar: "5360.00",
      },
    ],
  };
}
