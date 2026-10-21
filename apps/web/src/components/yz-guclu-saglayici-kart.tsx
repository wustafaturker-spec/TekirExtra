"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Select, Tarih } from "@/components/ui";

const POLITIKA_SURUMU = "2026-10-v1";

interface Guclu {
  saglayici: string; modelAdi: string | null; baseUrl: string | null; apiKey: string | null; hasApiKey: boolean;
  girisTokenMilyonUsd: number | null; cikisTokenMilyonUsd: number | null; dis: boolean;
  onay: { tarih: string; model: string | null; politikaSurumu: string | null } | null;
}

const SAGLAYICI_ADI: Record<string, string> = { anthropic: "Anthropic Claude", openai: "OpenAI uyumlu", gemini: "Google Gemini", ollama: "Yerel Ollama" };

/**
 * AI-81: isteğe bağlı güçlü sağlayıcı. Asistan ana modelle çalışır; kullanıcı
 * "Derin analiz" seçince o mesaj buraya gider. Kendi anahtarı, fiyatı ve yurt
 * dışı onayı vardır; aylık bütçe ve günlük sınır ana ayarla ortaktır.
 */
export function YzGucluSaglayiciKart() {
  const [guclu, setGuclu] = useState<Guclu | null>(null);
  const [yuklendi, setYuklendi] = useState(false);
  const [form, setForm] = useState({ saglayici: "anthropic", modelAdi: "claude-sonnet-5-5", apiKey: "", baseUrl: "", giris: "", cikis: "" });
  const [hata, setHata] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  function formuDoldur(g: Guclu | null) {
    setGuclu(g);
    if (g) setForm({ saglayici: g.saglayici, modelAdi: g.modelAdi ?? "", apiKey: g.apiKey ?? "", baseUrl: g.baseUrl ?? "", giris: g.girisTokenMilyonUsd?.toString() ?? "", cikis: g.cikisTokenMilyonUsd?.toString() ?? "" });
  }

  useEffect(() => {
    api<{ guclu?: Guclu | null }>("/ai/ayarlar").then((a) => { formuDoldur(a.guclu ?? null); setYuklendi(true); }).catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi"));
  }, []);

  async function islem(fn: () => Promise<void>) {
    setIsleniyor(true); setHata(null); setBilgi(null);
    try { await fn(); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); } finally { setIsleniyor(false); }
  }

  const sayi = (x: string) => (x.trim() ? Number(x.replace(",", ".")) : null);
  const kaydet = () => islem(async () => {
    const r = await api<{ guclu: Guclu | null }>("/ai/ayarlar/guclu", { method: "PUT", body: JSON.stringify({
      saglayici: form.saglayici, modelAdi: form.modelAdi, apiKey: form.apiKey || undefined, baseUrl: form.baseUrl || null,
      girisTokenMilyonUsd: sayi(form.giris), cikisTokenMilyonUsd: sayi(form.cikis),
    }) });
    formuDoldur(r.guclu);
    setBilgi(r.guclu?.dis && !r.guclu.onay ? "Kaydedildi. Derin analiz için aşağıdan veri aktarımı onayı verin." : "Kaydedildi.");
  });
  const kaldir = () => islem(async () => { await api("/ai/ayarlar/guclu", { method: "PUT", body: JSON.stringify({ saglayici: null }) }); formuDoldur(null); setBilgi("Güçlü sağlayıcı kaldırıldı; asistan yalnız ana modeli kullanır."); });
  const sina = () => islem(async () => {
    const r = await api<{ basarili: boolean; model?: string; yanit?: string; mesaj?: string }>("/ai/ayarlar/guclu/test-et", { method: "POST", body: "{}" });
    if (r.basarili) setBilgi(`Bağlantı başarılı (${r.model}): ${r.yanit}`); else setHata(`Bağlantı kurulamadı: ${r.mesaj}`);
  });
  const onayla = (onay: boolean) => islem(async () => {
    const r = await api<{ guclu: Guclu | null }>("/ai/ayarlar/guclu/onay", { method: "POST", body: JSON.stringify({ onay, politikaSurumu: POLITIKA_SURUMU }) });
    formuDoldur(r.guclu);
  });

  return (
    <Card title={<>Güçlü sağlayıcı — Derin analiz {yuklendi && (guclu ? (guclu.dis && !guclu.onay ? <Badge variant="warning">Onay yok</Badge> : <Badge variant="success">Hazır</Badge>) : <Badge>Tanımlı değil</Badge>)}</>}>
      <div className="stack">
        <p className="muted">
          İsteğe bağlı. Asistan her zaman ana modelle çalışır; mesaj kutusundaki <strong>Derin analiz</strong> seçilirse yalnız o mesaj bu sağlayıcıya gider.
          Brifing ve kısa denetimler ekonomik modelde kalır. Bu sağlayıcının kendi anahtarı, token fiyatı ve veri aktarımı onayı vardır; aylık bütçe ve günlük çağrı sınırı ana ayarla ortaktır.
        </p>
        <div className="form-grid form-grid--2">
          <Field label="Sağlayıcı">
            <Select value={form.saglayici} onChange={(e) => setForm({ ...form, saglayici: e.target.value })}>
              {Object.entries(SAGLAYICI_ADI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Model"><Input value={form.modelAdi} maxLength={120} onChange={(e) => setForm({ ...form, modelAdi: e.target.value })} placeholder="ör. claude-sonnet-5-5" /></Field>
          <Field label="API anahtarı"><Input type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={guclu?.hasApiKey ? "Kayıtlı (değiştirmek için yazın)" : "Anahtarı girin"} /></Field>
          <Field label="Adres (isteğe bağlı)"><Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="Varsayılan sağlayıcı adresi" /></Field>
          <Field label="Giriş token fiyatı (USD / 1M)"><Input inputMode="decimal" value={form.giris} onChange={(e) => setForm({ ...form, giris: e.target.value })} /></Field>
          <Field label="Çıkış token fiyatı (USD / 1M)"><Input inputMode="decimal" value={form.cikis} onChange={(e) => setForm({ ...form, cikis: e.target.value })} /></Field>
        </div>
        {hata && <Alert tone="error">{hata}</Alert>}
        {bilgi && <Alert tone="success">{bilgi}</Alert>}
        <div className="row-tight">
          <Button variant="primary" disabled={isleniyor || !form.modelAdi.trim()} onClick={() => void kaydet()}>Kaydet</Button>
          {guclu && <Button disabled={isleniyor} onClick={() => void sina()}>Bağlantıyı sına</Button>}
          {guclu && <Button disabled={isleniyor} variant="danger" onClick={() => void kaldir()}>Kaldır</Button>}
        </div>
        {guclu?.dis && (
          <div className="yz-onay">
            <p>
              <strong>Veri aktarımı onayı ({SAGLAYICI_ADI[guclu.saglayici] ?? guclu.saglayici} / {guclu.modelAdi}).</strong> Derin analiz seçilen mesajda
              sohbet metni, araç sonuçlarındaki cari, stok, fatura ve rapor verileri bu sağlayıcının yurt dışındaki sunucularına gönderilir. Ana sağlayıcının onayından ayrıdır;
              sağlayıcı ya da model değişirse yeniden onay gerekir. Metin sürümü {POLITIKA_SURUMU}.
            </p>
            {guclu.onay && <p>Onay: {guclu.onay.model} · {guclu.onay.politikaSurumu} · <Tarih deger={guclu.onay.tarih} saatli /></p>}
            <div className="row-tight">
              {guclu.onay
                ? <Button disabled={isleniyor} variant="danger" onClick={() => void onayla(false)}>Onayı geri al</Button>
                : <Button disabled={isleniyor} variant="primary" onClick={() => void onayla(true)}>Okudum, aktarımı onaylıyorum</Button>}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
