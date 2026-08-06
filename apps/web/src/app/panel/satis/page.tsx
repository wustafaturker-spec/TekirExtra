import { CalismaAlani } from "@/components/calisma-alani";

export default function SatisCalismaAlani() {
  return (
    <CalismaAlani
      baslik="Satış"
      aciklama="Tekliften tahsilata kadar müşteri işlemlerini tek yerden yönetin."
      anaEylem={{ href: "/panel/fatura?yon=satis&yeni=1", baslik: "Satış faturası" }}
      hizliEylemler={[
        {
          href: "/panel/fatura?yon=satis&yeni=1",
          baslik: "Satış faturası",
          aciklama: "Müşteriye yeni fatura taslağı oluşturun",
          ikon: "SF",
          vurgu: true,
        },
        {
          href: "/panel/belgeler?yon=satis&tur=teklif&yeni=1",
          baslik: "Teklif oluştur",
          aciklama: "Fiyat ve geçerlilik bilgileriyle teklif hazırlayın",
          ikon: "TK",
        },
        {
          href: "/panel/belgeler?yon=satis&tur=siparis&yeni=1",
          baslik: "Sipariş oluştur",
          aciklama: "Müşteri siparişini stokla ilişkilendirin",
          ikon: "SP",
        },
        {
          href: "/panel/kasa-banka?islem=tahsilat",
          baslik: "Tahsilat al",
          aciklama: "Müşteri bakiyesine tahsilat işleyin",
          ikon: "TH",
        },
      ]}
      kuyruklar={[
        {
          href: "/panel/fatura?yon=satis&durum=taslak",
          baslik: "Taslak satış faturaları",
          aciklama: "Kontrol edilip kesinleştirilmeyi bekleyen faturalar",
          ton: "warning",
        },
        {
          href: "/panel/fatura?yon=satis&ebelge=hata",
          baslik: "e-Belge hataları",
          aciklama: "Düzeltilip yeniden gönderilmesi gereken kayıtlar",
          ton: "danger",
        },
        {
          href: "/panel/cari?tip=musteri&bakiye=gecikmis",
          baslik: "Vadesi geçen alacaklar",
          aciklama: "Tahsilat takibi gereken müşteri bakiyeleri",
          ton: "warning",
        },
        {
          href: "/panel/belgeler?yon=satis",
          baslik: "Tüm satış belgeleri",
          aciklama: "Teklif, sipariş ve irsaliye zincirini inceleyin",
        },
      ]}
    />
  );
}
