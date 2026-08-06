import { CalismaAlani } from "@/components/calisma-alani";

export default function SatinAlmaCalismaAlani() {
  return (
    <CalismaAlani
      baslik="Satın Alma"
      aciklama="Tedarikçi siparişlerinden ödemeye kadar satın alma sürecini takip edin."
      anaEylem={{ href: "/panel/fatura?yon=alis&yeni=1", baslik: "Alış faturası" }}
      hizliEylemler={[
        {
          href: "/panel/fatura?yon=alis&yeni=1",
          baslik: "Alış faturası",
          aciklama: "Tedarikçiden gelen faturayı kaydedin",
          ikon: "AF",
          vurgu: true,
        },
        {
          href: "/panel/fatura/gelen-kutusu",
          baslik: "Gelen e-Belgeler",
          aciklama: "Entegratörden gelen belgeleri kontrol edin",
          ikon: "EB",
        },
        {
          href: "/panel/belgeler?yon=alis&tur=siparis&yeni=1",
          baslik: "Satın alma siparişi",
          aciklama: "Tedarikçiye yeni sipariş hazırlayın",
          ikon: "SA",
        },
        {
          href: "/panel/kasa-banka?islem=odeme",
          baslik: "Ödeme yap",
          aciklama: "Tedarikçi bakiyesine ödeme işleyin",
          ikon: "ÖD",
        },
      ]}
      kuyruklar={[
        {
          href: "/panel/fatura/gelen-kutusu",
          baslik: "Kontrol bekleyen e-Belgeler",
          aciklama: "Cari ve stok eşleştirmesi tamamlanacak belgeler",
          ton: "warning",
        },
        {
          href: "/panel/fatura?yon=alis&durum=taslak",
          baslik: "Taslak alış faturaları",
          aciklama: "Kontrol edilip kesinleştirilmeyi bekleyen faturalar",
          ton: "warning",
        },
        {
          href: "/panel/cari?tip=tedarikci&bakiye=gecikmis",
          baslik: "Vadesi gelen ödemeler",
          aciklama: "Ödeme planına alınması gereken tedarikçi borçları",
          ton: "danger",
        },
        {
          href: "/panel/belgeler?yon=alis",
          baslik: "Tüm satın alma belgeleri",
          aciklama: "Sipariş ve irsaliye zincirini inceleyin",
        },
      ]}
    />
  );
}
