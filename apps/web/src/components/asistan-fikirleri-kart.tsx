"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card } from "@/components/ui";

interface Fikir { id: string; hafta: string; tur: string; baslik: string; metin: string; hedefYol: string; isaret: "yarar" | "yaramaz" | "getirme" | null; createdAt: string }

const ISARET: Record<NonNullable<Fikir["isaret"]>, string> = { yarar: "İşe yarar", yaramaz: "İşe yaramaz", getirme: "Bu konu getirilmeyecek" };

/**
 * CNL-11: haftalık fikirler. Rakamlar dayandığı rapordan hesaplanır; işaret sonraki haftaların
 * seçimini etkiler ve Asistan › Hafıza ekranından geri alınabilir.
 */
export function AsistanFikirleriKarti() {
  const [fikirler, setFikirler] = useState<Fikir[] | null>(null);
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState<string | null>(null);

  const yukle = useCallback(() => {
    api<Fikir[]>("/ai/fikirler").then(setFikirler).catch((h) => setHata(h instanceof Error ? h.message : "Fikirler yüklenemedi"));
  }, []);
  useEffect(yukle, [yukle]);

  async function isaretle(f: Fikir, isaret: NonNullable<Fikir["isaret"]>) {
    setIsleniyor(f.id);
    setHata("");
    try {
      await api(`/ai/fikirler/${f.id}/isaret`, { method: "POST", body: JSON.stringify({ isaret }) });
      yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşaret kaydedilemedi");
    } finally {
      setIsleniyor(null);
    }
  }

  if (!fikirler || !fikirler.length) return null;
  return (
    <Card title={<div><span>FİKİRLER</span><h2>Bu hafta için öneriler</h2></div>}>
      {hata && <Alert tone="error">{hata}</Alert>}
      <p className="muted" style={{ marginTop: 0 }}>Her öneri ilgili raporun rakamlarına dayanır. İşaretiniz sonraki haftaların önerilerini etkiler.</p>
      <div className="stack">
        {fikirler.map((f) => (
          <div key={f.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
            <strong>{f.baslik}</strong> <small className="muted">· {f.hafta}</small>
            <p style={{ margin: "0.35rem 0" }}>{f.metin}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <Link className="btn btn--ghost btn--sm" href={f.hedefYol}>Rapora git</Link>
              {f.isaret ? <Badge variant="neutral">{ISARET[f.isaret]}</Badge> : (
                <>
                  <Button size="sm" disabled={isleniyor === f.id} onClick={() => void isaretle(f, "yarar")}>👍 İşe yarar</Button>
                  <Button size="sm" disabled={isleniyor === f.id} onClick={() => void isaretle(f, "yaramaz")}>👎 İşe yaramaz</Button>
                  <Button size="sm" disabled={isleniyor === f.id} onClick={() => void isaretle(f, "getirme")}>🚫 Bu konuyu getirme</Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
