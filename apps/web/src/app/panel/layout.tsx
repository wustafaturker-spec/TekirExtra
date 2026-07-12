"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, tokenYaz } from "@/lib/api";
import { stil } from "@/lib/stil";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function cikis() {
    await api("/auth/cikis", { method: "POST" }).catch(() => undefined);
    tokenYaz(null);
    router.push("/giris");
  }

  const linkler = [
    { href: "/panel", baslik: "📊 Finansal Özet", aktif: pathname === "/panel" },
    { href: "/panel/cari", baslik: "👥 Cari Hesaplar", aktif: pathname.startsWith("/panel/cari") },
    { href: "/panel/stok", baslik: "📦 Stok Kartları", aktif: pathname.startsWith("/panel/stok") },
    { href: "/panel/fatura", baslik: "📄 Faturalar", aktif: pathname.startsWith("/panel/fatura") },
    { href: "/panel/kasa-banka", baslik: "🏦 Kasa & Banka", aktif: pathname.startsWith("/panel/kasa-banka") },
    { href: "/panel/raporlar", baslik: "📈 Raporlar & Analiz", aktif: pathname.startsWith("/panel/raporlar") },
    { href: "/panel/ayarlar/entegratorler", baslik: "🔌 e-Belge Ayarları", aktif: pathname.startsWith("/panel/ayarlar") },
  ];

  return (
    <div style={stil.sayfa}>
      <aside style={stil.sidebar}>
        <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#7c3aed" }}>
          🐈 TekirExtra
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1 }}>
          {linkler.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              style={{
                ...stil.sidebarLink,
                ...(l.aktif ? stil.sidebarLinkAktif : {}),
              }}
            >
              {l.baslik}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => void cikis()}
          style={{
            ...stil.dugmeMuted,
            width: "100%",
            textAlign: "center",
          }}
        >
          🚪 Güvenli Çıkış
        </button>
      </aside>
      <main style={{ flex: 1, padding: "2.5rem", boxSizing: "border-box", overflowY: "auto", maxHeight: "100vh" }}>
        {children}
      </main>
    </div>
  );
}
