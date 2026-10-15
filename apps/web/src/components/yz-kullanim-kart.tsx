"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Stat, StatGrid } from "@/components/ui";

interface Kullanim {
  gunlukSinir: number;
  bugunToplam: number;
  gunler: Array<{ gun: string; ozellik: string; cagri: number }>;
  telemetri: Array<{ kullanici: string; ozellik: string; saglayici: string; model: string | null; basarili: boolean; cagri: number; ortalamaSureMs: number; girisToken: number; cikisToken: number; maliyetUsd: number | null }>;
  telemetriAyarlari: { saklamaGun: number; sohbetSaklamaGun: number | null; hataEsigiYuzde: number; gecikmeEsigiMs: number };
  maliyetButcesi: { paraBirimi: "USD"; ayBaslangici: string; buAyUsd: number | null; aylikUsd: number | null; girisMilyonTokenUsd: number | null; cikisMilyonTokenUsd: number | null; tahminUyarisi: string };
}

const OZELLIK_ADI: Record<string, string> = { asistan: "Asistan", tarama: "Tarama", ozet: "Özet yorumu", gorev: "Görev", ekstre: "Ekstre önerisi", hatirlatma: "Hatırlatma metni" };

/** AI-15: günlük model çağrısı sınırı ve son 30 günün kullanımı. */
export function YzKullanimKart() {
  const [veri, setVeri] = useState<Kullanim | null>(null);
  const [sinir, setSinir] = useState("");
  const [saklamaGun, setSaklamaGun] = useState("90");
  const [sohbetSaklamaGun, setSohbetSaklamaGun] = useState("");
  const [hataEsigi, setHataEsigi] = useState("20");
  const [gecikmeEsigi, setGecikmeEsigi] = useState("10000");
  const [girisFiyati, setGirisFiyati] = useState("");
  const [cikisFiyati, setCikisFiyati] = useState("");
  const [aylikButce, setAylikButce] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  const [basari, setBasari] = useState<string | null>(null);

  const yukle = () => api<Kullanim>("/ai/kullanim").then((v) => {
    setVeri(v); setSinir(String(v.gunlukSinir));
    setSaklamaGun(String(v.telemetriAyarlari.saklamaGun)); setHataEsigi(String(v.telemetriAyarlari.hataEsigiYuzde)); setGecikmeEsigi(String(v.telemetriAyarlari.gecikmeEsigiMs));
    setSohbetSaklamaGun(v.telemetriAyarlari.sohbetSaklamaGun == null ? "" : String(v.telemetriAyarlari.sohbetSaklamaGun));
    setGirisFiyati(v.maliyetButcesi.girisMilyonTokenUsd === null ? "" : String(v.maliyetButcesi.girisMilyonTokenUsd));
    setCikisFiyati(v.maliyetButcesi.cikisMilyonTokenUsd === null ? "" : String(v.maliyetButcesi.cikisMilyonTokenUsd));
    setAylikButce(v.maliyetButcesi.aylikUsd === null ? "" : String(v.maliyetButcesi.aylikUsd));
  }).catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi"));
  useEffect(() => { void yukle(); }, []);

  async function kaydet() {
    setHata(null); setBasari(null);
    try {
      await api("/ai/ayarlar", { method: "PUT", body: JSON.stringify({
        gunlukCagriSiniri: Number(sinir), telemetriSaklamaGun: Number(saklamaGun),
        sohbetSaklamaGun: sohbetSaklamaGun === "" ? null : Number(sohbetSaklamaGun),
        telemetriHataEsigiYuzde: Number(hataEsigi), telemetriGecikmeEsigiMs: Number(gecikmeEsigi),
        girisTokenMilyonUsd: girisFiyati === "" ? null : Number(girisFiyati),
        cikisTokenMilyonUsd: cikisFiyati === "" ? null : Number(cikisFiyati),
        aylikMaliyetButcesiUsd: aylikButce === "" ? null : Number(aylikButce),
      }) });
      setBasari("Kullanım ve telemetri politikası kaydedildi.");
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Kaydedilemedi");
    }
  }

  const gunler = [...new Set((veri?.gunler ?? []).map((g) => g.gun))];
  const ozellikToplam = Object.entries((veri?.gunler ?? []).reduce<Record<string, number>>((t, g) => ({ ...t, [g.ozellik]: (t[g.ozellik] ?? 0) + g.cagri }), {}));
  const telemetri = veri?.telemetri ?? [];
  const izToplam = telemetri.reduce((t, x) => t + x.cagri, 0);
  const hataToplam = telemetri.filter((x) => !x.basarili).reduce((t, x) => t + x.cagri, 0);
  const agirlikliSure = izToplam ? Math.round(telemetri.reduce((t, x) => t + x.ortalamaSureMs * x.cagri, 0) / izToplam) : 0;
  const tokenToplam = telemetri.reduce((t, x) => t + x.girisToken + x.cikisToken, 0);
  const para = (tutar: number | null) => tutar === null ? "Fiyat tanımlı değil" : tutar.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const maliyet = veri?.maliyetButcesi;
  const buAyMaliyet = maliyet?.buAyUsd ?? null;
  const butceAsildi = maliyet?.aylikUsd !== null && maliyet?.aylikUsd !== undefined && buAyMaliyet !== null && buAyMaliyet >= maliyet.aylikUsd;
  return (
    <Card title="Kullanım ve günlük sınır">
      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}
      <StatGrid>
        <Stat label="Bugün" value={`${veri?.bugunToplam ?? 0} / ${veri?.gunlukSinir ?? "—"}`} hint="model çağrısı" tone={veri && veri.bugunToplam >= veri.gunlukSinir ? "danger" : "default"} />
        <Stat label="Son 30 gün" value={(veri?.gunler ?? []).reduce((t, g) => t + g.cagri, 0)} hint={`${gunler.length} gün kullanıldı`} />
        <Stat label="Başarı oranı" value={izToplam ? `%${Math.round(((izToplam - hataToplam) / izToplam) * 100)}` : "—"} hint={`${hataToplam} başarısız / ${izToplam} izlenen`} tone={hataToplam > 0 ? "danger" : "default"} />
        <Stat label="Ortalama yanıt" value={izToplam ? `${agirlikliSure} ms` : "—"} hint="son 30 gün" />
        <Stat label="Token" value={tokenToplam.toLocaleString("tr-TR")} hint="giriş + çıkış" />
        <Stat label="Bu ay tahmini maliyet" value={buAyMaliyet === null && maliyet && maliyet.girisMilyonTokenUsd !== null && maliyet.cikisMilyonTokenUsd !== null ? "Henüz ölçüm yok" : para(buAyMaliyet)} hint={maliyet?.aylikUsd != null ? `Aylık bütçe ${para(maliyet.aylikUsd)}` : "USD fiyatları girilince hesaplanır"} tone={butceAsildi ? "danger" : "default"} />
        {ozellikToplam.map(([ozellik, cagri]) => <Stat key={ozellik} label={OZELLIK_ADI[ozellik] ?? ozellik} value={cagri} hint="son 30 gün" />)}
      </StatGrid>
      <form className="row-tight yz-kullanim__form" onSubmit={(e) => { e.preventDefault(); void kaydet(); }}>
        <Field label="Günlük çağrı sınırı (kiracı)"><Input max={100000} min={1} onChange={(e) => setSinir(e.target.value)} type="number" value={sinir} /></Field>
        <Field label="Telemetri saklama (gün)"><Input max={365} min={7} onChange={(e) => setSaklamaGun(e.target.value)} type="number" value={saklamaGun} /></Field>
        <Field label="Sohbet saklama (gün; boş = kapalı)"><Input max={365} min={7} onChange={(e) => setSohbetSaklamaGun(e.target.value)} type="number" value={sohbetSaklamaGun} /></Field>
        <Field label="Hata oranı uyarısı (%)"><Input max={100} min={1} onChange={(e) => setHataEsigi(e.target.value)} type="number" value={hataEsigi} /></Field>
        <Field label="Gecikme uyarısı (ms)"><Input max={120000} min={500} step={100} onChange={(e) => setGecikmeEsigi(e.target.value)} type="number" value={gecikmeEsigi} /></Field>
        <Field label="Giriş fiyatı (USD / 1M token)"><Input min={0} step="any" onChange={(e) => setGirisFiyati(e.target.value)} type="number" value={girisFiyati} /></Field>
        <Field label="Çıkış fiyatı (USD / 1M token)"><Input min={0} step="any" onChange={(e) => setCikisFiyati(e.target.value)} type="number" value={cikisFiyati} /></Field>
        <Field label="Aylık bütçe izleme eşiği (USD)"><Input min={0} step="0.01" onChange={(e) => setAylikButce(e.target.value)} type="number" value={aylikButce} /></Field>
        <Button type="submit">Kaydet</Button>
      </form>
      <p className="muted">Sohbet temizliği etkinse süresi geçen mesajlar ve kullanılmayan oturumlar saatlik bakımda kalıcı silinir; sonuçlanmış işlem onayları karar tarihinden 90 gün sonra temizlenir. İşlemdeki mesajlar ve açık onaylar korunur. Tamamlanmış istek yanıtları 7 gün saklanır. Aktarım onayı denetim kayıtları bu temizliğe dahil değildir. Aylık bütçe açıksa mevcut ayın maliyet izleri korunur.</p>
      <p className="muted">Fiyatlar bu tenant’ın seçili sağlayıcı/modeli için yönetici tarafından girilir. Tahmin sağlayıcı faturasıyla birebir mutabakat değildir. Bütçe eşiği izleme amaçlıdır; çağrıları otomatik durdurmaz.</p>
      {telemetri.some((x) => x.maliyetUsd !== null) && <div className="yz-kullanim__maliyetler" aria-label="Kullanıcı ve özellik maliyetleri">
        {telemetri.filter((x) => x.maliyetUsd !== null).map((x, i) => <p key={`${x.kullanici}-${x.ozellik}-${x.saglayici}-${x.model}-${i}`}>
          {x.kullanici} · {OZELLIK_ADI[x.ozellik] ?? x.ozellik} · {x.saglayici}{x.model ? ` / ${x.model}` : ""}: <strong>{para(x.maliyetUsd)}</strong>
        </p>)}
      </div>}
    </Card>
  );
}
