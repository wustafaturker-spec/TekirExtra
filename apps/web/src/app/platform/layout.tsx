"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { platformApi, platformTokenAl, platformTokenYaz } from "@/lib/platform-api";

const MENU = [
  { href: "/platform/firmalar", baslik: "Firmalar" },
  { href: "/platform", baslik: "Değişiklikler" },
  { href: "/platform/tablolar", baslik: "Yürürlükteki değerler" },
  { href: "/platform/talepler", baslik: "Talepler" },
  { href: "/platform/denetim", baslik: "Denetim izi" },
  { href: "/platform/yapay-zeka", baslik: "Yapay zekâ tavanı" },
];

/**
 * Mevzuat Merkezi platform paneli (MVZ-04). Kiracı panelinden ayrı bir
 * yerleşimdir; kiracı menüsü, kiracı oturumu ve kiracı verisi burada yoktur.
 */
export default function PlatformYerlesimi({ children }: { children: ReactNode }) {
  const yol = usePathname();
  const yonlendir = useRouter();
  const [eposta, setEposta] = useState<string | null>(null);
  const girisSayfasi = yol === "/platform/giris";

  useEffect(() => {
    if (girisSayfasi) return;
    if (!platformTokenAl()) { yonlendir.replace("/platform/giris"); return; }
    void platformApi<{ eposta: string }>("/platform/auth/ben").then((b) => setEposta(b.eposta)).catch(() => undefined);
  }, [girisSayfasi, yonlendir]);

  if (girisSayfasi) return <>{children}</>;
  return (
    <div className="platform-shell">
      <header className="platform-header">
        <div className="platform-header__brand"><span className="auth-brand-mark">TE</span><strong>Mevzuat Merkezi</strong><span className="muted">Platform paneli</span></div>
        <nav className="platform-header__nav" aria-label="Platform menüsü">
          {MENU.map((m) => <Link key={m.href} href={m.href} className={(m.href === "/platform" ? yol === "/platform" || yol.startsWith("/platform/degisiklik") : yol.startsWith(m.href)) ? "is-active" : undefined}>{m.baslik}</Link>)}
        </nav>
        <div className="row-tight">
          {eposta && <span className="muted">{eposta}</span>}
          <Button size="sm" onClick={() => { platformTokenYaz(null); yonlendir.replace("/platform/giris"); }}>Çıkış</Button>
        </div>
      </header>
      <main className="platform-main">{children}</main>
    </div>
  );
}
