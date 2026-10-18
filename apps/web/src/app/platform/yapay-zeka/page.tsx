"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Input, PageHeader, Stat, StatGrid, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

interface Kiraci {
  tenantId: string; unvan: string; saglayici: string; platformAnahtari: boolean;
  kiraciButcesiUsd: number | null; buAyUsd: number; tahminiCagri: number;
  ozelTavanUsd: number | null; uygulananTavanUsd: number | null;
}
interface Ozet {
  ayBaslangici: string; platformSaglayicisi: string | null; varsayilanTavanUsd: number | null;
  fiyat: { giris: number; cikis: number } | null; kiracilar: Kiraci[];
}

const usd = (x: number | null) => x === null ? "—" : x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * AI-31: platform anahtarıyla çalışan kiracıların aylık yapay zekâ tavanı.
 * Kendi anahtarını kullanan kiracının faturası ona gider; tavan uygulanmaz.
 */
export default function PlatformYapayZeka() {
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [girdiler, setGirdiler] = useState<Record<string, string>>({});
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState(false);
  const [arama, setArama] = useState("");

  const yukle = useCallback(async () => {
    const v = await platformApi<Ozet>("/platform/ai/kiracilar");
    setOzet(v);
    setGirdiler(Object.fromEntries(v.kiracilar.map((k) => [k.tenantId, k.ozelTavanUsd === null ? "" : String(k.ozelTavanUsd)])));
  }, []);
  useEffect(() => { if (platformTokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi")); }, [yukle]);

  async function kaydet(k: Kiraci) {
    const deger = girdiler[k.tenantId]?.trim() ?? "";
    setIslem(true); setHata(""); setBasari("");
    try {
      await platformApi(`/platform/ai/kiracilar/${k.tenantId}/tavan`, { method: "PUT", body: JSON.stringify({ aylikTavanUsd: deger === "" ? null : Number(deger) }) });
      setBasari(`${k.unvan}: ${deger === "" ? "özel tavan kaldırıldı, varsayılan geçerli" : `tavan ${usd(Number(deger))}`}.`);
      await yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "Kaydedilemedi"); } finally { setIslem(false); }
  }

  const platformdakiler = ozet?.kiracilar.filter((k) => k.platformAnahtari) ?? [];
  const toplam = platformdakiler.reduce((t, k) => t + k.buAyUsd, 0);
  const aranan = arama.trim().toLocaleLowerCase("tr-TR");
  const gorunen = (ozet?.kiracilar ?? []).filter((k) => !aranan || k.unvan.toLocaleLowerCase("tr-TR").includes(aranan));
  return <>
    <PageHeader title="Yapay zekâ tavanı" subtitle="Kendi API anahtarını girmeyen firmaların yapay zekâ çağrılarını platform öder. Her firmaya aylık USD tavanı konur; tavan dolunca firmanın yapay zekâ özellikleri ay sonuna kadar durur." />
    <Alert tone="error">{hata}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    {ozet && !ozet.fiyat && (ozet.varsayilanTavanUsd !== null || platformdakiler.some((k) => k.ozelTavanUsd !== null)) && <Alert tone="error">Platform token fiyatları (AI_GIRIS_TOKEN_MILYON_USD, AI_CIKIS_TOKEN_MILYON_USD) tanımlı değil: tavanı olan firmalarda maliyet ölçülemediği için yapay zekâ çağrıları durdurulur.</Alert>}
    {ozet && <StatGrid>
      <Stat label="Platform sağlayıcısı" value={ozet.platformSaglayicisi ?? "Tanımlı değil"} />
      <Stat label="Fiyat (USD / 1M token)" value={ozet.fiyat ? `${ozet.fiyat.giris} / ${ozet.fiyat.cikis}` : "Tanımlı değil"} hint="giriş / çıkış" />
      <Stat label="Varsayılan tavan" value={ozet.varsayilanTavanUsd === null ? "Yok" : usd(ozet.varsayilanTavanUsd)} hint="AI_PLATFORM_AYLIK_TAVAN_USD" />
      <Stat label="Bu ay platform maliyeti" value={usd(toplam)} hint={`${ozet.ayBaslangici.slice(0, 7)} · ${platformdakiler.length} firma`} />
    </StatGrid>}
    <Card title="Firmalar" pad={false} actions={<Input aria-label="Firma ara" placeholder="Firma ara" value={arama} onChange={(e) => setArama(e.target.value)} />}>
      <TableWrap>
        <thead><tr><th>Firma</th><th>Anahtar</th><th>Bu ay</th><th>Uygulanan tavan</th><th>Firma bütçesi</th><th>Özel tavan (USD)</th><th /></tr></thead>
        <tbody>
          {gorunen.map((k) => {
            const dolu = k.uygulananTavanUsd !== null && k.buAyUsd >= k.uygulananTavanUsd;
            return <tr key={k.tenantId}>
              <td>{k.unvan}</td>
              <td>{k.platformAnahtari ? <Badge variant="info">Platform</Badge> : <Badge variant="neutral">{k.saglayici === "varsayilan" ? "Yapay zekâ yok" : `Kendi (${k.saglayici})`}</Badge>}</td>
              <td>{usd(k.buAyUsd)}{k.tahminiCagri ? <span className="muted"> · {k.tahminiCagri} tahmini</span> : null}</td>
              <td>{k.platformAnahtari ? <>{usd(k.uygulananTavanUsd)}{dolu && <> <Badge variant="danger">Doldu</Badge></>}{k.uygulananTavanUsd !== null && k.ozelTavanUsd === null && <span className="muted"> · varsayılan</span>}</> : <span className="muted">Uygulanmaz</span>}</td>
              <td>{usd(k.kiraciButcesiUsd)}</td>
              <td><Input aria-label={`${k.unvan} özel tavan`} min={0} step="0.01" type="number" value={girdiler[k.tenantId] ?? ""} placeholder="varsayılan" onChange={(e) => setGirdiler({ ...girdiler, [k.tenantId]: e.target.value })} /></td>
              <td><Button size="sm" variant="primary" disabled={islem || (girdiler[k.tenantId] ?? "") === (k.ozelTavanUsd === null ? "" : String(k.ozelTavanUsd))} onClick={() => void kaydet(k)}>Kaydet</Button></td>
            </tr>;
          })}
          {ozet && !gorunen.length && <tr><td colSpan={7}>Firma yok.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>
    <p className="muted">Özel tavanı boş bırakmak varsayılan tavanı uygular. Firma yöneticisi kendi aylık bütçesini tavanın altında tutabilir; uygulanan sınır ikisinin küçüğüdür. Bütçe uyarıları (%80 ve doldu) firmanın yöneticilerine gider.</p>
  </>;
}
