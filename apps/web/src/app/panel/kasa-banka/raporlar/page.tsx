"use client";

import { RaporPaneli } from "@/components/rapor-paneli";
import { ButtonLabel, PageHeader } from "@/components/ui";

export default function KasaBankaRaporlariSayfasi() {
  return (
    <div>
      <PageHeader
        title="🏦 Kasa/Banka Raporları"
        subtitle="Hesap bakiyeleri ve değerleme, tahsilat/ödeme özeti, banka mutabakatı, komisyon giderleri ve hesap bazlı nakit akışı."
        actions={<ButtonLabel as="a" href="/panel/kasa-banka">← Kasa & Banka</ButtonLabel>}
      />
      <RaporPaneli modul="kasa_banka" />
    </div>
  );
}
