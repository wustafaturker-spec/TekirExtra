"use client";

import { RaporPaneli } from "@/components/rapor-paneli";
import { ButtonLabel, PageHeader } from "@/components/ui";

export default function FaturaRaporlariSayfasi() {
  return (
    <div>
      <PageHeader
        title="📄 Fatura Raporları"
        subtitle="Dönemsel özet, kâr marjı, iskonto analizi, KDV dökümü, iade oranları ve taslaklar."
        actions={
          <div style={{ display: "flex", gap: "8px" }}>
            <ButtonLabel as="a" href="/panel/fatura/pivot" variant="primary">📊 Detaylı Pivot Tablo</ButtonLabel>
            <ButtonLabel as="a" href="/panel/fatura">← Faturalar</ButtonLabel>
          </div>
        }
      />
      <RaporPaneli modul="fatura" />
    </div>
  );
}
