"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, tokenAl, tokenYaz } from "@/lib/api";

const ROL_ADI: Record<string, string> = {
  yonetici: "Yönetici",
  muhasebe: "Muhasebe",
  satis: "Satış",
  salt_okunur: "Salt Okunur",
};

interface MenuOge {
  href: string;
  ikon: string;
  baslik: string;
  eslesme?: "tam" | "onek";
}
interface MenuGrup {
  baslik: string;
  ogeler: MenuOge[];
}

const MENU: MenuGrup[] = [
  {
    baslik: "Genel",
    ogeler: [{ href: "/panel", ikon: "📊", baslik: "Finansal Özet", eslesme: "tam" }],
  },
  {
    baslik: "Finansal İşlemler",
    ogeler: [
      { href: "/panel/cari", ikon: "👥", baslik: "Cari Hesaplar" },
      { href: "/panel/belgeler", ikon: "🧾", baslik: "Belgeler", eslesme: "tam" },
      { href: "/panel/fatura", ikon: "📄", baslik: "Faturalar", eslesme: "tam" },
      {
        href: "/panel/fatura/gelen-kutusu",
        ikon: "📥",
        baslik: "Gelen e-Belgeler",
        eslesme: "tam",
      },
      { href: "/panel/kasa-banka", ikon: "🏦", baslik: "Kasa & Banka", eslesme: "tam" },
      { href: "/panel/kasa-banka/cek-senet", ikon: "🧾", baslik: "Çek & Senet", eslesme: "tam" },
      { href: "/panel/kasa-banka/ekstre", ikon: "🏧", baslik: "Banka Ekstresi", eslesme: "tam" },
    ],
  },
  {
    baslik: "Ürün & Stok",
    ogeler: [
      { href: "/panel/stok", ikon: "📦", baslik: "Stok Kartları", eslesme: "tam" },
      { href: "/panel/stok/kategoriler", ikon: "🗂️", baslik: "Kategoriler", eslesme: "tam" },
      { href: "/panel/stok/sayim", ikon: "📋", baslik: "Stok Sayımı", eslesme: "tam" },
      { href: "/panel/stok/fiyat-listeleri", ikon: "🏷️", baslik: "Fiyat Listeleri", eslesme: "tam" },
    ],
  },
  {
    baslik: "Raporlar",
    ogeler: [{ href: "/panel/raporlar", ikon: "📈", baslik: "Raporlar & Analiz" }],
  },
  {
    baslik: "Ayarlar",
    ogeler: [
      { href: "/panel/ayarlar/firma", ikon: "🏢", baslik: "Firma Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/fatura-serileri", ikon: "🔢", baslik: "Fatura Serileri", eslesme: "tam" },
      { href: "/panel/ayarlar/moduller", ikon: "⚙️", baslik: "Modül Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/kullanicilar", ikon: "👤", baslik: "Kullanıcılar", eslesme: "tam" },
      { href: "/panel/ayarlar/entegratorler", ikon: "🔌", baslik: "e-Belge Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/denetim", ikon: "🛡️", baslik: "Denetim İzi", eslesme: "tam" },
      { href: "/panel/ayarlar/hesap", ikon: "🔐", baslik: "Hesap Güvenliği", eslesme: "tam" },
    ],
  },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [rol, setRol] = useState<string | null>(null);

  useEffect(() => {
    if (tokenAl()) {
      api<{ rol: string }>("/auth/ben")
        .then((b) => setRol(b.rol))
        .catch(() => setRol(null));
    }
  }, []);

  async function cikis() {
    await api("/auth/cikis", { method: "POST" }).catch(() => undefined);
    tokenYaz(null);
    router.push("/giris");
  }

  function aktifMi(oge: MenuOge): boolean {
    return oge.eslesme === "tam" ? pathname === oge.href : pathname.startsWith(oge.href);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark">🐈</span>
          <span>Tekir<b>Extra</b></span>
        </div>

        <nav className="nav">
          {MENU.map((grup) => (
            <div className="nav__group" key={grup.baslik}>
              <div className="nav__label">{grup.baslik}</div>
              {grup.ogeler.map((oge) => (
                <Link
                  key={oge.href}
                  href={oge.href}
                  className={`nav__link${aktifMi(oge) ? " is-active" : ""}`}
                >
                  <span className="nav__link-icon">{oge.ikon}</span>
                  <span>{oge.baslik}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__user">
          <div className="grow sidebar__user-info">
            <div className="sidebar__user-name">{rol ? ROL_ADI[rol] ?? "Hesabım" : "Hesabım"}</div>
            <div className="sidebar__user-role">Aktif oturum</div>
          </div>
          <button className="btn btn--ghost btn--icon" onClick={() => void cikis()} title="Güvenli çıkış">
            🚪
          </button>
        </div>
      </aside>

      <main className="app-main">
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
