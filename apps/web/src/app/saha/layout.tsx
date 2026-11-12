"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SahaSaglayici, useSaha } from "./saha-baglam";

/** SAH-01: telefon için sade kabuk; panelin kenar çubuğu yoktur. */
export default function SahaDuzeni({ children }: { children: React.ReactNode }) {
  return (
    <SahaSaglayici>
      <div className="saha">
        <SahaBaslik />
        <main className="saha__icerik">{children}</main>
      </div>
    </SahaSaglayici>
  );
}

function SahaBaslik() {
  const { cevrimici, kuyruk } = useSaha();
  const yol = usePathname();
  const bekleyen = kuyruk.length;
  return (
    <header className="saha__baslik">
      {yol === "/saha" ? <Link href="/panel">Panel</Link> : <Link href="/saha" aria-label="Saha ana sayfası">← Saha</Link>}
      <strong>TekirExtra Saha</strong>
      <span className={`saha__durum ${cevrimici ? "is-cevrimici" : "is-cevrimdisi"}`} role="status">
        {cevrimici ? "Çevrimiçi" : "Çevrimdışı"}{bekleyen ? ` · ${bekleyen} bekliyor` : ""}
      </span>
    </header>
  );
}
