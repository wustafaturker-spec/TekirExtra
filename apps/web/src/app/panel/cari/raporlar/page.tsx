"use client";

import Link from "next/link";
import { RaporPaneli } from "@/components/rapor-paneli";
import { stil } from "@/lib/stil";

export default function CariRaporlariSayfasi() {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>👥 Cari Raporları</h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
            Ekstre, yaşlandırma, satış/alış özeti, tahsilat performansı ve bakiye raporları.
          </p>
        </div>
        <Link href="/panel/cari" style={{ ...stil.dugmeMuted, padding: "0.5rem 1rem", textDecoration: "none" }}>
          ← Cari Hesaplar
        </Link>
      </div>
      <RaporPaneli modul="cari" />
    </div>
  );
}
