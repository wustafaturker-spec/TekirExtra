"use client";

import Link from "next/link";
import { RaporPaneli } from "@/components/rapor-paneli";
import { stil } from "@/lib/stil";

export default function FaturaRaporlariSayfasi() {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>📄 Fatura Raporları</h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
            Dönemsel özet, kâr marjı, iskonto analizi, KDV dökümü, iade oranları ve taslaklar.
          </p>
        </div>
        <Link href="/panel/fatura" style={{ ...stil.dugmeMuted, padding: "0.5rem 1rem", textDecoration: "none" }}>
          ← Faturalar
        </Link>
      </div>
      <RaporPaneli modul="fatura" />
    </div>
  );
}
