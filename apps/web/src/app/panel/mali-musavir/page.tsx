"use client";

import { useState } from "react";
import { ayBasiTR, bugunTR } from "@tekirextra/shared";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Button, ButtonLabel, Card, Field, Input, PageHeader } from "@/components/ui";

/** RPR-02: KDV-1 ön analizi (TL, fatura kuruyla). */
interface KdvOzeti {
  satisKdv: number;
  alistanIadeKdv: number;
  hesaplananKdv: number;
  alisKdv: number;
  satistanIadeKdv: number;
  indirilecekKdv: number;
  /** EBLG-114: ihraç kayıtlı alışların KDV'si; ödenmediği için indirilmez. */
  ihracKayitliAlisKdv: number;
  ihracKayitliSatisKdv: number;
  aliciTevkifati: number;
  kestigimizTevkifat: number;
  odenecekKdv: number;
  devredenKdv: number;
}

const tl = (n: number) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

export default function MaliMusavirSayfasi() {
  const [baslangic, setBaslangic] = useState(
    ayBasiTR()
  );
  const [bitis, setBitis] = useState(bugunTR());

  const [kdvDonem, setKdvDonem] = useState({
    yil: new Date().getFullYear(),
    ay: new Date().getMonth() + 1,
  });
  const [kdvOzet, setKdvOzet] = useState<KdvOzeti | null>(null);
  const [kdvYukleniyor, setKdvYukleniyor] = useState(false);
  const [hata, setHata] = useState("");

  // İstekler oturumlu API istemcisinden gider; önceden yetkisiz düz fetch
  // `/api/mali-musavir/...` adresine gidip 404 alıyordu (2026-10-11).
  const dosyaIndir = (yol: string, ad: string) => {
    setHata("");
    void apiDosyaIndir(`${yol}?baslangic=${baslangic}&bitis=${bitis}`, ad).catch((h) => setHata(h instanceof Error ? h.message : "Dosya indirilemedi"));
  };
  const lucaXmlIndir = () => dosyaIndir("/mali-musavir/aktarim/luca-xml", `luca-faturalar-${baslangic}-${bitis}.xml`);
  const zirveCsvIndir = () => dosyaIndir("/mali-musavir/aktarim/zirve-csv", `zirve-fisler-${baslangic}-${bitis}.csv`);

  const kdvHesapla = async (e: React.FormEvent) => {
    e.preventDefault();
    setKdvYukleniyor(true);
    setHata("");
    const ay = String(kdvDonem.ay).padStart(2, "0");
    const sonGun = new Date(Date.UTC(kdvDonem.yil, kdvDonem.ay, 0)).toISOString().slice(0, 10);
    try {
      setKdvOzet(await api<KdvOzeti>(`/mali-musavir/kdv-ozeti?baslangic=${kdvDonem.yil}-${ay}-01&bitis=${sonGun}`));
    } catch (h) {
      setKdvOzet(null);
      setHata(h instanceof Error ? h.message : "KDV özeti alınamadı");
    } finally {
      setKdvYukleniyor(false);
    }
  };

  /** Alt kırılım satırı (ör. satışlar, iadeler); sıfırsa gösterilmez. */
  const alt = (etiket: string, deger: number, zorunlu = false) =>
    (zorunlu || deger > 0) && (
      <div className="invoice-summary__line"><span style={{ paddingLeft: "0.75rem", color: "var(--text-muted)" }}>{etiket}</span><span>{tl(deger)}</span></div>
    );

  return (
    <div>
      {/* Sayfa Tailwind sınıflarıyla yazılmıştı; uygulama Tailwind kullanmadığı için biçimsiz görünüyordu (2026-10-11). */}
      <PageHeader
        title="Mali Müşavir & Veri Aktarım Portalı"
        subtitle="Fatura, fiş ve KDV verilerini sürümlü Luca/Zirve aktarım taslaklarında indirin. Dosyaları hedef muhasebe yazılımınızın sürümünde içe aktarmadan önce doğrulayın."
        actions={<ButtonLabel as="a" href="/panel/mali-musavir/muhasebe">Muhasebe aktarımı (yevmiye fişleri) →</ButtonLabel>}
      />
      <Alert tone="error">{hata}</Alert>

      <div className="form-grid form-grid--2">
        <Card title="Fatura & fiş dışa aktarımı">
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>Seçilen tarih aralığındaki faturaları Luca XML, kasa/banka fişlerini Zirve CSV olarak indirin.</p>
          <div className="row-tight" style={{ alignItems: "flex-end", gap: "0.75rem", marginBottom: "1rem" }}>
            <Field label="Başlangıç"><Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} /></Field>
            <Field label="Bitiş"><Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} /></Field>
          </div>
          <div className="row-tight">
            <Button variant="primary" onClick={lucaXmlIndir}>Luca uyumlu fatura XML</Button>
            <Button onClick={zirveCsvIndir}>Zirve/Logo uyumlu fiş CSV</Button>
          </div>
        </Card>

        <Card title="KDV beyanname ön analizi">
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
            Ay bazında hesaplanan ve indirilecek KDV; iadeler ve tevkifat beyannamedeki yerinde. ÖTV, ÖİV ve stopaj için{" "}
            <a href="/panel/raporlar/kdv-disi-vergiler">KDV dışı vergiler raporu</a>.
          </p>
          <form onSubmit={kdvHesapla} className="row-tight" style={{ alignItems: "flex-end", gap: "0.75rem", marginBottom: "1rem" }}>
            <Field label="Yıl"><Input type="number" value={kdvDonem.yil} onChange={(e) => setKdvDonem({ ...kdvDonem, yil: Number(e.target.value) })} style={{ width: "6rem" }} /></Field>
            <Field label="Ay"><Input type="number" min={1} max={12} value={kdvDonem.ay} onChange={(e) => setKdvDonem({ ...kdvDonem, ay: Number(e.target.value) })} style={{ width: "4.5rem" }} /></Field>
            <Button type="submit" variant="primary" disabled={kdvYukleniyor}>{kdvYukleniyor ? "Sorgulanıyor..." : "Sorgula"}</Button>
          </form>

          {kdvOzet && (
            <div className="invoice-summary">
              <h4>{kdvDonem.yil} / {String(kdvDonem.ay).padStart(2, "0")} · TL, fatura kuruyla</h4>
              <div className="invoice-summary__line"><strong>Hesaplanan KDV</strong><strong>{tl(kdvOzet.hesaplananKdv)}</strong></div>
              {alt("Satışlar (tevkifatta satıcı payı)", kdvOzet.satisKdv, true)}
              {alt("Alıştan iade faturaları", kdvOzet.alistanIadeKdv)}
              <div className="invoice-summary__line"><strong>İndirilecek KDV</strong><strong>{tl(kdvOzet.indirilecekKdv)}</strong></div>
              {alt("Alışlar (tevkifatlı dahil tamamı)", kdvOzet.alisKdv, true)}
              {alt("Satıştan iadeler", kdvOzet.satistanIadeKdv)}
              {kdvOzet.ihracKayitliAlisKdv > 0 && <div className="invoice-summary__line"><span>İhraç kayıtlı alış KDV&apos;si (indirilmez)</span><span>{tl(kdvOzet.ihracKayitliAlisKdv)}</span></div>}
              {kdvOzet.ihracKayitliSatisKdv > 0 && <div className="invoice-summary__line"><span>İhraç kayıtlı satış KDV&apos;si (tahsil edilmez)</span><span>{tl(kdvOzet.ihracKayitliSatisKdv)}</span></div>}
              <div className="invoice-summary__line is-grand">
                <span>{kdvOzet.odenecekKdv > 0 ? "Tahmini ödenecek KDV" : "Sonraki döneme devreden KDV"}</span>
                <span>{tl(kdvOzet.odenecekKdv > 0 ? kdvOzet.odenecekKdv : kdvOzet.devredenKdv)}</span>
              </div>
              {/* KDV tevkifatı KDV-1'de değil: kestiğimiz KDV-2 ile ödenir, alıcının kestiğini o beyan eder. */}
              {kdvOzet.kestigimizTevkifat > 0 && <div className="invoice-summary__line is-discount"><span>Kestiğimiz KDV tevkifatı — KDV-2 ile ayrıca ödenir</span><span>{tl(kdvOzet.kestigimizTevkifat)}</span></div>}
              {kdvOzet.aliciTevkifati > 0 && <div className="invoice-summary__line"><small>Alıcıların kestiği tevkifat (alıcı beyan eder)</small><small>{tl(kdvOzet.aliciTevkifati)}</small></div>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
