"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Card, Select, TableWrap } from "@/components/ui";

/**
 * PZR-09: yıllık e-ticaret stopajı özeti. Stopaj gider değil, gelir/kurumlar
 * vergisinden mahsup edilecek peşin vergidir (muhasebede 193); beyanname
 * döneminde mahsup tutarı buradan alınır.
 */
interface Ay { ay: number; kesilen: Record<string, string>; kaydedilenAdet: number; kaydedilenTry: string; bekleyenAdet: number }
interface Ozet { yil: number; aylar: Ay[]; toplam: { kesilen: Record<string, string>; kaydedilenTry: string; kaydedilenAdet: number; bekleyenAdet: number } }

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const para = (v: string | number, d = "TRY") => Number(v).toLocaleString("tr-TR", { style: "currency", currency: d });
const tutarlar = (t: Record<string, string>) => Object.entries(t).map(([d, v]) => para(v, d)).join(" · ") || "—";

export function PazaryeriStopajOzeti({ yenile }: { yenile?: number }) {
  const buYil = new Date().getFullYear();
  const [yil, setYil] = useState(buYil);
  const [ozet, setOzet] = useState<Ozet | null>(null);
  const [hata, setHata] = useState("");

  const yukle = useCallback(async () => {
    try { setOzet(await api<Ozet>(`/pazaryeri/kesintiler/stopaj-ozeti?yil=${yil}`)); setHata(""); }
    catch (e) { setHata(e instanceof Error ? e.message : "Stopaj özeti yüklenemedi"); }
  }, [yil]);
  useEffect(() => { void yukle(); }, [yukle, yenile]);

  const doluAylar = ozet?.aylar.filter((a) => Object.keys(a.kesilen).length) ?? [];
  if (!hata && ozet && !doluAylar.length && yil === buYil) return null;

  return (
    <Card title="E-ticaret stopajı özeti" pad={false}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 1rem" }}>
        <small className="subtle">Stopaj gider değildir; gelir/kurumlar vergisinden mahsup edilecek peşin vergi olarak 193 hesabına kaydedilir. Beyannamede mahsup edilecek tutar kaydedilen toplamdır.</small>
        <Select aria-label="Stopaj özeti yılı" value={String(yil)} onChange={(e) => setYil(Number(e.target.value))} style={{ maxWidth: 120 }}>
          {[buYil, buYil - 1, buYil - 2].map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>
      {hata && <div style={{ padding: "0 1rem 0.75rem" }}><Alert tone="error">{hata}</Alert></div>}
      {ozet && (doluAylar.length ? (
        <TableWrap>
          <thead><tr><th>Ay</th><th>Kesilen</th><th className="num">Kaydedilen (TRY)</th><th className="num">Kaydedilmeyi bekleyen</th></tr></thead>
          <tbody>
            {doluAylar.map((a) => <tr key={a.ay}><td>{AYLAR[a.ay - 1]}</td><td>{tutarlar(a.kesilen)}</td><td className="num">{para(a.kaydedilenTry)} <small>({a.kaydedilenAdet})</small></td><td className="num">{a.bekleyenAdet || "—"}</td></tr>)}
            <tr><td><strong>{ozet.yil} toplamı</strong></td><td><strong>{tutarlar(ozet.toplam.kesilen)}</strong></td><td className="num"><strong>{para(ozet.toplam.kaydedilenTry)}</strong></td><td className="num"><strong>{ozet.toplam.bekleyenAdet || "—"}</strong></td></tr>
          </tbody>
        </TableWrap>
      ) : <div style={{ padding: "0 1rem 0.75rem" }}><small className="subtle">{yil} yılında stopaj kesintisi yok.</small></div>)}
    </Card>
  );
}
