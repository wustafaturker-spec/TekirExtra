"use client";

import { RaporPaneli } from "@/components/rapor-paneli";
import { PageHeader } from "@/components/ui";

export default function RaporlarSayfasi() {
  return (
    <div>
      <PageHeader
        title="📈 Raporlar & Analiz"
        subtitle="Tüm modüllerin raporları: tarih ve modüle özgü filtreler, kırılım, sıralama, Excel dışa aktarım ve kayıtlı görünümler."
        actions={
          <a role="button" className="btn btn--primary" href="/panel/raporlar/gelir-gider">
            📊 Gelir - Gider Raporu
          </a>
        }
      />
      <RaporPaneli />
    </div>
  );
}
