"use client";

import { useState } from "react";
import { RefreshCw, Gauge } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Stat, StatGrid, TableWrap } from "@/components/ui";
import { PlatformArama, PlatformListeDurumu } from "@/components/platform-liste";
import { platformApi } from "@/lib/platform-api";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";

interface Kiraci {
  tenantId: string; unvan: string; saglayici: string; platformAnahtari: boolean;
  kiraciButcesiUsd: number | null; buAyUsd: number; tahminiCagri: number;
  ozelTavanUsd: number | null; uygulananTavanUsd: number | null;
}
interface Ozet {
  ayBaslangici: string; platformSaglayicisi: string | null; varsayilanTavanUsd: number | null;
  fiyat: { giris: number; cikis: number } | null; kiracilar: Kiraci[];
}
const usd = (x: number | null) => x === null ? "—" : x.toLocaleString("tr-TR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kayitliDeger = (k: Kiraci) => k.ozelTavanUsd === null ? "" : String(k.ozelTavanUsd);
const gecerliTavan = (s: string) => s.trim() === "" || (Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 1_000_000);
const sinir = (k: Kiraci) => {
  const degerler = [k.platformAnahtari ? k.uygulananTavanUsd : null, k.kiraciButcesiUsd].filter((v): v is number => v !== null);
  return degerler.length ? Math.min(...degerler) : null;
};

/** Platform anahtarı için firma bazında aylık limitler; taslaklar satır bazında korunur. */
export default function PlatformYapayZeka() {
  const { veri: ozet, yukleniyor, hata: listeHatasi, yenile } = usePlatformVerisi<Ozet>("/platform/ai/kiracilar");
  const [girdiler, setGirdiler] = useState<Record<string, string>>({});
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const [filtre, setFiltre] = useState("hepsi");

  async function kaydet(k: Kiraci) {
    if (islem) return;
    const deger = (girdiler[k.tenantId] ?? kayitliDeger(k)).trim();
    if (!gecerliTavan(deger)) { setHata("Aylık tavan 0 ile 1.000.000 USD arasında olmalıdır."); return; }
    setIslem(k.tenantId); setHata(""); setBasari("");
    try {
      await platformApi(`/platform/ai/kiracilar/${encodeURIComponent(k.tenantId)}/tavan`, { method: "PUT", body: JSON.stringify({ aylikTavanUsd: deger === "" ? null : Number(deger) }) });
      setBasari(`${k.unvan}: ${deger === "" ? "özel tavan kaldırıldı, varsayılan geçerli" : `tavan ${usd(Number(deger))}`}.`);
      setGirdiler((v) => { const kalan = { ...v }; delete kalan[k.tenantId]; return kalan; });
      yenile();
    } catch (h) { setHata(h instanceof Error ? h.message : "Kaydedilemedi."); }
    finally { setIslem(null); }
  }

  const platformdakiler = ozet?.kiracilar.filter((k) => k.platformAnahtari) ?? [];
  const toplam = platformdakiler.reduce((t, k) => t + k.buAyUsd, 0);
  const aranan = arama.trim().toLocaleLowerCase("tr-TR");
  const grup = (k: Kiraci) => k.platformAnahtari ? 0 : k.saglayici !== "varsayilan" ? 1 : 2;
  const gorunen = (ozet?.kiracilar ?? []).filter((k) => k.unvan.toLocaleLowerCase("tr-TR").includes(aranan)
    && (filtre === "hepsi" || (filtre === "platform" ? k.platformAnahtari : filtre === "dolu" ? k.platformAnahtari && sinir(k) !== null && k.buAyUsd >= sinir(k)! : !k.platformAnahtari)))
    .sort((a, b) => grup(a) - grup(b) || b.buAyUsd - a.buAyUsd || a.unvan.localeCompare(b.unvan, "tr"));

  return <>
    <PageHeader title="Yapay zekâ tavanı" subtitle="Platformun karşıladığı yapay zekâ kullanımını izleyin ve firmalara aylık USD tavanı belirleyin." actions={<Button disabled={yukleniyor || Boolean(islem)} onClick={yenile}><RefreshCw size={16} aria-hidden="true" />Yenile</Button>} />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    <div className="platform-workflow"><Gauge size={20} aria-hidden="true" /><div><strong>Aylık sınır, bütçe ve tavanın küçüğüdür.</strong><span>Sınır dolunca yapay zekâ çağrıları yeni aya kadar durur. Özel tavanı boş bırakmak varsayılanı uygular; 0 USD kullanımını durdurur.</span></div></div>
    {ozet && !ozet.fiyat && platformdakiler.some((k) => sinir(k) !== null) && <Alert tone="error">Platform token fiyatları tanımlı değil. Aylık sınırı olan firmalarda maliyet ölçülemediği için yapay zekâ çağrıları durdurulur.</Alert>}
    {ozet && <div className="platform-ai-summary"><StatGrid>
      <Stat label="Platform sağlayıcısı" value={ozet.platformSaglayicisi ?? "Tanımlı değil"} />
      <Stat label="Varsayılan aylık tavan" value={ozet.varsayilanTavanUsd === null ? "Tanımlı değil" : usd(ozet.varsayilanTavanUsd)} />
      <Stat label="Bu ay platform maliyeti" value={usd(toplam)} hint={`${ozet.ayBaslangici.slice(0, 7)} · ${platformdakiler.length} firma`} />
      <Stat label="Token fiyatı (1 milyon)" value={ozet.fiyat ? `${usd(ozet.fiyat.giris)} / ${usd(ozet.fiyat.cikis)}` : "Tanımlı değil"} hint="Giriş / çıkış token maliyeti" />
    </StatGrid></div>}
    <Card title="Firma limitleri" pad={false}>
      <div className="platform-filter-bar">
        <PlatformArama etiket="Firma ara" deger={arama} onChange={setArama} placeholder="Firma unvanıyla ara…" />
        <Field label="Kullanım filtresi"><Select value={filtre} onChange={(e) => setFiltre(e.target.value)}><option value="hepsi">Tüm firmalar</option><option value="platform">Platform anahtarı kullananlar</option><option value="dolu">Aylık sınırı dolanlar</option><option value="diger">Kendi anahtarı veya yapay zekâ yok</option></Select></Field>
      </div>
      <div className="platform-list-caption" role="status">{yukleniyor ? "Kullanım bilgileri yükleniyor…" : listeHatasi ? "Liste alınamadı" : `${gorunen.length} firma`}</div>
      <TableWrap className="platform-responsive-table platform-ai-table">
        <thead><tr><th>Firma</th><th>Anahtar</th><th>Bu ay / aylık sınır</th><th>Platform tavanı</th><th>Firma bütçesi</th><th>Özel tavan (USD)</th><th>İşlem</th></tr></thead>
        <tbody>
          {!yukleniyor && !listeHatasi && gorunen.map((k) => {
            const limit = sinir(k);
            const oran = limit === null ? null : limit === 0 ? 100 : Math.min(100, (k.buAyUsd / limit) * 100);
            const dolu = oran !== null && oran >= 100;
            const deger = girdiler[k.tenantId] ?? kayitliDeger(k);
            const gecerli = gecerliTavan(deger);
            return <tr key={k.tenantId}>
              <td data-label="Firma" className="platform-cell-title"><strong>{k.unvan}</strong></td>
              <td data-label="Anahtar"><Badge variant={k.platformAnahtari ? "info" : "neutral"}>{k.platformAnahtari ? "Platform" : k.saglayici === "varsayilan" ? "Yapay zekâ yok" : `Kendi (${k.saglayici})`}</Badge></td>
              <td data-label="Bu ay / aylık sınır"><div>{usd(k.buAyUsd)}{limit !== null && ` / ${usd(limit)}`}</div>{oran !== null && <progress className={`platform-usage${dolu ? " is-full" : ""}`} max={100} value={oran} aria-label={`${k.unvan} aylık limit kullanımı`} />}{dolu ? <Badge variant="danger">Limit doldu</Badge> : oran !== null && oran >= 80 ? <Badge variant="warning">Sınıra yaklaşıyor</Badge> : null}{k.tahminiCagri > 0 && <div className="platform-field-help">{k.tahminiCagri} çağrının maliyeti tahmini</div>}</td>
              <td data-label="Platform tavanı">{k.platformAnahtari ? <>{usd(k.uygulananTavanUsd)}{k.ozelTavanUsd === null && <div className="muted">Varsayılan</div>}</> : <span className="muted">Uygulanmaz</span>}</td>
              <td data-label="Firma bütçesi">{usd(k.kiraciButcesiUsd)}</td>
              <td data-label="Özel tavan (USD)"><Input aria-label={`${k.unvan} özel tavan`} aria-invalid={!gecerli} aria-describedby={!gecerli ? `tavan-hata-${k.tenantId}` : undefined} min={0} max={1000000} step="0.01" type="number" disabled={islem === k.tenantId} value={deger} placeholder="Varsayılan" onChange={(e) => setGirdiler((v) => ({ ...v, [k.tenantId]: e.target.value }))} />{!gecerli && <span id={`tavan-hata-${k.tenantId}`} className="is-negative">0–1.000.000 USD arasında girin.</span>}{!k.platformAnahtari && <div className="platform-field-help">Platform anahtarına geçilince uygulanır.</div>}</td>
              <td data-label="İşlem"><Button size="sm" variant="primary" disabled={Boolean(islem) || !gecerli || deger === kayitliDeger(k)} onClick={() => void kaydet(k)}>{islem === k.tenantId ? "Kaydediliyor…" : "Kaydet"}</Button></td>
            </tr>;
          })}
          <PlatformListeDurumu sutun={7} yukleniyor={yukleniyor} hata={listeHatasi} bos={!gorunen.length} baslik="Eşleşen firma yok." aciklama="Arama metnini veya kullanım filtresini değiştirin." onTekrar={yenile} />
        </tbody>
      </TableWrap>
    </Card>
  </>;
}
