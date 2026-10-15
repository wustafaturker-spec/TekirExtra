"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, TableWrap } from "@/components/ui";
interface Toplam { adet: number; dovizler: { doviz: string; tutar: string; adet: number }[] }
interface Analiz { bugun: string; uyari: string; gruplar: { kod: string; ad: string; baslangic: string | null; bitis: string | null; alinan: Toplam; verilen: Toplam }[] }
const metin = (t: Toplam) => `${t.adet} evrak · ${t.dovizler.map((d) => `${d.tutar} ${d.doviz}`).join(" / ") || "—"}`;
export function CekVadeAnalizi({ yenileAnahtari, onFiltre }: { yenileAnahtari: string;
  onFiltre: (yon: "alinan" | "verilen", baslangic: string | null, bitis: string | null) => void }) {
  const [veri, setVeri] = useState<Analiz | null>(null);
  const [hata, setHata] = useState("");
  const [surum, setSurum] = useState(0);
  useEffect(() => {
    let aktif = true; setHata("");
    void api<Analiz>("/kasa-banka/cek-senet-vade-analizi").then((s) => { if (aktif) setVeri(s); })
      .catch((h) => { if (aktif) { setVeri(null); setHata(h instanceof Error ? h.message : "Analiz alınamadı"); } });
    return () => { aktif = false; };
  }, [yenileAnahtari, surum]);
  return <Card style={{ marginTop: "1rem" }}>
    <div className="card__title">Çek/senet vade analizi</div>
    <Button onClick={() => setSurum((s) => s + 1)}>Analizi yenile</Button>
    <Alert tone="error">{hata}</Alert>
    {veri && <>
      <p className="muted">İstanbul iş günü: {veri.bugun}. Tüm açık evraklar; üstteki liste filtrelerinden bağımsızdır.</p>
      <TableWrap><thead><tr><th>Vade aralığı</th><th>Alınan evraklar</th><th>Verilen evraklar</th></tr></thead>
        <tbody>{veri.gruplar.map((g) => <tr key={g.kod}><td>{g.ad}</td>
          <td><Button disabled={!g.alinan.adet} onClick={() => onFiltre("alinan", g.baslangic, g.bitis)}>{metin(g.alinan)}</Button></td>
          <td><Button disabled={!g.verilen.adet} onClick={() => onFiltre("verilen", g.baslangic, g.bitis)}>{metin(g.verilen)}</Button></td>
        </tr>)}</tbody></TableWrap>
      <p className="muted">{veri.uyari}</p>
    </>}
  </Card>;
}
