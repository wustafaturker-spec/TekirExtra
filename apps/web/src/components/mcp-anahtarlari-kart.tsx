"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Input, Tarih } from "@/components/ui";

interface Anahtar {
  id: string;
  ad: string;
  onEk: string;
  kullanici: string;
  kendi: boolean;
  createdAt: string;
  sonKullanim: string | null;
  iptalAt: string | null;
}

/** MCP adresi: API mutlak adresse o, değilse web kökü üzerinden (Next yönlendirmesi). */
function mcpAdresi(): string {
  const taban = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
  return /^https?:\/\//.test(taban) ? `${taban}/mcp` : `${window.location.origin}${taban}/mcp`;
}

/**
 * AI-09: kullanıcının kendi adına MCP erişim anahtarları. Anahtar yalnız
 * oluşturulduğu anda gösterilir; sizin yetkinizle çalışır, onay gerektiren
 * işlemler bu sayfadaki onay listesine düşer.
 */
export function McpAnahtarlariKart() {
  const [liste, setListe] = useState<Anahtar[]>([]);
  const [ad, setAd] = useState("");
  const [yeni, setYeni] = useState<{ ad: string; anahtar: string } | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);
  const [adres, setAdres] = useState("");

  const yukle = useCallback(() => {
    api<Anahtar[]>("/ai/mcp-anahtarlari").then(setListe).catch((e) => setHata(e instanceof Error ? e.message : "Anahtarlar yüklenemedi"));
  }, []);
  useEffect(() => { yukle(); setAdres(mcpAdresi()); }, [yukle]);

  async function olustur() {
    setIsleniyor(true);
    setHata(null);
    try {
      const y = await api<{ ad: string; anahtar: string }>("/ai/mcp-anahtarlari", { method: "POST", body: JSON.stringify({ ad }) });
      setYeni(y);
      setAd("");
      yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Anahtar oluşturulamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  async function iptal(id: string) {
    setHata(null);
    try {
      await api(`/ai/mcp-anahtarlari/${id}/iptal`, { method: "POST" });
      yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Anahtar iptal edilemedi");
    }
  }

  const ornekAnahtar = yeni?.anahtar ?? "<anahtarınız>";
  const yapilandirma = JSON.stringify({ mcpServers: { tekirextra: { type: "http", url: adres, headers: { Authorization: `Bearer ${ornekAnahtar}` } } } }, null, 2);

  return (
    <Card title="MCP erişim anahtarları">
      <p className="muted" style={{ marginTop: 0 }}>
        Claude, Cursor gibi MCP istemcileri TekirExtra'ya sizin adınıza ve sizin yetkinizle bağlanır. Onay gerektiren işlemler
        yukarıdaki onay listesine düşer; kayıt silinemez.
      </p>
      {hata && <Alert tone="error">{hata}</Alert>}
      {yeni && (
        <div className="mcp-yeni">
          <Alert tone="warning">“{yeni.ad}” anahtarı yalnız şimdi gösteriliyor; kopyalayın, sonra tekrar görülemez.</Alert>
          <code className="mcp-kod">{yeni.anahtar}</code>
          <div className="row-tight">
            <Button size="sm" onClick={() => void navigator.clipboard?.writeText(yeni.anahtar)}>Anahtarı kopyala</Button>
            <Button size="sm" onClick={() => setYeni(null)}>Kapat</Button>
          </div>
        </div>
      )}
      <form className="row-tight" onSubmit={(e) => { e.preventDefault(); void olustur(); }}>
        <Input aria-label="Anahtar adı" maxLength={60} onChange={(e) => setAd(e.target.value)} placeholder="Anahtar adı (ör. Claude Desktop)" value={ad} />
        <Button disabled={isleniyor || ad.trim().length < 2} type="submit" variant="primary">Anahtar oluştur</Button>
      </form>
      {liste.length > 0 && (
        <ul className="mcp-liste">
          {liste.map((k) => (
            <li key={k.id}>
              <div>
                <strong>{k.ad}</strong> <small className="muted">{k.onEk}{k.kendi ? "" : ` · ${k.kullanici}`}</small>
                <div><small className="muted">Oluşturma <Tarih deger={k.createdAt} /> · son kullanım {k.sonKullanim ? <Tarih deger={k.sonKullanim} saatli /> : "yok"}</small></div>
              </div>
              {k.iptalAt ? <Badge variant="neutral">İptal edildi</Badge> : <Button size="sm" variant="danger" onClick={() => void iptal(k.id)}>İptal et</Button>}
            </li>
          ))}
        </ul>
      )}
      <details className="mcp-ornek">
        <summary>Bağlantı ayarı</summary>
        <p className="muted">Adres: <code>{adres}</code> · Taşıma: HTTP · Kimlik: <code>Authorization: Bearer &lt;anahtar&gt;</code></p>
        <pre className="mcp-kod">{yapilandirma}</pre>
        <pre className="mcp-kod">{`claude mcp add --transport http tekirextra ${adres} --header "Authorization: Bearer ${ornekAnahtar}"`}</pre>
      </details>
    </Card>
  );
}
