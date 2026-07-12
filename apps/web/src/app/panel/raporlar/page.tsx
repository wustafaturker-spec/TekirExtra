"use client";

import { RaporPaneli } from "@/components/rapor-paneli";

export default function RaporlarSayfasi() {
  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>📈 Raporlar & Analiz</h1>
        <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
          Tüm modüllerin raporları: tarih ve modüle özgü filtreler, kırılım, sıralama,
          Excel dışa aktarım ve kayıtlı görünümler.
        </p>
      </div>
      <RaporPaneli />
    </div>
  );
}
