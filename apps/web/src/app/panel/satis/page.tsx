"use client";

import { useCallback, useEffect, useState } from "react";
import { CalismaAlani } from "@/components/calisma-alani";
import { api, tokenAl } from "@/lib/api";

interface SatisOzeti { buAyToplam: string; buAyAdet: number; buAyKdv: string; yillikToplam: string; acikTahsilat: string; oncekiAyaGoreDegisim: number | null }
interface SonSatis { id: string; no: string | null; tarih: string; durum: string; genelToplam: string; cari: { unvan: string } }
const para = (deger: string) => Number(deger).toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

export default function SatisCalismaAlani() {
  const [ozet, setOzet] = useState<SatisOzeti | null>(null);
  const [ozetHatasi, setOzetHatasi] = useState(false);
  const [sonSatislar, setSonSatislar] = useState<SonSatis[]>([]);
  const satisVerisiniYukle = useCallback(() => {
    if (!tokenAl()) return;
    setOzetHatasi(false);
    void api<SatisOzeti>("/fatura/satis-ozeti").then(setOzet).catch(() => setOzetHatasi(true));
    void api<{ kayitlar: SonSatis[] }>("/fatura?yon=satis&adet=5").then((veri) => setSonSatislar(veri.kayitlar)).catch(() => setSonSatislar([]));
  }, []);
  useEffect(() => { satisVerisiniYukle(); }, [satisVerisiniYukle]);
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
      araIcerik={
        <section aria-labelledby="satis-ozeti" className="sales-overview">
          <div className="section-heading"><div><p className="workspace-eyebrow">Güncel performans</p><h2 className="section-title" id="satis-ozeti">Satış özeti</h2></div><a className="btn btn--ghost btn--sm" href="/panel/fatura/raporlar">Detaylı raporlar</a></div>
          {ozetHatasi ? <div className="sales-overview__empty">Satış özeti şu anda yüklenemedi. <button className="btn btn--ghost btn--sm" type="button" onClick={satisVerisiniYukle}>Tekrar dene</button></div> : <div className="sales-metric-grid">
            <article className="sales-metric sales-metric--primary"><span>Bu ay net satış</span><strong>{ozet?.buAyToplam != null ? para(ozet.buAyToplam) : "—"}</strong><small>{ozet?.oncekiAyaGoreDegisim == null ? "Karşılaştırma için önceki ay verisi yok" : `Geçen aya göre %${Math.abs(ozet.oncekiAyaGoreDegisim).toLocaleString("tr-TR")} ${ozet.oncekiAyaGoreDegisim >= 0 ? "artış" : "azalış"}`}</small></article>
            <article className="sales-metric"><span>Bu ay fatura adedi</span><strong>{ozet?.buAyAdet != null ? ozet.buAyAdet.toLocaleString("tr-TR") : "—"}</strong><small>Kesinleşmiş satış faturası</small></article>
            <article className="sales-metric"><span>Bu ay satış KDV’si</span><strong>{ozet?.buAyKdv != null ? para(ozet.buAyKdv) : "—"}</strong><small>İadeler düşülmüş net KDV</small></article>
            <article className="sales-metric"><span>Yıllık net satış</span><strong>{ozet?.yillikToplam != null ? para(ozet.yillikToplam) : "—"}</strong><small>Yılbaşından bugüne</small></article>
            <article className="sales-metric sales-metric--warning"><span>Açık tahsilat</span><strong>{ozet?.acikTahsilat != null ? para(ozet.acikTahsilat) : "—"}</strong><small>Kesin faturaların kalan bakiyesi</small></article>
          </div>}
          {sonSatislar.length > 0 && <div className="sales-recent"><div className="section-heading sales-recent__head"><div><p className="workspace-eyebrow">Son hareketler</p><h3 className="section-title">Son satışlar</h3></div><a className="btn btn--ghost btn--sm" href="/panel/fatura?yon=satis">Tümünü gör</a></div><div className="table-wrap"><table className="table sales-recent__table"><thead><tr><th>Belge</th><th>Cari</th><th>Tarih</th><th className="num">Tutar</th></tr></thead><tbody>{sonSatislar.map((fatura) => <tr key={fatura.id}><td><a className="sales-recent__invoice" href={`/panel/fatura?faturaId=${fatura.id}`}>{fatura.no ?? "Taslak"}</a></td><td>{fatura.cari.unvan}</td><td>{new Date(fatura.tarih).toLocaleDateString("tr-TR")}</td><td className="num"><strong>{para(fatura.genelToplam)}</strong></td></tr>)}</tbody></table></div></div>}
        </section>
      }
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
