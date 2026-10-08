"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Badge, Button, Card, PageHeader, Stat, StatGrid, Table } from "@/components/ui";

type Tur = "kart" | "depo" | "varyant" | "varyant_depo";
interface Fark { tur: Tur; stokId: string; kod: string; ad: string; depo: string | null; varyant: string | null; kayitli: string; hareket: string; fark: string }
interface Denetim { farklar: Fark[]; dagitilmamis: { stokId: string; kod: string; ad: string; miktar: string }[]; kartSayisi: number }
const TUR: Record<Tur, string> = { kart: "Kart toplamı", depo: "Depo bakiyesi", varyant: "Varyant toplamı", varyant_depo: "Varyant depo bakiyesi" };
const sayi = (v: string) => Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

/** STK-24: kayıtlı stok bakiyelerinin hareket toplamıyla uyumu; yönetici farkları onarır. */
export default function StokTutarlilikSayfasi() {
  const [denetim, setDenetim] = useState<Denetim | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(async () => {
    try { setHata(null); setDenetim(await api<Denetim>("/stok/tutarlilik")); }
    catch (e) { setHata(e instanceof ApiHata && e.durum === 403 ? "Bu denetim yalnız yönetici rolüne açıktır." : e instanceof Error ? e.message : "Denetim yapılamadı"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const onar = async () => {
    if (!denetim?.farklar.length) return;
    if (!window.confirm(`${denetim.farklar.length} bakiye hareket toplamına eşitlenecek. Hareket yazılmaz, ortalama maliyet değişmez; işlem denetim kaydına geçer. Devam edilsin mi?`)) return;
    try {
      setIsleniyor(true); setHata(null);
      const r = await api<{ duzeltilen: number }>("/stok/tutarlilik/onar", { method: "POST", body: "{}" });
      setBilgi(`${r.duzeltilen} bakiye düzeltildi.`);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Onarım yapılamadı"); }
    finally { setIsleniyor(false); }
  };

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/stok">← Stok kartları</Link>
      <PageHeader
        title="Stok tutarlılık denetimi"
        subtitle="Kart, depo ve varyant bakiyeleri stok hareketlerinin toplamıyla karşılaştırılır. Fark, eşzamanlı işlemlerin birbirini ezdiği eski kayıtlardan kalır; onarım bakiyeyi hareket toplamına eşitler."
        actions={<>
          <Button onClick={() => void yukle()}>Yeniden denetle</Button>
          <Button variant="primary" disabled={isleniyor || !denetim?.farklar.length} onClick={() => void onar()}>{isleniyor ? "Onarılıyor…" : "Farkları onar"}</Button>
        </>}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{bilgi}</Alert>
      {denetim && <>
        <StatGrid>
          <Stat label="Denetlenen kart" value={denetim.kartSayisi} hint="Kiracıdaki bütün stok kartları" />
          <Stat label="Farklı bakiye" value={denetim.farklar.length} hint={denetim.farklar.length ? "Onarım bekliyor" : "Bütün bakiyeler hareketlerle uyumlu"} tone={denetim.farklar.length ? "accent" : undefined} />
          <Stat label="Varyantsız hareketli kart" value={denetim.dagitilmamis.length} hint="Varyantlı kartta varyanta bağlanmamış hareket" />
        </StatGrid>
        <Card title="Farklar" pad={false}>
          <Table>
            <thead><tr><th>Ürün</th><th>Bakiye</th><th>Depo / varyant</th><th className="num">Kayıtlı</th><th className="num">Hareket toplamı</th><th className="num">Fark</th></tr></thead>
            <tbody>
              {denetim.farklar.map((f, i) => (
                <tr key={`${f.tur}-${f.stokId}-${f.depo}-${f.varyant}-${i}`}>
                  <td><Link href={`/panel/stok/${f.stokId}`}><strong>{f.kod}</strong></Link> <span className="muted">{f.ad}</span></td>
                  <td><Badge variant="warning">{TUR[f.tur]}</Badge></td>
                  <td>{[f.depo, f.varyant].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="num">{sayi(f.kayitli)}</td>
                  <td className="num">{sayi(f.hareket)}</td>
                  <td className="num"><strong>{Number(f.fark) > 0 ? "+" : ""}{sayi(f.fark)}</strong></td>
                </tr>
              ))}
              {!denetim.farklar.length && <tr><td className="muted" colSpan={6}>Fark yok.</td></tr>}
            </tbody>
          </Table>
        </Card>
        {denetim.dagitilmamis.length > 0 && (
          <Card title="Varyanta bağlanmamış hareketler" pad={false}>
            <p className="muted" style={{ margin: "0 1.1rem 0.75rem" }}>Bu kartların toplamı varyant toplamından ayrışır; onarım bunlara dokunmaz. Eski hareketler ilgili varyanta elle düzeltme fişiyle taşınmalıdır.</p>
            <Table>
              <thead><tr><th>Ürün</th><th className="num">Varyantsız hareket toplamı</th></tr></thead>
              <tbody>{denetim.dagitilmamis.map((d) => <tr key={d.stokId}><td><Link href={`/panel/stok/${d.stokId}`}><strong>{d.kod}</strong></Link> <span className="muted">{d.ad}</span></td><td className="num">{sayi(d.miktar)}</td></tr>)}</tbody>
            </Table>
          </Card>
        )}
      </>}
    </div>
  );
}
