"use client";

import { RaporPaneli } from "@/components/rapor-paneli";
import { ButtonLabel, PageHeader } from "@/components/ui";

export default function StokRaporlariSayfasi() {
  return (
    <div>
      <PageHeader
        title="📦 Stok Raporları"
        subtitle="Envanter, hareket özeti, satış sıralaması, devir hızı, kârlılık ve kritik stok."
        actions={<ButtonLabel as="a" href="/panel/stok">← Stok Kartları</ButtonLabel>}
      />
      <RaporPaneli modul="stok" />
    </div>
  );
}
