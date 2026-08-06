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
interface Bildirim { href: string; baslik: string; aciklama: string; sayi: number; ton: "warning" | "danger"; }
interface BildirimFaturasi { tip: string; durum: string; ebelge?: { durum: string } | null; odemeOzeti?: { durum: string }; }

const MENU: MenuGrup[] = [
  {
    baslik: "Genel",
    ogeler: [{ href: "/panel", ikon: "📊", baslik: "Finansal Özet", eslesme: "tam" }],
  },
  {
    baslik: "Operasyon",
    ogeler: [
      { href: "/panel/satis", ikon: "S", baslik: "Satış", eslesme: "onek" },
      { href: "/panel/satin-alma", ikon: "A", baslik: "Satın Alma", eslesme: "onek" },
    ],
  },
  {
    baslik: "Kayıtlar",
    ogeler: [
      { href: "/panel/cari", ikon: "👥", baslik: "Cari Hesaplar" },
      { href: "/panel/belgeler", ikon: "B", baslik: "Tüm Belgeler", eslesme: "tam" },
      { href: "/panel/fatura", ikon: "F", baslik: "Tüm Faturalar", eslesme: "tam" },
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
      { href: "/panel/stok/transferler", ikon: "🔁", baslik: "Depo Transferi", eslesme: "tam" },
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
      { href: "/panel/ayarlar/depolar", ikon: "🏬", baslik: "Depolar", eslesme: "tam" },
      { href: "/panel/ayarlar/moduller", ikon: "⚙️", baslik: "Modül Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/kullanicilar", ikon: "👤", baslik: "Kullanıcılar", eslesme: "tam" },
      { href: "/panel/ayarlar/entegratorler", ikon: "🔌", baslik: "e-Belge Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/denetim", ikon: "🛡️", baslik: "Denetim İzi", eslesme: "tam" },
      { href: "/panel/ayarlar/kullanim", ikon: "KM", baslik: "Kullanım Metrikleri", eslesme: "tam" },
      { href: "/panel/ayarlar/hesap", ikon: "🔐", baslik: "Hesap Güvenliği", eslesme: "tam" },
    ],
  },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [rol, setRol] = useState<string | null>(null);
  const [menuAcik, setMenuAcik] = useState(false);
  const [bildirimler, setBildirimler] = useState<Bildirim[]>([]);
  const [bildirimlerAcik, setBildirimlerAcik] = useState(false);

  useEffect(() => {
    if (tokenAl()) {
      api<{ rol: string }>("/auth/ben")
        .then(async (b) => {
          setRol(b.rol);
          const veri = await api<{ kayitlar: BildirimFaturasi[] }>("/fatura?adet=100");
          const say = (test: (fatura: BildirimFaturasi) => boolean) => veri.kayitlar.filter(test).length;
          const yeni: Bildirim[] = [];
          const ebelgeHatasi = say((f) => ["hata", "ret"].includes(f.ebelge?.durum ?? ""));
          const taslak = say((f) => f.durum === "taslak" && (b.rol !== "satis" || ["satis", "satis_iade", "proforma"].includes(f.tip)));
          const acikOdeme = say((f) => ["odenmedi", "kismi"].includes(f.odemeOzeti?.durum ?? "") && (b.rol !== "satis" || ["satis", "alis_iade"].includes(f.tip)));
          if (ebelgeHatasi > 0 && b.rol !== "satis") yeni.push({ href: "/panel/fatura?ebelge=hata", baslik: "e-Belge müdahalesi gerekli", aciklama: "Hatalı veya reddedilen belgeleri inceleyin.", sayi: ebelgeHatasi, ton: "danger" });
          if (taslak > 0) yeni.push({ href: b.rol === "satis" ? "/panel/fatura?yon=satis&durum=taslak" : "/panel/fatura?durum=taslak", baslik: "Bekleyen fatura taslakları", aciklama: "Kontrol edilip kesinleştirilecek kayıtlar.", sayi: taslak, ton: "warning" });
          if (acikOdeme > 0) yeni.push({ href: b.rol === "satis" ? "/panel/fatura?yon=satis&odeme=acik" : "/panel/fatura?odeme=acik", baslik: b.rol === "satis" ? "Tahsilat takibi" : "Açık tahsilat ve ödemeler", aciklama: "Finansal kapanışı bekleyen faturalar.", sayi: acikOdeme, ton: "warning" });
          setBildirimler(yeni);
        })
        .catch(() => setBildirimler([]));
    }
  }, []);

  useEffect(() => { setBildirimlerAcik(false); }, [pathname]);
  useEffect(() => {
    if (!bildirimlerAcik) return;
    const kapat = (event: KeyboardEvent) => { if (event.key === "Escape") setBildirimlerAcik(false); };
    window.addEventListener("keydown", kapat);
    return () => window.removeEventListener("keydown", kapat);
  }, [bildirimlerAcik]);
  const bildirimSayisi = bildirimler.reduce((toplam, bildirim) => toplam + bildirim.sayi, 0);

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
      <header className="mobile-topbar">
        <button
          aria-expanded={menuAcik}
          aria-label="Ana menüyü aç"
          className="mobile-menu-button"
          onClick={() => setMenuAcik((acik) => !acik)}
          type="button"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <Link className="mobile-brand" href="/panel">Tekir<b>Extra</b></Link>
        <button className="notification-button" aria-expanded={bildirimlerAcik} aria-label={"Bildirimler" + (bildirimSayisi ? ", " + bildirimSayisi + " açık kayıt" : "")} onClick={() => setBildirimlerAcik((acik) => !acik)} title="Bildirimler" type="button">
          <span aria-hidden="true">🔔</span>{bildirimSayisi > 0 && <span className="notification-button__count">{bildirimSayisi > 99 ? "99+" : bildirimSayisi}</span>}
        </button>
      </header>
      {menuAcik && (
        <button
          aria-label="Menüyü kapat"
          className="sidebar-backdrop"
          onClick={() => setMenuAcik(false)}
          type="button"
        />
      )}
      <aside className={`sidebar${menuAcik ? " is-open" : ""}`}>
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark">🐈</span>
          <span>Tekir<b>Extra</b></span>
        </div>

        <nav className="nav">
          <button className="notification-nav" aria-expanded={bildirimlerAcik} onClick={() => setBildirimlerAcik((acik) => !acik)} type="button">
            <span aria-hidden="true">🔔</span><span>Bildirimler</span>{bildirimSayisi > 0 && <span className="notification-nav__count">{bildirimSayisi}</span>}
          </button>
          {MENU.map((grup) => (
            <div className="nav__group" key={grup.baslik}>
              <div className="nav__label">{grup.baslik}</div>
              {grup.ogeler.filter((oge) => oge.href !== "/panel/ayarlar/kullanim" || rol === "yonetici").map((oge) => (
                <Link
                  key={oge.href}
                  href={oge.href}
                  className={`nav__link${aktifMi(oge) ? " is-active" : ""}`}
                  onClick={() => setMenuAcik(false)}
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

      {bildirimlerAcik && (
        <aside className="notification-panel" aria-label="Bildirim merkezi">
          <div className="notification-panel__head"><div><strong>Bildirimler</strong><small>{bildirimSayisi ? bildirimSayisi + " açık kayıt" : "Güncel"}</small></div><button aria-label="Bildirimleri kapat" onClick={() => setBildirimlerAcik(false)} type="button">×</button></div>
          <div className="notification-panel__list">
            {bildirimler.length === 0 ? <p className="notification-panel__empty">İlgilenmeniz gereken yeni bir kayıt yok.</p> : bildirimler.map((bildirim) => (
              <Link className="notification-item" href={bildirim.href} key={bildirim.baslik}>
                <span className={"notification-item__status is-" + bildirim.ton} /><span><strong>{bildirim.baslik}</strong><small>{bildirim.aciklama}</small></span><b>{bildirim.sayi}</b>
              </Link>
            ))}
          </div>
        </aside>
      )}

      <main className="app-main">
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
