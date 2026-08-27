"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";

type Rol = "yonetici" | "muhasebe" | "satis" | "salt_okunur" | "mali_musavir" | "b2b_bayi" | "uretim_planlama" | "uretim_operatoru" | "depo" | "kalite" | "maliyet_muhasebesi";
interface FinansOzet { nakitVarliklar: string; envanterDegeri: string; toplamAlacaklar: string; toplamBorclar: string; netVarlikDegeri: string; }
interface FaturaKuyrukOzeti { taslakSatis: number; taslakAlis: number; ebelgeHata: number; acikTahsilat: number; acikOdeme: number; }
interface CekSenet { id: string; tur: "cek" | "senet"; yon: "alinan" | "verilen"; portfoyNo: string; vadeTarihi: string; tutarTry: string; borclu: string; durum: string; banka?: string | null; cari?: { unvan: string } | null; }
interface IsOgesi { href: string; baslik: string; aciklama: string; sayi: number; ton: "danger" | "warning" | "neutral"; }
interface GunlukOzet { satis: { toplam: string; adet: number }; tahsilat: { toplam: string; adet: number }; }
interface DovizKurlari { kurTarihi: string; oncekiIsGunuKullanildi?: boolean; kurlar: Record<string, number>; }
interface VadesiGecenSatir { faturaId: string; no: string | null; cariId: string; cariUnvan: string; vadeTarihi: string; gecikmeGun: number; kalanTry: string; tip: "satis" | "alis"; }
interface VadesiGecenler { alacaklar: VadesiGecenSatir[]; borclar: VadesiGecenSatir[]; toplamAlacak: string; toplamBorc: string; }

const rolAdi: Record<Rol, string> = { yonetici: "Yönetim görünümü", muhasebe: "Muhasebe görünümü", satis: "Satış görünümü", salt_okunur: "Genel görünüm", mali_musavir: "Mali müşavir görünümü", b2b_bayi: "Bayi görünümü", uretim_planlama: "Üretim planlama görünümü", uretim_operatoru: "Operatör görünümü", depo: "Depo görünümü", kalite: "Kalite görünümü", maliyet_muhasebesi: "Maliyet görünümü" };
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
  const [gunluk, setGunluk] = useState<GunlukOzet | null>(null);
  const [alisKurlari, setAlisKurlari] = useState<DovizKurlari | null>(null);
  const [satisKurlari, setSatisKurlari] = useState<DovizKurlari | null>(null);
  const [vadesiGecenler, setVadesiGecenler] = useState<VadesiGecenler | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true); setHata("");
    try {
      const [ben, firmaVeri] = await Promise.all([api<{ rol: Rol }>("/auth/ben"), api<{ unvan: string }>("/firma")]);
      setRol(ben.rol); setFirma(firmaVeri.unvan);
      const finansalErisim = ben.rol !== "satis";
      const sonuclar = await Promise.allSettled([
        api<FaturaKuyrukOzeti>("/fatura/is-kuyrugu-ozeti"),
        api<{ kritikStok: number }>("/stok/kritik-ozeti"),
        api<GunlukOzet>("/rapor/gunluk"),
        api<DovizKurlari>("/doviz-kurlari?tip=alis"),
        api<DovizKurlari>("/doviz-kurlari?tip=satis"),
        ...(finansalErisim ? [
          api<FinansOzet>("/rapor/ozet"), api<unknown[]>("/kasa-banka/ekstre/satirlar?durum=beklemede"),
          api<unknown[]>("/ebelge/gelen?durum=beklemede"), api<CekSenet[]>("/kasa-banka/cek-senet"), api<VadesiGecenler>("/rapor/vadesi-gecenler"),
        ] : []),
      ]);
      if (sonuclar[0]?.status === "fulfilled") setFatura(sonuclar[0].value as FaturaKuyrukOzeti);
      if (sonuclar[1]?.status === "fulfilled") setKritikStok((sonuclar[1].value as { kritikStok: number }).kritikStok);
      if (sonuclar[2]?.status === "fulfilled") setGunluk(sonuclar[2].value as GunlukOzet);
      if (sonuclar[3]?.status === "fulfilled") setAlisKurlari(sonuclar[3].value as DovizKurlari);
      if (sonuclar[4]?.status === "fulfilled") setSatisKurlari(sonuclar[4].value as DovizKurlari);
      if (finansalErisim) {
        if (sonuclar[5]?.status === "fulfilled") setFinans(sonuclar[5].value as FinansOzet);
        if (sonuclar[6]?.status === "fulfilled") setEkstre((sonuclar[6].value as unknown[]).length);
        if (sonuclar[7]?.status === "fulfilled") setGelen((sonuclar[7].value as unknown[]).length);
        if (sonuclar[8]?.status === "fulfilled") setCekler(sonuclar[8].value as CekSenet[]);
        if (sonuclar[9]?.status === "fulfilled") setVadesiGecenler(sonuclar[9].value as VadesiGecenler);
        else setVadesiGecenler({ alacaklar: [], borclar: [], toplamAlacak: "0.00", toplamBorc: "0.00" });
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
  const varlikKalemleri = [
    { etiket: "Nakit ve banka", tutar: nakit, ton: "teal" },
    { etiket: "Açık hesap alacakları", tutar: Number(finans?.toplamAlacaklar ?? 0), ton: "blue" },
    { etiket: "Stok", tutar: Number(finans?.envanterDegeri ?? 0), ton: "violet" },
  ];
  const toplamVarlik = varlikKalemleri.reduce((toplam, kalem) => toplam + kalem.tutar, 0);
  const borcKalemleri = [
    { etiket: "Tedarikçi borçları", tutar: Number(finans?.toplamBorclar ?? 0), ton: "orange" },
    { etiket: "Yaklaşan çek ve senetler", tutar: otuzGunOdeme, ton: "red" },
  ];
  const toplamBorc = borcKalemleri.reduce((toplam, kalem) => toplam + kalem.tutar, 0);

  const isler: IsOgesi[] = rol === "satis" ? [
    { href: "/panel/fatura?yon=satis&odeme=acik", baslik: "Açık tahsilatlar", aciklama: "Müşteri takibi bekleyen satış faturaları", sayi: fatura?.acikTahsilat ?? 0, ton: "warning" },
    { href: "/panel/fatura?yon=satis&durum=taslak", baslik: "Taslak satış faturaları", aciklama: "Kesinleştirilmeyi bekleyen kayıtlar", sayi: fatura?.taslakSatis ?? 0, ton: "neutral" },
    { href: "/panel/stok?durum=kritik", baslik: "Kritik stoklar", aciklama: "Satışı etkileyebilecek düşük stoklar", sayi: kritikStok, ton: kritikStok ? "danger" : "neutral" },
  ] : [
    { href: "/panel/fatura?yon=satis&durum=taslak", baslik: "Taslak satış faturaları", aciklama: "Kesinleştirilmeyi bekleyen kayıtlar", sayi: fatura?.taslakSatis ?? 0, ton: "neutral" },
    { href: "/panel/stok?durum=kritik", baslik: "Kritik stoklar", aciklama: "Satışı etkileyebilecek düşük stoklar", sayi: kritikStok, ton: kritikStok ? "danger" : "neutral" },
    { href: "/panel/fatura?ebelge=hata", baslik: "e-Belge hataları", aciklama: "Müdahale edilmesi gereken gönderimler", sayi: fatura?.ebelgeHata ?? 0, ton: (fatura?.ebelgeHata ?? 0) ? "danger" : "neutral" },
    { href: "/panel/kasa-banka/cek-senet?durum=vadesi-gecmis", baslik: "Vadesi geçen çekler", aciklama: "Tahsilat veya ödeme işlemi bekleyen kayıtlar", sayi: vadeOzeti.gecikenAlinan.adet + vadeOzeti.gecikenVerilen.adet, ton: "danger" },
    { href: "/panel/fatura/gelen-kutusu?durum=beklemede", baslik: "Bekleyen alış e-Belgeleri", aciklama: "Kontrol ve eşleştirme kuyruğu", sayi: gelen, ton: "warning" },
    { href: "/panel/kasa-banka/ekstre?durum=beklemede", baslik: "Eşleşmemiş banka hareketleri", aciklama: "Cari veya faturayla ilişkilendirilecek satırlar", sayi: ekstre, ton: "warning" },
  ];

  const tarihBasligi = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", color: "#0f172a", margin: "-20px -24px", padding: "24px 32px" }}>
      {/* Header Banner */}
      <header style={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <span style={{ backgroundColor: "#ffedd5", color: "#c2410c", padding: "3px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "700" }}>
              {rol ? rolAdi[rol] : "Finansal Kontrol Merkezi"}
            </span>
            <span style={{ fontSize: "12px", color: "#94a3b8" }}>•</span>
            <span style={{ fontSize: "13px", color: "#64748b" }}>{tarihBasligi.charAt(0).toUpperCase() + tarihBasligi.slice(1)}</span>
          </div>
          <h1 style={{ fontSize: "26px", fontWeight: "800", color: "#0f172a", margin: "4px 0" }}>{firma}</h1>
          <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>İşletmenizin anlık finansal ve operasyonel canlı durumu</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "12px", color: "#94a3b8", fontWeight: "500" }}>
            {sonGuncelleme ? `Son güncelleme: ${sonGuncelleme.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : "Yükleniyor..."}
          </span>
          <button
            disabled={yukleniyor}
            onClick={() => void yukle()}
            style={{ padding: "9px 16px", backgroundColor: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "10px", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "#334155", display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>↻</span> {yukleniyor ? "Yenileniyor..." : "Yenile"}
          </button>
          <Link href="/panel/fatura/yeni?yon=satis" style={{ padding: "9px 18px", backgroundColor: "#e8792b", color: "#ffffff", borderRadius: "10px", textDecoration: "none", fontSize: "13px", fontWeight: "700", boxShadow: "0 4px 12px rgba(232, 121, 43, 0.25)", display: "flex", alignItems: "center", gap: "6px" }}>
            <span>+</span> Yeni İşlem
          </Link>
        </div>
      </header>

      {hata && (
        <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "12px", padding: "12px 20px", color: "#991b1b", fontSize: "13px", fontWeight: "500", marginBottom: "24px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span>⚠️</span> {hata}
        </div>
      )}

      {/* Daily Strip (Satış & Tahsilat & Kurlar) */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px", marginBottom: "28px" }}>
        <Link href={`/panel/fatura?yon=satis&baslangic=${new Date().toISOString().slice(0, 10)}&bitis=${new Date().toISOString().slice(0, 10)}`} style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "14px", border: "1px solid #e2e8f0", textDecoration: "none", boxShadow: "0 1px 3px rgba(0,0,0,0.03)", display: "block" }}>
          <div style={{ color: "#64748b", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>Bugünkü Satış Hacmi</div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", marginBottom: "4px" }}>{gunluk ? para(gunluk.satis.toplam) : "—"}</div>
          <div style={{ fontSize: "12px", color: "#16a34a", fontWeight: "600" }}>{gunluk?.satis.adet ?? 0} adet kesinleşmiş satış faturası · Detayları Gör →</div>
        </Link>

        <Link href={`/panel/kasa-banka?baslangic=${new Date().toISOString().slice(0, 10)}&bitis=${new Date().toISOString().slice(0, 10)}&tur=tahsilat`} style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "14px", border: "1px solid #e2e8f0", textDecoration: "none", boxShadow: "0 1px 3px rgba(0,0,0,0.03)", display: "block" }}>
          <div style={{ color: "#64748b", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>Bugünkü Tahsilat</div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", marginBottom: "4px" }}>{gunluk ? para(gunluk.tahsilat.toplam) : "—"}</div>
          <div style={{ fontSize: "12px", color: "#e8792b", fontWeight: "600" }}>{gunluk?.tahsilat.adet ?? 0} tahsilat kaydı · Detayları Gör →</div>
        </Link>

        <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "14px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "13px", fontWeight: "600", marginBottom: "10px" }}>
            <span>TCMB Döviz Kurları</span>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>{alisKurlari?.kurTarihi ?? "Canlı"}</span>
          </div>
          <div style={{ display: "flex", gap: "20px", fontSize: "13px" }}>
            <div>
              <div style={{ fontWeight: "700", color: "#0f172a" }}>USD</div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>Alış: <strong style={{ color: "#0f172a" }}>{alisKurlari?.kurlar.USD?.toFixed(4) ?? "—"}</strong></div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>Satış: <strong style={{ color: "#0f172a" }}>{satisKurlari?.kurlar.USD?.toFixed(4) ?? "—"}</strong></div>
            </div>
            <div style={{ borderLeft: "1px solid #f1f5f9", paddingLeft: "20px" }}>
              <div style={{ fontWeight: "700", color: "#0f172a" }}>EUR</div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>Alış: <strong style={{ color: "#0f172a" }}>{alisKurlari?.kurlar.EUR?.toFixed(4) ?? "—"}</strong></div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>Satış: <strong style={{ color: "#0f172a" }}>{satisKurlari?.kurlar.EUR?.toFixed(4) ?? "—"}</strong></div>
            </div>
          </div>
        </div>
      </section>

      {/* Main KPI Grid */}
      {rol !== "satis" && (
        <section style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: "800", color: "#0f172a", margin: 0 }}>Finansal Varlık & Borç Durumu</h2>
            <Link href="/panel/raporlar" style={{ fontSize: "13px", color: "#e8792b", fontWeight: "700", textDecoration: "none" }}>Tüm Detaylı Raporlar →</Link>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
            <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "14px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>Nakit ve Banka</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "6px 0 4px 0" }}>{finans ? para(finans.nakitVarliklar, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: cekSonrasiNakit < 0 ? "#dc2626" : "#16a34a", fontWeight: "600" }}>
                30 günlük çek etkisi: {finans ? para(cekSonrasiNakit, true) : "—"}
              </div>
            </div>

            <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "14px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>Müşteri Alacakları</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "6px 0 4px 0" }}>{finans ? para(finans.toplamAlacaklar, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Açık satış faturaları bakiyesi</div>
            </div>

            <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "14px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>Tedarikçi Borçları</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "6px 0 4px 0" }}>{finans ? para(finans.toplamBorclar, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Açık alış faturaları borcu</div>
            </div>

            <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "14px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>Stok Değeri</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "6px 0 4px 0" }}>{finans ? para(finans.envanterDegeri, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: kritikStok ? "#dc2626" : "#64748b", fontWeight: "600" }}>
                {kritikStok ? `${kritikStok} ürün kritik stokta` : "Kritik stok yok"}
              </div>
            </div>

            <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "14px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>Net Varlık Degeri</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "6px 0 4px 0" }}>{finans ? para(finans.netVarlikDegeri, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Nakit + alacak + envanter - borç</div>
            </div>
          </div>
        </section>
      )}

      {/* Two Column Layout (Task List & Quick Actions) */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px", marginBottom: "28px" }}>

        {/* Priority Task List Card */}
        <div style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "16px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Öncelikli Operasyonel İşler</h3>
              <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0 0" }}>Aksiyon almanız gereken bekleyen süreçler</p>
            </div>
            <span style={{ backgroundColor: "#f1f5f9", color: "#475569", padding: "4px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "700" }}>
              {isler.reduce((toplam, is) => toplam + is.sayi, 0)} Açık İş
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {isler.map((is) => (
              <Link
                href={is.href}
                key={is.baslik}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", backgroundColor: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: "12px", textDecoration: "none", transition: "all 0.2s" }}
              >
                <div>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a" }}>{is.baslik}</div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>{is.aciklama}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{
                    backgroundColor: is.ton === "danger" ? "#fee2e2" : is.ton === "warning" ? "#fef3c7" : "#e2e8f0",
                    color: is.ton === "danger" ? "#dc2626" : is.ton === "warning" ? "#b45309" : "#475569",
                    padding: "4px 10px",
                    borderRadius: "10px",
                    fontSize: "12px",
                    fontWeight: "800"
                  }}>
                    {is.sayi}
                  </span>
                  <span style={{ color: "#94a3b8", fontWeight: "bold" }}>→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Quick Shortcuts */}
        <div style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "16px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
          <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: "0 0 16px 0" }}>Hızlı Kısayollar</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            {(rol === "satis" ? [
              ["SF", "Satış Faturası", "/panel/fatura/yeni?yon=satis"],
              ["TK", "Teklif Oluştur", "/panel/belgeler/yeni?yon=satis&tur=teklif"],
              ["CR", "Yeni Cari", "/panel/cari/yeni"],
              ["TH", "Tahsilat Al", "/panel/kasa-banka?islem=tahsilat"],
            ] : [
              ["SF", "Satış Faturası", "/panel/fatura/yeni?yon=satis"],
              ["AF", "Alış Faturası", "/panel/fatura/yeni?yon=alis"],
              ["MS", "Masraf Ekle", "/panel/masraflar/yeni"],
              ["TH", "Tahsilat Al", "/panel/kasa-banka?islem=tahsilat"]
            ]).map(([ikon, baslik, href]) => (
              <Link href={href} key={baslik} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "14px", backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", textDecoration: "none", color: "#0f172a" }}>
                <span style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: "#ffedd5", color: "#e8792b", fontWeight: "800", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>{ikon}</span>
                <span style={{ fontSize: "13px", fontWeight: "700" }}>{baslik}</span>
              </Link>
            ))}
          </div>
        </div>

      </div>

      {/* Overdue Tables (Alacak & Borç) */}
      {rol !== "satis" && (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "24px" }}>
          {[{ baslik: "Vadesi Geçmiş Alacaklar", alt: "Müşterilerden tahsil edilecek açık faturalar", toplam: vadesiGecenler?.toplamAlacak, liste: vadesiGecenler?.alacaklar ?? [], renk: "#16a34a", bos: "Vadesi geçmiş alacak yok." }, { baslik: "Vadesi Geçmiş Borçlar", alt: "Tedarikçilere ödenecek açık faturalar", toplam: vadesiGecenler?.toplamBorc, liste: vadesiGecenler?.borclar ?? [], renk: "#dc2626", bos: "Vadesi geçmiş borç yok." }].map((grup) => (
            <div key={grup.baslik} style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "16px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: 0 }}>{grup.baslik}</h3>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0 0" }}>{grup.alt}</p>
                </div>
                <strong style={{ fontSize: "16px", fontWeight: "800", color: grup.renk }}>{vadesiGecenler ? para(grup.toplam ?? 0, true) : "—"}</strong>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {grup.liste.slice(0, 5).map((satir) => (
                  <Link href={`/panel/fatura?faturaId=${satir.faturaId}&panel=odeme`} key={satir.faturaId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", backgroundColor: "#f8fafc", borderRadius: "10px", textDecoration: "none", color: "#0f172a" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: "700" }}>{satir.cariUnvan}</div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>{satir.no || "Fatura"} · Vade: {satir.vadeTarihi}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "13px", fontWeight: "800", color: grup.renk }}>{para(satir.kalanTry, true)}</div>
                      <div style={{ fontSize: "10px", color: "#dc2626", fontWeight: "600" }}>{satir.gecikmeGun} gün gecikti</div>
                    </div>
                  </Link>
                ))}
                {!grup.liste.length && (
                  <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                    {vadesiGecenler ? grup.bos : "Veriler yükleniyor…"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
