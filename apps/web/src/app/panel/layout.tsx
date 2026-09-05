"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, tokenAl, tokenYaz } from "@/lib/api";
import { rolMenuYoluGorebilir } from "@/lib/rol-yetkileri";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { ThemeConfiguratorDrawer } from "@/components/theme-configurator-drawer";
import { KomutPaleti } from "@/components/komut-paleti";
import { AYARLAR, MENU, type MenuOge } from "@/lib/menu";
import { Bell, ChevronRight, CircleHelp, LogOut, Menu as MenuIkonu, Search, Settings } from "lucide-react";

const ROL_ADI: Record<string, string> = {
  yonetici: "Yönetici",
  muhasebe: "Muhasebe",
  satis: "Satış",
  salt_okunur: "Salt Okunur",
  mali_musavir: "Mali Müşavir",
  b2b_bayi: "B2B Bayi",
  uretim_planlama: "Üretim Planlama",
  uretim_operatoru: "Üretim Operatörü",
  depo: "Depo Sorumlusu",
  kalite: "Kalite Sorumlusu",
  maliyet_muhasebesi: "Maliyet Muhasebesi",
};

interface Bildirim { href: string; baslik: string; aciklama: string; sayi: number; ton: "warning" | "danger"; }
interface DuzeltmeBildirimOzeti { kritik: number; slaAsan: number; }
interface FaturaKuyrukOzeti { taslakSatis: number; taslakAlis: number; ebelgeHata: number; acikTahsilat: number; acikOdeme: number; }


/**
 * İkinci seviye menü bağlantısı. `/panel/fatura?yon=…` bağlantıları aynı
 * rotanın farklı sorgu parametreleridir; Next.js istemci gezinmesi sayfayı
 * yeniden kurmadığı için tam gezinme yapılır.
 */
function MenuBaglantisi({ oge, aktif, onGit }: { oge: MenuOge; aktif: boolean; onGit: () => void }) {
  const Ikon = oge.ikon;
  return (
    <Link
      className={`nav__link${aktif ? " is-active" : ""}`}
      href={oge.href}
      onClick={(olay) => {
        onGit();
        if (oge.href.startsWith("/panel/fatura?yon=")) {
          olay.preventDefault();
          window.location.assign(oge.href);
        }
      }}
      title={oge.baslik}
    >
      <Ikon aria-hidden="true" className="nav__link-icon" size={16} strokeWidth={1.9} />
      <span>{oge.baslik}</span>
    </Link>
  );
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [aktifArama, setAktifArama] = useState("");
  const [rol, setRol] = useState<string | null>(null);
  const [menuAcik, setMenuAcik] = useState(false);
  const [sidebarDaraltildi, setSidebarDaraltildi] = useState(false);
  // İlk SSR çıktısı ile tarayıcı çıktısı aynı olmalı; kullanıcı tercihi mount sonrası okunur.
  const menuTercihiYuklendi = useRef(false);
  // Aynı anda tek çalışma alanı açıktır: ekranda 8 alan + açık alanın maddeleri
  // durur, 55 satırlık düz liste değil.
  const [acikAlan, setAcikAlan] = useState<string>("Özet");
  const [ayarlarAcik, setAyarlarAcik] = useState(false);
  const [paletAcik, setPaletAcik] = useState(false);
  const ayarlarTetikleyiciRef = useRef<HTMLButtonElement>(null);
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
  const gorunurMenu = MENU
    .map((alan) => ({ ...alan, ogeler: alan.ogeler.filter((oge) => rolMenuYoluGorebilir(rol, oge.href)) }))
    .filter((alan) => alan.ogeler.length > 0);
  const gorunurAyarlar = AYARLAR.filter((oge) => rolMenuYoluGorebilir(rol, oge.href));
  const sayfaYetkili = rolMenuYoluGorebilir(rol, pathname);

  useEffect(() => { setAktifArama(window.location.search); }, [pathname]);
  useEffect(() => {
    try {
      const kayit = window.localStorage.getItem("tekirextra-acik-menu-alani");
      if (kayit && MENU.some((alan) => alan.baslik === kayit)) setAcikAlan(kayit);
    } catch { /* Bozuk/erişilemeyen tercihler varsayılan menüyü etkilemez. */ }
    menuTercihiYuklendi.current = true;
  }, []);
  // Gezinilen sayfanın alanı her zaman açılır — kullanıcı nerede olduğunu görür.
  useEffect(() => {
    const aktifAlan = MENU.find((alan) => alan.ogeler.some((oge) => aktifMi(oge)))?.baslik;
    if (aktifAlan) setAcikAlan(aktifAlan);
  }, [pathname, aktifArama]);
  useEffect(() => {
    if (!menuTercihiYuklendi.current) return;
    window.localStorage.setItem("tekirextra-acik-menu-alani", acikAlan);
  }, [acikAlan]);

  useEffect(() => {
    if (tokenAl()) {
      const bildirimleriYenile = () => api<{ rol: string }>("/auth/ben")
        .then(async (b) => {
          setRol(b.rol);
          const duzeltmeYetkili = ["yonetici", "muhasebe", "salt_okunur", "mali_musavir"].includes(b.rol);
          const [ozet, duzeltme] = await Promise.all([
            api<FaturaKuyrukOzeti>("/fatura/is-kuyrugu-ozeti"),
            duzeltmeYetkili ? api<DuzeltmeBildirimOzeti>("/duzeltmeler/ozet") : Promise.resolve(null),
          ]);
          const yeni: Bildirim[] = [];
          const ebelgeHatasi = ozet.ebelgeHata;
          const taslak = b.rol === "satis" ? ozet.taslakSatis : ozet.taslakSatis + ozet.taslakAlis;
          const acikOdeme = b.rol === "satis" ? ozet.acikTahsilat : ozet.acikTahsilat + ozet.acikOdeme;
          if (ebelgeHatasi > 0 && b.rol !== "satis") yeni.push({ href: "/panel/fatura?ebelge=hata", baslik: "e-Belge müdahalesi gerekli", aciklama: "Hatalı veya reddedilen belgeleri inceleyin.", sayi: ebelgeHatasi, ton: "danger" });
          if (taslak > 0) yeni.push({ href: b.rol === "satis" ? "/panel/fatura?yon=satis&durum=taslak" : "/panel/fatura?durum=taslak", baslik: "Bekleyen fatura taslakları", aciklama: "Kontrol edilip kesinleştirilecek kayıtlar.", sayi: taslak, ton: "warning" });
          if (acikOdeme > 0) yeni.push({ href: b.rol === "satis" ? "/panel/fatura?yon=satis&odeme=acik" : "/panel/fatura?odeme=acik", baslik: b.rol === "satis" ? "Tahsilat takibi" : "Açık tahsilat ve ödemeler", aciklama: "Finansal kapanışı bekleyen faturalar.", sayi: acikOdeme, ton: "warning" });
          if (duzeltme?.kritik) yeni.unshift({ href: "/panel/islemler", baslik: "Kritik düzeltme gerekli", aciklama: duzeltme.slaAsan ? `${duzeltme.slaAsan} kayıt SLA süresini aştı.` : "Kritik finansal istisnaları inceleyin.", sayi: duzeltme.kritik, ton: "danger" });
          setBildirimler(yeni);
        })
        .catch(() => setBildirimler([]));
      void bildirimleriYenile();
      const zamanlayici = window.setInterval(() => void bildirimleriYenile(), 15 * 60 * 1000);
      return () => window.clearInterval(zamanlayici);
    } else {
      router.replace("/giris");
    }
  }, [router]);

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

  function paletiAc() {
    setMenuAcik(false);
    setPaletAcik(true);
  }

  function alanAcKapat(baslik: string) {
    setAcikAlan((acik) => (acik === baslik ? "" : baslik));
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
          <MenuIkonu aria-hidden="true" size={20} strokeWidth={2} />
        </button>
        <Link className="mobile-brand" href="/panel">Tekir<b>Extra</b></Link>
        <div style={{ marginLeft: "auto", marginRight: "8px", display: "flex", alignItems: "center", gap: "4px" }}>
          <button aria-label="Ara veya git" className="notification-button" onClick={paletiAc} type="button">
            <Search aria-hidden="true" size={19} strokeWidth={1.9} />
          </button>
          <ThemeSwitcher />
        </div>
        <button className="notification-button" aria-controls="bildirim-paneli" aria-expanded={bildirimlerAcik} aria-label={"Bildirimler" + (bildirimSayisi ? ", " + bildirimSayisi + " açık kayıt" : "")} onClick={bildirimleriDegistir} title="Bildirimler" type="button">
          <Bell aria-hidden="true" size={19} strokeWidth={1.9} />{bildirimSayisi > 0 && <span className="notification-button__count">{bildirimSayisi > 99 ? "99+" : bildirimSayisi}</span>}
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
      <aside className={`sidebar${menuAcik ? " is-open" : ""}${sidebarDaraltildi ? " is-collapsed" : ""}`} id="ana-menu" ref={mobilMenuRef}>
        <div className="sidebar__brand">
          <span aria-hidden="true" className="sidebar__brand-mark">TE</span>
          <span>Tekir<b>Extra</b></span>
          <button className="sidebar-collapse" type="button" aria-label={sidebarDaraltildi ? "Menüyü genişlet" : "Menüyü daralt"} aria-expanded={!sidebarDaraltildi} onClick={() => setSidebarDaraltildi((daraltilmis) => !daraltilmis)}>
            <span aria-hidden="true">{sidebarDaraltildi ? "→" : "←"}</span>
          </button>
        </div>

        <nav className="nav">
          <button className="palet-tetik" onClick={paletiAc} title="Komut paleti (Ctrl+K)" type="button">
            <Search aria-hidden="true" size={15} strokeWidth={1.9} />
            <span>Ara veya git…</span>
            <kbd className="palet__kbd">⌘K</kbd>
          </button>
          <button className="notification-nav" aria-controls="bildirim-paneli" aria-expanded={bildirimlerAcik} onClick={bildirimleriDegistir} type="button">
            <Bell aria-hidden="true" size={16} strokeWidth={1.9} /><span>Bildirimler</span>{bildirimSayisi > 0 && <span className="notification-nav__count">{bildirimSayisi}</span>}
          </button>
          {gorunurMenu.map((alan) => {
            const acik = acikAlan === alan.baslik;
            const alanAktif = alan.ogeler.some((oge) => aktifMi(oge));
            const AlanIkonu = alan.ikon;
            return (
              <div className="nav__group" key={alan.baslik}>
                <button
                  aria-expanded={acik}
                  className={`nav__alan${alanAktif ? " is-aktif-alan" : ""}`}
                  onClick={() => alanAcKapat(alan.baslik)}
                  title={sidebarDaraltildi ? alan.baslik : undefined}
                  type="button"
                >
                  <AlanIkonu aria-hidden="true" className="nav__alan-ikon" size={17} strokeWidth={1.9} />
                  <span>{alan.baslik}</span>
                  {alanAktif && !acik
                    ? <span aria-hidden="true" className="nav__alan-nokta" />
                    : <ChevronRight aria-hidden="true" className="nav__alan-ok" size={14} strokeWidth={2.2} />}
                </button>
                {acik && (
                  <div className="nav__ogeler">
                    {alan.ogeler.map((oge) => <MenuBaglantisi key={oge.href} aktif={aktifMi(oge)} oge={oge} onGit={() => setMenuAcik(false)} />)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {gorunurAyarlar.length > 0 && (
          <div className="nav__group nav__ayarlar">
            <button
              aria-expanded={ayarlarAcik}
              className="nav__alan"
              onClick={() => setAyarlarAcik((acik) => !acik)}
              ref={ayarlarTetikleyiciRef}
              title={sidebarDaraltildi ? "Ayarlar" : undefined}
              type="button"
            >
              <Settings aria-hidden="true" className="nav__alan-ikon" size={17} strokeWidth={1.9} />
              <span>Ayarlar</span>
              <ChevronRight aria-hidden="true" className="nav__alan-ok" size={14} strokeWidth={2.2} />
            </button>
            {ayarlarAcik && (
              <div className="nav__ogeler">
                {gorunurAyarlar.map((oge) => <MenuBaglantisi key={oge.href} aktif={aktifMi(oge)} oge={oge} onGit={() => setMenuAcik(false)} />)}
              </div>
            )}
          </div>
        )}
        <button className="feedback-trigger" onClick={() => { setMenuAcik(false); setGeriBildirimAcik(true); setGeriBildirimDurum(""); }} ref={geriBildirimTetikleyiciRef} type="button"><CircleHelp aria-hidden="true" size={16} strokeWidth={1.9} /><span>Geri bildirim ver</span></button>
        <div className="sidebar__user">
          <div className="grow sidebar__user-info">
            <div className="sidebar__user-name">{rol ? ROL_ADI[rol] ?? "Hesabım" : "Hesabım"}</div>
            <div className="sidebar__user-role">Aktif oturum</div>
          </div>
          <button aria-label="Güvenli çıkış" className="btn btn--ghost btn--icon" onClick={() => void cikis()} title="Güvenli çıkış">
            <LogOut aria-hidden="true" size={16} strokeWidth={1.9} />
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

      <KomutPaleti acik={paletAcik} rol={rol} setAcik={setPaletAcik} />

      <main className="app-main" id="ana-icerik" tabIndex={-1}>
        <div className="app-content">
          {rol === null ? (
            <section className="card empty-state" role="status" aria-live="polite">
              <p>Oturum ve erişim yetkileri doğrulanıyor…</p>
            </section>
          ) : sayfaYetkili ? children : (
            <section aria-labelledby="yetkisiz-baslik" className="card empty-state" role="alert">
              <span aria-hidden="true" className="empty-state__icon">🔒</span>
              <h1 id="yetkisiz-baslik">Bu sayfaya erişim yetkiniz yok</h1>
              <p>Hesabınıza tanımlı rol bu modülü görüntülemeye izin vermiyor.</p>
              <Link className="btn btn--primary" href={rol === "b2b_bayi" ? "/panel/b2b" : "/panel"}>Yetkili olduğum alana dön</Link>
            </section>
          )}
        </div>
      </main>
      <ThemeConfiguratorDrawer />
    </div>
  );
}
