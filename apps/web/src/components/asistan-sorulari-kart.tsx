"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Input, Tarih } from "@/components/ui";

interface Soru {
  id: string;
  tur: "banka_satiri" | "eposta_gonderen" | "taslak_kosul" | "masraf_kategori";
  soru: string;
  secenekler: Array<{ kod: string; etiket: string }>;
  serbestYanit: boolean;
  durum: "acik" | "yanitlandi" | "gecersiz";
  sonuc: string | null;
  createdAt: string;
}

const TUR_ADI: Record<Soru["tur"], string> = { banka_satiri: "Banka", eposta_gonderen: "E-posta", taslak_kosul: "Taslak", masraf_kategori: "Masraf" };

/**
 * CNL-09: asistanın emin olmadığı yerde sorduğu sorular. Aynı sorular Telegram'a da gider;
 * hangi kanaldan yanıtlanırsa yanıtlansın bir kez işlenir. Kesin işlem onay talebi açar.
 */
export function AsistanSorulariKarti({ onTalepAcildi }: { onTalepAcildi?: () => void }) {
  const [sorular, setSorular] = useState<Soru[] | null>(null);
  const [metinler, setMetinler] = useState<Record<string, string>>({});
  const [isleniyor, setIsleniyor] = useState<string | null>(null);
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");

  const yukle = useCallback(() => {
    api<Soru[]>("/ai/sorular").then(setSorular).catch((h) => setHata(h instanceof Error ? h.message : "Sorular yüklenemedi"));
  }, []);
  useEffect(yukle, [yukle]);

  async function yanitla(s: Soru, govde: { kod?: string; metin?: string }) {
    setIsleniyor(s.id);
    setHata("");
    setBilgi("");
    try {
      const r = await api<{ sonuc: string; talepId?: string }>(`/ai/sorular/${s.id}/yanit`, { method: "POST", body: JSON.stringify(govde) });
      setBilgi(r.sonuc);
      if (r.talepId) onTalepAcildi?.();
      setMetinler((m) => ({ ...m, [s.id]: "" }));
      yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yanıt işlenemedi");
    } finally {
      setIsleniyor(null);
    }
  }

  if (!sorular) return null;
  const acik = sorular.filter((s) => s.durum === "acik");
  const yanitlanan = sorular.filter((s) => s.durum !== "acik").slice(0, 5);

  return (
    <Card title={<div><span>SORULAR</span><h2>Asistanın sorduğu sorular</h2></div>}>
      {hata && <Alert tone="error">{hata}</Alert>}
      {bilgi && <Alert tone="success">{bilgi}</Alert>}
      {!acik.length && <p className="muted" style={{ marginTop: 0 }}>Yanıt bekleyen soru yok. Asistan emin olmadığı eşleştirmeleri burada (ve bağlıysanız Telegram'da) sorar.</p>}
      <div className="stack">
        {acik.map((s) => (
          <div key={s.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
            <small className="muted"><Badge variant="info">{TUR_ADI[s.tur]}</Badge> <Tarih deger={s.createdAt} saatli /></small>
            <p style={{ whiteSpace: "pre-line", margin: "0.4rem 0" }}>{s.soru}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              {s.secenekler.map((o) => (
                <Button key={o.kod} size="sm" disabled={isleniyor === s.id} onClick={() => void yanitla(s, { kod: o.kod })}>{o.etiket}</Button>
              ))}
              {s.serbestYanit && (
                <form
                  style={{ display: "inline-flex", gap: "0.4rem" }}
                  onSubmit={(e) => { e.preventDefault(); const m = metinler[s.id]?.trim(); if (m) void yanitla(s, { metin: m }); }}
                >
                  <Input
                    aria-label={s.tur === "masraf_kategori" ? "Kategori adı" : "Cari unvanı ya da kodu"}
                    placeholder={s.tur === "masraf_kategori" ? "Kategori adı" : "Cari unvanı ya da kodu"}
                    value={metinler[s.id] ?? ""}
                    onChange={(e) => setMetinler((m) => ({ ...m, [s.id]: e.target.value }))}
                    maxLength={200}
                  />
                  <Button size="sm" type="submit" variant="primary" disabled={isleniyor === s.id || !metinler[s.id]?.trim()}>Yanıtla</Button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
      {!!yanitlanan.length && (
        <details className="mt-1">
          <summary className="muted">Son yanıtlananlar</summary>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
            {yanitlanan.map((s) => <li key={s.id}><small>{s.sonuc ?? s.soru}</small></li>)}
          </ul>
        </details>
      )}
    </Card>
  );
}
