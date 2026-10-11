"use client";

import { RaporPaneli } from "@/components/rapor-paneli";
import { ButtonLabel, PageHeader } from "@/components/ui";

/** RPR-09: ÖTV, ÖİV, konaklama, stopaj vb. — tahsil edilen, ödenen ve stopajlar. */
export default function KdvDisiVergilerSayfasi() {
  return (
    <div>
      <PageHeader
        title="KDV Dışı Vergiler"
        subtitle="Kesin satış ve alış faturalarındaki ÖTV, ÖİV, konaklama, stopaj vb. Tahsil edilen vergi beyan edilip ödenir; ödenen vergi maliyete girmiştir; kestiğimiz stopaj muhtasarla beyan edilir; bizden kesilen stopaj mahsup edilir."
        actions={<ButtonLabel as="a" href="/panel/mali-musavir">KDV ön analizi →</ButtonLabel>}
      />
      <RaporPaneli modul="vergi" />
    </div>
  );
}
