"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card } from "@/components/ui";

interface Ozellik { anahtar: string; ad: string; aciklama: string; firmadaKapali: boolean; platformdaDurduruldu: boolean }

/**
 * AI-109: firmada yapay zekâ özelliklerini tek tek kapatma. Platform ekibinin acil
 * durdurduğu özellik burada açık görünse de çalışmaz; rozetle belirtilir.
 */
export function YzOzelliklerKart() {
  const [ozellikler, setOzellikler] = useState<Ozellik[] | null>(null);
  const [kapali, setKapali] = useState<Set<string>>(new Set());
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const uygula = (liste: Ozellik[]) => {
    setOzellikler(liste);
    setKapali(new Set(liste.filter((o) => o.firmadaKapali).map((o) => o.anahtar)));
  };

  const yukle = useCallback(async () => {
    try {
      uygula((await api<{ ozellikler: Ozellik[] }>("/ai/ayarlar/ozellikler")).ozellikler);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Özellikler yüklenemedi.");
    }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const degisti = ozellikler?.some((o) => o.firmadaKapali !== kapali.has(o.anahtar)) ?? false;

  async function kaydet() {
    setKaydediliyor(true); setHata(""); setBasari("");
    try {
      const r = await api<{ ozellikler: Ozellik[] }>("/ai/ayarlar/ozellikler", { method: "PUT", body: JSON.stringify({ kapaliOzellikler: [...kapali] }) });
      uygula(r.ozellikler);
      setBasari("Yapay zekâ özellikleri kaydedildi. Kapatılan özelliklerde bekleyen onaylar ve kuyruktaki işler korunur.");
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <Card title="Yapay zekâ özellikleri">
      <p className="muted" style={{ marginTop: 0 }}>
        Firmanızda kullanılmasını istemediğiniz özellikleri kapatın. Kapalı özellik çağrıldığında kullanıcıya nedeni söylenir;
        bekleyen onaylar ve kuyruktaki işler silinmez, özellik açılınca sürer.
      </p>
      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}
      {!ozellikler ? <p className="muted">Yükleniyor…</p> : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {ozellikler.map((o) => (
            <label key={o.anahtar} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={!kapali.has(o.anahtar)}
                disabled={kaydediliyor}
                onChange={(e) => setKapali((k) => { const y = new Set(k); if (e.target.checked) y.delete(o.anahtar); else y.add(o.anahtar); return y; })}
                aria-describedby={`yz-ozellik-${o.anahtar}`}
              />
              <span>
                <strong>{o.ad}</strong>{" "}
                {o.platformdaDurduruldu && <Badge variant="warning">Platformda geçici olarak durduruldu</Badge>}
                <br />
                <span id={`yz-ozellik-${o.anahtar}`} className="muted">{o.aciklama}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
        <Button variant="primary" onClick={() => void kaydet()} disabled={!degisti || kaydediliyor}>
          {kaydediliyor ? "Kaydediliyor…" : "Özellikleri kaydet"}
        </Button>
      </div>
    </Card>
  );
}
