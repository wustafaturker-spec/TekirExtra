"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { mutlakSapmaMetni, sapmaMetni, type IsabetOlcusu } from "@/lib/tahmin-isabeti";
import { Card, Stat, StatGrid } from "@/components/ui";

/** CARI-49: tahmini gecikmenin kiracı düzeyindeki isabeti (son 12 ay); ayrıntı Raporlar › Tahmin İsabeti. */
export function YzTahminIsabetiKart() {
  const [ozet, setOzet] = useState<(IsabetOlcusu & { tahminsiz: number; acik: number }) | null>(null);
  const [hata, setHata] = useState(false);
  useEffect(() => {
    api<{ ozet: IsabetOlcusu & { tahminsiz: number; acik: number } }>("/rapor/tahmin-isabeti").then((r) => setOzet(r.ozet)).catch(() => setHata(true));
  }, []);
  return (
    <Card title="Gecikme tahmini isabeti" actions={<Link href="/panel/raporlar/tahmin-isabeti">Ayrıntılı rapor →</Link>}>
      <p className="muted">Satış faturası kesinleşirken gösterilen tahmini gecikme, fatura kapandığında gerçekleşenle karşılaştırılır (son 12 ay). Bu tahmin dil modeli değil, cari hareketlerinden hesaplanan kuraldır.</p>
      {hata ? <p className="muted">Ölçüm okunamadı.</p> : !ozet ? <p className="muted">Hesaplanıyor…</p> : (
        <StatGrid>
          <Stat label="Ölçülen fatura" value={ozet.ornek} hint={`${ozet.tahminsiz} tahminsiz · ${ozet.acik} açık`} />
          <Stat label="Ortalama sapma" value={sapmaMetni(ozet.ortalamaSapma)} />
          <Stat label="Ortalama mutlak sapma" value={mutlakSapmaMetni(ozet.ortalamaMutlakSapma)} />
        </StatGrid>
      )}
    </Card>
  );
}
