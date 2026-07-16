"use client";

import { RaporPaneli } from "@/components/rapor-paneli";
import { ButtonLabel, PageHeader } from "@/components/ui";

export default function CariRaporlariSayfasi() {
  return (
    <div>
      <PageHeader
        title="👥 Cari Raporları"
        subtitle="Ekstre, yaşlandırma, satış/alış özeti, tahsilat performansı ve bakiye raporları."
        actions={<ButtonLabel as="a" href="/panel/cari">← Cari Hesaplar</ButtonLabel>}
      />
      <RaporPaneli modul="cari" />
    </div>
  );
}
