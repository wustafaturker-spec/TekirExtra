"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Button, Card, Input, PageHeader, Para, Select, Stat, StatGrid, Table } from "@/components/ui";
import { paraBicimle } from "@tekirextra/shared";

type Satir = { personelNo: string; adSoyad: string; departman: string; brutUcret: number; netUcret: number; isverenSgk: number; tesvikIndirimi: number; isverenSgkNet: number; isverenIssizlik: number; isverenMaliyeti: number };
type Rapor = { donem: { yil: number; ay: number }; toplam: { brutUcret: number; netUcret: number; tesvikIndirimi: number; isverenMaliyeti: number }; satirlar: Satir[] };
type Toplam = { brutUcret: number; netUcret: number; tesvikIndirimi: number; isverenMaliyeti: number };

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const BOS: Toplam = { brutUcret: 0, netUcret: 0, tesvikIndirimi: 0, isverenMaliyeti: 0 };
const topla = (xs: Satir[]) => xs.reduce<Toplam>((t, x) => ({ brutUcret: t.brutUcret + x.brutUcret, netUcret: t.netUcret + x.netUcret, tesvikIndirimi: t.tesvikIndirimi + x.tesvikIndirimi, isverenMaliyeti: t.isverenMaliyeti + x.isverenMaliyeti }), BOS);

/** Personel bazında işveren payları ve teşvik etkisi; önceki ayla karşılaştırmalı. */
export default function MaliyetAnalizi() {
  const simdi = new Date();
  const [donem, setDonem] = useState({ yil: simdi.getFullYear(), ay: simdi.getMonth() + 1 });
  const [rapor, setRapor] = useState<Rapor | null>(null);
  const [oncekiRapor, setOncekiRapor] = useState<Rapor | null>(null);
  const [departman, setDepartman] = useState("");
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      setHata("");
      const o = new Date(Date.UTC(donem.yil, donem.ay - 2, 1));
      const [r, onceki] = await Promise.all([
        api<Rapor>(`/personel/raporlar/maliyet?yil=${donem.yil}&ay=${donem.ay}`),
        api<Rapor>(`/personel/raporlar/maliyet?yil=${o.getUTCFullYear()}&ay=${o.getUTCMonth() + 1}`),
      ]);
      setRapor(r); setOncekiRapor(onceki);
    } catch (e) { setHata(e instanceof Error ? e.message : "Maliyet raporu alınamadı"); }
    finally { setYukleniyor(false); }
  }, [donem]);
  useEffect(() => { void yukle(); }, [yukle]);

  const departmanlar = useMemo(() => [...new Set(rapor?.satirlar.map((x) => x.departman) ?? [])].sort((a, b) => a.localeCompare(b, "tr")), [rapor]);
  const satirlar = useMemo(() => rapor?.satirlar.filter((x) => !departman || x.departman === departman) ?? [], [rapor, departman]);
  const toplam = useMemo(() => topla(satirlar), [satirlar]);
  const oncekiToplam = useMemo(() => topla(oncekiRapor?.satirlar.filter((x) => !departman || x.departman === departman) ?? []), [oncekiRapor, departman]);

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel/raporlar">← İK kontrol merkezine dön</Link>
      <PageHeader
        title="İşveren maliyet analizi"
        subtitle="Personel bazında işveren payları ve teşvik etkisini bordro kayıtlarından inceleyin."
        actions={<>
          <Input aria-label="Yıl" type="number" min="2020" max="2100" value={donem.yil} onChange={(e) => setDonem({ ...donem, yil: Number(e.target.value) })} style={{ width: "6rem" }} />
          <Select aria-label="Ay" value={donem.ay} onChange={(e) => setDonem({ ...donem, ay: Number(e.target.value) })} style={{ width: "auto" }}>{AYLAR.map((a, i) => <option key={a} value={i + 1}>{a}</option>)}</Select>
          <Select aria-label="Departman" value={departman} onChange={(e) => setDepartman(e.target.value)} style={{ width: "auto" }}><option value="">Tüm departmanlar</option>{departmanlar.map((x) => <option key={x}>{x}</option>)}</Select>
          <Button variant="primary" onClick={() => void apiDosyaIndir(`/personel/raporlar/maliyet.xlsx?yil=${donem.yil}&ay=${donem.ay}&departman=${encodeURIComponent(departman)}`, `personel-maliyet-${donem.yil}-${String(donem.ay).padStart(2, "0")}.xlsx`)}>Excel indir</Button>
        </>}
      />
      <Alert tone="error">{hata}</Alert>
      {rapor && (
        <StatGrid>
          <Stat label="Toplam işveren maliyeti" value={<Para deger={toplam.isverenMaliyeti} />} hint={oncekiRapor && <Fark guncel={toplam.isverenMaliyeti} onceki={oncekiToplam.isverenMaliyeti} />} tone="accent" />
          <Stat label="Toplam brüt ücret" value={<Para deger={toplam.brutUcret} />} hint={oncekiRapor && <Fark guncel={toplam.brutUcret} onceki={oncekiToplam.brutUcret} />} />
          <Stat label="Toplam net ücret" value={<Para deger={toplam.netUcret} />} hint={oncekiRapor && <Fark guncel={toplam.netUcret} onceki={oncekiToplam.netUcret} />} />
          <Stat label="Teşvik tasarrufu" value={<Para deger={toplam.tesvikIndirimi} />} hint={oncekiRapor && <Fark guncel={toplam.tesvikIndirimi} onceki={oncekiToplam.tesvikIndirimi} artisIyi />} tone="success" />
        </StatGrid>
      )}
      <Card pad={false}>
        <Table>
          <thead><tr><th>Personel</th><th>Departman</th><th className="num">Brüt</th><th className="num">Net</th><th className="num">Brüt SGK işveren</th><th className="num">Teşvik</th><th className="num">Net SGK işveren</th><th className="num">İşsizlik</th><th className="num">Toplam maliyet</th></tr></thead>
          <tbody>
            {satirlar.map((x) => (
              <tr key={x.personelNo}>
                <td><strong>{x.adSoyad}</strong><div className="subtle mono">{x.personelNo}</div></td>
                <td>{x.departman}</td>
                <td className="num"><Para deger={x.brutUcret} /></td>
                <td className="num"><Para deger={x.netUcret} /></td>
                <td className="num"><Para deger={x.isverenSgk} /></td>
                <td className="num"><Para deger={x.tesvikIndirimi ? -x.tesvikIndirimi : 0} isaretle /></td>
                <td className="num"><Para deger={x.isverenSgkNet} /></td>
                <td className="num"><Para deger={x.isverenIssizlik} /></td>
                <td className="num"><strong><Para deger={x.isverenMaliyeti} /></strong></td>
              </tr>
            ))}
            {!satirlar.length && <tr><td className="muted" colSpan={9}>{yukleniyor ? "Rapor hazırlanıyor…" : "Seçilen dönem ve filtre için bordro bulunamadı."}</td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

/** Önceki aya göre fark; maliyet kalemlerinde artış kırmızı, teşvikte yeşil. */
function Fark({ guncel, onceki, artisIyi }: { guncel: number; onceki: number; artisIyi?: boolean }) {
  const d = guncel - onceki;
  const yuzde = onceki ? (d / onceki) * 100 : null;
  const renk = d === 0 ? "var(--text-muted)" : (d > 0) === Boolean(artisIyi) ? "var(--success)" : "var(--danger)";
  return (
    <span title={`Önceki dönem: ${paraBicimle(onceki)}`}>
      <span style={{ color: renk, fontWeight: 600 }}>{d > 0 ? "+" : ""}{paraBicimle(d)}</span>
      {" "}{yuzde === null ? "· önceki ay yok" : `· ${yuzde > 0 ? "+" : ""}${yuzde.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}%`}
    </span>
  );
}
