"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";
import { finansalOzetGorebilir } from "@/lib/rol-yetkileri";
import { bugunTR, paraBicimle } from "@tekirextra/shared";
import { Para, Tarih } from "@/components/ui";

type Rol = "yonetici" | "muhasebe" | "satis" | "salt_okunur" | "mali_musavir" | "b2b_bayi" | "uretim_planlama" | "uretim_operatoru" | "depo" | "kalite" | "maliyet_muhasebesi" | "ik" | "calisan";
interface FinansOzet { nakitVarliklar: string; envanterDegeri: string; toplamAlacaklar: string; toplamBorclar: string; netVarlikDegeri: string; }
interface FaturaKuyrukOzeti { taslakSatis: number; taslakAlis: number; ebelgeHata: number; acikTahsilat: number; acikOdeme: number; }
interface CekSenet { id: string; tur: "cek" | "senet"; yon: "alinan" | "verilen"; portfoyNo: string; vadeTarihi: string; tutarTry: string; borclu: string; durum: string; banka?: string | null; cari?: { unvan: string } | null; }
interface IsOgesi { href: string; baslik: string; aciklama: string; sayi: number; ton: "danger" | "warning" | "neutral"; }
interface GunlukOzet { satis: { toplam: string; adet: number }; tahsilat: { toplam: string; adet: number }; }
interface DovizKurlari { kurTarihi: string; oncekiIsGunuKullanildi?: boolean; kurlar: Record<string, number>; }
interface VadesiGecenSatir { faturaId: string; no: string | null; cariId: string; cariUnvan: string; vadeTarihi: string; gecikmeGun: number; kalanTry: string; tip: "satis" | "alis"; }
interface VadesiGecenler { alacaklar: VadesiGecenSatir[]; borclar: VadesiGecenSatir[]; toplamAlacak: string; toplamBorc: string; }

const rolAdi: Record<Rol, string> = { yonetici: "Yönetim görünümü", muhasebe: "Muhasebe görünümü", satis: "Satış görünümü", salt_okunur: "Genel görünüm", mali_musavir: "Mali müşavir görünümü", b2b_bayi: "Bayi görünümü", uretim_planlama: "Üretim planlama görünümü", uretim_operatoru: "Operatör görünümü", depo: "Depo görünümü", kalite: "Kalite görünümü", maliyet_muhasebesi: "Maliyet görünümü", ik: "İK görünümü", calisan: "Çalışan görünümü" };
// Biçim tek kaynaktan gelir (packages/shared/bicim); sayfa kendi kuralını kurmaz.
const para = (deger: string | number, sifirBasamak = false) => paraBicimle(deger, { basamak: sifirBasamak ? 0 : 2, bosDeger: paraBicimle(0, { basamak: sifirBasamak ? 0 : 2 }) });
const gunBaslangici = (deger = new Date()) => new Date(deger.getFullYear(), deger.getMonth(), deger.getDate());
const gunFarki = (deger: string) => Math.round((gunBaslangici(new Date(deger)).getTime() - gunBaslangici().getTime()) / 86_400_000);

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
      const ben = await api<{ rol: Rol }>("/auth/ben");
      // PRS-21: çalışanın ana sayfası self-servis.
      if (ben.rol === "calisan") { router.replace("/panel/self-servis"); return; }
      const firmaVeri = await api<{ unvan: string }>("/firma");
      setRol(ben.rol); setFirma(firmaVeri.unvan);
      // RPR-11: finansal özet yalnız finans rollerine; API de aynı rolleri uygular.
      const finansalErisim = finansalOzetGorebilir(ben.rol);
      const sonuclar = await Promise.allSettled([
        api<FaturaKuyrukOzeti>("/fatura/is-kuyrugu-ozeti"),
        api<{ kritikStok: number }>("/stok/kritik-ozeti"),
        finansalErisim || ben.rol === "satis" ? api<GunlukOzet>("/rapor/gunluk") : Promise.resolve(null),
        api<DovizKurlari>("/doviz-kurlari?tip=alis"),
        api<DovizKurlari>("/doviz-kurlari?tip=satis"),
        ...(finansalErisim ? [
          api<FinansOzet>("/rapor/ozet"), api<unknown[]>("/kasa-banka/ekstre/satirlar?durum=beklemede"),
          api<unknown[]>("/ebelge/gelen?durum=beklemede"), api<CekSenet[]>("/kasa-banka/cek-senet"), api<VadesiGecenler>("/rapor/vadesi-gecenler"),
        ] : []),
      ]);
      if (sonuclar[0]?.status === "fulfilled") setFatura(sonuclar[0].value as FaturaKuyrukOzeti);
      if (sonuclar[1]?.status === "fulfilled") setKritikStok((sonuclar[1].value as { kritikStok: number }).kritikStok);
      if (sonuclar[2]?.status === "fulfilled" && sonuclar[2].value) setGunluk(sonuclar[2].value as GunlukOzet);
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
  const otuzGunTahsilat = vadeOzeti.bugunAlinan.tutar + vadeOzeti.haftaAlinan.tutar + vadeOzeti.ayAlinan.tutar;
  const otuzGunOdeme = vadeOzeti.bugunVerilen.tutar + vadeOzeti.haftaVerilen.tutar + vadeOzeti.ayVerilen.tutar;
  const nakit = Number(finans?.nakitVarliklar ?? 0);
  const cekSonrasiNakit = nakit + otuzGunTahsilat - otuzGunOdeme;

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
    <div className="dashboard-home" style={{ minHeight: "100vh", backgroundColor: "var(--bg)", color: "var(--text)", margin: "-20px -24px", padding: "24px 32px" }}>
      {/* Header Banner */}
      <header className="dashboard-home__header" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px", boxShadow: "var(--shadow)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <span style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent-text)", padding: "3px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "700" }}>
              {rol ? rolAdi[rol] : "Finansal Kontrol Merkezi"}
            </span>
            <span style={{ fontSize: "12px", color: "var(--text-subtle)" }}>•</span>
            <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{tarihBasligi.charAt(0).toUpperCase() + tarihBasligi.slice(1)}</span>
          </div>
          <h1 style={{ fontSize: "26px", fontWeight: "800", color: "var(--text)", margin: "4px 0" }}>{firma}</h1>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>İşletmenizin anlık finansal ve operasyonel canlı durumu</p>
        </div>

        <div className="dashboard-home__header-actions" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "12px", color: "var(--text-subtle)", fontWeight: "500" }}>
            {sonGuncelleme ? `Son güncelleme: ${sonGuncelleme.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : "Yükleniyor..."}
          </span>
          <button
            disabled={yukleniyor}
            onClick={() => void yukle()}
            style={{ padding: "9px 16px", backgroundColor: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "10px", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "var(--text)", display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>↻</span> {yukleniyor ? "Yenileniyor..." : "Yenile"}
          </button>
          <Link href="/panel/fatura/yeni?yon=satis" style={{ padding: "9px 18px", backgroundColor: "var(--accent)", color: "#ffffff", borderRadius: "10px", textDecoration: "none", fontSize: "13px", fontWeight: "700", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", gap: "6px" }}>
            <span>+</span> Yeni İşlem
          </Link>
        </div>
      </header>

      {hata && (
        <div style={{ backgroundColor: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: "12px", padding: "12px 20px", color: "var(--danger)", fontSize: "13px", fontWeight: "500", marginBottom: "24px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span>⚠️</span> {hata}
        </div>
      )}

      {/* Daily Strip (Satış & Tahsilat & Kurlar) — RPR-11: satış/tahsilat yalnız finans ve satış rollerine. */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px", marginBottom: "28px" }}>
        {(finansalOzetGorebilir(rol) || rol === "satis") && <>
        <Link href={`/panel/fatura?yon=satis&baslangic=${bugunTR()}&bitis=${bugunTR()}`} style={{ backgroundColor: "var(--surface)", padding: "20px", borderRadius: "14px", border: "1px solid var(--border)", textDecoration: "none", boxShadow: "var(--shadow)", display: "block" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>Bugünkü Satış Hacmi</div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "var(--text)", marginBottom: "4px" }}>{gunluk ? para(gunluk.satis.toplam) : "—"}</div>
          <div style={{ fontSize: "12px", color: "var(--success)", fontWeight: "600" }}>{gunluk?.satis.adet ?? 0} adet kesinleşmiş satış faturası · Detayları Gör →</div>
        </Link>

        <Link href={`/panel/kasa-banka?baslangic=${bugunTR()}&bitis=${bugunTR()}&tur=tahsilat`} style={{ backgroundColor: "var(--surface)", padding: "20px", borderRadius: "14px", border: "1px solid var(--border)", textDecoration: "none", boxShadow: "var(--shadow)", display: "block" }}>
          <div style={{ color: "var(--text-muted)", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>Bugünkü Tahsilat</div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "var(--text)", marginBottom: "4px" }}>{gunluk ? para(gunluk.tahsilat.toplam) : "—"}</div>
          <div style={{ fontSize: "12px", color: "var(--accent)", fontWeight: "600" }}>{gunluk?.tahsilat.adet ?? 0} tahsilat kaydı · Detayları Gör →</div>
        </Link>
        </>}

        <div style={{ backgroundColor: "var(--surface)", padding: "20px", borderRadius: "14px", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)", fontSize: "13px", fontWeight: "600", marginBottom: "10px" }}>
            <span>TCMB Döviz Kurları</span>
            <span style={{ fontSize: "11px", color: "var(--text-subtle)" }}>{alisKurlari?.kurTarihi ?? "Canlı"}</span>
          </div>
          <div style={{ display: "flex", gap: "20px", fontSize: "13px" }}>
            <div>
              <div style={{ fontWeight: "700", color: "var(--text)" }}>USD</div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Alış: <strong style={{ color: "var(--text)" }}>{alisKurlari?.kurlar.USD?.toFixed(4) ?? "—"}</strong></div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Satış: <strong style={{ color: "var(--text)" }}>{satisKurlari?.kurlar.USD?.toFixed(4) ?? "—"}</strong></div>
            </div>
            <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: "20px" }}>
              <div style={{ fontWeight: "700", color: "var(--text)" }}>EUR</div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Alış: <strong style={{ color: "var(--text)" }}>{alisKurlari?.kurlar.EUR?.toFixed(4) ?? "—"}</strong></div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Satış: <strong style={{ color: "var(--text)" }}>{satisKurlari?.kurlar.EUR?.toFixed(4) ?? "—"}</strong></div>
            </div>
          </div>
        </div>
      </section>

      {/* Main KPI Grid */}
      {finansalOzetGorebilir(rol) && (
        <section style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: "800", color: "var(--text)", margin: 0 }}>Finansal Varlık & Borç Durumu</h2>
            <Link href="/panel/raporlar" style={{ fontSize: "13px", color: "var(--accent)", fontWeight: "700", textDecoration: "none" }}>Tüm Detaylı Raporlar →</Link>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "24px 16px", marginTop: "16px" }}>
            {/* 1. Nakit ve Banka - Teal/Yeşil Gradient Icon Header */}
            <div style={{ backgroundColor: "var(--surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow)", position: "relative" }}>
              <div style={{ width: "46px", height: "46px", borderRadius: "12px", background: "linear-gradient(195deg, #66bb6a, #43a047)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginTop: "-36px", marginBottom: "12px", boxShadow: "0 4px 14px rgba(67, 160, 71, 0.4)" }}>
                🏦
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "600" }}>Nakit ve Banka</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--text)", margin: "4px 0" }}>{finans ? para(finans.nakitVarliklar, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: cekSonrasiNakit < 0 ? "var(--danger)" : "var(--success)", fontWeight: "600" }}>
                30 günlük çek etkisi: {finans ? para(cekSonrasiNakit, true) : "—"}
              </div>
            </div>

            {/* 2. Müşteri Alacakları - Mavi Gradient Icon Header */}
            <div style={{ backgroundColor: "var(--surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow)", position: "relative" }}>
              <div style={{ width: "46px", height: "46px", borderRadius: "12px", background: "linear-gradient(195deg, #49a3f1, #1A73E8)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginTop: "-36px", marginBottom: "12px", boxShadow: "0 4px 14px rgba(26, 115, 232, 0.4)" }}>
                📊
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "600" }}>Müşteri Alacakları</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--text)", margin: "4px 0" }}>{finans ? para(finans.toplamAlacaklar, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Açık satış faturaları bakiyesi</div>
            </div>

            {/* 3. Tedarikçi Borçları - Kırmızı/Pembe Gradient Icon Header */}
            <div style={{ backgroundColor: "var(--surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow)", position: "relative" }}>
              <div style={{ width: "46px", height: "46px", borderRadius: "12px", background: "linear-gradient(195deg, #ec407a, #d81b60)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginTop: "-36px", marginBottom: "12px", boxShadow: "0 4px 14px rgba(216, 27, 96, 0.4)" }}>
                💳
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "600" }}>Tedarikçi Borçları</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--text)", margin: "4px 0" }}>{finans ? para(finans.toplamBorclar, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Açık alış faturaları borcu</div>
            </div>

            {/* 4. Stok Değeri - Turuncu Gradient Icon Header */}
            <div style={{ backgroundColor: "var(--surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow)", position: "relative" }}>
              <div style={{ width: "46px", height: "46px", borderRadius: "12px", background: "linear-gradient(195deg, #ffa726, #fb8c00)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginTop: "-36px", marginBottom: "12px", boxShadow: "0 4px 14px rgba(251, 140, 0, 0.4)" }}>
                📦
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "600" }}>Stok Değeri</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--text)", margin: "4px 0" }}>{finans ? para(finans.envanterDegeri, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: kritikStok ? "var(--danger)" : "var(--text-muted)", fontWeight: "600" }}>
                {kritikStok ? `${kritikStok} ürün kritik stokta` : "Kritik stok yok"}
              </div>
            </div>

            {/* 5. Net Varlık Değeri - Koyu/Obsidian Gradient Icon Header */}
            <div style={{ backgroundColor: "var(--surface)", padding: "20px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow)", position: "relative" }}>
              <div style={{ width: "46px", height: "46px", borderRadius: "12px", background: "linear-gradient(195deg, #42424a, #191919)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginTop: "-36px", marginBottom: "12px", boxShadow: "0 4px 14px rgba(25, 25, 25, 0.4)" }}>
                💎
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "600" }}>Net Varlık Değeri</span>
              <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--text)", margin: "4px 0" }}>{finans ? para(finans.netVarlikDegeri, true) : "—"}</div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Nakit + alacak + envanter - borç</div>
            </div>
          </div>
        </section>
      )}

      {/* Two Column Layout (Task List & Quick Actions) */}
      <div className="dashboard-home__operations" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px", marginBottom: "28px" }}>

        {/* Priority Task List Card */}
        <div style={{ backgroundColor: "var(--surface)", padding: "24px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text)", margin: 0 }}>Öncelikli Operasyonel İşler</h3>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "2px 0 0 0" }}>Aksiyon almanız gereken bekleyen süreçler</p>
            </div>
            <span style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)", fontSize: "12px", fontWeight: "700", padding: "2px 10px", borderRadius: "12px" }}>
              {isler.reduce((toplam, is) => toplam + is.sayi, 0)} Açık İş
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {isler.map((is) => (
              <Link
                key={is.baslik}
                href={is.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--surface-2)",
                  textDecoration: "none",
                  transition: "all 0.15s ease"
                }}
              >
                <div>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--text)" }}>{is.baslik}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{is.aciklama}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{
                    backgroundColor: is.ton === "danger" ? "var(--danger-soft)" : is.ton === "warning" ? "var(--warning-soft)" : "var(--surface)",
                    color: is.ton === "danger" ? "var(--danger)" : is.ton === "warning" ? "var(--warning)" : "var(--text-muted)",
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: "800"
                  }}>
                    {is.sayi} Adet
                  </span>
                  <span style={{ color: "var(--text-subtle)", fontSize: "14px" }}>→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Quick Actions & AI Card */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ backgroundColor: "var(--surface)", padding: "24px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text)", margin: "0 0 14px 0" }}>Hızlı Operasyonlar</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {(rol === "satis" ? [
                ["📄", "Satış Faturası Kes", "/panel/fatura/yeni?yon=satis"],
                ["📝", "Teklif Oluştur", "/panel/belgeler/yeni?yon=satis&tur=teklif"],
                ["👥", "Yeni Cari Kartı Aç", "/panel/cari/yeni"],
                ["💳", "Tahsilat Al", "/panel/kasa-banka?islem=tahsilat"],
              ] : [
                ["📄", "Satış Faturası Kes", "/panel/fatura/yeni?yon=satis"],
                ["🧾", "Alış Faturası Gir", "/panel/fatura/yeni?yon=alis"],
                ["📎", "Masraf Ekle", "/panel/masraflar/yeni"],
                ["💳", "Tahsilat Al", "/panel/kasa-banka?islem=tahsilat"],
              ]).map(([ikon, baslik, href]) => (
                <Link key={baslik} href={href} style={{ padding: "12px 14px", backgroundColor: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "10px", textDecoration: "none", fontSize: "13px", fontWeight: "600", color: "var(--text)", display: "flex", alignItems: "center", gap: "10px" }}>
                  <span aria-hidden="true">{ikon}</span> {baslik}
                </Link>
              ))}
            </div>
          </div>

          <div style={{ backgroundColor: "var(--accent-soft)", border: "1px solid var(--border)", borderRadius: "16px", padding: "20px" }}>
            <div style={{ fontSize: "11px", color: "var(--accent-text)", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>✨ AI Akıllı Öneri</div>
            <h4 style={{ fontSize: "14px", fontWeight: "700", color: "var(--accent-text)", margin: "0 0 6px 0" }}>Banka Ekstresi Eşleştirme</h4>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
              Son aktarılan banka ekstrenizde {ekstre} adet işlenmemiş hareket bulundu. Yapay zeka ile otomatik cari eşleştirmesi yapabilirsiniz.
            </p>
          </div>
        </div>

      </div>

      {/* Overdue Tables (Alacak & Borç) — RPR-11: finans rollerine. */}
      {finansalOzetGorebilir(rol) && (
        <section className="dashboard-home__overdue" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "24px" }}>
          {[{ baslik: "Vadesi Geçmiş Alacaklar", alt: "Müşterilerden tahsil edilecek açık faturalar", toplam: vadesiGecenler?.toplamAlacak, liste: vadesiGecenler?.alacaklar ?? [], renk: "var(--success)", bos: "Vadesi geçmiş alacak yok." }, { baslik: "Vadesi Geçmiş Borçlar", alt: "Tedarikçilere ödenecek açık faturalar", toplam: vadesiGecenler?.toplamBorc, liste: vadesiGecenler?.borclar ?? [], renk: "var(--danger)", bos: "Vadesi geçmiş borç yok." }].map((grup) => (
            <div key={grup.baslik} style={{ backgroundColor: "var(--surface)", padding: "24px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text)", margin: 0 }}>{grup.baslik}</h3>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "2px 0 0 0" }}>{grup.alt}</p>
                </div>
                <strong style={{ fontSize: "16px", fontWeight: "800", color: grup.renk }}>{vadesiGecenler ? para(grup.toplam ?? 0, true) : "—"}</strong>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {grup.liste.slice(0, 5).map((satir) => (
                  <Link href={`/panel/fatura?faturaId=${satir.faturaId}&panel=odeme`} key={satir.faturaId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", backgroundColor: "var(--surface-2)", borderRadius: "10px", textDecoration: "none", color: "var(--text)" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: "700" }}>{satir.cariUnvan}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{satir.no || "Fatura"} · Vade: <Tarih deger={satir.vadeTarihi} /></div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "13px", fontWeight: "800", color: grup.renk }}><Para basamak={0} deger={satir.kalanTry} /></div>
                      <div style={{ fontSize: "10px", color: "var(--danger)", fontWeight: "600" }}>{satir.gecikmeGun} gün gecikti</div>
                    </div>
                  </Link>
                ))}
                {!grup.liste.length && (
                  <div style={{ padding: "20px", textAlign: "center", color: "var(--text-subtle)", fontSize: "13px" }}>
                    {vadesiGecenler ? grup.bos : "Veriler yükleniyor…"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {finansalOzetGorebilir(rol) && (
        <section style={{ marginTop: "24px", backgroundColor: "var(--surface)", padding: "24px", borderRadius: "16px", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text)", margin: 0 }}>Bekleyen çek ve senetler</h3>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "2px 0 0" }}>Tahsilat ve ödeme tarihi yaklaşan portföy kayıtları</p>
            </div>
            <Link href="/panel/kasa-banka/cek-senet" style={{ fontSize: "12px", color: "var(--accent)", fontWeight: "700", textDecoration: "none" }}>Tümünü görüntüle →</Link>
          </div>
          {!aktifCekler.length ? (
            <div style={{ padding: "18px", textAlign: "center", color: "var(--text-subtle)", fontSize: "13px" }}>Bekleyen çek veya senet bulunmuyor.</div>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              {aktifCekler.slice().sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi)).slice(0, 8).map((cek) => {
                const kalanGun = gunFarki(cek.vadeTarihi);
                const renk = cek.yon === "alinan" ? "var(--success)" : "var(--danger)";
                return <Link href={`/panel/kasa-banka/cek-senet?odak=${cek.id}`} key={cek.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "11px 14px", borderRadius: "10px", border: "1px solid var(--border)", backgroundColor: "var(--surface-2)", textDecoration: "none", color: "var(--text)" }}>
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: "13px", fontWeight: "700" }}>{cek.cari?.unvan ?? cek.borclu}</div><div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{cek.tur === "cek" ? "Çek" : "Senet"} · {cek.yon === "alinan" ? "Tahsil edilecek" : "Ödenecek"} · Vade <Tarih deger={cek.vadeTarihi} /></div></div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}><div style={{ fontSize: "13px", fontWeight: "800", color: renk }}><Para basamak={0} deger={cek.tutarTry} /></div><div style={{ fontSize: "10px", color: kalanGun < 0 ? "var(--danger)" : "var(--text-muted)", fontWeight: "600" }}>{kalanGun < 0 ? `${Math.abs(kalanGun)} gün gecikti` : kalanGun === 0 ? "Bugün" : `${kalanGun} gün kaldı`}</div></div>
                </Link>;
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
