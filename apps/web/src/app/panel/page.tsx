"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";

type Rol = "yonetici" | "muhasebe" | "satis" | "salt_okunur";
interface FinansOzet { nakitVarliklar: string; envanterDegeri: string; toplamAlacaklar: string; toplamBorclar: string; netVarlikDegeri: string; }
interface FaturaKuyrukOzeti { taslakSatis: number; taslakAlis: number; ebelgeHata: number; acikTahsilat: number; acikOdeme: number; }
interface CekSenet { id: string; tur: "cek" | "senet"; yon: "alinan" | "verilen"; portfoyNo: string; vadeTarihi: string; tutarTry: string; borclu: string; durum: string; banka?: string | null; cari?: { unvan: string } | null; }
interface IsOgesi { href: string; baslik: string; aciklama: string; sayi: number; ton: "danger" | "warning" | "neutral"; }

const rolAdi: Record<Rol, string> = { yonetici: "Yönetim görünümü", muhasebe: "Muhasebe görünümü", satis: "Satış görünümü", salt_okunur: "Genel görünüm" };
const para = (deger: string | number, sifirBasamak = false) => Number(deger || 0).toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: sifirBasamak ? 0 : 2 });
const tarih = (deger: string) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" }).format(new Date(deger));
const gunBaslangici = (deger = new Date()) => new Date(deger.getFullYear(), deger.getMonth(), deger.getDate());
const gunFarki = (deger: string) => Math.round((gunBaslangici(new Date(deger)).getTime() - gunBaslangici().getTime()) / 86_400_000);
const vadeMetni = (gun: number) => gun < 0 ? `${Math.abs(gun)} gün gecikti` : gun === 0 ? "Bugün" : gun === 1 ? "Yarın" : `${gun} gün kaldı`;

export default function PanelSayfasi() {
  const router = useRouter();
  const [firma, setFirma] = useState("Yükleniyor…");
  const [rol, setRol] = useState<Rol | null>(null);
  const [finans, setFinans] = useState<FinansOzet | null>(null);
  const [fatura, setFatura] = useState<FaturaKuyrukOzeti | null>(null);
  const [kritikStok, setKritikStok] = useState(0);
  const [ekstre, setEkstre] = useState(0);
  const [gelen, setGelen] = useState(0);
  const [cekler, setCekler] = useState<CekSenet[]>([]);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [sonGuncelleme, setSonGuncelleme] = useState<Date | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true); setHata("");
    try {
      const [ben, firmaVeri] = await Promise.all([api<{ rol: Rol }>("/auth/ben"), api<{ unvan: string }>("/firma")]);
      setRol(ben.rol); setFirma(firmaVeri.unvan);
      const finansalErisim = ben.rol !== "satis";
      const sonuclar = await Promise.allSettled([
        api<FaturaKuyrukOzeti>("/fatura/is-kuyrugu-ozeti"),
        api<{ kritikStok: number }>("/stok/kritik-ozeti"),
        ...(finansalErisim ? [
          api<FinansOzet>("/rapor/ozet"), api<unknown[]>("/kasa-banka/ekstre/satirlar?durum=beklemede"),
          api<unknown[]>("/ebelge/gelen?durum=beklemede"), api<CekSenet[]>("/kasa-banka/cek-senet"),
        ] : []),
      ]);
      if (sonuclar[0]?.status === "fulfilled") setFatura(sonuclar[0].value as FaturaKuyrukOzeti);
      if (sonuclar[1]?.status === "fulfilled") setKritikStok((sonuclar[1].value as { kritikStok: number }).kritikStok);
      if (finansalErisim) {
        if (sonuclar[2]?.status === "fulfilled") setFinans(sonuclar[2].value as FinansOzet);
        if (sonuclar[3]?.status === "fulfilled") setEkstre((sonuclar[3].value as unknown[]).length);
        if (sonuclar[4]?.status === "fulfilled") setGelen((sonuclar[4].value as unknown[]).length);
        if (sonuclar[5]?.status === "fulfilled") setCekler(sonuclar[5].value as CekSenet[]);
      }
      if (sonuclar.some((sonuc) => sonuc.status === "rejected")) setHata("Bazı özetler şu anda yüklenemedi; erişilebilen güncel veriler gösteriliyor.");
      setSonGuncelleme(new Date());
    } catch (err) {
      if (err instanceof ApiHata && err.durum === 401) { tokenYaz(null); router.push("/giris"); return; }
      setHata(err instanceof Error ? err.message : "Panel yüklenemedi");
    } finally { setYukleniyor(false); }
  }, [router]);

  useEffect(() => { if (!tokenAl()) router.push("/giris"); else void yukle(); }, [router, yukle]);

  const aktifCekler = useMemo(() => cekler.filter((cek) => cek.yon === "alinan" ? cek.durum === "portfoyde" : cek.durum === "verildi"), [cekler]);
  const vadeOzeti = useMemo(() => {
    const hesapla = (yon: CekSenet["yon"], alt: number, ust: number) => {
      const kayitlar = aktifCekler.filter((cek) => cek.yon === yon && gunFarki(cek.vadeTarihi) >= alt && gunFarki(cek.vadeTarihi) <= ust);
      return { adet: kayitlar.length, tutar: kayitlar.reduce((toplam, cek) => toplam + Number(cek.tutarTry), 0) };
    };
    return { gecikenAlinan: hesapla("alinan", -99_999, -1), gecikenVerilen: hesapla("verilen", -99_999, -1), bugunAlinan: hesapla("alinan", 0, 0), bugunVerilen: hesapla("verilen", 0, 0), haftaAlinan: hesapla("alinan", 1, 7), haftaVerilen: hesapla("verilen", 1, 7), ayAlinan: hesapla("alinan", 8, 30), ayVerilen: hesapla("verilen", 8, 30) };
  }, [aktifCekler]);
  const yakinCekler = useMemo(() => [...aktifCekler].filter((cek) => gunFarki(cek.vadeTarihi) <= 30).sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi)).slice(0, 6), [aktifCekler]);
  const otuzGunTahsilat = vadeOzeti.bugunAlinan.tutar + vadeOzeti.haftaAlinan.tutar + vadeOzeti.ayAlinan.tutar;
  const otuzGunOdeme = vadeOzeti.bugunVerilen.tutar + vadeOzeti.haftaVerilen.tutar + vadeOzeti.ayVerilen.tutar;
  const nakit = Number(finans?.nakitVarliklar ?? 0);
  const cekSonrasiNakit = nakit + otuzGunTahsilat - otuzGunOdeme;

  const isler: IsOgesi[] = rol === "satis" ? [
    { href: "/panel/fatura?yon=satis&odeme=acik", baslik: "Açık tahsilatlar", aciklama: "Müşteri takibi bekleyen satış faturaları", sayi: fatura?.acikTahsilat ?? 0, ton: "warning" },
    { href: "/panel/fatura?yon=satis&durum=taslak", baslik: "Taslak satış faturaları", aciklama: "Kesinleştirilmeyi bekleyen kayıtlar", sayi: fatura?.taslakSatis ?? 0, ton: "neutral" },
    { href: "/panel/stok?durum=kritik", baslik: "Kritik stoklar", aciklama: "Satışı etkileyebilecek düşük stoklar", sayi: kritikStok, ton: kritikStok ? "danger" : "neutral" },
  ] : [
    { href: "/panel/fatura?ebelge=hata", baslik: "e-Belge hataları", aciklama: "Müdahale edilmesi gereken gönderimler", sayi: fatura?.ebelgeHata ?? 0, ton: (fatura?.ebelgeHata ?? 0) ? "danger" : "neutral" },
    { href: "/panel/kasa-banka/cek-senet?durum=vadesi-gecmis", baslik: "Vadesi geçen çekler", aciklama: "Tahsilat veya ödeme işlemi bekleyen kayıtlar", sayi: vadeOzeti.gecikenAlinan.adet + vadeOzeti.gecikenVerilen.adet, ton: "danger" },
    { href: "/panel/fatura/gelen-kutusu?durum=beklemede", baslik: "Bekleyen alış e-Belgeleri", aciklama: "Kontrol ve eşleştirme kuyruğu", sayi: gelen, ton: "warning" },
    { href: "/panel/kasa-banka/ekstre?durum=beklemede", baslik: "Eşleşmemiş banka hareketleri", aciklama: "Cari veya faturayla ilişkilendirilecek satırlar", sayi: ekstre, ton: "warning" },
  ];

  const tarihBasligi = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return <div className="dashboard">
    <header className="dashboard-hero">
      <div><p className="dashboard-kicker">{rol ? rolAdi[rol] : "Finansal kontrol merkezi"}</p><h1>{firma}</h1><p>{tarihBasligi.charAt(0).toUpperCase() + tarihBasligi.slice(1)} · İşletmenizin bugünkü finansal görünümü</p></div>
      <div className="dashboard-hero__actions"><span className="dashboard-updated">{sonGuncelleme ? `Son güncelleme ${sonGuncelleme.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : "Veriler hazırlanıyor"}</span><button className="btn btn--ghost" disabled={yukleniyor} onClick={() => void yukle()} type="button"><span aria-hidden="true">↻</span>{yukleniyor ? "Güncelleniyor" : "Yenile"}</button><Link className="btn btn--primary" href="/panel/fatura/yeni?yon=satis"><span aria-hidden="true">＋</span>Yeni işlem</Link></div>
    </header>
    {hata && <div className="dashboard-notice" role="status"><span aria-hidden="true">i</span>{hata}</div>}

    {rol !== "satis" && <section aria-labelledby="finansal-durum">
      <div className="dashboard-section-head"><div><p className="dashboard-kicker">Anlık durum</p><h2 id="finansal-durum">Finansal görünüm</h2></div><Link href="/panel/raporlar">Detaylı raporlar <span aria-hidden="true">→</span></Link></div>
      <div className="dashboard-kpis">
        <article className="dashboard-kpi dashboard-kpi--lead"><span>Nakit ve banka</span><strong>{finans ? para(finans.nakitVarliklar, true) : "—"}</strong><small>30 günlük çek etkisi sonrası <b className={cekSonrasiNakit < 0 ? "is-negative" : "is-positive"}>{finans ? para(cekSonrasiNakit, true) : "—"}</b></small></article>
        <article className="dashboard-kpi"><span>Müşteri alacakları</span><strong>{finans ? para(finans.toplamAlacaklar, true) : "—"}</strong><small>Açık satış bakiyesi</small></article>
        <article className="dashboard-kpi"><span>Tedarikçi borçları</span><strong>{finans ? para(finans.toplamBorclar, true) : "—"}</strong><small>Açık alış bakiyesi</small></article>
        <article className="dashboard-kpi"><span>Stok değeri</span><strong>{finans ? para(finans.envanterDegeri, true) : "—"}</strong><small>{kritikStok ? `${kritikStok} ürün kritik seviyede` : "Kritik stok bulunmuyor"}</small></article>
        <article className="dashboard-kpi"><span>Net varlık</span><strong>{finans ? para(finans.netVarlikDegeri, true) : "—"}</strong><small>Nakit, alacak, borç ve envanter</small></article>
      </div>
    </section>}

    <div className="dashboard-columns">
      <section className="dashboard-panel" aria-labelledby="oncelikli-isler"><div className="dashboard-panel__head"><div><p className="dashboard-kicker">Operasyon</p><h2 id="oncelikli-isler">Öncelikli işler</h2></div><span>{isler.reduce((toplam, is) => toplam + is.sayi, 0)} açık kayıt</span></div><div className="dashboard-task-list">{isler.map((is) => <Link href={is.href} className="dashboard-task" key={is.baslik}><i className={`is-${is.ton}`} /><span><strong>{is.baslik}</strong><small>{is.aciklama}</small></span><b>{is.sayi}</b><em aria-hidden="true">→</em></Link>)}</div></section>
      <section className="dashboard-panel dashboard-panel--actions" aria-labelledby="hizli-islemler"><div className="dashboard-panel__head"><div><p className="dashboard-kicker">Kısayollar</p><h2 id="hizli-islemler">Hızlı işlemler</h2></div></div><div className="dashboard-actions">{(rol === "satis" ? [
        ["SF", "Satış faturası", "/panel/fatura/yeni?yon=satis"], ["TK", "Teklif oluştur", "/panel/belgeler/yeni?yon=satis&tur=teklif"], ["CR", "Yeni cari", "/panel/cari/yeni"], ["TH", "Tahsilat al", "/panel/kasa-banka?islem=tahsilat"],
      ] : [["SF", "Satış faturası", "/panel/fatura/yeni?yon=satis"], ["AF", "Alış faturası", "/panel/fatura/yeni?yon=alis"], ["MS", "Masraf ekle", "/panel/masraflar/yeni"], ["TH", "Tahsilat al", "/panel/kasa-banka?islem=tahsilat"]]).map(([ikon, baslik, href]) => <Link href={href} key={baslik}><span>{ikon}</span><strong>{baslik}</strong><em aria-hidden="true">↗</em></Link>)}</div></section>
    </div>

    {rol !== "satis" && <section className="dashboard-cheques" aria-labelledby="cek-takvimi">
      <div className="dashboard-section-head"><div><p className="dashboard-kicker">30 günlük görünüm</p><h2 id="cek-takvimi">Çek &amp; senet takvimi</h2><p>Yaklaşan tahsilat ve ödemelerin nakit pozisyonunuza etkisi</p></div><Link href="/panel/kasa-banka/cek-senet">Tümünü görüntüle <span aria-hidden="true">→</span></Link></div>
      <div className="cheque-summary">
        <div className="cheque-balance"><span>30 gün içinde beklenen net etki</span><strong className={otuzGunTahsilat - otuzGunOdeme < 0 ? "is-negative" : "is-positive"}>{para(otuzGunTahsilat - otuzGunOdeme, true)}</strong><div><p><i className="is-in" />Tahsil edilecek <b>{para(otuzGunTahsilat, true)}</b></p><p><i className="is-out" />Ödenecek <b>{para(otuzGunOdeme, true)}</b></p></div></div>
        <div className="cheque-periods">{[
          ["Vadesi geçmiş", vadeOzeti.gecikenAlinan, vadeOzeti.gecikenVerilen, "danger"], ["Bugün", vadeOzeti.bugunAlinan, vadeOzeti.bugunVerilen, "urgent"], ["Önümüzdeki 7 gün", vadeOzeti.haftaAlinan, vadeOzeti.haftaVerilen, "warning"], ["8–30 gün", vadeOzeti.ayAlinan, vadeOzeti.ayVerilen, "calm"],
        ].map(([etiket, alinan, verilen, ton]) => { const a = alinan as { adet: number; tutar: number }; const v = verilen as { adet: number; tutar: number }; return <Link href="/panel/kasa-banka/cek-senet" className={`cheque-period is-${ton}`} key={etiket as string}><span>{etiket as string}</span><div><p><small>Tahsilat</small><strong>{para(a.tutar, true)}</strong><em>{a.adet} kayıt</em></p><p><small>Ödeme</small><strong>{para(v.tutar, true)}</strong><em>{v.adet} kayıt</em></p></div></Link>; })}</div>
      </div>
      <div className="cheque-upcoming"><div className="cheque-upcoming__head"><strong>Yaklaşan kayıtlar</strong><span>Vade önceliğine göre</span></div>{yakinCekler.length ? yakinCekler.map((cek) => { const gun = gunFarki(cek.vadeTarihi); return <Link href="/panel/kasa-banka/cek-senet" className="cheque-row" key={cek.id}><span className={`cheque-row__date${gun <= 0 ? " is-danger" : gun <= 3 ? " is-warning" : ""}`}><b>{tarih(cek.vadeTarihi).split(" ")[0]}</b><small>{tarih(cek.vadeTarihi).split(" ")[1]}</small></span><span className="cheque-row__party"><strong>{cek.cari?.unvan || cek.borclu}</strong><small>{cek.tur === "cek" ? "Çek" : "Senet"} · {cek.portfoyNo}{cek.banka ? ` · ${cek.banka}` : ""}</small></span><span className={`cheque-row__direction is-${cek.yon}`}><small>{cek.yon === "alinan" ? "Tahsil edilecek" : "Ödenecek"}</small><strong>{para(cek.tutarTry, true)}</strong></span><span className={`cheque-row__due${gun <= 0 ? " is-danger" : gun <= 3 ? " is-warning" : ""}`}>{vadeMetni(gun)}</span><em aria-hidden="true">→</em></Link>; }) : <div className="cheque-empty"><span aria-hidden="true">✓</span><div><strong>Yaklaşan çek veya senet yok</strong><p>Önümüzdeki 30 gün için açık kayıt bulunmuyor.</p></div></div>}</div>
    </section>}
  </div>;
}
