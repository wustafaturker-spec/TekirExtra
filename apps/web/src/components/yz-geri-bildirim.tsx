"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";

export function YzGeriBildirim({ mesajId, deger, not }: { mesajId?: string; deger?: string | null; not?: string | null }) {
  const [secim, setSecim] = useState(deger);
  const [aciklama, setAciklama] = useState(not ?? "");
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState("");
  if (!mesajId) return null;
  async function kaydet(yeni: string) {
    setBekliyor(true); setHata("");
    try {
      await api(`/ai/ajan/mesajlar/${mesajId}/geri-bildirim`, { method: "POST", body: JSON.stringify({ deger: yeni, not: aciklama }) });
      setSecim(yeni);
    } catch (e) { setHata(e instanceof Error ? e.message : "Kaydedilemedi"); }
    finally { setBekliyor(false); }
  }
  return <details style={{ marginTop: 8, fontSize: 12 }}>
    <summary>Yanıtı değerlendir{secim ? " · Kaydedildi" : ""}</summary>
    <Input aria-label="Değerlendirme notu" placeholder="Düzeltme veya açıklama (isteğe bağlı)" maxLength={500} value={aciklama} onChange={e => setAciklama(e.target.value)} />
    <div className="row-tight" style={{ marginTop: 6 }}>
      {[["dogru", "Doğru"], ["yanlis", "Yanlış"], ["eksik", "Eksik"]].map(([kod, ad]) => <Button key={kod} aria-pressed={secim === kod} disabled={bekliyor} variant={secim === kod ? "primary" : "ghost"} onClick={() => void kaydet(kod)}>{ad}</Button>)}
    </div>
    {hata && <p role="alert">{hata}</p>}
  </details>;
}
