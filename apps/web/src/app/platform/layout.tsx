"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { platformApi, platformCikis, platformTokenAl } from "@/lib/platform-api";

type PlatformRolu = "yonetici" | "mevzuat_editoru";

/** PLT-06: `yalnizYonetici` sayfaları mevzuat editörüne gösterilmez (API de 403 döner). */
const MENU = [
  { href: "/platform/firmalar", baslik: "Firmalar", yalnizYonetici: true },
  { href: "/platform", baslik: "Değişiklikler" },
  { href: "/platform/tablolar", baslik: "Yürürlükteki değerler" },
  { href: "/platform/talepler", baslik: "Talepler" },
  { href: "/platform/denetim", baslik: "Denetim izi" },
  { href: "/platform/odeme", baslik: "Abonelik ödemesi", yalnizYonetici: true },
  { href: "/platform/sistem-sagligi", baslik: "Sistem sağlığı", yalnizYonetici: true },
  { href: "/platform/yapay-zeka", baslik: "Yapay zekâ tavanı", yalnizYonetici: true },
  { href: "/platform/kullanicilar", baslik: "Kullanıcılar", yalnizYonetici: true },
];

const ROL_ADI: Record<PlatformRolu, string> = { yonetici: "Platform yöneticisi", mevzuat_editoru: "Mevzuat editörü" };

/**
 * Mevzuat Merkezi platform paneli (MVZ-04). Kiracı panelinden ayrı bir
 * yerleşimdir; kiracı menüsü, kiracı oturumu ve kiracı verisi burada yoktur.
 */
export default function PlatformYerlesimi({ children }: { children: ReactNode }) {
  const yol = usePathname();
  const yonlendir = useRouter();
  const [ben, setBen] = useState<{ eposta: string; rol: PlatformRolu } | null>(null);
  // PLT-07: davet sayfası da oturumsuz, panel çerçevesi olmadan açılır.
  const girisSayfasi = yol === "/platform/giris" || yol === "/platform/davet";

  useEffect(() => {
    if (girisSayfasi) return;
    if (!platformTokenAl()) { yonlendir.replace("/platform/giris"); return; }
    void platformApi<{ eposta: string; rol?: PlatformRolu }>("/platform/auth/ben").then((b) => setBen({ eposta: b.eposta, rol: b.rol ?? "yonetici" })).catch(() => undefined);
  }, [girisSayfasi, yonlendir]);

  const editor = ben?.rol === "mevzuat_editoru";
  const menu = MENU.filter((m) => !(editor && m.yalnizYonetici));
  const yasakSayfa = editor && MENU.some((m) => m.yalnizYonetici && yol.startsWith(m.href));
  useEffect(() => {
    if (yasakSayfa) yonlendir.replace("/platform");
  }, [yasakSayfa, yonlendir]);

  if (girisSayfasi) return <>{children}</>;
  return (
    <div className="platform-shell">
      <header className="platform-header">
        <div className="platform-header__brand"><span className="auth-brand-mark">TE</span><strong>Mevzuat Merkezi</strong><span className="muted">Platform paneli</span></div>
        <nav className="platform-header__nav" aria-label="Platform menüsü">
          {menu.map((m) => <Link key={m.href} href={m.href} className={(m.href === "/platform" ? yol === "/platform" || yol.startsWith("/platform/degisiklik") : yol.startsWith(m.href)) ? "is-active" : undefined}>{m.baslik}</Link>)}
        </nav>
        <div className="row-tight">
          {ben && <span className="muted">{ben.eposta} · {ROL_ADI[ben.rol]}</span>}
          <Button size="sm" onClick={() => { void platformCikis().then(() => yonlendir.replace("/platform/giris")); }}>Çıkış</Button>
        </div>
      </header>
      <main className="platform-main">{yasakSayfa ? null : children}</main>
    </div>
  );
}
