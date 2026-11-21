"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { metinDurumunuSifirla } from "@/components/ai-metin-alani";
import { Alert, Card } from "@/components/ui";

/** AI-115 (g): kullanıcı metin önerilerini kendi hesabından kapatabilir. */
export function AiMetinTercihiKart() {
  const [durum, setDurum] = useState<{ kullanilabilir: boolean; kisiselAcik: boolean } | null>(null);
  const [hata, setHata] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => { api<{ kullanilabilir: boolean; kisiselAcik: boolean }>("/ai/metin/durum").then(setDurum).catch(() => setDurum(null)); }, []);
  if (!durum) return null;

  async function degistir(acik: boolean) {
    setKaydediliyor(true); setHata("");
    try {
      setDurum(await api("/ai/metin/tercih", { method: "PUT", body: JSON.stringify({ acik }) }));
      metinDurumunuSifirla();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <Card className="stack" style={{ marginBottom: "1.5rem" }} title="Yapay zekâ metin önerileri">
      <p className="muted" style={{ margin: 0 }}>
        Açıklama, not ve e-posta alanlarında yazarken gri devam önerisi (Tab ile ekle, Esc ile kapat) ve seçili metni yeniden yazma.
        Öneriler kaydetmez; kaydı siz yaparsınız.
      </p>
      {hata && <Alert tone="error">{hata}</Alert>}
      <label style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="checkbox" checked={durum.kisiselAcik} disabled={kaydediliyor} onChange={(e) => void degistir(e.target.checked)} />
        <span>Metin önerilerini kullan</span>
      </label>
      {durum.kisiselAcik && !durum.kullanilabilir && (
        <p className="muted" style={{ margin: 0 }}>Firmanızda şu anda kullanılamıyor (yapay zekâ ayarı, veri aktarım onayı ya da geçici durdurma).</p>
      )}
    </Card>
  );
}
