"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Menu, X, LogOut, MonitorX, ShieldCheck, LayoutDashboard, ListTodo, Building2, FilePenLine, Table2, Inbox, History, CreditCard, Activity, Sparkles, Users, ReceiptText } from "lucide-react";
import { Alert, Button, Modal, ModalEylem } from "@/components/ui";
import { platformApi, platformCikis, platformTokenAl, platformTokenYaz } from "@/lib/platform-api";

import { PlatformOturumuBaglami, type PlatformRolu } from "@/lib/platform-oturumu";

/** PLT-06: `yalnizYonetici` sayfaları mevzuat editörüne gösterilmez (API de 403 döner). */
const MENU = [
  { href: "/platform/ozet", baslik: "Yönetim özeti", ikon: LayoutDashboard },
  { href: "/platform/gorevler", baslik: "Görev merkezi", ikon: ListTodo },
  { href: "/platform/firmalar", ikon: Building2, baslik: "Firmalar", yalnizYonetici: true },
  { href: "/platform", ikon: FilePenLine, baslik: "Değişiklikler" },
  { href: "/platform/tablolar", ikon: Table2, baslik: "Yürürlükteki değerler" },
  { href: "/platform/talepler", ikon: Inbox, baslik: "Talepler" },
  { href: "/platform/denetim", ikon: History, baslik: "Denetim izi" },
  { href: "/platform/odeme-raporu", ikon: ReceiptText, baslik: "Ödeme raporu", yalnizYonetici: true },
  { href: "/platform/odeme", ikon: CreditCard, baslik: "Abonelik ödemesi", yalnizYonetici: true },
  { href: "/platform/sistem-sagligi", ikon: Activity, baslik: "Sistem sağlığı", yalnizYonetici: true },
  { href: "/platform/yapay-zeka", ikon: Sparkles, baslik: "Yapay zekâ tavanı", yalnizYonetici: true },
  { href: "/platform/kullanicilar", ikon: Users, baslik: "Kullanıcılar", yalnizYonetici: true },
];

const ROL_ADI: Record<PlatformRolu, string> = { yonetici: "Platform yöneticisi", mevzuat_editoru: "Mevzuat editörü" };

/**
 * Mevzuat Merkezi platform paneli (MVZ-04). Kiracı panelinden ayrı bir
 * yerleşimdir; kiracı menüsü, kiracı oturumu ve kiracı verisi burada yoktur.
 */
export default function PlatformYerlesimi({ children }: { children: ReactNode }) {
  const yol = usePathname();
  const yonlendir = useRouter();
  const [menuAcik, setMenuAcik] = useState(false);
  const [kimlikHatasi, setKimlikHatasi] = useState(false);
  const [tekrar, setTekrar] = useState(0);
  const [ben, setBen] = useState<{ eposta: string; rol: PlatformRolu } | null>(null);
  const [tumOturumlar, setTumOturumlar] = useState(false);
  const [oturumHatasi, setOturumHatasi] = useState("");
  const [oturumKapaniyor, setOturumKapaniyor] = useState(false);
  /** PLT-25: kullanıcının bu sekme dahil bütün platform oturumları sunucuda kapanır. */
  async function tumOturumlariKapat(e: React.FormEvent) {
    e.preventDefault();
    setOturumHatasi(""); setOturumKapaniyor(true);
    try {
      await platformApi("/platform/auth/oturumlari-kapat", { method: "POST" });
      platformTokenYaz(null);
      yonlendir.replace("/platform/giris?cikis=tum");
    } catch (h) { setOturumHatasi(h instanceof Error ? h.message : "Oturumlar kapatılamadı."); }
    finally { setOturumKapaniyor(false); }
  }
  // PLT-07: davet sayfası da oturumsuz, panel çerçevesi olmadan açılır.
  const girisSayfasi = yol === "/platform/giris" || yol === "/platform/davet";

  useEffect(() => {
    if (girisSayfasi) { setBen(null); return; }
    if (!platformTokenAl()) { yonlendir.replace("/platform/giris"); return; }
    const kontrol = new AbortController();
    setKimlikHatasi(false);
    void platformApi<{ eposta: string; rol?: PlatformRolu }>("/platform/auth/ben", { signal: kontrol.signal })
      .then((b) => { if (!kontrol.signal.aborted) setBen({ eposta: b.eposta, rol: b.rol ?? "yonetici" }); })
      .catch(() => { if (!kontrol.signal.aborted) setKimlikHatasi(true); });
    return () => kontrol.abort();
  }, [girisSayfasi, yonlendir, tekrar]);
  const editor = ben?.rol === "mevzuat_editoru";
  const menu = MENU.filter((m) => !(editor && m.yalnizYonetici));
  const yasakSayfa = editor && MENU.some((m) => m.yalnizYonetici && (yol === m.href || yol.startsWith(`${m.href}/`)));
  useEffect(() => { if (yasakSayfa) yonlendir.replace("/platform"); }, [yasakSayfa, yonlendir]);
  useEffect(() => { setMenuAcik(false); }, [yol]);
  useEffect(() => {
    if (!menuAcik) return;
    const kapat = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuAcik(false); };
    document.addEventListener("keydown", kapat);
    return () => document.removeEventListener("keydown", kapat);
  }, [menuAcik]);
  if (girisSayfasi) return <>{children}</>;
  if (!ben) return <main className="platform-session" aria-live="polite"><ShieldCheck size={32} /><h1>Mevzuat Merkezi</h1><p>{kimlikHatasi ? "Oturum bilgileri alınamadı." : "Oturumunuz doğrulanıyor…"}</p>{kimlikHatasi && <Button onClick={() => setTekrar((v) => v + 1)}>Tekrar dene</Button>}</main>;
  const aktif = (href: string) => href === "/platform" ? yol === href || yol.startsWith("/platform/degisiklik") : yol === href || yol.startsWith(`${href}/`);
  const bolumler = [
    { ad: "Genel bakış", yollar: ["/platform/ozet", "/platform/gorevler"] },
    { ad: "Mevzuat yönetimi", yollar: ["/platform", "/platform/tablolar", "/platform/talepler", "/platform/denetim"] },
    { ad: "Platform yönetimi", yollar: ["/platform/firmalar", "/platform/odeme-raporu", "/platform/odeme", "/platform/sistem-sagligi", "/platform/yapay-zeka", "/platform/kullanicilar"] },
  ];
  return (
    <div className="platform-shell">
      <a className="platform-skip" href="#platform-icerik">İçeriğe geç</a>
      <aside id="platform-menu" className={`platform-sidebar${menuAcik ? " is-open" : ""}`} aria-label="Platform gezinmesi">
        <Link href="/platform/ozet" className="platform-brand"><span className="auth-brand-mark">TE</span><span><strong>Mevzuat Merkezi</strong><small>TekirExtra · Platform</small></span></Link>
        <nav aria-label="Platform menüsü">
          {bolumler.map((b) => {
            const ogeler = menu.filter((m) => b.yollar.includes(m.href));
            return ogeler.length > 0 && <div className="platform-nav-group" key={b.ad}><p>{b.ad}</p>{ogeler.map((m) => {
              const Icon = m.ikon;
              return <Link key={m.href} href={m.href} onClick={() => setMenuAcik(false)} aria-current={aktif(m.href) ? "page" : undefined} className={aktif(m.href) ? "is-active" : undefined}><Icon size={18} aria-hidden="true" />{m.baslik}</Link>;
            })}</div>;
          })}
        </nav>
        <div className="platform-sidebar-note"><ShieldCheck size={18} /><span>Kontrollü yayın süreci<small>Hazırlama, onay ve denetim tek yerde.</small></span></div>
      </aside>
      {menuAcik && <button className="platform-backdrop" aria-label="Menüyü kapat" onClick={() => setMenuAcik(false)} />}
      <div className="platform-workspace">
        <header className="platform-topbar">
          <Button className="platform-menu-toggle" aria-label={menuAcik ? "Menüyü kapat" : "Menüyü aç"} aria-expanded={menuAcik} aria-controls="platform-menu" onClick={() => setMenuAcik(!menuAcik)}>{menuAcik ? <X size={20} /> : <Menu size={20} />}</Button>
          <div className="platform-breadcrumb">Platform <span>/</span> <strong>{MENU.find((m) => aktif(m.href))?.baslik ?? "Değişiklik detayı"}</strong></div>
          <div className="platform-account"><span className="platform-avatar" aria-hidden="true">{ben.eposta.slice(0, 1).toLocaleUpperCase("tr-TR")}</span><div><strong>{ben.eposta}</strong><small>{ROL_ADI[ben.rol]}</small></div><Button size="sm" variant="ghost" aria-label="Tüm oturumlarımı kapat" onClick={() => { setOturumHatasi(""); setTumOturumlar(true); }}><MonitorX size={16} aria-hidden="true" /><span>Tüm oturumlar</span></Button><Button size="sm" aria-label="Çıkış" data-platform-navigation onClick={() => { void platformCikis().then((iptal) => yonlendir.replace(iptal ? "/platform/giris" : "/platform/giris?cikis=dogrulanamadi")); }}><LogOut size={16} aria-hidden="true" /><span>Çıkış</span></Button></div>
        </header>
        {tumOturumlar && (
          <Modal baslik="Tüm oturumlarımı kapat" aciklama="Bu sekme dahil, platform hesabınızla açık olan bütün oturumlar sunucuda kapanır; her yerde yeniden giriş yapmanız gerekir." onKapat={() => setTumOturumlar(false)}>
            <form onSubmit={(e) => void tumOturumlariKapat(e)} className="stack">
              <Alert tone="error">{oturumHatasi}</Alert>
              <ModalEylem onVazgec={() => setTumOturumlar(false)} isleniyor={oturumKapaniyor} metin="Oturumları kapat" tehlikeli />
            </form>
          </Modal>
        )}
        <main id="platform-icerik" className="platform-main" tabIndex={-1}><PlatformOturumuBaglami.Provider value={ben}>{yasakSayfa ? null : children}</PlatformOturumuBaglami.Provider></main>
      </div>
    </div>
  );
}
