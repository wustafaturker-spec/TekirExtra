"use client";

import { RaporPaneli } from "@/components/rapor-paneli";
import { ButtonLabel, PageHeader } from "@/components/ui";

export default function FaturaRaporlariSayfasi() {
  return (
    <div>
      <PageHeader
        title="📄 Fatura Raporları"
        subtitle="Dönemsel özet, kâr marjı, iskonto analizi, KDV dökümü, iade oranları ve taslaklar."
        actions={<ButtonLabel as="a" href="/panel/fatura">← Faturalar</ButtonLabel>}
      />
      <RaporPaneli modul="fatura" />
    </div>
  );
}
