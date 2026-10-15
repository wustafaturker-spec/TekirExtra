"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Card, Button } from "@/components/ui";

interface Kalite {
  toplam: number; sinirli: boolean;
  modeller: Array<{ saglayici: string; model: string; dogru: number; yanlis: number; eksik: number }>;
  araclar: Array<{ arac: string; dogru: number; yanlis: number; eksik: number }>;
}
export function YzKaliteKart() {
  const [veri, setVeri] = useState<Kalite | null>(null);
  const [hata, setHata] = useState("");
  const yukle = async () => { setHata(""); try { setVeri(await api<Kalite>("/ai/kalite")); } catch(e) { setHata(e instanceof Error ? e.message : "Yüklenemedi"); } };
  useEffect(() => { void yukle(); }, []);
  return <Card title="AI yanıt kalitesi — son 30 gün">
    {hata && <Alert tone="error">{hata}</Alert>}
    <p>{veri ? `${veri.toplam} değerlendirme` : "Yükleniyor…"}{veri?.sinirli ? " (en son 1.000 değerlendirme)" : ""}</p>
    {veri?.modeller.map((m) => <p key={JSON.stringify([m.saglayici, m.model])}>{m.saglayici} / {m.model}: {m.dogru} doğru · {m.yanlis} yanlış · {m.eksik} eksik</p>)}
    {!!veri?.araclar.length && <p className="muted">Araç sayıları, o aracı kullanan yanıtların değerlendirmesidir.</p>}
    {veri?.araclar.map((a) => <p key={a.arac}>{a.arac}: {a.dogru} doğru · {a.yanlis} yanlış · {a.eksik} eksik</p>)}
    <Button variant="ghost" onClick={() => void yukle()}>Yenile</Button>
  </Card>;
}
