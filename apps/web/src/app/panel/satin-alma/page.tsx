"use client";

import { useEffect, useState } from "react";
import { CalismaAlani } from "@/components/calisma-alani";
import { api, tokenAl } from "@/lib/api";

interface AlisOzeti { buAyToplam: string; buAyAdet: number; buAyKdv: string; yillikToplam: string; acikOdeme: string; oncekiAyaGoreDegisim: number | null }
const para = (deger: string) => Number(deger).toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

export default function SatinAlmaCalismaAlani() {
  const [ozet, setOzet] = useState<AlisOzeti | null>(null); const [ozetHatasi, setOzetHatasi] = useState(false);
  useEffect(() => { if (tokenAl()) void api<AlisOzeti>("/fatura/alis-ozeti").then(setOzet).catch(() => setOzetHatasi(true)); }, []);
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
      araIcerik={
        <section aria-labelledby="alis-ozeti" className="sales-overview purchase-overview">
          <div className="section-heading"><div><p className="workspace-eyebrow">Güncel maliyet</p><h2 className="section-title" id="alis-ozeti">Satın alma özeti</h2></div><a className="btn btn--ghost btn--sm" href="/panel/fatura/raporlar">Detaylı raporlar</a></div>
          {ozetHatasi ? <div className="sales-overview__empty">Satın alma özeti şu anda yüklenemedi.</div> : <div className="sales-metric-grid">
            <article className="sales-metric sales-metric--primary purchase-metric--primary"><span>Bu ay net alış</span><strong>{ozet?.buAyToplam != null ? para(ozet.buAyToplam) : "—"}</strong><small>{ozet?.oncekiAyaGoreDegisim == null ? "Karşılaştırma için önceki ay verisi yok" : `Geçen aya göre %${Math.abs(ozet.oncekiAyaGoreDegisim).toLocaleString("tr-TR")} ${ozet.oncekiAyaGoreDegisim >= 0 ? "artış" : "azalış"}`}</small></article>
            <article className="sales-metric"><span>Bu ay fatura adedi</span><strong>{ozet?.buAyAdet != null ? ozet.buAyAdet.toLocaleString("tr-TR") : "—"}</strong><small>Kesinleşmiş alış faturası</small></article>
            <article className="sales-metric"><span>Bu ay indirilecek KDV</span><strong>{ozet?.buAyKdv != null ? para(ozet.buAyKdv) : "—"}</strong><small>İadeler düşülmüş net KDV</small></article>
            <article className="sales-metric"><span>Yıllık net alış</span><strong>{ozet?.yillikToplam != null ? para(ozet.yillikToplam) : "—"}</strong><small>Yılbaşından bugüne</small></article>
            <article className="sales-metric sales-metric--warning"><span>Açık ödeme</span><strong>{ozet?.acikOdeme != null ? para(ozet.acikOdeme) : "—"}</strong><small>Kesin faturaların kalan bakiyesi</small></article>
          </div>}
        </section>
      }
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
