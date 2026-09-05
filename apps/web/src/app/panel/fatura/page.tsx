"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { kullanimOlayi } from "@/lib/kullanim";
import { AramaSecici } from "@/components/arama-secici";
import { DepoSecici } from "@/components/depo-secici";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { BelgeDosyalari, belgeDosyalariniYukle } from "@/components/belge-dosyalari";
import { FaturaEkPaneli } from "@/components/fatura-ek-paneli";
import { UrunSecimModali } from "@/components/urun-secim-modali";
import { faturaHesapla, type FaturaHesaplaSatirGirdi } from "@tekirextra/shared";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  TableWrap,
} from "@/components/ui";

interface Cari {
  id: string;
  kod?: string;
  unvan: string;
  vknTckn?: string | null;
  telefon?: string | null;
}

interface CariSecimOzeti extends Cari {
  bakiyeler: { dovizCinsi: string; bakiye: string }[];
  risk: { mevcutRisk: string; limit: string | null; kalanLimit: string | null; asim: boolean };
  varsayilanVadeGun?: number | null;
  eFaturaMukellefi?: boolean | null;
}

interface Stok {
  id: string;
  kod: string;
  ad: string;
  barkod?: string | null;
  tedarikciUrunKodlari?: string[];
  anaBirim?: string;
  kullanilabilirMiktar?: string;
  alisFiyati: string | null;
  satisFiyati: string | null;
  kdvOrani: string;
  takipTipi?: "yok" | "lot" | "seri";
}
interface StokVaryant { id: string; kod: string; ad: string; barkod: string | null; satisFiyati: string | null; alisFiyati: string | null; mevcutMiktar: string; aktif: boolean }
interface Proje { id: string; kod: string; ad: string; durum: string; altKirilimlar?: { id: string; kod: string; ad: string }[] }

interface FaturaSatir {
  stokId: string;
  varyantId?: string;
  miktar: number;
  birimFiyat: number;
  iskontoOrani: number;
  kdvOrani: number;
  gibIstisnaKodu?: string;
  projeId?: string;
  projeAltKirilimId?: string;
  lotNo?: string; seriNolar?: string; sonKullanmaTarihi?: string; uretimTarihi?: string;
}

interface Fatura {
  id: string;
  no: string | null;
  tip: string;
  tarih: string;
  vadeTarihi?: string | null;
  siparisNo?: string | null;
  siparisTarihi?: string | null;
  aciklama?: string | null;
  durum: string;
  toplamMatrah: string;
  toplamKdv: string;
  genelToplam: string;
  cari: { unvan: string };
  /** API iç içe döner; gönderilmemiş faturada null. */
  ebelge?: { id: string; durum: string; tur: string } | null;
  odemeOzeti?: { durum: "beklemede" | "odenmedi" | "kismi" | "odendi"; odenen: string; kalan: string };
}

interface FaturaDetay extends Fatura {
  cari: { id: string; kod: string; unvan: string; vknTckn: string | null; eFaturaMukellefi: boolean | null };
  dovizCinsi: string;
  notlar?: string | null;
  depoId?: string | null;
  satirlar: { stokId: string; varyantId?: string | null; stokKod: string; stokAd: string; miktar: string; birim: string; birimFiyat: string; iskontoOrani: string; kdvOrani: string; gibIstisnaKodu?: string | null }[];
  ebelge?: {
    id: string;
    durum: string;
    tur: string;
    entegratorRef: string | null;
    hataMesaji: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  odemeOzeti: {
    durum: "beklemede" | "odenmedi" | "kismi" | "odendi";
    odenen: string;
    kalan: string;
    hareketler: {
      id: string;
      tip: string;
      tutar: string;
      dovizCinsi: string;
      tarih: string;
      aciklama: string | null;
      hesap: string;
      createdAt: string;
    }[];
  };
}

interface KesinlestirmeOzeti {
  fatura: FaturaDetay;
  risk: { mevcutRisk: string; limit: string | null; kalanLimit: string | null; asim: boolean } | null;
}
interface EbelgeWizardBilgisi {
  gonderilebilir: boolean;
  neden?: string;
  faturaNo?: string | null;
  cari: string;
  vknTckn?: string | null;
  saglayici?: string;
  not?: string;
}
interface KayitliGorunum { id: string; ad: string; yon: "satis" | "alis" | null; durum: string | null; ebelge: string | null; odeme: string | null; }
const GORUNUM_ANAHTARI = "tekir_fatura_gorunumleri";

/** FaturaTip enum'u; iade ve proforma da listede ayırt edilmeli. */
const TIP_ETIKETLERI: Record<string, string> = {
  satis: "📤 Satış",
  alis: "📥 Alış",
  satis_iade: "↩️ Satış İade",
  alis_iade: "↪️ Alış İade",
  proforma: "📄 Proforma",
};

/** BelgeDurum enum'u (EBLG-04). */
const EBELGE_DURUMLARI: Record<string, { baslik: string; renk: "info" | "success" | "danger" | "neutral" }> = {
  kuyrukta: { baslik: "⚙ Kuyrukta", renk: "info" },
  iletildi: { baslik: "📨 İletildi", renk: "info" },
  kabul: { baslik: "✓ Kabul", renk: "success" },
  ret: { baslik: "⛔ Ret", renk: "danger" },
  hata: { baslik: "⚠ Hata", renk: "danger" },
};

const ODEME_DURUMLARI: Record<string, { baslik: string; renk: "info" | "success" | "danger" | "neutral" }> = {
  beklemede: { baslik: "Beklemede", renk: "neutral" },
  odenmedi: { baslik: "Ödenmedi", renk: "danger" },
  kismi: { baslik: "Kısmi ödendi", renk: "info" },
  odendi: { baslik: "Ödendi", renk: "success" },
};

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
const KAYDEDILMEMIS_DEGISIKLIK_UYARISI = "Bu faturadaki kaydedilmemiş değişiklikler silinecek. Formdan ayrılmak istiyor musunuz?";

export default function FaturaSayfasi() {
  const pathname = usePathname(); const router = useRouter(); const yeniSayfasi = pathname.endsWith("/yeni");
  const [faturalar, setFaturalar] = useState<Fatura[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [stoklar, setStoklar] = useState<Stok[]>([]);
  const [projeler, setProjeler] = useState<Proje[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [epostaGonderilen, setEpostaGonderilen] = useState<Fatura | null>(null);
  const [ekleriAcikFatura, setEkleriAcikFatura] = useState<Fatura | null>(null);
  const [epostaAdresi, setEpostaAdresi] = useState("");
  const [formAcik, setFormAcik] = useState(yeniSayfasi);
  const [duzenlenenId, setDuzenlenenId] = useState<string | null>(null);
  const [yonBaglami, setYonBaglami] = useState<"satis" | "alis" | null>(null);
  const [durumFiltresi, setDurumFiltresi] = useState<string | null>(null);
  const [ebelgeFiltresi, setEbelgeFiltresi] = useState<string | null>(null);
  const [odemeFiltresi, setOdemeFiltresi] = useState<string | null>(null);
  // Komut paleti ve derin bağlantılar fatura numarasıyla gelebilir; sunucu
  // tarafı arama olmadan aranan kayıt ilk sayfada olmayabilir.
  const [aramaFiltresi, setAramaFiltresi] = useState<string | null>(null);
  const [odakFaturaId, setOdakFaturaId] = useState<string | null>(null);
  const [kayitliGorunumler, setKayitliGorunumler] = useState<KayitliGorunum[]>([]);
  const [gorunumFormuAcik, setGorunumFormuAcik] = useState(false);
  const [gorunumAdi, setGorunumAdi] = useState("");
  const [acikSatir, setAcikSatir] = useState<number | null>(null);
  const urunRefleri = useRef<Array<HTMLInputElement | null>>([]);
  const cariRef = useRef<HTMLInputElement | null>(null);
  const faturaBaslangicRef = useRef<number | null>(null);
  useEffect(() => { if (yeniSayfasi) { setFormAcik(true); faturaBaslangicRef.current = Date.now(); } }, [yeniSayfasi]);
  const istenenFaturaImlecleri = useRef(new Set<string>());
  const faturaYuklemeSirasi = useRef(0);
  const miktarRefleri = useRef<Array<HTMLInputElement | null>>([]);
  const [hizliPanel, setHizliPanel] = useState<"cari" | "stok" | null>(null);
  const [hizliStokSatir, setHizliStokSatir] = useState(0);
  const [hizliHata, setHizliHata] = useState("");
  const [yeniCariKod, setYeniCariKod] = useState("");
  const [yeniCariUnvan, setYeniCariUnvan] = useState("");
  const [yeniCariVkn, setYeniCariVkn] = useState("");
  const [yeniStokKod, setYeniStokKod] = useState("");
  const [yeniStokAd, setYeniStokAd] = useState("");
  const [yeniStokBarkod, setYeniStokBarkod] = useState("");
  const [yeniStokKdv, setYeniStokKdv] = useState("20");
  const [yeniStokFiyat, setYeniStokFiyat] = useState("");
  const [kesinlestirmeOzeti, setKesinlestirmeOzeti] = useState<KesinlestirmeOzeti | null>(null);
  const [ebelgeWizard, setEbelgeWizard] = useState<{ fatura: Fatura; bilgi: EbelgeWizardBilgisi } | null>(null);
  const [ebelgeDetayi, setEbelgeDetayi] = useState<FaturaDetay | null>(null);
  const [odemeDetayi, setOdemeDetayi] = useState<FaturaDetay | null>(null);
  const [sonrakiFaturaImleci, setSonrakiFaturaImleci] = useState<string | null>(null);
  const [cariDogrulamaHatasi, setCariDogrulamaHatasi] = useState("");
  const [satirDogrulamaHatalari, setSatirDogrulamaHatalari] = useState<number[]>([]);
  const [urunModali, setUrunModali] = useState<{ satir: number; stokId?: string } | null>(null);
  const [faturaListesiYukleniyor, setFaturaListesiYukleniyor] = useState(false);
  const [faturaFiltreleriHazir, setFaturaFiltreleriHazir] = useState(false);

  // Form alanları
  const [cariId, setCariId] = useState("");
  const [cariOzeti, setCariOzeti] = useState<CariSecimOzeti | null>(null);
  const [depoId, setDepoId] = useState("");
  const [tip, setTip] = useState("satis");
  const [gelirTuru, setGelirTuru] = useState<string>("ticari_satis");
  const [dovizCinsi, setDovizCinsi] = useState("TRY");
  const [kur, setKur] = useState("1");
  const [kurBilgisi, setKurBilgisi] = useState("");
  const [tarih, setTarih] = useState(new Date().toISOString().substring(0, 10));
  const [vadeTarihi, setVadeTarihi] = useState("");
  const [vadeElleDegisti, setVadeElleDegisti] = useState(false);
  const [siparisNo, setSiparisNo] = useState("");
  const [siparisTarihi, setSiparisTarihi] = useState("");
  const [faturaNo, setFaturaNo] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [kuruAciklamayaEkle, setKuruAciklamayaEkle] = useState(true);
  const [notlar, setNotlar] = useState("");
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [satirlar, setSatirlar] = useState<FaturaSatir[]>([
    { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" },
  ]);
  const [stokVaryantlari, setStokVaryantlari] = useState<Record<string, StokVaryant[]>>({});
  const bugun = new Date().toISOString().substring(0, 10);
  const formKirli = formAcik && (
    cariId !== "" || depoId !== "" || tip !== (yonBaglami ?? "satis") || tarih !== bugun
    || dovizCinsi !== "TRY" || kur !== "1" || aciklama.trim() !== "" || notlar.trim() !== "" || dosyalar.length > 0 || satirlar.length !== 1
    || satirlar.some((satir) => satir.stokId !== "" || satir.miktar !== 1 || satir.birimFiyat !== 0 || satir.iskontoOrani !== 0 || satir.kdvOrani !== 20 || Boolean(satir.gibIstisnaKodu))
  );

  useEffect(() => {
    if (!formKirli) return;
    const ayrilmayiEngelle = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const uygulamaIciGecisiKoru = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const baglanti = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!baglanti || baglanti.target === "_blank" || baglanti.hasAttribute("download")) return;
      const hedef = new URL(baglanti.href, window.location.href);
      if (hedef.origin !== window.location.origin || hedef.href === window.location.href) return;
      if (!window.confirm(KAYDEDILMEMIS_DEGISIKLIK_UYARISI)) {
        event.preventDefault();
        // Next Link kendi document listener'ını da çalıştırmamalı; yalnızca
        // stopPropagation aynı hedefteki listener'ları durdurmaz.
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", ayrilmayiEngelle);
    document.addEventListener("click", uygulamaIciGecisiKoru, true);
    return () => {
      window.removeEventListener("beforeunload", ayrilmayiEngelle);
      document.removeEventListener("click", uygulamaIciGecisiKoru, true);
    };
  }, [formKirli]);

  // Önizleme hesaplamaları
  const girdiSatirlar: FaturaHesaplaSatirGirdi[] = satirlar.map((s) => ({
    stokId: s.stokId || "gecici-id",
    miktar: s.miktar,
    birimFiyat: s.birimFiyat,
    kdvOrani: s.kdvOrani,
    iskontoOrani: s.iskontoOrani,
  }));
  const sonuc = faturaHesapla({ satirlar: girdiSatirlar });

  const yukle = useCallback(async (imlec?: string) => {
    if (imlec && istenenFaturaImlecleri.current.has(imlec)) return;
    if (imlec) istenenFaturaImlecleri.current.add(imlec); else istenenFaturaImlecleri.current.clear();
    const istekSirasi = ++faturaYuklemeSirasi.current;
    setHata(""); setFaturaListesiYukleniyor(true);
    try {
      const parametreler = new URLSearchParams();
      if (yonBaglami) parametreler.set("yon", yonBaglami);
      if (durumFiltresi) parametreler.set("durum", durumFiltresi);
      if (ebelgeFiltresi) parametreler.set("ebelge", ebelgeFiltresi);
      if (aramaFiltresi) parametreler.set("arama", aramaFiltresi);
      if (imlec) parametreler.set("imlec", imlec);
      const sorgu = parametreler.size ? `?${parametreler.toString()}` : "";
      const fVeri = await api<{ kayitlar: Fatura[]; sonrakiImlec: string | null }>(`/fatura${sorgu}`);
      if (istekSirasi !== faturaYuklemeSirasi.current) return;
      setFaturalar((eskiler) => imlec ? [...eskiler, ...fVeri.kayitlar] : fVeri.kayitlar);
      setSonrakiFaturaImleci(fVeri.sonrakiImlec);
    } catch (h) {
      if (istekSirasi === faturaYuklemeSirasi.current) {
        if (imlec) istenenFaturaImlecleri.current.delete(imlec);
        setHata(h instanceof Error ? h.message : "Yükleme hatası");
      }
    } finally {
      if (istekSirasi === faturaYuklemeSirasi.current) setFaturaListesiYukleniyor(false);
    }
  }, [yonBaglami, durumFiltresi, ebelgeFiltresi, aramaFiltresi]);

  useEffect(() => {
    if (tokenAl()) {
      tumSayfalariAl<Cari>("/cari").then(setCariler).catch(() => undefined);
      tumSayfalariAl<Stok>("/stok").then(setStoklar).catch(() => undefined);
      api<Proje[]>("/projeler").then(setProjeler).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (faturaFiltreleriHazir && tokenAl()) {
      void yukle();
    }
  }, [faturaFiltreleriHazir, yukle]);

  useEffect(() => {
    const parametreler = new URLSearchParams(window.location.search);
    const yon = parametreler.get("yon");
    if (yon === "satis" || yon === "alis") {
      setYonBaglami(yon);
      setTip(yon);
    } else setYonBaglami(null);
    if (parametreler.get("yeni") === "1" && !yeniSayfasi) {
      // Çalışma alanı bağlantıları liste bağlamını koruyarak yeni formu açar.
      // Ayrı /yeni rotasına zorunlu yönlendirme, hızlı geçişlerde formun
      // açılmadan kalmasına ve erişilebilirlik testlerinde başlığın kaybolmasına
      // neden olabiliyordu.
      setFormAcik(true);
      faturaBaslangicRef.current ??= Date.now();
      return;
    }
    const duzenleId = parametreler.get("duzenle");
    if (yeniSayfasi && duzenleId) {
      void api<FaturaDetay>(`/fatura/${duzenleId}`).then((fatura) => {
        if ((fatura.durum !== "taslak" && !(fatura.durum === "kesin" && !fatura.ebelge)) || fatura.ebelge) throw new Error("Bu fatura artık düzenlenemez.");
        setDuzenlenenId(fatura.id); setTip(fatura.tip); setFaturaNo(fatura.no ?? ""); setTarih(fatura.tarih.slice(0, 10)); setDovizCinsi(fatura.dovizCinsi); setVadeTarihi(fatura.vadeTarihi?.slice(0, 10) ?? ""); setSiparisNo(fatura.siparisNo ?? ""); setSiparisTarihi(fatura.siparisTarihi?.slice(0, 10) ?? ""); setVadeElleDegisti(true);
        setCariId(fatura.cari.id); setDepoId(fatura.depoId ?? ""); setAciklama(fatura.aciklama ?? ""); setNotlar(fatura.notlar ?? "");
        setSatirlar(fatura.satirlar.map((satir) => ({
          stokId: satir.stokId, varyantId: satir.varyantId ?? undefined,
          miktar: Number(satir.miktar), birimFiyat: Number(satir.birimFiyat),
          iskontoOrani: Number(satir.iskontoOrani), kdvOrani: Number(satir.kdvOrani),
          gibIstisnaKodu: satir.gibIstisnaKodu ?? "",
          projeId: (satir as any).projeId ?? (satir as any).proje?.id ?? undefined,
          projeAltKirilimId: (satir as any).projeAltKirilimId ?? (satir as any).projeAltKirilim?.id ?? undefined,
        })));
      }).catch((h) => setHata(h instanceof Error ? h.message : "Fatura düzenleme için açılamadı"));
    }
    setDurumFiltresi(parametreler.get("durum"));
    setEbelgeFiltresi(parametreler.get("ebelge"));
    setAramaFiltresi(parametreler.get("arama"));
    setOdemeFiltresi(parametreler.get("odeme"));
    const faturaId = parametreler.get("faturaId");
    setOdakFaturaId(faturaId);
    if (faturaId && parametreler.get("panel") === "ebelge") void ebelgeDetayAc(faturaId);
    if (faturaId && parametreler.get("panel") === "odeme") void odemeDetayAc(faturaId);
    try { setKayitliGorunumler(JSON.parse(localStorage.getItem(GORUNUM_ANAHTARI) ?? "[]") as KayitliGorunum[]); }
    catch { localStorage.removeItem(GORUNUM_ANAHTARI); }
    setFaturaFiltreleriHazir(true);
  }, [router, yeniSayfasi]);

  function filtreleriUygula(filtreler: Omit<KayitliGorunum, "id" | "ad">) {
    setHata("");
    setYonBaglami(filtreler.yon); setDurumFiltresi(filtreler.durum); setEbelgeFiltresi(filtreler.ebelge); setOdemeFiltresi(filtreler.odeme);
    const parametreler = new URLSearchParams();
    if (filtreler.yon) parametreler.set("yon", filtreler.yon);
    if (filtreler.durum) parametreler.set("durum", filtreler.durum);
    if (filtreler.ebelge) parametreler.set("ebelge", filtreler.ebelge);
    if (filtreler.odeme) parametreler.set("odeme", filtreler.odeme);
    window.history.replaceState(null, "", "/panel/fatura" + (parametreler.size ? "?" + parametreler.toString() : ""));
  }

  function filtreDegistir(alan: "durum" | "ebelge" | "odeme", deger: string) {
    filtreleriUygula({ yon: yonBaglami, durum: alan === "durum" ? deger || null : durumFiltresi, ebelge: alan === "ebelge" ? deger || null : ebelgeFiltresi, odeme: alan === "odeme" ? deger || null : odemeFiltresi });
  }

  function gorunumKaydet(event: React.FormEvent) {
    event.preventDefault(); const ad = gorunumAdi.trim(); if (!ad) return;
    const yeni: KayitliGorunum = { id: Date.now().toString(), ad, yon: yonBaglami, durum: durumFiltresi, ebelge: ebelgeFiltresi, odeme: odemeFiltresi };
    const gorunumler = [...kayitliGorunumler.filter((g) => g.ad.toLocaleLowerCase("tr-TR") !== ad.toLocaleLowerCase("tr-TR")), yeni];
    setKayitliGorunumler(gorunumler); localStorage.setItem(GORUNUM_ANAHTARI, JSON.stringify(gorunumler));
    setGorunumAdi(""); setGorunumFormuAcik(false); setBasari("“" + ad + "” görünümü kaydedildi.");
    kullanimOlayi("gorunum_kaydedildi");
  }

  function gorunumSil(id: string) {
    const gorunumler = kayitliGorunumler.filter((gorunum) => gorunum.id !== id);
    setKayitliGorunumler(gorunumler); localStorage.setItem(GORUNUM_ANAHTARI, JSON.stringify(gorunumler));
  }
  function gorunumUygula(gorunum: KayitliGorunum) { filtreleriUygula(gorunum); kullanimOlayi("gorunum_kullanildi"); }
  function formuSifirla() {
    setCariId(""); setCariOzeti(null); setDepoId(""); setTip(yonBaglami ?? "satis"); setGelirTuru("ticari_satis"); setTarih(new Date().toISOString().substring(0, 10)); setDovizCinsi("TRY"); setKur("1");
    setAciklama(""); setKuruAciklamayaEkle(true); setFaturaNo("");
    setNotlar(""); setVadeTarihi(""); setVadeElleDegisti(false); setSiparisNo(""); setSiparisTarihi("");
    setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" }]); setAcikSatir(null);
    setDosyalar([]);
    setCariDogrulamaHatasi(""); setSatirDogrulamaHatalari([]);
  }

  function faturaFormunuAcKapat() {
    if (formAcik) {
      if (formKirli && !window.confirm(KAYDEDILMEMIS_DEGISIKLIK_UYARISI)) return;
      if (faturaBaslangicRef.current !== null) kullanimOlayi("fatura_form_terk", Date.now() - faturaBaslangicRef.current);
      faturaBaslangicRef.current = null; setFormAcik(false); formuSifirla(); return;
    }
    faturaBaslangicRef.current = Date.now(); kullanimOlayi("fatura_form_acildi"); setFormAcik(true);
  }

  useEffect(() => {
    if (!cariId || !tokenAl()) {
      setCariOzeti(null);
      return;
    }
    let gecerli = true;
    api<CariSecimOzeti>(`/cari/${cariId}`)
      .then((ozet) => { if (gecerli) setCariOzeti(ozet); })
      .catch(() => { if (gecerli) setCariOzeti(null); });
    return () => { gecerli = false; };
  }, [cariId]);

  useEffect(() => {
    if (!cariOzeti || vadeElleDegisti || duzenlenenId) return;
    const temel = new Date(`${tarih}T00:00:00`);
    temel.setDate(temel.getDate() + (cariOzeti.varsayilanVadeGun ?? 0));
    setVadeTarihi(temel.toISOString().slice(0, 10));
  }, [cariOzeti, tarih, vadeElleDegisti, duzenlenenId]);

  useEffect(() => {
    if (dovizCinsi === "TRY") { setKur("1"); setKurBilgisi(""); return; }
    let gecerli = true;
    api<{ kaynak: string; kurTarihi: string; oncekiIsGunuKullanildi: boolean; kurlar: Record<string, number> }>(`/doviz-kurlari?tarih=${tarih}&tip=alis`)
      .then((veri) => { if (gecerli && veri.kurlar[dovizCinsi]) { setKur(String(veri.kurlar[dovizCinsi])); setKurBilgisi(`${veri.kaynak === "TCMB_XML" ? "TCMB" : "TCMB EVDS"} · ${veri.kurTarihi}${veri.oncekiIsGunuKullanildi ? " (önceki iş günü)" : ""}`); } })
      .catch(() => { if (gecerli) setKurBilgisi("TCMB kuru alınamadı; manuel kur girin"); });
    return () => { gecerli = false; };
  }, [dovizCinsi, tarih]);

  function satirEkle() {
    const yeniIndex = satirlar.length;
    setSatirlar([...satirlar, { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" }]);
    requestAnimationFrame(() => urunRefleri.current[yeniIndex]?.focus());
  }

  function satirKopyala(index: number) {
    const yeni = [...satirlar];
    yeni.splice(index + 1, 0, { ...satirlar[index] });
    setSatirlar(yeni);
    setAcikSatir(null);
    requestAnimationFrame(() => miktarRefleri.current[index + 1]?.focus());
  }

  function satirSil(index: number) {
    if (satirlar.length === 1) return;
    setSatirlar(satirlar.filter((_, i) => i !== index));
    setAcikSatir(null);
  }

  async function satirGuncelle(index: number, alan: keyof FaturaSatir, deger: string | number) {
    const yeni = [...satirlar];
    yeni[index] = { ...yeni[index], [alan]: deger };

    // Eğer stok seçildiyse varsayılan fiyatları yükleyelim
    if (alan === "stokId") {
      yeni[index].varyantId = undefined;
      const stok = stoklar.find((s) => s.id === deger);
      if (stok) {
        yeni[index].kdvOrani = Number(stok.kdvOrani || 20);
      }
      if (deger) {
        try {
          const tavsiye = await api<{ birimFiyat: number; iskontoOrani: number }>(
            `/stok/${deger}/tavsiye-fiyat?cariId=${cariId}&tip=${tip}&dovizCinsi=${dovizCinsi}`
          );
          yeni[index].birimFiyat = tavsiye.birimFiyat;
          yeni[index].iskontoOrani = tavsiye.iskontoOrani;
        } catch (err) {
          console.error("Tavsiye fiyat alınamadı", err);
        }
      }
    }
    setSatirlar(yeni);
  }

  function urunSec(index: number, deger: string) {
    if (deger && satirlar[index].stokId === deger) {
      setSatirlar((eskiler) => eskiler.map((satir, satirIndex) =>
        satirIndex === index ? { ...satir, miktar: Number(satir.miktar) + 1 } : satir,
      ));
      return;
    }
    void satirGuncelle(index, "stokId", deger);
    if (deger && !stokVaryantlari[deger]) void api<{ varyantlar: StokVaryant[] }>(`/stok/${deger}`).then((detay) => setStokVaryantlari((eskiler) => ({ ...eskiler, [deger]: detay.varyantlar })));
  }

  async function hizliCariOlustur(event: React.FormEvent) {
    event.preventDefault();
    setHizliHata("");
    try {
      const yeni = await api<Cari>("/cari", {
        method: "POST",
        body: JSON.stringify({
          kod: yeniCariKod,
          unvan: yeniCariUnvan,
          tip: tip.startsWith("alis") ? "tedarikci" : "musteri",
          kisiTipi: "tuzel",
          vknTckn: yeniCariVkn || undefined,
        }),
      });
      setCariler((eskiler) => [yeni, ...eskiler]);
      setCariId(yeni.id);
      setHizliPanel(null);
      setYeniCariKod("");
      setYeniCariUnvan("");
      setYeniCariVkn("");
      setBasari(`${yeni.unvan} oluşturuldu ve faturaya seçildi.`);
    } catch (h) {
      setHizliHata(h instanceof Error ? h.message : "Cari oluşturulamadı");
    }
  }

  async function hizliStokOlustur(event: React.FormEvent) {
    event.preventDefault();
    setHizliHata("");
    try {
      const yeni = await api<Stok>("/stok", {
        method: "POST",
        body: JSON.stringify({
          kod: yeniStokKod,
          ad: yeniStokAd,
          tip: "urun",
          barkod: yeniStokBarkod || null,
          kdvOrani: yeniStokKdv,
          alisFiyati: tip.startsWith("alis") && yeniStokFiyat ? yeniStokFiyat : null,
          satisFiyati: !tip.startsWith("alis") && yeniStokFiyat ? yeniStokFiyat : null,
        }),
      });
      setStoklar((eskiler) => [yeni, ...eskiler]);
      setSatirlar((eskiler) => eskiler.map((satir, index) =>
        index === hizliStokSatir
          ? {
              ...satir,
              stokId: yeni.id,
              kdvOrani: Number(yeni.kdvOrani),
              birimFiyat: Number(tip.startsWith("alis") ? yeni.alisFiyati ?? 0 : yeni.satisFiyati ?? 0),
            }
          : satir,
      ));
      setHizliPanel(null);
      setYeniStokKod("");
      setYeniStokAd("");
      setYeniStokBarkod("");
      setYeniStokKdv("20");
      setYeniStokFiyat("");
      setBasari(`${yeni.ad} oluşturuldu ve satıra seçildi.`);
      requestAnimationFrame(() => miktarRefleri.current[hizliStokSatir]?.focus());
    } catch (h) {
      setHizliHata(h instanceof Error ? h.message : "Ürün oluşturulamadı");
    }
  }

  useEffect(() => {
    // Düzenlemede faturaya kaydedilmiş ticari fiyat korunur; güncel fiyat
    // listesi yalnız yeni faturada cari/tip seçimi değiştiğinde uygulanır.
    if (duzenlenenId) return;
    if (cariId && satirlar.some((s) => s.stokId)) {
      const guncelleFiyatlar = async () => {
        const yeni = [...satirlar];
        for (let i = 0; i < yeni.length; i++) {
          if (yeni[i].stokId) {
            try {
              const tavsiye = await api<{ birimFiyat: number; iskontoOrani: number }>(
                `/stok/${yeni[i].stokId}/tavsiye-fiyat?cariId=${cariId}&tip=${tip}`
              );
              yeni[i].birimFiyat = tavsiye.birimFiyat;
              yeni[i].iskontoOrani = tavsiye.iskontoOrani;
            } catch (err) {
              console.error(err);
            }
          }
        }
        setSatirlar(yeni);
      };
      void guncelleFiyatlar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cariId, tip, dovizCinsi, duzenlenenId]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");

    const eksikSatirlar = satirlar.flatMap((satir, index) => satir.stokId ? [] : [index]);
    setCariDogrulamaHatasi(cariId ? "" : "Faturayı kaydetmek için müşteri veya tedarikçi seçin.");
    setSatirDogrulamaHatalari(eksikSatirlar);
    if (!cariId || eksikSatirlar.length > 0) {
      setHata(!cariId ? "Lütfen bir cari hesap seçin." : "Lütfen tüm satırlarda ürün/hizmet seçimi yapın.");
      kullanimOlayi("fatura_dogrulama_hatasi");
      requestAnimationFrame(() => (!cariId ? cariRef.current : urunRefleri.current[eksikSatirlar[0]])?.focus());
      return;
    }

    try {
      const kurAciklamasi = kuruAciklamayaEkle && dovizCinsi !== "TRY" ? `Döviz kuru: 1 ${dovizCinsi} = ${Number(kur).toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 6 })} TRY${kurBilgisi ? ` (${kurBilgisi})` : ""}` : "";
      const kullaniciAciklamasi = aciklama.split("\n").filter((satir) => !satir.startsWith("Döviz kuru:")).join("\n").trim();
      const kayitAciklamasi = [kullaniciAciklamasi, kurAciklamasi].filter(Boolean).join("\n");
      if (kayitAciklamasi.length > 500) { setHata("Açıklama, döviz kuru bilgisiyle birlikte 500 karakteri aşamaz."); return; }
      const kayit = await api<Fatura>(duzenlenenId ? `/fatura/${duzenlenenId}` : "/fatura", {
        method: duzenlenenId ? "PATCH" : "POST",
        body: JSON.stringify({
          cariId,
          // STK-07: boş bırakılırsa sunucu varsayılan depoyu kullanır
          depoId: depoId || null,
          tip,
          gelirTuru: tip === "satis" ? gelirTuru : undefined,
          tarih,
          dovizCinsi,
          kur,
          vadeTarihi: vadeTarihi || null,
          siparisNo: siparisNo.trim() || null,
          siparisTarihi: siparisTarihi || null,
          aciklama: kayitAciklamasi || null,
          notlar: notlar.trim() || null,
          satirlar: satirlar.map((s) => ({
            stokId: s.stokId,
            varyantId: s.varyantId || null,
            miktar: String(s.miktar),
            birim: "adet",
            birimFiyat: String(s.birimFiyat),
            iskontoOrani: String(s.iskontoOrani),
            kdvOrani: String(s.kdvOrani),
            gibIstisnaKodu: s.gibIstisnaKodu || undefined,
            projeId: s.projeId || undefined,
            projeAltKirilimId: s.projeAltKirilimId || undefined,
            partiBilgileri: (() => {
              const stok = stoklar.find((x) => x.id === s.stokId);
              if (!(["alis", "satis_iade"].includes(tip)) || !stok?.takipTipi || stok.takipTipi === "yok") return [];
              if (stok.takipTipi === "seri") return (s.seriNolar ?? "").split(/[\n,;]/).map((x) => x.trim()).filter(Boolean).map((seriNo) => ({ lotNo: s.lotNo || seriNo, seriNo, sonKullanmaTarihi: s.sonKullanmaTarihi || null, uretimTarihi: s.uretimTarihi || null, miktar: "1" }));
              return [{ lotNo: s.lotNo ?? "", seriNo: null, sonKullanmaTarihi: s.sonKullanmaTarihi || null, uretimTarihi: s.uretimTarihi || null, miktar: String(s.miktar) }];
            })(),
          })),
        }),
      });

      if (dosyalar.length > 0) await belgeDosyalariniYukle("fatura", kayit.id, dosyalar);

      setBasari(duzenlenenId ? "Fatura taslağı güncellendi." : "Fatura taslağı başarıyla oluşturuldu.");
      kullanimOlayi("fatura_tamamlandi", faturaBaslangicRef.current === null ? undefined : Date.now() - faturaBaslangicRef.current);
      faturaBaslangicRef.current = null;
      setFormAcik(false);
      formuSifirla();
      void yukle();
      if (yeniSayfasi) router.push("/panel/fatura");
    } catch (h) {
      kullanimOlayi("fatura_dogrulama_hatasi");
      setHata(h instanceof Error ? h.message : "Fatura oluşturulamadı");
    }
  }

  async function kesinlestir(id: string, belgeNo?: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}/kesinlestir`, { method: "POST", body: JSON.stringify({ no: belgeNo?.trim() || undefined }) });
      setKesinlestirmeOzeti(null);
      setBasari("Fatura kesinleştirildi. e-Fatura gönderimi için e-Fatura Oluştur wizard'ını kullanın.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kesinleştirme hatası");
    }
  }

  async function iptalEt(id: string) {
    if (!window.confirm("Bu taslak faturayı iptal etmek istediğinize emin misiniz? Kayıt, iptal durumuyla korunacaktır.")) return;
    setHata(""); setBasari("");
    try { await api(`/fatura/${id}/iptal`, { method: "POST" }); setBasari("Fatura iptal edildi."); void yukle(); }
    catch (h) { setHata(h instanceof Error ? h.message : "Fatura iptal edilemedi"); }
  }

  async function kesinlestirmeOzetiAc(id: string) {
    setHata("");
    try {
      const fatura = await api<FaturaDetay>(`/fatura/${id}`);
      const cari = await api<CariSecimOzeti>(`/cari/${fatura.cari.id}`);
      setFaturaNo(fatura.no ?? "");
      setKesinlestirmeOzeti({ fatura, risk: cari.risk });
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kesinleştirme özeti yüklenemedi");
    }
  }

  async function sil(id: string) {
    if (!confirm("Taslak faturayı silmek istediğinize emin misiniz?")) return;
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}`, { method: "DELETE" });
      setBasari("Fatura başarıyla silindi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Silme hatası");
    }
  }

  async function kopyala(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}/kopyala`, { method: "POST" });
      setBasari("Fatura başarıyla kopyalandı ve taslak olarak kaydedildi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kopyalama hatası");
    }
  }

  async function ebelgeSorgula(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/ebelge/sorgula/${id}`, { method: "POST" });
      setBasari("e-Belge durum sorgusu kuyruğa alındı; sonuç otomatik güncellenecek.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Sorgulama hatası");
    }
  }

  async function ebelgeDetayAc(id: string) {
    setHata("");
    try {
      setEbelgeDetayi(await api<FaturaDetay>(`/fatura/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "e-Belge ayrıntısı yüklenemedi");
    }
  }

  async function ebelgeWizardAc(fatura: Fatura) {
    setHata(""); setBasari("");
    try {
      const bilgi = await api<EbelgeWizardBilgisi>(`/ebelge/wizard/${fatura.id}`);
      setEbelgeWizard({ fatura, bilgi });
    } catch (h) { setHata(h instanceof Error ? h.message : "e-Fatura wizard'ı açılamadı"); }
  }

  async function ebelgeWizardGonder() {
    if (!ebelgeWizard) return;
    setHata(""); setBasari("");
    try {
      await api(`/ebelge/gonder/${ebelgeWizard.fatura.id}`, { method: "POST" });
      setEbelgeWizard(null);
      setBasari("e-Belge oluşturuldu ve entegratöre gönderim kuyruğuna alındı.");
      void yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "e-Belge gönderilemedi"); }
  }

  async function odemeDetayAc(id: string) {
    setHata("");
    try {
      setOdemeDetayi(await api<FaturaDetay>(`/fatura/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Ödeme ayrıntısı yüklenemedi");
    }
  }

  function odemeKaydinaGit(fatura: FaturaDetay) {
    const islem = ["satis", "alis_iade"].includes(fatura.tip) ? "tahsilat" : "tediye";
    const parametreler = new URLSearchParams({
      islem,
      cariId: fatura.cari.id,
      faturaId: fatura.id,
      tutar: fatura.odemeOzeti.kalan,
      aciklama: `${fatura.no ?? "Fatura"} ${islem === "tahsilat" ? "tahsilatı" : "ödemesi"}`,
    });
    window.location.href = `/panel/kasa-banka?${parametreler.toString()}`;
  }

  async function ebelgeYenidenGonder(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/ebelge/gonder/${id}`, { method: "POST" });
      setBasari("e-Belge yeniden gönderildi.");
      setEbelgeDetayi(await api<FaturaDetay>(`/fatura/${id}`));
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "e-Belge yeniden gönderilemedi");
    }
  }

  async function earsivIptalBildir(id: string) {
    if (!confirm("Bu faturanın iptalini Sovos e-Arşiv servisine bildirmek istediğinize emin misiniz?")) return;
    setHata(""); setBasari("");
    try {
      await api(`/ebelge/earsiv/${id}/iptal-bildir`, { method: "POST", body: JSON.stringify({ iptalTarihi: new Date().toISOString() }) });
      setBasari("e-Arşiv iptali Sovos'a bildirildi.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "e-Arşiv iptali bildirilemedi");
    }
  }

  /** FTR-09: proformadan yeni taslak satış faturası üretir. */
  async function satisaDonustur(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/fatura/${id}/satisa-donustur`, { method: "POST" });
      setBasari("Proforma, taslak satış faturasına dönüştürüldü.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Dönüştürme hatası");
    }
  }

  /** Boş bırakılırsa API carinin kayıtlı e-postasına gönderir. */
  async function epostaGonder(id: string, eposta: string) {
    setHata("");
    setBasari("");
    try {
      const yanit = await api<{ alici: string }>(`/fatura/${id}/pdf-gonder`, {
        method: "POST",
        body: JSON.stringify(eposta.trim() === "" ? {} : { eposta: eposta.trim() }),
      });
      setBasari(`Fatura PDF'i ${yanit.alici} adresine gönderildi.`);
      setEpostaGonderilen(null);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "E-posta gönderilemedi");
    }
  }

  function pdfAc(id: string) {
    const token = tokenAl();
    const url = `${apiBase()}/fatura/${id}/pdf?token=${token ?? ""}`;
    window.open(url, "_blank");
  }

  const gorunenFaturalar = faturalar.filter((f) =>
      (!yonBaglami || (yonBaglami === "satis"
          ? ["satis", "satis_iade", "proforma"].includes(f.tip)
          : ["alis", "alis_iade"].includes(f.tip))) &&
      (!durumFiltresi || f.durum === durumFiltresi) &&
      (!ebelgeFiltresi || (ebelgeFiltresi === "hata" ? ["hata", "ret"].includes(f.ebelge?.durum ?? "") : f.ebelge?.durum === ebelgeFiltresi)) &&
      (!odemeFiltresi || (odemeFiltresi === "acik" && ["odenmedi", "kismi"].includes(f.odemeOzeti?.durum ?? ""))) &&
      (!odakFaturaId || f.id === odakFaturaId),
    );
  useEffect(() => {
    if (odemeFiltresi === "acik" && !odakFaturaId && gorunenFaturalar.length === 0 && sonrakiFaturaImleci && !faturaListesiYukleniyor && !hata) {
      void yukle(sonrakiFaturaImleci);
    }
  }, [odemeFiltresi, odakFaturaId, gorunenFaturalar.length, sonrakiFaturaImleci, faturaListesiYukleniyor, hata, yukle]);

  const odakFatura = odakFaturaId ? faturalar.find((fatura) => fatura.id === odakFaturaId) : null;
  const sayfaBasligi =
    yonBaglami === "satis"
      ? "Satış Faturaları"
      : yonBaglami === "alis"
        ? "Alış Faturaları"
        : "Fatura Yönetimi";

  return (
    <div className={yeniSayfasi ? "create-page" : undefined}>
      <PageHeader
        title={sayfaBasligi}
        subtitle={
          yonBaglami === "satis"
            ? "Müşteri faturalarını hazırlayın, kesinleştirin ve e-Belge durumlarını takip edin."
            : yonBaglami === "alis"
              ? "Tedarikçi faturalarını kaydedin ve ödeme sürecine hazırlayın."
              : "Alış ve satış faturalarını tek görünümde yönetin."
        }
        actions={
          <>
            <ButtonLabel as="a" href="/panel/fatura/raporlar">📈 Raporlar</ButtonLabel>
            {yeniSayfasi ? <Button onClick={() => router.push("/panel/fatura")}>Listeye dön</Button> : <ButtonLabel as="a" role="button" variant="primary" href={`/panel/fatura/yeni${yonBaglami ? `?yon=${yonBaglami}` : ""}`}>➕ Yeni Fatura</ButtonLabel>}
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {odakFaturaId && (
        <Card className="between" style={{ marginBottom: "1rem", borderColor: "var(--accent)" }}>
          <div><strong>Belge zincirinden açılan fatura</strong><div className="muted">{odakFatura?.no ?? odakFaturaId}{odakFatura ? " · " + odakFatura.cari.unvan : ""}</div></div>
          <Button size="sm" type="button" onClick={() => { setOdakFaturaId(null); setAramaFiltresi(null); window.history.replaceState(null, "", "/panel/fatura"); }}>Tüm faturaları göster</Button>
        </Card>
      )}

      <section className="saved-view-bar" aria-label="Fatura görünümü ve filtreleri">
        <div className="saved-view-filters">
          <Field label="Fatura durumu"><Select aria-label="Fatura durumu" value={durumFiltresi ?? ""} onChange={(e) => filtreDegistir("durum", e.target.value)}><option value="">Tümü</option><option value="taslak">Taslak</option><option value="kesin">Kesinleşmiş</option></Select></Field>
          <Field label="e-Belge durumu"><Select aria-label="e-Belge durumu" value={ebelgeFiltresi ?? ""} onChange={(e) => filtreDegistir("ebelge", e.target.value)}><option value="">Tümü</option><option value="hata">Hata / Ret</option><option value="kuyrukta">Kuyrukta</option><option value="iletildi">İletildi</option><option value="kabul">Kabul</option></Select></Field>
          <Field label="Ödeme durumu"><Select aria-label="Ödeme durumu" value={odemeFiltresi ?? ""} onChange={(e) => filtreDegistir("odeme", e.target.value)}><option value="">Tümü</option><option value="acik">Ödenmedi / Kısmi</option></Select></Field>
          <Field label="Kaydedilmiş görünüm"><Select aria-label="Kaydedilmiş görünüm" value="" onChange={(e) => { const gorunum = kayitliGorunumler.find((g) => g.id === e.target.value); if (gorunum) gorunumUygula(gorunum); }}><option value="">Görünüm seçin</option>{kayitliGorunumler.map((g) => <option value={g.id} key={g.id}>{g.ad}</option>)}</Select></Field>
        </div>
        <div className="saved-view-actions">
          {(durumFiltresi || ebelgeFiltresi || odemeFiltresi) && <Button size="sm" type="button" onClick={() => filtreleriUygula({ yon: yonBaglami, durum: null, ebelge: null, odeme: null })}>Filtreleri temizle</Button>}
          <Button size="sm" type="button" onClick={() => setGorunumFormuAcik((acik) => !acik)}>Görünümü kaydet</Button>
        </div>
        {gorunumFormuAcik && <form className="saved-view-form" onSubmit={gorunumKaydet}><Input autoFocus aria-label="Görünüm adı" value={gorunumAdi} onChange={(e) => setGorunumAdi(e.target.value)} placeholder="Örn. Takip edilecek tahsilatlar" required /><Button size="sm" variant="primary" type="submit">Kaydet</Button><Button size="sm" type="button" onClick={() => setGorunumFormuAcik(false)}>Vazgeç</Button></form>}
        {kayitliGorunumler.length > 0 && <div className="saved-view-list" aria-label="Kaydedilmiş görünümleri yönet">{kayitliGorunumler.map((g) => <span key={g.id}><button type="button" onClick={() => filtreleriUygula(g)}>{g.ad}</button><button aria-label={g.ad + " görünümünü sil"} title="Görünümü sil" type="button" onClick={() => gorunumSil(g.id)}>×</button></span>)}</div>}
      </section>

      {epostaGonderilen && (
        <Card className="stack" style={{ marginBottom: "1.5rem", borderColor: "var(--accent)", maxWidth: 620 }}>
          <div className="between">
            <div className="card__title" style={{ margin: 0 }}>
              ✉️ Fatura PDF&apos;ini E-posta ile Gönder
            </div>
            <Button size="sm" onClick={() => { setEpostaGonderilen(null); setEpostaAdresi(""); }}>✖ Vazgeç</Button>
          </div>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            {epostaGonderilen.no} · {epostaGonderilen.cari.unvan} · {tl(epostaGonderilen.genelToplam)}
          </p>
          <Field label="Alıcı E-posta">
            <Input
              type="email"
              value={epostaAdresi}
              onChange={(e) => setEpostaAdresi(e.target.value)}
              placeholder="Boş bırakılırsa cari kartındaki adres kullanılır"
            />
          </Field>
          <div>
            <Button variant="primary" onClick={() => epostaGonder(epostaGonderilen.id, epostaAdresi)}>
              Gönder
            </Button>
          </div>
        </Card>
      )}

      {formAcik && (
        <div className="document-editor">
          <div className="document-editor__head">
          <h3>{duzenlenenId ? "Faturayı düzenle" : `Yeni ${tip.startsWith("alis") ? (tip === "alis_iade" ? "alış iade" : "alış") : tip === "proforma" ? "proforma" : "satış"} faturası`}</h3>
            <div className="row-tight"><span className="badge badge--warning">Taslak</span>{!yeniSayfasi && <Button size="sm" type="button" onClick={faturaFormunuAcKapat}>Vazgeç</Button>}</div>
          </div>

          <div className="document-editor__section">
            <h4 className="document-editor__section-title">Cari ve belge bilgileri</h4>
            <div className="document-fields">
              <Field label={tip.startsWith("alis") ? "Tedarikçi" : "Müşteri"}>
                <AramaSecici
                  ariaLabel={tip.startsWith("alis") ? "Tedarikçi ara" : "Müşteri ara"}
                  ariaDescribedBy={cariDogrulamaHatasi ? "fatura-cari-hatasi" : undefined}
                  ariaInvalid={Boolean(cariDogrulamaHatasi)}
                  deger={cariId}
                  inputRef={cariRef}
                  kullanimAnahtari="tekir_son_cariler"
                  onChange={(deger) => { setCariId(deger); if (deger) setCariDogrulamaHatasi(""); }}
                  placeholder="Ünvan, cari kodu veya VKN ile ara"
                  yeniKayit={{
                    etiket: tip.startsWith("alis") ? "Yeni tedarikçi oluştur" : "Yeni müşteri oluştur",
                    onClick: () => { setHizliHata(""); setHizliPanel("cari"); },
                  }}
                  secenekler={cariler.map((cari) => ({
                    deger: cari.id,
                    baslik: cari.unvan,
                    aciklama: [cari.kod, cari.vknTckn, cari.telefon].filter(Boolean).join(" · ") || "Cari hesap",
                    aramaMetni: [cari.kod, cari.vknTckn, cari.telefon].filter(Boolean).join(" "),
                  }))}
                />
                {cariDogrulamaHatasi && <p className="field-error" id="fatura-cari-hatasi" role="alert">{cariDogrulamaHatasi}</p>}
              </Field>
              <Field label="Fatura Tipi">
                <Select aria-label="Fatura Tipi" value={tip} onChange={(e) => { setTip(e.target.value); setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]); }}>
                  <option value="satis">Satış Faturası</option>
                  <option value="alis">Alış Faturası</option>
                  {yonBaglami === "alis" && <option value="alis_iade">Alış İade Faturası</option>}
                  <option value="proforma">Proforma</option>
                </Select>
              </Field>
              {tip === "satis" && (
                <Field label="Fatura Kategorisi / Gelir Türü">
                  <Select aria-label="Fatura Kategorisi" value={gelirTuru} onChange={(e) => setGelirTuru(e.target.value)}>
                    <option value="ticari_satis">🛒 Esas Ticari Satış Hasılatı</option>
                    <option value="kira_geliri">🏢 Faaliyet Dışı Kira Geliri</option>
                    <option value="varlik_satisi">🚜 Faaliyet Dışı Varlık / Demirbaş Satışı</option>
                    <option value="yansitma">🔄 Yansıtma / Masraf Aktarımı</option>
                    <option value="hizmet_diger">🌐 Diğer Faaliyet Dışı Gelirler</option>
                  </Select>
                </Field>
              )}
              <Field label="Fatura Tarihi">
                <Input aria-label="Fatura Tarihi" type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} required />
              </Field>
              <Field label="Fatura Dövizi">
                <Select value={dovizCinsi} onChange={(e) => { setDovizCinsi(e.target.value); if (e.target.value === "TRY") setKur("1"); }}>
                  <option value="TRY">TRY — Türk Lirası</option><option value="USD">USD — Amerikan Doları</option><option value="EUR">EUR — Euro</option>
                </Select>
              </Field>
              {dovizCinsi !== "TRY" && <Field label="Kur (1 döviz = TRY)"><Input type="number" min="0.000001" step="0.000001" value={kur} onChange={(e) => { setKur(e.target.value); setKurBilgisi("Manuel kur"); }} required /><small className="muted">{kurBilgisi || "TCMB EVDS kuru yükleniyor…"}</small></Field>}
              <Field label="Vade Tarihi">
                <Input aria-label="Vade Tarihi" type="date" value={vadeTarihi} onChange={(e) => { setVadeTarihi(e.target.value); setVadeElleDegisti(true); }} />
                {cariOzeti?.varsayilanVadeGun != null && <small className="muted">Cari varsayılanı: {cariOzeti.varsayilanVadeGun} gün</small>}
              </Field>
              <Field label="Sipariş No"><Input value={siparisNo} onChange={(e) => setSiparisNo(e.target.value)} maxLength={100} placeholder="Opsiyonel" /></Field>
              <Field label="Sipariş Tarihi"><Input type="date" value={siparisTarihi} onChange={(e) => setSiparisTarihi(e.target.value)} /></Field>
            <div>
              <DepoSecici deger={depoId} onChange={setDepoId} />
            </div>
            <Field label="Notlar">
              <textarea className="input" value={notlar} onChange={(e) => setNotlar(e.target.value)} maxLength={2000} rows={3} placeholder="İç notlar (isteğe bağlı)" />
            </Field>
            </div>
            {cariOzeti && (
              <div className={`customer-context${cariOzeti.risk.asim ? " is-warning" : ""}`}>
                <div><span>TRY bakiye</span><strong>{tl(cariOzeti.bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? 0)}</strong></div>
                <div><span>Mevcut risk</span><strong>{tl(cariOzeti.risk.mevcutRisk)}</strong></div>
                <div><span>Kullanılabilir limit</span><strong>{cariOzeti.risk.kalanLimit === null ? "Limit yok" : tl(cariOzeti.risk.kalanLimit)}</strong></div>
                <div><span>Varsayılan vade</span><strong>{cariOzeti.varsayilanVadeGun ? `${cariOzeti.varsayilanVadeGun} gün` : "Tanımsız"}</strong></div>
                <div><span>e-Belge</span><strong>{cariOzeti.eFaturaMukellefi ? "e-Fatura" : "e-Arşiv"}</strong></div>
                {cariOzeti.risk.asim && <p>Risk limiti aşılmış. Kesinleştirmeden önce cari durumunu kontrol edin.</p>}
              </div>
            )}
          </div>

          <div className="document-editor__section document-lines invoice-lines">
            <div className="between"><h4 className="document-editor__section-title">Fatura kalemleri</h4><Button type="button" variant="primary" onClick={() => setUrunModali({ satir: satirlar.findIndex((s) => !s.stokId) >= 0 ? satirlar.findIndex((s) => !s.stokId) : satirlar.length })}>+ Ürün çağır</Button></div>
            <TableWrap>
              <colgroup>
                <col className="document-line-col--product" />
                <col className="document-line-col--quantity" />
                <col className="document-line-col--price" />
                <col className="document-line-col--rate" />
                <col className="document-line-col--rate" />
                <col className="document-line-col--total" />
                <col className="document-line-col--action" />
              </colgroup>
              <thead>
                <tr>
                  <th>Ürün/Hizmet</th>
                  <th className="num">Miktar</th>
                  <th className="num">Birim fiyat</th>
                  <th className="num">İsk. %</th>
                  <th className="num">KDV %</th>
                  <th className="num">Tutar</th>
                  <th><span className="sr-only">İşlem</span></th>
                </tr>
              </thead>
              <tbody>
                {satirlar.map((s, index) => {
                  const satirSonuc = sonuc.satirlar[index];
                  const seciliStok = stoklar.find((stok) => stok.id === s.stokId);
                  const kullanilabilir = Number(seciliStok?.kullanilabilirMiktar ?? 0);
                  const stokYetersiz = tip === "satis" && seciliStok?.kullanilabilirMiktar !== undefined && Number(s.miktar) > kullanilabilir;
                  return (
                    <Fragment key={index}>
                    <tr>
                      <td className="invoice-line__product">
                        <AramaSecici
                          ariaLabel={`${index + 1}. satır ürün veya hizmet seçimi`}
                          ariaDescribedBy={satirDogrulamaHatalari.includes(index) ? `fatura-satir-${index}-hatasi` : undefined}
                          ariaInvalid={satirDogrulamaHatalari.includes(index)}
                          deger={s.stokId}
                          kullanimAnahtari="tekir_son_urunler"
                          inputRef={(eleman) => { urunRefleri.current[index] = eleman; }}
                          onChange={(deger) => { if (deger) { setUrunModali({ satir: index, stokId: deger }); setSatirDogrulamaHatalari((hatalar) => hatalar.filter((satirIndex) => satirIndex !== index)); } }}
                          onSecim={(deger) => requestAnimationFrame(() => {
                            if (s.stokId === deger) urunRefleri.current[index]?.focus();
                            else miktarRefleri.current[index]?.focus();
                          })}
                          placeholder="Kod, barkod veya ürün adıyla ara"
                          yeniKayit={{
                            etiket: "Yeni ürün oluştur",
                            onClick: () => { setHizliHata(""); setHizliStokSatir(index); setHizliPanel("stok"); },
                          }}
                          secenekler={stoklar.map((stok) => ({
                            deger: stok.id,
                            baslik: stok.ad,
                            aciklama: [
                              stok.kod,
                              stok.barkod && `Barkod: ${stok.barkod}`,
                              stok.kullanilabilirMiktar !== undefined && `Stok: ${Number(stok.kullanilabilirMiktar).toLocaleString("tr-TR")} ${stok.anaBirim ?? "adet"}`,
                              tip.startsWith("alis")
                                ? stok.alisFiyati && `Alış: ${tl(stok.alisFiyati)}`
                                : stok.satisFiyati && `Satış: ${tl(stok.satisFiyati)}`,
                              `KDV %${Number(stok.kdvOrani)}`,
                            ].filter(Boolean).join(" · "),
                            aramaMetni: [stok.kod, stok.barkod, ...(stok.tedarikciUrunKodlari ?? [])].filter(Boolean).join(" "),
                          }))}
                        />
                        {(stokVaryantlari[s.stokId]?.length ?? 0) > 0 && <Select aria-label="Varyant" required value={s.varyantId ?? ""} onChange={(e) => { const varyant = stokVaryantlari[s.stokId].find((v) => v.id === e.target.value); const yeni = [...satirlar]; yeni[index] = { ...s, varyantId: e.target.value, ...(varyant ? { birimFiyat: Number(tip.startsWith("alis") ? varyant.alisFiyati ?? s.birimFiyat : varyant.satisFiyati ?? s.birimFiyat) } : {}) }; setSatirlar(yeni); }}><option value="">Varyant seçin</option>{stokVaryantlari[s.stokId].filter((v) => v.aktif).map((v) => <option key={v.id} value={v.id}>{v.kod} — {v.ad} · Stok {Number(v.mevcutMiktar).toLocaleString("tr-TR")}</option>)}</Select>}
                        {satirDogrulamaHatalari.includes(index) && <p className="field-error" id={`fatura-satir-${index}-hatasi`} role="alert">Bu satır için ürün veya hizmet seçin.</p>}
                        {seciliStok && (
                          <span className={`document-line-stock${stokYetersiz ? " is-warning" : ""}`}>
                            {stokYetersiz
                              ? `Yetersiz stok: ${kullanilabilir.toLocaleString("tr-TR")} ${seciliStok.anaBirim ?? "adet"} kullanılabilir`
                              : `Stok: ${kullanilabilir.toLocaleString("tr-TR")} ${seciliStok.anaBirim ?? "adet"}`}
                          </span>
                        )}
                      </td>
                      <td className="invoice-line__field" data-label="Miktar"><Input className="document-line-number" aria-label="Miktar" type="number" min="0.01" step="any" inputMode="decimal" ref={(eleman) => { miktarRefleri.current[index] = eleman; }} value={s.miktar} onChange={(e) => satirGuncelle(index, "miktar", Number(e.target.value))} required /></td>
                      <td className="invoice-line__field" data-label="Birim fiyat"><Input className="document-line-number" aria-label="Birim fiyat" type="number" min="0" step="any" inputMode="decimal" value={s.birimFiyat} onChange={(e) => satirGuncelle(index, "birimFiyat", Number(e.target.value))} required /></td>
                      <td className="invoice-line__field" data-label="İskonto %"><Input className="document-line-number" aria-label="İskonto yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.iskontoOrani} onChange={(e) => satirGuncelle(index, "iskontoOrani", Number(e.target.value))} /></td>
                      <td className="invoice-line__field" data-label="KDV %"><Input className="document-line-number" aria-label="KDV yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.kdvOrani} onChange={(e) => satirGuncelle(index, "kdvOrani", Number(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); satirEkle(); } }} required /></td>
                      <td className="num document-line-total invoice-line__total" data-label="Tutar">{satirSonuc ? tl(satirSonuc.toplamTutar) : "0,00 TL"}</td>
                      <td className="center invoice-line__action">
                        <Button aria-expanded={acikSatir === index} aria-label="Satır ayrıntıları" title="Satır ayrıntıları" size="sm" type="button" onClick={() => setAcikSatir(acikSatir === index ? null : index)}>⋯</Button>
                      </td>
                    </tr>
                    {acikSatir === index && (
                      <tr className="document-line-detail">
                        <td colSpan={7}>
                          <div className="document-line-detail__content">
                            <Field label="GİB istisna kodu">
                              <Input className="document-line-code" aria-label="GİB istisna kodu" type="text" placeholder="351" value={s.gibIstisnaKodu || ""} onChange={(e) => satirGuncelle(index, "gibIstisnaKodu", e.target.value)} />
                            </Field>
                            <Field label="İlişkili Proje">
                              <Select
                                aria-label="Proje seçimi"
                                value={s.projeId || ""}
                                onChange={(e) => {
                                  const pId = e.target.value;
                                  const yeni = [...satirlar];
                                  yeni[index] = { ...s, projeId: pId || undefined, projeAltKirilimId: undefined };
                                  setSatirlar(yeni);
                                }}
                              >
                                <option value="">(Proje Yok)</option>
                                {projeler.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    [{p.kod}] {p.ad}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            {s.projeId && (
                              <Field label="Maliyet Merkezi (WBS)">
                                <Select
                                  aria-label="Maliyet merkezi seçimi"
                                  value={s.projeAltKirilimId || ""}
                                  onChange={(e) => satirGuncelle(index, "projeAltKirilimId", e.target.value)}
                                >
                                  <option value="">(Alt Kırılım Yok)</option>
                                  {(projeler.find((p) => p.id === s.projeId)?.altKirilimlar ?? []).map((k) => (
                                    <option key={k.id} value={k.id}>
                                      [{k.kod}] {k.ad}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            )}
                            {["alis", "satis_iade"].includes(tip) && seciliStok?.takipTipi && seciliStok.takipTipi !== "yok" && <><Field label="Lot / Parti No"><Input required value={s.lotNo ?? ""} onChange={(e) => satirGuncelle(index, "lotNo", e.target.value)} /></Field>{seciliStok.takipTipi === "seri" && <Field label="Seri numaraları (virgülle)"><Input required value={s.seriNolar ?? ""} onChange={(e) => satirGuncelle(index, "seriNolar", e.target.value)} /></Field>}<Field label="Üretim tarihi"><Input type="date" value={s.uretimTarihi ?? ""} onChange={(e) => satirGuncelle(index, "uretimTarihi", e.target.value)} /></Field><Field label="Son kullanma tarihi"><Input type="date" value={s.sonKullanmaTarihi ?? ""} onChange={(e) => satirGuncelle(index, "sonKullanmaTarihi", e.target.value)} /></Field></>}
                            <div className="document-line-detail__actions">
                              <Button size="sm" type="button" onClick={() => satirKopyala(index)}>Satırı kopyala</Button>
                              <Button aria-label="Satırı sil" variant="danger" size="sm" type="button" disabled={satirlar.length === 1} onClick={() => satirSil(index)}>Satırı sil</Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </TableWrap>

            <div className="document-summary-row">
              <Button type="button" onClick={satirEkle}>+ Satır ekle</Button>
              <div className="document-totals">
                <div className="document-total-line">
                  <span>Brüt toplam</span><span>{tl(sonuc.toplamBrut)}</span>
                </div>
                <div className="document-total-line is-discount">
                  <span>Toplam iskonto</span><span>-{tl(sonuc.toplamSatirIskontosu)}</span>
                </div>
                <div className="document-total-line is-tax">
                  <span>KDV toplamı</span><span>{tl(sonuc.toplamKdv)}</span>
                </div>
                <div className="document-total-line is-grand">
                  <span>Ödenecek</span><span>{tl(sonuc.genelToplam)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="document-editor__section document-description">
            <Field label="Fatura açıklaması">
              <textarea className="textarea document-description__input" value={aciklama} onChange={(e) => setAciklama(e.target.value)} maxLength={500} rows={5} placeholder="Faturada gösterilecek açıklamayı yazın (isteğe bağlı)" />
              {dovizCinsi !== "TRY" && <label className="check-row"><input type="checkbox" checked={kuruAciklamayaEkle} onChange={(e) => setKuruAciklamayaEkle(e.target.checked)} /> Döviz kurunu açıklamaya ekle</label>}
            </Field>
          </div>

          <div className="document-editor__section">
            <BelgeDosyalari dosyalar={dosyalar} onChange={setDosyalar} />
          </div>

          <div className="document-editor__actions">
            <Button variant="primary" onClick={kaydet}>{duzenlenenId ? "Değişiklikleri kaydet" : "Taslak faturayı kaydet"}</Button>
          </div>
        </div>
      )}
      <UrunSecimModali acik={urunModali !== null} baslangicStokId={urunModali?.stokId} stoklar={stoklar} cariId={cariId} tip={tip.startsWith("alis") ? "alis" : "satis"} belgeDovizi={dovizCinsi} belgeKuru={kur} belgeTarihi={tarih} onKapat={() => setUrunModali(null)} onEkle={(urun) => {
        setSatirlar((eskiler) => {
          const satir = { stokId: urun.stokId, varyantId: urun.varyantId, miktar: urun.miktar, birimFiyat: urun.birimFiyat, iskontoOrani: urun.iskontoOrani, kdvOrani: urun.kdvOrani, gibIstisnaKodu: "" };
          if (urunModali == null || urunModali.satir >= eskiler.length) return [...eskiler, satir];
          return eskiler.map((x, i) => i === urunModali.satir ? satir : x);
        });
        setUrunModali(null);
      }} />

      {hizliPanel === "cari" && (
          <HizliKayitPaneli baslik={tip.startsWith("alis") ? "Yeni tedarikçi" : "Yeni müşteri"} onKapat={() => setHizliPanel(null)}>
          <form className="quick-panel__form" onSubmit={hizliCariOlustur}>
            <Alert tone="error">{hizliHata}</Alert>
            <Field label="Ünvan / Ad soyad"><Input autoFocus value={yeniCariUnvan} onChange={(e) => setYeniCariUnvan(e.target.value)} required /></Field>
            <Field label="Cari kodu"><Input value={yeniCariKod} onChange={(e) => setYeniCariKod(e.target.value)} required placeholder="CARI-001" /></Field>
            <Field label="VKN / TCKN"><Input inputMode="numeric" value={yeniCariVkn} onChange={(e) => setYeniCariVkn(e.target.value)} placeholder="İsteğe bağlı" /></Field>
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setHizliPanel(null)}>Vazgeç</Button>
              <Button type="submit" variant="primary">Oluştur ve seç</Button>
            </div>
          </form>
        </HizliKayitPaneli>
      )}

      {ekleriAcikFatura && <FaturaEkPaneli faturaId={ekleriAcikFatura.id} baslik={ekleriAcikFatura.no ?? "Taslak"} onKapat={() => setEkleriAcikFatura(null)} />}

      {hizliPanel === "stok" && (
        <HizliKayitPaneli baslik="Yeni ürün" onKapat={() => setHizliPanel(null)}>
          <form className="quick-panel__form" onSubmit={hizliStokOlustur}>
            <Alert tone="error">{hizliHata}</Alert>
            <Field label="Ürün adı"><Input autoFocus value={yeniStokAd} onChange={(e) => setYeniStokAd(e.target.value)} required /></Field>
            <Field label="Stok kodu"><Input value={yeniStokKod} onChange={(e) => setYeniStokKod(e.target.value)} required placeholder="STK-001" /></Field>
            <Field label="Barkod"><Input value={yeniStokBarkod} onChange={(e) => setYeniStokBarkod(e.target.value)} /></Field>
            <Field label={tip.startsWith("alis") ? "Alış fiyatı (TRY)" : "Satış fiyatı (TRY)"}><Input className="record-number" type="number" min="0" step="0.0001" inputMode="decimal" value={yeniStokFiyat} onChange={(e) => setYeniStokFiyat(e.target.value)} placeholder="0,00" /></Field>
            <Field label="KDV (%)"><Input className="record-number" type="number" min="0" max="100" inputMode="decimal" value={yeniStokKdv} onChange={(e) => setYeniStokKdv(e.target.value)} required /></Field>
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setHizliPanel(null)}>Vazgeç</Button>
              <Button type="submit" variant="primary">Oluştur ve seç</Button>
            </div>
          </form>
        </HizliKayitPaneli>
      )}

      {kesinlestirmeOzeti && (() => {
        const fatura = kesinlestirmeOzeti.fatura;
        const toplamMiktar = fatura.satirlar.reduce((toplam, satir) => toplam + Number(satir.miktar), 0);
        const satisYonlu = fatura.tip === "satis" || fatura.tip === "alis_iade";
        const proforma = fatura.tip === "proforma";
        const tahminiRisk = Number(kesinlestirmeOzeti.risk?.mevcutRisk ?? 0) + (fatura.tip === "satis" ? Number(fatura.genelToplam) : 0);
        const riskLimiti = kesinlestirmeOzeti.risk?.limit === null ? null : Number(kesinlestirmeOzeti.risk?.limit ?? 0);
        const riskAsimi = riskLimiti !== null && tahminiRisk > riskLimiti;
        return (
          <HizliKayitPaneli baslik="Faturayı kesinleştir" onKapat={() => setKesinlestirmeOzeti(null)}>
            <div className="approval-summary">
              <div className="approval-summary__identity">
                <strong>{fatura.no || "Taslak fatura"} · {TIP_ETIKETLERI[fatura.tip] ?? fatura.tip}</strong>
                <span>{fatura.cari.unvan}</span>
              </div>
              <dl>
                <div><dt>Kalem</dt><dd>{fatura.satirlar.length}</dd></div>
                <div><dt>Toplam miktar</dt><dd>{toplamMiktar.toLocaleString("tr-TR")}</dd></div>
                <div><dt>Matrah</dt><dd>{tl(fatura.toplamMatrah)}</dd></div>
                <div><dt>KDV</dt><dd>{tl(fatura.toplamKdv)}</dd></div>
                <div><dt>Genel toplam</dt><dd>{tl(fatura.genelToplam)}</dd></div>
              </dl>
              <div className="approval-effects">
                <div><span>Stok</span><strong>{proforma ? "Değişmeyecek" : `${toplamMiktar.toLocaleString("tr-TR")} birim ${satisYonlu ? "azalacak" : "artacak"}`}</strong></div>
                <div><span>Cari hesap</span><strong>{proforma ? "Değişmeyecek" : `${tl(fatura.genelToplam)} ${satisYonlu ? "borç" : "alacak"} yazılacak`}</strong></div>
                <div><span>e-Belge</span><strong>{proforma ? "Oluşmayacak" : "Kesinleştirme sonrası ayrıca wizard ile oluşturulacak"}</strong></div>
                <div><span>Tahmini risk</span><strong>{fatura.tip === "satis" ? tl(tahminiRisk) : "Değişmeyecek"}</strong></div>
              </div>
              {!fatura.cari.vknTckn && !proforma && <div className="approval-impact is-warning">Cari VKN/TCKN bilgisi eksik. e-Belge gönderiminden önce cari kartını tamamlayın.</div>}
              {riskAsimi && <div className="approval-impact is-warning">Kesinleştirme sonrasında tahmini risk {tl(tahminiRisk)} ile {tl(riskLimiti)} limitini aşacak.</div>}
              {(fatura.tip === "alis" || fatura.tip === "alis_iade") && <Field label="Tedarikçi fatura no *"><Input autoFocus value={faturaNo} onChange={(e) => setFaturaNo(e.target.value)} maxLength={100} placeholder="Tedarikçinin belge numarası" required /></Field>}
              <div className="quick-panel__actions">
                <Button type="button" onClick={() => setKesinlestirmeOzeti(null)}>Vazgeç</Button>
                <Button type="button" variant="primary" disabled={(fatura.tip === "alis" || fatura.tip === "alis_iade") && !faturaNo.trim()} onClick={() => void kesinlestir(fatura.id, faturaNo)}>Kesinleştir</Button>
              </div>
            </div>
          </HizliKayitPaneli>
        );
      })()}

      {ebelgeWizard && (
        <HizliKayitPaneli baslik="e-Fatura oluştur ve gönder" onKapat={() => setEbelgeWizard(null)}>
          <div className="approval-summary">
            <div className="approval-summary__identity">
              <strong>1. Kontrol</strong>
              <span>{ebelgeWizard.fatura.no} · {ebelgeWizard.bilgi.cari}</span>
            </div>
            <div className="approval-effects">
              <div><span>Alıcı VKN/TCKN</span><strong>{ebelgeWizard.bilgi.vknTckn || "Eksik"}</strong></div>
              <div><span>Entegratör</span><strong>{ebelgeWizard.bilgi.saglayici || "Tanımlı değil"}</strong></div>
              <div><span>Belge türü</span><strong>Mükellefiyet gönderim onayında sorgulanacak: e-Fatura / e-Arşiv</strong></div>
            </div>
            {ebelgeWizard.bilgi.neden && <div className="approval-impact is-warning">{ebelgeWizard.bilgi.neden}</div>}
            {ebelgeWizard.bilgi.not && <div className="approval-impact">{ebelgeWizard.bilgi.not}</div>}
            <p className="subtle">İkinci adımda UBL-TR belge oluşturulur, entegratöre gönderilir ve durum takibine alınır. Bu işlem faturayı yeniden kesinleştirmez.</p>
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setEbelgeWizard(null)}>Vazgeç</Button>
              <Button type="button" variant="primary" disabled={!ebelgeWizard.bilgi.gonderilebilir} onClick={() => void ebelgeWizardGonder()}>2. Oluştur ve gönder</Button>
            </div>
          </div>
        </HizliKayitPaneli>
      )}

      {ebelgeDetayi?.ebelge && (
        <HizliKayitPaneli baslik="e-Belge durumu" onKapat={() => setEbelgeDetayi(null)}>
          <div className="approval-summary">
            <div className="approval-summary__identity">
              <strong>{ebelgeDetayi.no} · {ebelgeDetayi.ebelge.tur === "efatura" ? "e-Fatura" : "e-Arşiv"}</strong>
              <span>{ebelgeDetayi.cari.unvan}</span>
            </div>
            <div className="status-history">
              <div className="status-history__item is-complete">
                <span />
                <div><strong>e-Belge kaydı oluşturuldu</strong><small>{new Date(ebelgeDetayi.ebelge.createdAt).toLocaleString("tr-TR")}</small></div>
              </div>
              <div className={`status-history__item${ebelgeDetayi.ebelge.durum === "hata" || ebelgeDetayi.ebelge.durum === "ret" ? " is-error" : " is-complete"}`}>
                <span />
                <div><strong>{EBELGE_DURUMLARI[ebelgeDetayi.ebelge.durum]?.baslik ?? ebelgeDetayi.ebelge.durum}</strong><small>{new Date(ebelgeDetayi.ebelge.updatedAt).toLocaleString("tr-TR")}</small></div>
              </div>
            </div>
            <dl>
              <div><dt>Entegratör referansı</dt><dd>{ebelgeDetayi.ebelge.entegratorRef || "Henüz oluşmadı"}</dd></div>
              <div><dt>Son güncelleme</dt><dd>{new Date(ebelgeDetayi.ebelge.updatedAt).toLocaleString("tr-TR")}</dd></div>
            </dl>
            {ebelgeDetayi.ebelge.hataMesaji && <div className="approval-impact is-warning">{ebelgeDetayi.ebelge.hataMesaji}</div>}
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setEbelgeDetayi(null)}>Kapat</Button>
              {["kuyrukta", "iletildi"].includes(ebelgeDetayi.ebelge.durum) && <Button type="button" variant="primary" onClick={() => void ebelgeSorgula(ebelgeDetayi.id)}>Durumu sorgula</Button>}
              {ebelgeDetayi.ebelge.durum === "hata" && <Button type="button" variant="primary" onClick={() => void ebelgeYenidenGonder(ebelgeDetayi.id)}>Yeniden gönder</Button>}
              {ebelgeDetayi.ebelge.tur === "earsiv" && ebelgeDetayi.durum === "iptal" && <Button type="button" variant="danger" onClick={() => void earsivIptalBildir(ebelgeDetayi.id)}>İptali Sovos'a bildir</Button>}
            </div>
          </div>
        </HizliKayitPaneli>
      )}

      {odemeDetayi && (
        <HizliKayitPaneli baslik="Ödeme durumu" onKapat={() => setOdemeDetayi(null)}>
          <div className="approval-summary">
            <div className="approval-summary__identity">
              <strong>{odemeDetayi.no || "Taslak fatura"} · {odemeDetayi.cari.unvan}</strong>
              <span>{TIP_ETIKETLERI[odemeDetayi.tip] ?? odemeDetayi.tip}</span>
            </div>
            <dl>
              <div><dt>Fatura toplamı</dt><dd>{tl(odemeDetayi.genelToplam)}</dd></div>
              <div><dt>Ödenen</dt><dd>{tl(odemeDetayi.odemeOzeti.odenen)}</dd></div>
              <div><dt>Kalan</dt><dd>{tl(odemeDetayi.odemeOzeti.kalan)}</dd></div>
            </dl>
            <div className="status-history">
              <div className="status-history__item is-complete">
                <span />
                <div><strong>Fatura {odemeDetayi.durum === "kesin" ? "kesinleşti" : "taslak olarak oluşturuldu"}</strong><small>{odemeDetayi.tarih}</small></div>
              </div>
              {odemeDetayi.odemeOzeti.hareketler.map((hareket) => (
                <div className="status-history__item is-complete" key={hareket.id}>
                  <span />
                  <div>
                    <strong>{hareket.tip === "tahsilat" ? "Tahsilat" : "Ödeme"} · {Number(hareket.tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {hareket.dovizCinsi}</strong>
                    <small>{hareket.tarih} · {hareket.hesap}{hareket.aciklama ? ` · ${hareket.aciklama}` : ""}</small>
                  </div>
                </div>
              ))}
              {odemeDetayi.odemeOzeti.hareketler.length === 0 && (
                <div className="status-history__item">
                  <span />
                  <div><strong>Henüz ödeme eşleştirilmedi</strong><small>Kalan {tl(odemeDetayi.odemeOzeti.kalan)}</small></div>
                </div>
              )}
            </div>
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setOdemeDetayi(null)}>Kapat</Button>
              {odemeDetayi.durum === "kesin" && Number(odemeDetayi.odemeOzeti.kalan) > 0 && (
                <Button type="button" variant="primary" onClick={() => odemeKaydinaGit(odemeDetayi)}>
                  {["satis", "alis_iade"].includes(odemeDetayi.tip) ? "Tahsilat kaydet" : "Ödeme kaydet"}
                </Button>
              )}
            </div>
          </div>
        </HizliKayitPaneli>
      )}

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Fatura No</th>
              <th>Firma / Cari</th>
              <th>Tarih</th>
              <th>Tip</th>
              <th className="num">Net Tutar</th>
              <th className="num">Genel Toplam</th>
              <th>Durum</th>
              <th>e-Belge</th>
              <th>Ödeme</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {gorunenFaturalar.length === 0 ? (
              <tr>
                <td colSpan={10} className="empty">Sistemde henüz kayıtlı fatura bulunmuyor.</td>
              </tr>
            ) : (
              gorunenFaturalar.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 700 }} className="mono">{f.no || "(Taslak)"}</td>
                  <td>{f.cari.unvan}</td>
                  <td>{f.tarih}</td>
                  <td>{TIP_ETIKETLERI[f.tip] ?? f.tip}</td>
                  <td className="num">{tl(f.toplamMatrah)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{tl(f.genelToplam)}</td>
                  <td>
                    {f.durum === "taslak" ? <Badge variant="warning">📝 Taslak</Badge> : f.durum === "iptal" ? <Badge variant="danger">İptal</Badge> : <Badge variant="success">🔒 Kesinleşti</Badge>}
                  </td>
                  <td>
                    {f.ebelge ? (
                      <button className="status-trigger" onClick={() => void ebelgeDetayAc(f.id)} title="e-Belge ayrıntısını aç" type="button">
                        <Badge variant={EBELGE_DURUMLARI[f.ebelge.durum]?.renk ?? "neutral"}>
                          {EBELGE_DURUMLARI[f.ebelge.durum]?.baslik ?? f.ebelge.durum}
                          {f.ebelge.tur === "efatura" ? " · e-Fatura" : " · e-Arşiv"}
                        </Badge>
                      </button>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td>
                    <button className="status-trigger" onClick={() => void odemeDetayAc(f.id)} title="Ödeme ayrıntısını aç" type="button">
                      <Badge variant={ODEME_DURUMLARI[f.odemeOzeti?.durum ?? "beklemede"].renk}>
                        {ODEME_DURUMLARI[f.odemeOzeti?.durum ?? "beklemede"].baslik}
                      </Badge>
                    </button>
                  </td>
                  <td className="center">
                    <div className="row-tight" style={{ flexWrap: "nowrap", justifyContent: "center" }}>
                      {f.durum === "taslak" ? (
                        <>
                          <Button variant="primary" size="sm" onClick={() => void kesinlestirmeOzetiAc(f.id)}>🔒 Kesinleştir</Button>
                          <Button size="sm" onClick={() => router.push(`/panel/fatura/yeni?duzenle=${f.id}`)}>Düzenle</Button>
                          <Button variant="danger" size="sm" onClick={() => void iptalEt(f.id)}>İptal</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" onClick={() => pdfAc(f.id)}>🖨 PDF</Button>
                          <Button size="sm" onClick={() => setEpostaGonderilen(f)}>✉️ E-posta</Button>
                          {!f.ebelge && f.durum === "kesin" && !f.tip.startsWith("alis") && <Button variant="primary" size="sm" onClick={() => void ebelgeWizardAc(f)}>🧾 e-Fatura Oluştur</Button>}
                          {!f.ebelge && f.durum === "kesin" && <Button size="sm" onClick={() => router.push(`/panel/fatura/yeni?duzenle=${f.id}`)}>Düzenle</Button>}
                          {f.ebelge && ["kuyrukta", "iletildi"].includes(f.ebelge.durum) && (
                            <Button size="sm" onClick={() => ebelgeSorgula(f.id)}>Sorgula</Button>
                          )}
                          {f.ebelge?.durum === "hata" && <Button size="sm" onClick={() => void ebelgeYenidenGonder(f.id)}>Yeniden gönder</Button>}
                        </>
                      )}
                      {/* FTR-09: yalnız proforma satışa dönüştürülebilir */}
                      {f.tip === "proforma" && (
                        <Button size="sm" onClick={() => satisaDonustur(f.id)}>➡️ Satışa Dönüştür</Button>
                      )}
                      <Button size="sm" onClick={() => setEkleriAcikFatura(f)}>📎 Ekler</Button>
                      <Button size="sm" onClick={() => kopyala(f.id)}>📋 Kopyala</Button>
                      <Button size="sm" onClick={() => router.push(`/panel/fatura/tekrarlayan?sablonFaturaId=${f.id}`)}>↻ Tekrarla</Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
        {sonrakiFaturaImleci && (
          <div style={{ padding: "1rem", textAlign: "center" }}>
            <Button type="button" onClick={() => void yukle(sonrakiFaturaImleci)} disabled={faturaListesiYukleniyor}>
              {faturaListesiYukleniyor ? "Faturalar yükleniyor…" : "Daha fazla fatura yükle"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
