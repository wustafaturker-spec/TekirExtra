"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { mutlakSapmaMetni, sapmaMetni, type IsabetOlcusu } from "@/lib/tahmin-isabeti";
import { Alert, Card, PageHeader, Stat, StatGrid, Table } from "@/components/ui";

type Guven = "dusuk" | "orta" | "yuksek";
interface Rapor {
  baslangic: string;
  ozet: IsabetOlcusu & {
    tahminsiz: number;
    acik: number;
    guven: Record<Guven, IsabetOlcusu>;
    kaynak: Record<"kesinlesme" | "geriye_donuk", IsabetOlcusu>;
    aylik: ({ ay: string } & IsabetOlcusu)[];
  };
  enCokSapan: ({ cariId: string; unvan: string } & IsabetOlcusu)[];
}

const GUVEN_ADI: Record<Guven, string> = { yuksek: "Yüksek", orta: "Orta", dusuk: "Düşük" };
const ayAdi = (ay: string) => new Date(`${ay}-01T00:00:00Z`).toLocaleDateString("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });

function OlcuSatiri({ ad, o }: { ad: ReactNode; o: IsabetOlcusu }) {
  return (
    <tr>
      <td>{ad}</td>
      <td className="num">{o.ornek}</td>
      <td className="num">{sapmaMetni(o.ortalamaSapma)}</td>
      <td className="num">{mutlakSapmaMetni(o.ortalamaMutlakSapma)}</td>
    </tr>
  );
}

const BASLIK = <thead><tr><th /><th className="num">Fatura</th><th className="num">Ortalama sapma</th><th className="num">Ortalama mutlak sapma</th></tr></thead>;

/** CARI-49: tahmini gecikmenin, kapanan satış faturalarında gerçekleşenle karşılaştırması. */
export default function TahminIsabetiSayfasi() {
  const [rapor, setRapor] = useState<Rapor | null>(null);
  const [hata, setHata] = useState("");

  useEffect(() => {
    api<Rapor>("/rapor/tahmin-isabeti").then(setRapor).catch((e) => setHata(e instanceof Error ? e.message : "Rapor okunamadı"));
  }, []);

  const o = rapor?.ozet;
  return (
    <div className="stack">
      <PageHeader
        title="Tahmin İsabeti"
        subtitle="Satış faturası kesinleşirken gösterilen tahmini gecikme ile faturanın gerçekte kaç gün geç kapandığının karşılaştırması. Sapma = gerçekleşen − tahmin; erken ödeme 0 gün sayılır."
      />
      <Alert tone="error">{hata}</Alert>
      {!rapor && !hata && <p className="muted">Hesaplanıyor…</p>}
      {rapor && o && (
        <>
          <StatGrid>
            <Stat label="Ölçülen fatura" value={o.ornek} hint={`${new Date(`${rapor.baslangic}T00:00:00Z`).toLocaleDateString("tr-TR", { timeZone: "UTC" })} sonrası kapananlar`} />
            <Stat label="Ortalama sapma" value={sapmaMetni(o.ortalamaSapma)} hint="Tahminlerin genel eğilimi" />
            <Stat label="Ortalama mutlak sapma" value={mutlakSapmaMetni(o.ortalamaMutlakSapma)} hint="Bir tahminin tipik hatası" />
            <Stat label="Ölçülemeyen" value={o.tahminsiz + o.acik} hint={`${o.tahminsiz} tahminsiz (veri yetersiz) · ${o.acik} henüz kapanmadı`} />
          </StatGrid>

          {o.ornek === 0 ? (
            <Card><p className="muted">Son 12 ayda tahmini olup tamamen kapanan satış faturası yok.</p></Card>
          ) : (
            <>
              <Card title="Güven düzeyine göre">
                <Table density="compact">{BASLIK}<tbody>{(["yuksek", "orta", "dusuk"] as Guven[]).map((g) => <OlcuSatiri key={g} ad={GUVEN_ADI[g]} o={o.guven[g]} />)}</tbody></Table>
              </Card>
              <Card title="Tahminin kaynağına göre">
                <Table density="compact">{BASLIK}<tbody>
                  <OlcuSatiri ad="Kesinleşmede kaydedilen" o={o.kaynak.kesinlesme} />
                  <OlcuSatiri ad={<>Geriye dönük <span className="muted">(yaklaşık)</span></>} o={o.kaynak.geriye_donuk} />
                </tbody></Table>
                <p className="subtle">Geriye dönük tahmin, kaydı bulunmayan geçmiş faturalar için fatura tarihindeki hareketlerle yeniden üretilmiştir; sonradan düzeltilen kayıtlar yüzünden o gün gösterilenden farklı olabilir.</p>
              </Card>
              <Card title="Kapanış ayına göre">
                <Table density="compact">{BASLIK}<tbody>{o.aylik.map((a) => <OlcuSatiri key={a.ay} ad={ayAdi(a.ay)} o={a} />)}</tbody></Table>
              </Card>
              {rapor.enCokSapan.length > 0 && (
                <Card title="En çok sapan cariler" actions={<small className="muted">En az 3 ölçümü olanlar</small>}>
                  <Table density="compact">{BASLIK}<tbody>{rapor.enCokSapan.map((c) => <OlcuSatiri key={c.cariId} ad={<Link href={`/panel/cari/${c.cariId}`}>{c.unvan}</Link>} o={c} />)}</tbody></Table>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
