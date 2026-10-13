"use client";

import Link from "next/link";
import { AsistanSohbet } from "@/components/asistan-sohbet";

/** Telefonda tam ekran asistan (AI-05); masaüstündeki pencereyle aynı sohbet. */
export default function MobilAsistanSayfasi() {
  return (
    <div className="mobil-asistan">
      <header className="mobil-asistan__baslik">
        <Link href="/panel">← Panel</Link>
        <strong>Asistan</strong>
        <Link href="/panel/ai">Onaylar</Link>
      </header>
      <AsistanSohbet yukseklik="calc(100dvh - 4.5rem)" />
    </div>
  );
}
