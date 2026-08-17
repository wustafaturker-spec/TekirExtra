"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
interface FaturaKuyrukOzeti { taslakSatis: number; taslakAlis: number; ebelgeHata: number; acikTahsilat: number; acikOdeme: number; }

const MENU: MenuGrup[] = [
  {
    baslik: "Genel",
    ogeler: [{ href: "/panel", ikon: "ÖZ", baslik: "Finansal Özet", eslesme: "tam" }],
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
      { href: "/panel/cari", ikon: "CH", baslik: "Cari Hesaplar" },
      { href: "/panel/belgeler", ikon: "B", baslik: "Tüm Belgeler", eslesme: "tam" },
      { href: "/panel/fatura?yon=satis", ikon: "SF", baslik: "Satış Faturaları", eslesme: "tam" },
      { href: "/panel/fatura?yon=alis", ikon: "AF", baslik: "Alış Faturaları", eslesme: "tam" },
      { href: "/panel/masraflar", ikon: "M", baslik: "Masraflar", eslesme: "tam" },
      { href: "/panel/masraflar/raporlar", ikon: "MR", baslik: "Masraf Raporları", eslesme: "tam" },
      { href: "/panel/masraflar/kiralar", ikon: "KR", baslik: "Kira Sözleşmeleri", eslesme: "tam" },
      { href: "/panel/fatura/tekrarlayan", ikon: "↻", baslik: "Tekrarlayan Faturalar" },
      { href: "/panel/fatura/tekrarlayan/raporlar", ikon: "TR", baslik: "Tekrarlayan Raporları", eslesme: "tam" },
      { href: "/panel/fatura/earsiv-raporlari", ikon: "EA", baslik: "e-Arşiv Raporları", eslesme: "tam" },
      { href: "/panel/ebelge/irsaliye-gelen", ikon: "İG", baslik: "Gelen e-İrsaliyeler", eslesme: "tam" },
      { href: "/panel/pazaryeri", ikon: "PS", baslik: "Pazaryeri Siparişleri", eslesme: "tam" },
      { href: "/panel/pazaryeri/kesintiler", ikon: "PK", baslik: "Pazaryeri Kesintileri", eslesme: "tam" },
      { href: "/panel/kasa-banka", ikon: "KB", baslik: "Kasa & Banka", eslesme: "tam" },
      { href: "/panel/kasa-banka/kredi-kartlari", ikon: "KK", baslik: "Kredi Kartları", eslesme: "tam" },
      { href: "/panel/kasa-banka/pos", ikon: "POS", baslik: "POS Hesapları", eslesme: "tam" },
      { href: "/panel/kasa-banka/cek-senet", ikon: "ÇS", baslik: "Çek & Senet", eslesme: "tam" },
      { href: "/panel/kasa-banka/ekstre", ikon: "BE", baslik: "Banka Ekstresi", eslesme: "tam" },
      { href: "/panel/kasa-banka/odeme-talimatlari", ikon: "↗", baslik: "Ödeme Talimatları", eslesme: "tam" },
    ],
  },
  {
    baslik: "Ürün & Stok",
    ogeler: [
      { href: "/panel/uretim", ikon: "ÜR", baslik: "Üretim Emirleri", eslesme: "tam" },
      { href: "/panel/stok", ikon: "SK", baslik: "Stok Kartları", eslesme: "tam" },
      { href: "/panel/stok/kategoriler", ikon: "KT", baslik: "Kategoriler", eslesme: "tam" },
      { href: "/panel/stok/sayim", ikon: "SS", baslik: "Stok Sayımı", eslesme: "tam" },
      { href: "/panel/stok/transferler", ikon: "DT", baslik: "Depo Transferi", eslesme: "tam" },
      { href: "/panel/stok/fiyat-listeleri", ikon: "FL", baslik: "Fiyat Listeleri", eslesme: "tam" },
    ],
  },
  {
    baslik: "Raporlar",
    ogeler: [
      { href: "/panel/raporlar", ikon: "RA", baslik: "Raporlar & Analiz", eslesme: "tam" },
      { href: "/panel/raporlar/urun-hareketleri", ikon: "ÜH", baslik: "Ürün Hareket Raporu", eslesme: "tam" },
    ],
  },
  {
    baslik: "Ayarlar",
    ogeler: [
      { href: "/panel/ayarlar/firma", ikon: "FA", baslik: "Firma Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/abonelik", ikon: "AP", baslik: "Abonelik ve Paket", eslesme: "tam" },
      { href: "/panel/ayarlar/fatura-serileri", ikon: "FS", baslik: "Fatura Serileri", eslesme: "tam" },
      { href: "/panel/ayarlar/depolar", ikon: "DP", baslik: "Depolar", eslesme: "tam" },
      { href: "/panel/ayarlar/moduller", ikon: "MA", baslik: "Modül Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/kullanicilar", ikon: "KU", baslik: "Kullanıcılar", eslesme: "tam" },
      { href: "/panel/ayarlar/entegratorler", ikon: "EB", baslik: "e-Belge Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/pazaryerleri", ikon: "PA", baslik: "Pazaryeri Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/pos", ikon: "POS", baslik: "Sanal POS Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/sms", ikon: "SMS", baslik: "SMS Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/eposta", ikon: "EP", baslik: "E-posta Ayarları", eslesme: "tam" },
      { href: "/panel/ayarlar/banka-baglantilari", ikon: "BB", baslik: "Banka Bağlantıları", eslesme: "tam" },
      { href: "/panel/ayarlar/denetim", ikon: "Dİ", baslik: "Denetim İzi", eslesme: "tam" },
      { href: "/panel/ayarlar/kullanim", ikon: "KM", baslik: "Kullanım Metrikleri", eslesme: "tam" },
      { href: "/panel/ayarlar/hesap", ikon: "HG", baslik: "Hesap Güvenliği", eslesme: "tam" },
    ],
  },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [aktifArama, setAktifArama] = useState("");
  const [rol, setRol] = useState<string | null>(null);
  const [menuAcik, setMenuAcik] = useState(false);
  const [bildirimler, setBildirimler] = useState<Bildirim[]>([]);
  const [bildirimlerAcik, setBildirimlerAcik] = useState(false);
  const [geriBildirimAcik, setGeriBildirimAcik] = useState(false);
  const [geriBildirimPuan, setGeriBildirimPuan] = useState(5);
  const [geriBildirimKategori, setGeriBildirimKategori] = useState("genel");
  const [geriBildirimMesaj, setGeriBildirimMesaj] = useState("");
  const [geriBildirimDurum, setGeriBildirimDurum] = useState<"" | "gonderiliyor" | "basarili" | "hata">("");
  const geriBildirimTetikleyiciRef = useRef<HTMLButtonElement>(null);
  const geriBildirimDiyalogRef = useRef<HTMLElement>(null);
  const mobilMenuTetikleyiciRef = useRef<HTMLButtonElement>(null);
  const mobilMenuRef = useRef<HTMLElement>(null);
  const bildirimTetikleyiciRef = useRef<HTMLButtonElement | null>(null);
  const bildirimPanelRef = useRef<HTMLElement>(null);

  useEffect(() => { setAktifArama(window.location.search); }, [pathname]);

  useEffect(() => {
    if (tokenAl()) {
      api<{ rol: string }>("/auth/ben")
        .then(async (b) => {
          setRol(b.rol);
          const ozet = await api<FaturaKuyrukOzeti>("/fatura/is-kuyrugu-ozeti");
          const yeni: Bildirim[] = [];
          const ebelgeHatasi = ozet.ebelgeHata;
          const taslak = b.rol === "satis" ? ozet.taslakSatis : ozet.taslakSatis + ozet.taslakAlis;
          const acikOdeme = b.rol === "satis" ? ozet.acikTahsilat : ozet.acikTahsilat + ozet.acikOdeme;
          if (ebelgeHatasi > 0 && b.rol !== "satis") yeni.push({ href: "/panel/fatura?ebelge=hata", baslik: "e-Belge müdahalesi gerekli", aciklama: "Hatalı veya reddedilen belgeleri inceleyin.", sayi: ebelgeHatasi, ton: "danger" });
          if (taslak > 0) yeni.push({ href: b.rol === "satis" ? "/panel/fatura?yon=satis&durum=taslak" : "/panel/fatura?durum=taslak", baslik: "Bekleyen fatura taslakları", aciklama: "Kontrol edilip kesinleştirilecek kayıtlar.", sayi: taslak, ton: "warning" });
          if (acikOdeme > 0) yeni.push({ href: b.rol === "satis" ? "/panel/fatura?yon=satis&odeme=acik" : "/panel/fatura?odeme=acik", baslik: b.rol === "satis" ? "Tahsilat takibi" : "Açık tahsilat ve ödemeler", aciklama: "Finansal kapanışı bekleyen faturalar.", sayi: acikOdeme, ton: "warning" });
          setBildirimler(yeni);
        })
        .catch(() => setBildirimler([]));
    }
  }, []);

  useEffect(() => { setBildirimlerAcik(false); setGeriBildirimAcik(false); }, [pathname]);
  useEffect(() => {
    if (!menuAcik) return;
    const menu = mobilMenuRef.current;
    const odaklanabilirSecici = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const ilkOdak = window.requestAnimationFrame(() =>
      menu?.querySelector<HTMLElement>(odaklanabilirSecici)?.focus(),
    );
    const klavyeYonet = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuAcik(false);
        return;
      }
      if (event.key !== "Tab" || !menu) return;
      const odaklanabilirler = Array.from(menu.querySelectorAll<HTMLElement>(odaklanabilirSecici));
      if (!odaklanabilirler.length) return;
      const ilk = odaklanabilirler[0];
      const son = odaklanabilirler[odaklanabilirler.length - 1];
      if (event.shiftKey && document.activeElement === ilk) {
        event.preventDefault();
        son.focus();
      } else if (!event.shiftKey && document.activeElement === son) {
        event.preventDefault();
        ilk.focus();
      }
    };
    window.addEventListener("keydown", klavyeYonet);
    return () => {
      window.cancelAnimationFrame(ilkOdak);
      window.removeEventListener("keydown", klavyeYonet);
      if (mobilMenuTetikleyiciRef.current?.isConnected) mobilMenuTetikleyiciRef.current.focus();
    };
  }, [menuAcik]);
  useEffect(() => {
    if (!geriBildirimAcik) return;
    const diyalog = geriBildirimDiyalogRef.current;
    const odaklanabilirSecici = "button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
    const ilkOdak = window.requestAnimationFrame(() =>
      diyalog?.querySelector<HTMLElement>(odaklanabilirSecici)?.focus(),
    );
    const klavyeYonet = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setGeriBildirimAcik(false);
        return;
      }
      if (event.key !== "Tab" || !diyalog) return;
      const odaklanabilirler = Array.from(diyalog.querySelectorAll<HTMLElement>(odaklanabilirSecici));
      if (!odaklanabilirler.length) return;
      const ilk = odaklanabilirler[0];
      const son = odaklanabilirler[odaklanabilirler.length - 1];
      if (event.shiftKey && document.activeElement === ilk) {
        event.preventDefault();
        son.focus();
      } else if (!event.shiftKey && document.activeElement === son) {
        event.preventDefault();
        ilk.focus();
      }
    };
    window.addEventListener("keydown", klavyeYonet);
    return () => {
      window.cancelAnimationFrame(ilkOdak);
      window.removeEventListener("keydown", klavyeYonet);
      if (geriBildirimTetikleyiciRef.current?.isConnected) geriBildirimTetikleyiciRef.current.focus();
    };
  }, [geriBildirimAcik]);
  useEffect(() => {
    if (!bildirimlerAcik) return;
    const ilkOdak = window.requestAnimationFrame(() =>
      bildirimPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
    const kapat = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setBildirimlerAcik(false);
    };
    window.addEventListener("keydown", kapat);
    return () => {
      window.cancelAnimationFrame(ilkOdak);
      window.removeEventListener("keydown", kapat);
      if (bildirimTetikleyiciRef.current?.isConnected) bildirimTetikleyiciRef.current.focus();
    };
  }, [bildirimlerAcik]);
  const bildirimSayisi = bildirimler.reduce((toplam, bildirim) => toplam + bildirim.sayi, 0);

  function bildirimleriDegistir(event: React.MouseEvent<HTMLButtonElement>) {
    if (!bildirimlerAcik) bildirimTetikleyiciRef.current = event.currentTarget;
    setBildirimlerAcik((acik) => !acik);
  }

  function geriBildirimPuaniKlavyeYonet(event: React.KeyboardEvent<HTMLButtonElement>, puan: number) {
    let yeniPuan = puan;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") yeniPuan = puan === 5 ? 1 : puan + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") yeniPuan = puan === 1 ? 5 : puan - 1;
    else if (event.key === "Home") yeniPuan = 1;
    else if (event.key === "End") yeniPuan = 5;
    else return;

    event.preventDefault();
    setGeriBildirimPuan(yeniPuan);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[role="radio"][data-puan="${yeniPuan}"]`)
      ?.focus();
  }

  async function geriBildirimGonder(event: React.FormEvent) {
    event.preventDefault(); setGeriBildirimDurum("gonderiliyor");
    try {
      await api("/kullanim/geri-bildirim", { method: "POST", body: JSON.stringify({ puan: geriBildirimPuan, kategori: geriBildirimKategori, mesaj: geriBildirimMesaj.trim() || undefined }) });
      setGeriBildirimDurum("basarili"); setGeriBildirimMesaj("");
    } catch { setGeriBildirimDurum("hata"); }
  }

  async function cikis() {
    await api("/auth/cikis", { method: "POST" }).catch(() => undefined);
    tokenYaz(null);
    router.push("/giris");
  }

  function aktifMi(oge: MenuOge): boolean {
    const [hedefYol, hedefSorgu = ""] = oge.href.split("?");
    const yolEslesiyor = oge.eslesme === "tam" ? pathname === hedefYol : pathname.startsWith(hedefYol);
    if (!yolEslesiyor || !hedefSorgu) return yolEslesiyor;
    const hedefParametreler = new URLSearchParams(hedefSorgu);
    const aktifParametreler = new URLSearchParams(aktifArama);
    return Array.from(hedefParametreler.entries()).every(([anahtar, deger]) => aktifParametreler.get(anahtar) === deger);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#ana-icerik">Ana içeriğe geç</a>
      <header className="mobile-topbar">
        <button
          aria-controls="ana-menu"
          aria-expanded={menuAcik}
          aria-label={menuAcik ? "Ana menüyü kapat" : "Ana menüyü aç"}
          className="mobile-menu-button"
          onClick={() => setMenuAcik((acik) => !acik)}
          ref={mobilMenuTetikleyiciRef}
          type="button"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <Link className="mobile-brand" href="/panel">Tekir<b>Extra</b></Link>
        <button className="notification-button" aria-controls="bildirim-paneli" aria-expanded={bildirimlerAcik} aria-label={"Bildirimler" + (bildirimSayisi ? ", " + bildirimSayisi + " açık kayıt" : "")} onClick={bildirimleriDegistir} title="Bildirimler" type="button">
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
      <aside className={`sidebar${menuAcik ? " is-open" : ""}`} id="ana-menu" ref={mobilMenuRef}>
        <div className="sidebar__brand">
          <span aria-hidden="true" className="sidebar__brand-mark">TE</span>
          <span>Tekir<b>Extra</b></span>
        </div>

        <nav className="nav">
          <button className="notification-nav" aria-controls="bildirim-paneli" aria-expanded={bildirimlerAcik} onClick={bildirimleriDegistir} type="button">
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
                  onClick={(event) => {
                    setMenuAcik(false);
                    if (oge.href.startsWith("/panel/fatura?yon=")) {
                      event.preventDefault();
                      window.location.assign(oge.href);
                    }
                  }}
                >
                  <span aria-hidden="true" className="nav__link-icon">{oge.ikon}</span>
                  <span>{oge.baslik}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <button className="feedback-trigger" onClick={() => { setMenuAcik(false); setGeriBildirimAcik(true); setGeriBildirimDurum(""); }} ref={geriBildirimTetikleyiciRef} type="button"><span aria-hidden="true">?</span><span>Geri bildirim ver</span></button>
        <div className="sidebar__user">
          <div className="grow sidebar__user-info">
            <div className="sidebar__user-name">{rol ? ROL_ADI[rol] ?? "Hesabım" : "Hesabım"}</div>
            <div className="sidebar__user-role">Aktif oturum</div>
          </div>
          <button aria-label="Güvenli çıkış" className="btn btn--ghost btn--icon" onClick={() => void cikis()} title="Güvenli çıkış">
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </aside>

      {geriBildirimAcik && <div className="feedback-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setGeriBildirimAcik(false); }}><section aria-labelledby="feedback-title" aria-modal="true" className="feedback-dialog" ref={geriBildirimDiyalogRef} role="dialog"><div className="feedback-dialog__head"><div><strong id="feedback-title">Deneyiminizi paylaşın</strong><small>Geri bildiriminiz ürün geliştirme kararlarında kullanılır.</small></div><button aria-label="Geri bildirim formunu kapat" onClick={() => setGeriBildirimAcik(false)} type="button">×</button></div>{geriBildirimDurum === "basarili" ? <div aria-live="polite" className="feedback-success" role="status"><strong>Teşekkür ederiz.</strong><p>Geri bildiriminiz kaydedildi.</p><button autoFocus className="btn btn--primary" onClick={() => setGeriBildirimAcik(false)} type="button">Kapat</button></div> : <form className="feedback-form" onSubmit={(e) => void geriBildirimGonder(e)}><label>Deneyiminizi puanlayın</label><div className="feedback-score" role="radiogroup" aria-label="Deneyim puanı">{[1, 2, 3, 4, 5].map((puan) => <button aria-checked={geriBildirimPuan === puan} autoFocus={puan === geriBildirimPuan} className={geriBildirimPuan === puan ? "is-selected" : ""} data-puan={puan} key={puan} onClick={() => setGeriBildirimPuan(puan)} onKeyDown={(event) => geriBildirimPuaniKlavyeYonet(event, puan)} role="radio" tabIndex={geriBildirimPuan === puan ? 0 : -1} type="button">{puan}<span aria-hidden="true">★</span></button>)}</div><label htmlFor="feedback-category">Konu</label><select className="select" id="feedback-category" value={geriBildirimKategori} onChange={(e) => setGeriBildirimKategori(e.target.value)}><option value="genel">Genel deneyim</option><option value="kullanilabilirlik">Kullanılabilirlik</option><option value="hata">Hata</option><option value="oneri">Öneri</option></select><label htmlFor="feedback-message">Açıklama <small>(isteğe bağlı)</small></label><textarea className="textarea" id="feedback-message" maxLength={1000} onChange={(e) => setGeriBildirimMesaj(e.target.value)} placeholder="Neyi iyileştirebiliriz?" rows={4} value={geriBildirimMesaj} />{geriBildirimDurum === "hata" && <p className="feedback-error" role="alert">Geri bildirim gönderilemedi. Lütfen yeniden deneyin.</p>}<div className="feedback-form__actions"><button className="btn btn--ghost" onClick={() => setGeriBildirimAcik(false)} type="button">Vazgeç</button><button className="btn btn--primary" disabled={geriBildirimDurum === "gonderiliyor"} type="submit">{geriBildirimDurum === "gonderiliyor" ? "Gönderiliyor…" : "Gönder"}</button></div></form>}</section></div>}

      {bildirimlerAcik && (
        <aside className="notification-panel" aria-label="Bildirim merkezi" id="bildirim-paneli" ref={bildirimPanelRef}>
          <div className="notification-panel__head"><div><strong>Bildirimler</strong><small>{bildirimSayisi ? bildirimSayisi + " açık kayıt" : "Güncel"}</small></div><button aria-label="Bildirimleri kapat" onClick={() => setBildirimlerAcik(false)} type="button">×</button></div>
          <div className="notification-panel__list">
            {bildirimler.length === 0 ? <p className="notification-panel__empty">İlgilenmeniz gereken yeni bir kayıt yok.</p> : bildirimler.map((bildirim) => (
              <Link className="notification-item" href={bildirim.href} key={bildirim.baslik}>
                <span aria-hidden="true" className={"notification-item__status is-" + bildirim.ton} /><span><strong>{bildirim.baslik}</strong><small>{bildirim.aciklama}</small></span><b>{bildirim.sayi}</b>
              </Link>
            ))}
          </div>
        </aside>
      )}

      <main className="app-main" id="ana-icerik" tabIndex={-1}>
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
