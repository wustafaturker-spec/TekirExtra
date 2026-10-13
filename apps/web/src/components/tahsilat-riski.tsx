"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Card, Para } from "@/components/ui";

export type RiskSeviyesi = "dusuk" | "orta" | "yuksek";

export interface TahsilatOnceligi {
  cariId: string;
  cariUnvan: string;
  kalanTry: number;
  enEskiGecikmeGun: number;
  faturaSayisi: number;
  puan: number;
  risk: RiskSeviyesi;
  riskSkoru: number | null;
  riskKatsayisi: number;
  tahminiGecikmeGun: number | null;
  guven: string | null;
}

const RISK: Record<RiskSeviyesi, { ad: string; tur: "success" | "warning" | "danger" | "neutral" }> = {
  dusuk: { ad: "Düşük risk", tur: "success" },
  orta: { ad: "Orta risk", tur: "warning" },
  yuksek: { ad: "Yüksek risk", tur: "danger" },
};

export function RiskRozeti({ risk }: { risk: RiskSeviyesi }) {
  return <Badge variant={RISK[risk].tur}>{RISK[risk].ad}</Badge>;
}

const gecikmeMetni = (g: number) => (g > 0 ? `${g} gün gecikmiş` : g === 0 ? "bugün vadesi" : `${-g} gün sonra vadesi`);

/**
 * AI-18: "Bugün kimi aramalı". Puan = kalan TL × risk katsayısı × (1 + gecikme/30);
 * risk geçmiş ödemelerden istatistikle hesaplanır (AI-17), dil modeli kullanılmaz.
 */
export function TahsilatOncelikleriKart({ liste }: { liste: TahsilatOnceligi[] | null }) {
  return (
    <Card title="Bugün kimi aramalı">
      <p className="muted tahsilat-oncelik__not">Vadesi geçmiş ya da 7 gün içinde dolacak alacaklar; puan = kalan tutar × risk katsayısı (düşük 1, orta 1,5, yüksek 2) × (1 + gecikme günü / 30). Risk, cari kartındaki ödeme davranışı analizinden gelir.</p>
      {liste === null ? <p className="muted">Yükleniyor…</p> : liste.length === 0 ? <p className="muted">Öncelikli tahsilat yok.</p> : (
        <ol className="tahsilat-oncelik">
          {liste.slice(0, 10).map((x) => (
            <li key={x.cariId}>
              <div>
                <a href={`/panel/cari/${x.cariId}`}><strong>{x.cariUnvan}</strong></a> <RiskRozeti risk={x.risk} />
                <div className="subtle">
                  {x.faturaSayisi} fatura · en eskisi {gecikmeMetni(x.enEskiGecikmeGun)}
                  {x.tahminiGecikmeGun !== null && ` · ortalama ${x.tahminiGecikmeGun} gün geç öder`}
                  {x.riskSkoru !== null && ` · risk skoru ${x.riskSkoru}/100`}
                </div>
              </div>
              <div className="tahsilat-oncelik__tutar">
                <Para deger={x.kalanTry} />
                <small className="muted" title={`katsayı ${x.riskKatsayisi}`}>puan {x.puan.toLocaleString("tr-TR")}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

interface BeklenenOdemeler {
  tahminiGecikmeGun: number | null;
  acikFaturalar: Array<{ faturaId: string; no: string | null; vadeTarihi: string; gecikmeGun: number; kalanTry: number; beklenenOdemeTarihi: string }>;
}

const gun = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * AI-17: cari kartında açık faturaların beklenen ödeme tarihi = vade + ödeme
 * davranışı analizindeki tahmini gecikme. Ayrı risk ölçüsü göstermez; yetkisiz rolde görünmez.
 */
export function BeklenenOdemelerKart({ cariId }: { cariId: string }) {
  const [r, setR] = useState<BeklenenOdemeler | null>(null);
  useEffect(() => { api<BeklenenOdemeler>(`/cari/vade-hatirlatma/risk/${cariId}`).then(setR).catch(() => setR(null)); }, [cariId]);
  if (!r || !r.acikFaturalar.length) return null;
  return (
    <Card title="Açık faturaların beklenen ödeme tarihi">
      <p className="muted tahsilat-oncelik__not">Vade + ödeme davranışı analizindeki tahmini gecikme ({r.tahminiGecikmeGun ?? 0} gün). Tahmindir.</p>
      <ul className="tahsilat-oncelik">
        {r.acikFaturalar.slice(0, 10).map((f) => (
          <li key={f.faturaId}>
            <div><a href={`/panel/fatura?faturaId=${f.faturaId}`}>{f.no ?? "Numarasız"}</a><div className="subtle">vade {gun(f.vadeTarihi)} · {gecikmeMetni(f.gecikmeGun)}</div></div>
            <div className="tahsilat-oncelik__tutar"><Para deger={f.kalanTry} /><small className="muted">beklenen {gun(f.beklenenOdemeTarihi)}</small></div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
