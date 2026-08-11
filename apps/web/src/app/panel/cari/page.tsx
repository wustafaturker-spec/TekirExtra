"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { kullanimOlayi } from "@/lib/kullanim";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Stat,
  StatGrid,
  Status,
  TableWrap,
  Tabs,
} from "@/components/ui";

const TIP_ETIKETLERI: Record<string, string> = {
  musteri: "👤 Müşteri",
  tedarikci: "🏬 Tedarikçi",
  her_ikisi: "🔄 Müşteri + Tedarikçi",
  personel: "🧑‍💼 Personel",
  ortak: "🤝 Ortak",
  diger: "🏢 Diğer",
};

interface Cari {
  id: string;
  kod: string;
  unvan: string;
  tip: string;
  sektor: string | null;
  vknTckn: string | null;
  eposta: string | null;
  telefon: string | null;
  karaListe: boolean;
  bakiyeler: { dovizCinsi: string; bakiye: string }[];
}

interface Etiket {
  id: string;
  ad: string;
  renk: string | null;
}

interface BankaHesap {
  id: string;
  bankaAdi: string;
  subeAdi: string | null;
  hesapSahibi: string | null;
  iban: string;
  swift: string | null;
  paraBirimi: string;
}

interface CariAdres {
  id: string;
  baslik: string;
  tip: string;
  adres: string;
  il: string;
  ilce: string | null;
  postaKodu: string | null;
  ulke: string;
}

interface CariKisi {
  id: string;
  adSoyad: string;
  gorev: string | null;
  telefon: string | null;
  eposta: string | null;
}

interface CariDetay extends Cari {
  kisaAd: string | null;
  kisiTipi: string;
  vergiDairesi: string | null;
  mersisNo: string | null;
  ticaretSicilNo: string | null;
  webSitesi: string | null;
  faks: string | null;
  karaListeNotu: string | null;
  riskLimiti: string | null;
  varsayilanVadeGun: number | null;
  bankaHesaplari: BankaHesap[];
  etiketler: Etiket[];
  adresler: CariAdres[];
  kisiler: CariKisi[];
  risk: {
    cekSenetRiski: string;
    mevcutRisk: string;
    limit: string | null;
    kalanLimit: string | null;
    asim: boolean;
  };
  finansalOzet: {
    sonIslemTarihi: string | null;
    sonTahsilatTarihi: string | null;
    sonOdemeTarihi: string | null;
    vadesiGecmisBakiye: string;
  };
}

interface EkstreSatir {
  tarih: string;
  vadeTarihi: string | null;
  tip: "borc" | "alacak";
  aciklama: string | null;
  dovizCinsi: string;
  tutar: string;
  kur: string;
  tutarTry: string;
  yuruyenBakiye: string;
}

interface EkstreVeri {
  cari: { id: string; kod: string; unvan: string };
  satirlar: EkstreSatir[];
}

interface CrmVeri {
  etkilesimler: { id: string; tip: string; konu: string; aciklama: string | null; tarih: string; user: { id: string; adSoyad: string } }[];
  gorevler: { id: string; baslik: string; aciklama: string | null; sonTarih: string; hatirlatmaTarihi: string | null; oncelik: string; durum: string; tamamlanmaZamani: string | null; atanan: { id: string; adSoyad: string } }[];
  teklifler: { id: string; no: string; tarih: string; gecerlilikTarihi: string | null; durum: string; genelToplam: string; dovizCinsi: string }[];
  kullanicilar: { id: string; adSoyad: string; rol: string }[];
}

interface CariAnalizi {
  riskSkoru: number;
  riskSeviyesi: "dusuk" | "orta" | "yuksek";
  tahminiGecikmeGun: number | null;
  odemeDavranisi: "veri_yetersiz" | "zamaninda" | "kismen_gec" | "gecikmeli";
  onerilenRiskLimiti: string;
  guven: "dusuk" | "orta" | "yuksek";
  metrikler: { kapananBorcSayisi: number; ortalamaGecikmeGun: number | null; zamanindaOdemeOrani: number | null; acikBakiye: string; vadesiGecmisBakiye: string; limitKullanimOrani: number | null };
  gerekceler: string[];
}

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

/** AdresTip enum'unun ekran karşılıkları (CARI-15: merkez/şube/depo). */
const ADRES_TIP_ETIKETI: Record<string, string> = {
  fatura: "📄 Fatura Adresi",
  sevk: "🚚 Sevk Adresi",
  merkez: "🏢 Merkez",
  sube: "🏬 Şube",
  depo: "📦 Depo",
};

type Sekme = "genel" | "crm" | "ekstre" | "adresler" | "kisiler" | "bankalar";
type FiltreTip = "tumu" | "musteri" | "tedarikci" | "bloke";

interface CariGorunumu { id: string; ad: string; filtreTip: FiltreTip; }
const GORUNUM_ANAHTARI = "tekir_cari_gorunumleri";

export default function CariSayfasi() {
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [arama, setArama] = useState("");
  const [aramaSorgusu, setAramaSorgusu] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [detay, setDetay] = useState<CariDetay | null>(null);
  const [ekstre, setEkstre] = useState<EkstreVeri | null>(null);
  const [crm, setCrm] = useState<CrmVeri | null>(null);
  const [cariAnalizi, setCariAnalizi] = useState<CariAnalizi | null>(null);
  const [etiketler, setEtiketler] = useState<Etiket[]>([]);
  const [aktifSekme, setAktifSekme] = useState<Sekme>("genel");
  const [filtreTip, setFiltreTip] = useState<FiltreTip>("tumu");
  const [kayitliGorunumler, setKayitliGorunumler] = useState<CariGorunumu[]>([]);
  const [gorunumFormuAcik, setGorunumFormuAcik] = useState(false);
  const [gorunumAdi, setGorunumAdi] = useState("");
  const [sonrakiCariImleci, setSonrakiCariImleci] = useState<string | null>(null);
  const [cariListesiYukleniyor, setCariListesiYukleniyor] = useState(false);
  const [cariFiltreleriHazir, setCariFiltreleriHazir] = useState(false);
  const cariYuklemeSirasi = useRef(0);

  // Form alanları — kimlik
  const [kod, setKod] = useState("");
  const [unvan, setUnvan] = useState("");
  const [kisaAd, setKisaAd] = useState("");
  const [tip, setTip] = useState("musteri");
  const [kisiTipi, setKisiTipi] = useState("tuzel");
  const [sektor, setSektor] = useState("");
  // Vergi / resmi
  const [vknTckn, setVknTckn] = useState("");
  const [vergiDairesi, setVergiDairesi] = useState("");
  const [mersisNo, setMersisNo] = useState("");
  const [ticaretSicilNo, setTicaretSicilNo] = useState("");
  // İletişim
  const [eposta, setEposta] = useState("");
  const [telefon, setTelefon] = useState("");
  const [webSitesi, setWebSitesi] = useState("");
  const [faks, setFaks] = useState("");
  // Finans (CARI-10: özel satış koşulları)
  const [riskLimiti, setRiskLimiti] = useState("");
  const [fiyatListesiId, setFiyatListesiId] = useState("");
  const [varsayilanIskonto, setVarsayilanIskonto] = useState("");
  const [varsayilanVadeGun, setVarsayilanVadeGun] = useState("");
  const [fiyatListeleri, setFiyatListeleri] = useState<{ id: string; ad: string; dovizCinsi: string }[]>([]);
  // Detay panel alt formları
  const [bankaAdi, setBankaAdi] = useState("");
  const [iban, setIban] = useState("");
  const [paraBirimi, setParaBirimi] = useState("TRY");
  // Adres formu (CARI-09/15)
  const [adresTip, setAdresTip] = useState("fatura");
  const [adresBaslik, setAdresBaslik] = useState("");
  const [adresMetin, setAdresMetin] = useState("");
  const [adresIl, setAdresIl] = useState("");
  const [adresIlce, setAdresIlce] = useState("");
  const [adresPostaKodu, setAdresPostaKodu] = useState("");
  // İlgili kişi formu (CARI-09)
  const [kisiAdSoyad, setKisiAdSoyad] = useState("");
  const [kisiGorev, setKisiGorev] = useState("");
  const [kisiTelefon, setKisiTelefon] = useState("");
  const [kisiEposta, setKisiEposta] = useState("");
  const [yeniEtiket, setYeniEtiket] = useState("");
  const [secilenEtiketId, setSecilenEtiketId] = useState("");
  const [etkilesimTipi, setEtkilesimTipi] = useState("gorusme");
  const [etkilesimKonusu, setEtkilesimKonusu] = useState("");
  const [etkilesimAciklamasi, setEtkilesimAciklamasi] = useState("");
  const [etkilesimTarihi, setEtkilesimTarihi] = useState("");
  const [gorevBasligi, setGorevBasligi] = useState("");
  const [gorevAciklamasi, setGorevAciklamasi] = useState("");
  const [gorevAtanan, setGorevAtanan] = useState("");
  const [gorevOnceligi, setGorevOnceligi] = useState("normal");
  const [gorevSonTarihi, setGorevSonTarihi] = useState("");
  const [gorevHatirlatmaTarihi, setGorevHatirlatmaTarihi] = useState("");

  const yukle = useCallback(async (imlec?: string) => {
    const istekSirasi = ++cariYuklemeSirasi.current;
    setCariListesiYukleniyor(true);
    try {
      const parametreler = new URLSearchParams();
      if (aramaSorgusu) parametreler.set("arama", aramaSorgusu);
      if (filtreTip === "musteri" || filtreTip === "tedarikci") parametreler.set("tip", filtreTip);
      if (filtreTip === "bloke") parametreler.set("durum", "bloke");
      if (imlec) parametreler.set("imlec", imlec);
      const qs = parametreler.size ? `?${parametreler.toString()}` : "";
      const veri = await api<{ kayitlar: Cari[]; sonrakiImlec: string | null }>(`/cari${qs}`);
      if (istekSirasi !== cariYuklemeSirasi.current) return;
      setCariler((eskiler) => imlec ? [...eskiler, ...veri.kayitlar] : veri.kayitlar);
      setSonrakiCariImleci(veri.sonrakiImlec);
    } catch (h) {
      if (istekSirasi === cariYuklemeSirasi.current) {
        setHata(h instanceof Error ? h.message : "Yükleme hatası");
      }
    } finally {
      if (istekSirasi === cariYuklemeSirasi.current) setCariListesiYukleniyor(false);
    }
  }, [aramaSorgusu, filtreTip]);

  const etiketleriYukle = useCallback(async () => {
    try {
      setEtiketler(await api<Etiket[]>("/cari/etiketler"));
    } catch {
      /* etiketler yüklenemezse liste boş kalır */
    }
  }, []);

  useEffect(() => {
    const zamanlayici = window.setTimeout(() => setAramaSorgusu(arama.trim()), 300);
    return () => window.clearTimeout(zamanlayici);
  }, [arama]);

  useEffect(() => {
    if (cariFiltreleriHazir && tokenAl()) void yukle();
  }, [cariFiltreleriHazir, yukle]);

  useEffect(() => {
    if (tokenAl()) {
      void etiketleriYukle();
      api<{ id: string; ad: string; dovizCinsi: string }[]>("/fiyat-listeleri")
        .then(setFiyatListeleri)
        .catch(() => undefined);
    }
  }, [etiketleriYukle]);

  useEffect(() => {
    const parametreler = new URLSearchParams(window.location.search);
    const tipParametresi = parametreler.get("tip");
    if (tipParametresi === "musteri" || tipParametresi === "tedarikci") setFiltreTip(tipParametresi);
    if (parametreler.get("durum") === "bloke") setFiltreTip("bloke");
    try { setKayitliGorunumler(JSON.parse(localStorage.getItem(GORUNUM_ANAHTARI) ?? "[]") as CariGorunumu[]); }
    catch { localStorage.removeItem(GORUNUM_ANAHTARI); }
    setCariFiltreleriHazir(true);
  }, []);

  function filtreyiUygula(yeniFiltre: FiltreTip) {
    setFiltreTip(yeniFiltre);
    const parametreler = new URLSearchParams();
    if (yeniFiltre === "musteri" || yeniFiltre === "tedarikci") parametreler.set("tip", yeniFiltre);
    if (yeniFiltre === "bloke") parametreler.set("durum", "bloke");
    window.history.replaceState(null, "", "/panel/cari" + (parametreler.size ? "?" + parametreler.toString() : ""));
  }

  function gorunumKaydet(event: React.FormEvent) {
    event.preventDefault(); const ad = gorunumAdi.trim(); if (!ad) return;
    const yeni: CariGorunumu = { id: Date.now().toString(), ad, filtreTip };
    const gorunumler = [...kayitliGorunumler.filter((g) => g.ad.toLocaleLowerCase("tr-TR") !== ad.toLocaleLowerCase("tr-TR")), yeni];
    setKayitliGorunumler(gorunumler); localStorage.setItem(GORUNUM_ANAHTARI, JSON.stringify(gorunumler));
    setGorunumAdi(""); setGorunumFormuAcik(false); setBasari("“" + ad + "” görünümü kaydedildi.");
    kullanimOlayi("gorunum_kaydedildi");
  }

  function gorunumSil(id: string) {
    const gorunumler = kayitliGorunumler.filter((gorunum) => gorunum.id !== id);
    setKayitliGorunumler(gorunumler); localStorage.setItem(GORUNUM_ANAHTARI, JSON.stringify(gorunumler));
  }

  function gorunumuUygula(gorunum: CariGorunumu) { filtreyiUygula(gorunum.filtreTip); kullanimOlayi("gorunum_kullanildi"); }

  /**
   * @param sekmeyiKoru Alt formlardan (adres/kişi/banka/etiket) sonraki
   *   tazelemelerde açık sekme korunur; aksi hâlde kullanıcı eklediği kaydı
   *   göremeden Genel Bakış'a düşüyordu. Listeden açarken false kalır.
   */
  async function detayAc(id: string, sekmeyiKoru = false) {
    setHata("");
    try {
      const [cDetay, cEkstre, cCrm, cAnaliz] = await Promise.all([
        api<CariDetay>(`/cari/${id}`),
        api<EkstreVeri>(`/cari/${id}/ekstre`),
        api<CrmVeri>(`/cari/${id}/crm`),
        api<CariAnalizi>(`/cari/${id}/davranis-analizi`),
      ]);
      setDetay(cDetay);
      setEkstre(cEkstre);
      setCrm(cCrm);
      setCariAnalizi(cAnaliz);
      if (!sekmeyiKoru) setAktifSekme("genel");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Detay veya ekstre yüklenemedi");
    }
  }

  async function etkilesimEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!detay) return;
    setHata("");
    try {
      await api(`/cari/${detay.id}/crm/etkilesimler`, { method: "POST", body: JSON.stringify({
        tip: etkilesimTipi, konu: etkilesimKonusu, aciklama: etkilesimAciklamasi || undefined,
        tarih: etkilesimTarihi ? new Date(etkilesimTarihi).toISOString() : new Date().toISOString(),
      }) });
      setEtkilesimKonusu(""); setEtkilesimAciklamasi(""); setEtkilesimTarihi("");
      await detayAc(detay.id, true); setBasari("Etkileşim kaydı eklendi.");
    } catch (h) { setHata(h instanceof Error ? h.message : "Etkileşim eklenemedi"); }
  }

  async function crmGorevEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!detay) return;
    setHata("");
    try {
      await api(`/cari/${detay.id}/crm/gorevler`, { method: "POST", body: JSON.stringify({
        baslik: gorevBasligi, aciklama: gorevAciklamasi || undefined, atananUserId: gorevAtanan || undefined,
        oncelik: gorevOnceligi, sonTarih: new Date(gorevSonTarihi).toISOString(),
        hatirlatmaTarihi: gorevHatirlatmaTarihi ? new Date(gorevHatirlatmaTarihi).toISOString() : undefined,
      }) });
      setGorevBasligi(""); setGorevAciklamasi(""); setGorevSonTarihi(""); setGorevHatirlatmaTarihi("");
      await detayAc(detay.id, true); setBasari("CRM görevi oluşturuldu.");
    } catch (h) { setHata(h instanceof Error ? h.message : "Görev oluşturulamadı"); }
  }

  async function crmGorevDurumu(gorevId: string, durum: "tamamlandi" | "iptal") {
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/crm/gorevler/${gorevId}`, { method: "PATCH", body: JSON.stringify({ durum }) });
      await detayAc(detay.id, true); setBasari(durum === "tamamlandi" ? "Görev tamamlandı." : "Görev iptal edildi.");
    } catch (h) { setHata(h instanceof Error ? h.message : "Görev güncellenemedi"); }
  }

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      await api("/cari", {
        method: "POST",
        body: JSON.stringify({
          kod,
          unvan,
          kisaAd: kisaAd || undefined,
          tip,
          kisiTipi,
          sektor: sektor || undefined,
          vknTckn: vknTckn || undefined,
          vergiDairesi: vergiDairesi || undefined,
          mersisNo: mersisNo || undefined,
          ticaretSicilNo: ticaretSicilNo || undefined,
          eposta: eposta || undefined,
          telefon: telefon || undefined,
          webSitesi: webSitesi || undefined,
          faks: faks || undefined,
          riskLimiti: riskLimiti || undefined,
          fiyatListesiId: fiyatListesiId || undefined,
          varsayilanIskonto: varsayilanIskonto || undefined,
          varsayilanVadeGun: varsayilanVadeGun ? Number(varsayilanVadeGun) : undefined,
        }),
      });
      setBasari("Cari kart başarıyla oluşturuldu.");
      setFormAcik(false);
      setKod("");
      setUnvan("");
      setKisaAd("");
      setSektor("");
      setVknTckn("");
      setVergiDairesi("");
      setMersisNo("");
      setTicaretSicilNo("");
      setEposta("");
      setTelefon("");
      setWebSitesi("");
      setFaks("");
      setRiskLimiti("");
      setFiyatListesiId("");
      setVarsayilanIskonto("");
      setVarsayilanVadeGun("");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kayıt hatası");
    }
  }

  async function karaListeDegistir() {
    if (!detay) return;
    const yeniDurum = !detay.karaListe;
    const not = yeniDurum
      ? window.prompt("Blokaj nedeni (isteğe bağlı):") || undefined
      : undefined;
    try {
      await api(`/cari/${detay.id}`, {
        method: "PATCH",
        body: JSON.stringify({ karaListe: yeniDurum, karaListeNotu: not }),
      });
      await detayAc(detay.id, true);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Güncelleme hatası");
    }
  }

  async function iletisimGuncelle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!detay) return; const f = new FormData(e.currentTarget); setHata(""); setBasari("");
    try {
      await api(`/cari/${detay.id}`, { method: "PATCH", body: JSON.stringify({ eposta: String(f.get("eposta") || "") || undefined, telefon: String(f.get("telefon") || "") || undefined, webSitesi: String(f.get("webSitesi") || "") || undefined, faks: String(f.get("faks") || "") || undefined }) });
      await detayAc(detay.id, true); void yukle(); setBasari("Cari iletişim bilgileri güncellendi.");
    } catch (h) { setHata(h instanceof Error ? h.message : "İletişim bilgileri güncellenemedi"); }
  }

  async function bankaHesabiEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/banka-hesaplari`, {
        method: "POST",
        body: JSON.stringify({ bankaAdi, iban, paraBirimi }),
      });
      setBankaAdi("");
      setIban("");
      await detayAc(detay.id, true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Banka hesabı eklenemedi");
    }
  }

  async function bankaHesabiSil(hesapId: string) {
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/banka-hesaplari/${hesapId}`, { method: "DELETE" });
      await detayAc(detay.id, true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Banka hesabı silinemedi");
    }
  }

  async function adresEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/adresler`, {
        method: "POST",
        body: JSON.stringify({
          tip: adresTip,
          baslik: adresBaslik.trim(),
          adres: adresMetin.trim(),
          // Boş metinler şemadaki min/max kontrollerine takılmasın diye
          // gönderilmez (alanlar opsiyonel).
          ...(adresIl.trim() ? { il: adresIl.trim() } : {}),
          ...(adresIlce.trim() ? { ilce: adresIlce.trim() } : {}),
          ...(adresPostaKodu.trim() ? { postaKodu: adresPostaKodu.trim() } : {}),
        }),
      });
      setAdresBaslik("");
      setAdresMetin("");
      setAdresIl("");
      setAdresIlce("");
      setAdresPostaKodu("");
      await detayAc(detay.id, true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Adres eklenemedi");
    }
  }

  async function adresSil(adresId: string) {
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/adresler/${adresId}`, { method: "DELETE" });
      await detayAc(detay.id, true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Adres silinemedi");
    }
  }

  async function kisiEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/kisiler`, {
        method: "POST",
        body: JSON.stringify({
          adSoyad: kisiAdSoyad.trim(),
          ...(kisiGorev.trim() ? { gorev: kisiGorev.trim() } : {}),
          ...(kisiTelefon.trim() ? { telefon: kisiTelefon.trim() } : {}),
          ...(kisiEposta.trim() ? { eposta: kisiEposta.trim() } : {}),
        }),
      });
      setKisiAdSoyad("");
      setKisiGorev("");
      setKisiTelefon("");
      setKisiEposta("");
      await detayAc(detay.id, true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İlgili kişi eklenemedi");
    }
  }

  async function kisiSil(kisiId: string) {
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/kisiler/${kisiId}`, { method: "DELETE" });
      await detayAc(detay.id, true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İlgili kişi silinemedi");
    }
  }

  async function etiketOlusturVeAta(e: React.FormEvent) {
    e.preventDefault();
    if (!detay || !yeniEtiket.trim()) return;
    try {
      const etiket = await api<Etiket>("/cari/etiketler", {
        method: "POST",
        body: JSON.stringify({ ad: yeniEtiket.trim() }),
      });
      await api(`/cari/${detay.id}/etiketler/${etiket.id}`, { method: "POST" });
      setYeniEtiket("");
      await Promise.all([detayAc(detay.id, true), etiketleriYukle()]);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Etiket eklenemedi");
    }
  }

  async function etiketAta() {
    if (!detay || !secilenEtiketId) return;
    try {
      await api(`/cari/${detay.id}/etiketler/${secilenEtiketId}`, { method: "POST" });
      setSecilenEtiketId("");
      await detayAc(detay.id, true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Etiket atanamadı");
    }
  }

  async function etiketKaldir(etiketId: string) {
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/etiketler/${etiketId}`, { method: "DELETE" });
      await detayAc(detay.id, true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Etiket kaldırılamadı");
    }
  }

  async function excelYukle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setHata("");
    setBasari("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = tokenAl();
      const res = await fetch(`${apiBase()}/cari/excel-aktar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "Excel yükleme hatası");
      }

      const resData = await res.json();
      setBasari(`Excel başarıyla aktarıldı. ${resData.eklenen} adet cari eklendi/güncellendi.`);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Excel yükleme hatası");
    }
  }

  async function ekstreIndir(id: string, unvanAd: string) {
    try {
      const token = tokenAl();
      const res = await fetch(`${apiBase()}/cari/${id}/ekstre/excel`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Ekstre indirilemedi");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ekstre-${unvanAd.replace(/\s+/g, "-")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setHata("Excel ekstre indirilirken bir hata oluştu.");
    }
  }

  async function kopyala(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/cari/${id}/kopyala`, { method: "POST" });
      setBasari("Cari hesap başarıyla kopyalandı.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kopyalama hatası");
    }
  }

  const filtrelenmisCariler = cariler.filter((c) => {
    if (filtreTip === "musteri") return c.tip === "musteri" || c.tip === "her_ikisi";
    if (filtreTip === "tedarikci") return c.tip === "tedarikci" || c.tip === "her_ikisi";
    if (filtreTip === "bloke") return c.karaListe === true;
    return true;
  });

  const musteriSayisi = cariler.filter((c) => c.tip === "musteri" || c.tip === "her_ikisi").length;
  const tedarikciSayisi = cariler.filter((c) => c.tip === "tedarikci" || c.tip === "her_ikisi").length;
  const blokeSayisi = cariler.filter((c) => c.karaListe === true).length;

  return (
    <div>
      <PageHeader
        title="Cari Hesaplar"
        subtitle="Müşterileriniz, tedarikçileriniz ve diğer cari ortaklarınızı buradan yönetin."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/cari/raporlar">📈 Raporlar</ButtonLabel>
            <ButtonLabel>
              📥 Excel&apos;den İçe Aktar
              <input type="file" accept=".xlsx" onChange={excelYukle} style={{ display: "none" }} />
            </ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Cari"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <form className="document-editor record-editor--wide" onSubmit={kaydet}>
          <div className="document-editor__head">
            <h3>Yeni cari hesap</h3>
            <span className="badge badge--warning">Yeni</span>
          </div>

          <div className="document-editor__section">
            <h4 className="document-editor__section-title">Temel bilgiler</h4>
            <div className="record-fields record-fields--cari-main">
              <Field label="Ünvan / Ad soyad"><Input value={unvan} onChange={(e) => setUnvan(e.target.value)} required placeholder="Teknoloji A.Ş." /></Field>
              <Field label="Cari kodu"><Input value={kod} onChange={(e) => setKod(e.target.value)} required placeholder="CARI-001" /></Field>
              <Field label="Cari tipi"><Select value={tip} onChange={(e) => setTip(e.target.value)}>{Object.entries(TIP_ETIKETLERI).map(([deger, ad]) => (<option key={deger} value={deger}>{ad}</option>))}</Select></Field>
              <Field label="Kısa ad"><Input value={kisaAd} onChange={(e) => setKisaAd(e.target.value)} placeholder="Teknoloji" /></Field>
              <Field label="Kişi tipi"><Select value={kisiTipi} onChange={(e) => setKisiTipi(e.target.value)}><option value="tuzel">Tüzel kişi</option><option value="gercek">Gerçek kişi</option></Select></Field>
              <Field label="Sektör"><Input value={sektor} onChange={(e) => setSektor(e.target.value)} placeholder="Perakende" /></Field>
            </div>
          </div>

          <details className="record-disclosure">
            <summary>Vergi ve resmi bilgiler</summary>
            <div className="record-fields record-fields--four">
              <Field label="VKN / TCKN"><Input value={vknTckn} onChange={(e) => setVknTckn(e.target.value)} placeholder="10-11 hane" /></Field>
              <Field label="Vergi dairesi"><Input value={vergiDairesi} onChange={(e) => setVergiDairesi(e.target.value)} /></Field>
              <Field label="MERSİS no"><Input value={mersisNo} onChange={(e) => setMersisNo(e.target.value)} placeholder="16 hane" /></Field>
              <Field label="Ticaret sicil no"><Input value={ticaretSicilNo} onChange={(e) => setTicaretSicilNo(e.target.value)} /></Field>
            </div>
          </details>

          <details className="record-disclosure">
            <summary>İletişim bilgileri</summary>
            <div className="record-fields record-fields--four">
              <Field label="E-posta"><Input type="email" value={eposta} onChange={(e) => setEposta(e.target.value)} /></Field>
              <Field label="Telefon"><Input value={telefon} onChange={(e) => setTelefon(e.target.value)} /></Field>
              <Field label="Web sitesi"><Input value={webSitesi} onChange={(e) => setWebSitesi(e.target.value)} placeholder="https://..." /></Field>
              <Field label="Faks"><Input value={faks} onChange={(e) => setFaks(e.target.value)} /></Field>
            </div>
          </details>

          <details className="record-disclosure">
            <summary>Finans ve satış koşulları</summary>
            <div className="record-fields record-fields--four">
              <Field label="Fiyat listesi"><Select value={fiyatListesiId} onChange={(e) => setFiyatListesiId(e.target.value)}><option value="">Stok satış fiyatı</option>{fiyatListeleri.map((l) => (<option key={l.id} value={l.id}>{l.ad} ({l.dovizCinsi})</option>))}</Select></Field>
              <Field label="Varsayılan iskonto (%)"><Input className="record-number" type="number" step="0.01" min="0" max="100" inputMode="decimal" value={varsayilanIskonto} onChange={(e) => setVarsayilanIskonto(e.target.value)} placeholder="0" /></Field>
              <Field label="Varsayılan vade (gün)"><Input className="record-number" type="number" min="0" max="365" inputMode="numeric" value={varsayilanVadeGun} onChange={(e) => setVarsayilanVadeGun(e.target.value)} placeholder="0" /></Field>
              <Field label="Risk limiti (TL)"><Input className="record-number" type="number" min="0" step="0.01" inputMode="decimal" value={riskLimiti} onChange={(e) => setRiskLimiti(e.target.value)} placeholder="0,00" /></Field>
            </div>
          </details>

          <div className="document-editor__actions"><Button variant="primary" type="submit">Cari hesabı kaydet</Button></div>
        </form>
      )}

      {detay && (
        <Card style={{ marginBottom: "1.5rem", borderColor: "var(--accent)" }}>
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ fontSize: "1.15rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {detay.unvan}
                {detay.karaListe && <Badge variant="danger">🚫 Kara Liste</Badge>}
              </h3>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                {detay.kod} · {TIP_ETIKETLERI[detay.tip] ?? detay.tip} · {detay.kisiTipi === "gercek" ? "Gerçek Kişi" : "Tüzel Kişi"}
                {detay.sektor ? ` · ${detay.sektor}` : ""}
              </p>
              {detay.karaListe && detay.karaListeNotu && (
                <p style={{ color: "var(--danger)", fontSize: "0.85rem", margin: "0.3rem 0 0" }}>Blokaj nedeni: {detay.karaListeNotu}</p>
              )}
            </div>
            <div className="row-tight">
              <Button size="sm" onClick={karaListeDegistir}>{detay.karaListe ? "✅ Blokajı Kaldır" : "🚫 Kara Listeye Al"}</Button>
              <Button size="sm" onClick={() => { setDetay(null); setEkstre(null); setCrm(null); setCariAnalizi(null); }}>✖ Kapat</Button>
            </div>
          </div>

          <div style={{ marginTop: "1.25rem" }}>
            <Tabs<Sekme>
              ariaLabel="Cari hesap bölümleri"
              idPrefix="cari-detay"
              value={aktifSekme}
              onChange={setAktifSekme}
              items={[
                { deger: "genel", baslik: "Genel Bakış" },
                { deger: "crm", baslik: "CRM" },
                { deger: "ekstre", baslik: "Ekstre" },
                { deger: "adresler", baslik: "Adresler" },
                { deger: "kisiler", baslik: "İlgili Kişiler" },
                { deger: "bankalar", baslik: "Banka Hesapları" },
              ]}
            />
          </div>

          {aktifSekme === "genel" && (
            <div aria-labelledby="cari-detay-tab-genel" id="cari-detay-panel-genel" role="tabpanel" tabIndex={0}>
              <StatGrid>
                {(() => {
                  const bakiyeNum = Number(detay.bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? "0.00");
                  return (
                    <Stat
                      label="Toplam Bakiye"
                      value={tl(bakiyeNum)}
                      tone={bakiyeNum > 0 ? "success" : bakiyeNum < 0 ? "danger" : "default"}
                      hint={bakiyeNum > 0 ? "Alacaklıyız" : bakiyeNum < 0 ? "Borçluyuz" : "Bakiye Sıfır"}
                    />
                  );
                })()}
                <Stat
                  label="Vadesi Geçmiş"
                  value={tl(detay.finansalOzet.vadesiGecmisBakiye)}
                  tone={Number(detay.finansalOzet.vadesiGecmisBakiye) > 0 ? "danger" : "default"}
                  hint="Açık kalemler"
                />
                <Stat
                  label="Vade Süresi"
                  value={detay.varsayilanVadeGun ? `${detay.varsayilanVadeGun} Gün` : "—"}
                  hint="Varsayılan vade"
                />
                <Stat
                  label="Risk Durumu"
                  value={detay.risk.asim ? "Limit Aşımı" : "Normal"}
                  tone={detay.risk.asim ? "danger" : "accent"}
                  hint={detay.risk.limit ? `Limit: ${tl(detay.risk.limit)}` : "Limit Tanımsız"}
                />
              </StatGrid>

              <div className="row">
                <Card className="grow" style={{ flex: 1, minWidth: 280 }}>
                  <div className="card__title">📨 İletişim Bilgileri</div>
                  <form className="stack" onSubmit={iletisimGuncelle}>
                    <Field label="E-posta"><Input name="eposta" type="email" defaultValue={detay.eposta ?? ""} placeholder="odeme@firma.com" /></Field>
                    <Field label="Telefon"><Input name="telefon" defaultValue={detay.telefon ?? ""} /></Field>
                    <Field label="Web sitesi"><Input name="webSitesi" type="url" defaultValue={detay.webSitesi ?? ""} placeholder="https://..." /></Field>
                    <Field label="Faks"><Input name="faks" defaultValue={detay.faks ?? ""} /></Field>
                    <Button type="submit" size="sm" variant="primary">İletişimi güncelle</Button>
                  </form>
                  {!detay.eposta && <p style={{ color: "var(--danger)", fontSize: ".82rem" }}>Ödeme bağlantısı göndermek için e-posta eklenmelidir.</p>}
                </Card>
                <Card className="grow" style={{ flex: 2, minWidth: 280 }}>
                  <div className="card__title">⚖️ Risk &amp; Finans Bilgileri</div>
                  <table style={{ width: "100%", fontSize: "0.9rem" }}>
                    <tbody>
                      <SatirCift ad="Mevcut Risk" deger={tl(detay.risk.mevcutRisk)} />
                      <SatirCift ad="Çek/Senet Riski" deger={tl(detay.risk.cekSenetRiski)} />
                      {detay.risk.kalanLimit !== null && (
                        <tr>
                          <td className="muted" style={{ padding: "0.4rem 0" }}>Kalan Risk Limiti</td>
                          <td className="num" style={{ fontWeight: 700, color: detay.risk.asim ? "var(--danger)" : "var(--success)" }}>{tl(detay.risk.kalanLimit)}</td>
                        </tr>
                      )}
                      <SatirCift ad="Son İşlem Tarihi" deger={detay.finansalOzet.sonIslemTarihi ?? "—"} />
                      <SatirCift ad="Son Tahsilat Tarihi" deger={detay.finansalOzet.sonTahsilatTarihi ?? "—"} />
                      <SatirCift ad="Son Ödeme Tarihi" deger={detay.finansalOzet.sonOdemeTarihi ?? "—"} />
                    </tbody>
                  </table>
                  {detay.risk.asim && <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.75rem" }}>⚠️ Risk limiti aşılmış durumda.</p>}
                </Card>

                <Card className="grow" style={{ flex: 1, minWidth: 220 }}>
                  <div className="card__title">🏷️ Etiket Yönetimi</div>
                  <div className="row-tight" style={{ marginBottom: "0.75rem" }}>
                    {detay.etiketler.length === 0 && <span className="subtle" style={{ fontSize: "0.85rem" }}>Etiket yok</span>}
                    {detay.etiketler.map((e) => (
                      <span key={e.id} className="chip">
                        {e.ad}
                        <button onClick={() => etiketKaldir(e.id)}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div className="row-tight" style={{ marginBottom: "0.5rem", flexWrap: "nowrap" }}>
                    <Select className="grow" value={secilenEtiketId} onChange={(e) => setSecilenEtiketId(e.target.value)}>
                      <option value="">Seç...</option>
                      {etiketler.filter((e) => !detay.etiketler.some((d) => d.id === e.id)).map((e) => (
                        <option key={e.id} value={e.id}>{e.ad}</option>
                      ))}
                    </Select>
                    <Button size="sm" onClick={etiketAta}>Ata</Button>
                  </div>
                  <form onSubmit={etiketOlusturVeAta} className="row-tight" style={{ flexWrap: "nowrap" }}>
                    <Input className="grow" value={yeniEtiket} onChange={(e) => setYeniEtiket(e.target.value)} placeholder="Yeni etiket..." />
                    <Button size="sm" type="submit">➕</Button>
                  </form>
                </Card>
              </div>
            </div>
          )}

          {aktifSekme === "crm" && (
            <div aria-labelledby="cari-detay-tab-crm" className="stack" id="cari-detay-panel-crm" role="tabpanel" tabIndex={0}>
              {!crm ? <Card><p className="subtle">CRM bilgileri yükleniyor...</p></Card> : <>
                {cariAnalizi && <Card>
                  <div className="between"><div className="card__title" style={{ margin: 0 }}>Ödeme Davranışı Analizi</div><Badge variant={cariAnalizi.guven === "dusuk" ? "neutral" : "info"}>Güven: {cariAnalizi.guven}</Badge></div>
                  <StatGrid>
                    <Stat label="Risk Skoru" value={`${cariAnalizi.riskSkoru}/100`} tone={cariAnalizi.riskSeviyesi === "yuksek" ? "danger" : cariAnalizi.riskSeviyesi === "orta" ? "default" : "success"} hint={cariAnalizi.riskSeviyesi} />
                    <Stat label="Tahmini Gecikme" value={cariAnalizi.tahminiGecikmeGun === null ? "—" : `${cariAnalizi.tahminiGecikmeGun} gün`} hint={cariAnalizi.odemeDavranisi.replaceAll("_", " ")} />
                    <Stat label="Zamanında Ödeme" value={cariAnalizi.metrikler.zamanindaOdemeOrani === null ? "—" : `%${cariAnalizi.metrikler.zamanindaOdemeOrani}`} hint={`${cariAnalizi.metrikler.kapananBorcSayisi} kapanmış borç`} />
                    <Stat label="Önerilen Risk Limiti" value={tl(cariAnalizi.onerilenRiskLimiti)} tone="accent" hint="Son 6 aylık davranışa göre" />
                  </StatGrid>
                  <details className="record-disclosure"><summary>Analiz gerekçeleri</summary><ul>{cariAnalizi.gerekceler.map((gerekce) => <li key={gerekce}>{gerekce}</li>)}</ul><p className="subtle">Bu sonuç istatistiksel bir karar desteğidir; finansal karar öncesinde kullanıcı değerlendirmesi gerekir.</p></details>
                </Card>}
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <Card className="grow" style={{ minWidth: 300 }}>
                    <div className="card__title">Yeni Etkileşim</div>
                    <form className="stack" onSubmit={etkilesimEkle}>
                      <div className="row">
                        <Field label="Tür"><Select value={etkilesimTipi} onChange={(e) => setEtkilesimTipi(e.target.value)}><option value="gorusme">Görüşme</option><option value="telefon">Telefon</option><option value="eposta">E-posta</option><option value="ziyaret">Ziyaret</option><option value="not">Not</option></Select></Field>
                        <Field label="Tarih"><Input type="datetime-local" value={etkilesimTarihi} onChange={(e) => setEtkilesimTarihi(e.target.value)} /></Field>
                      </div>
                      <Field label="Konu"><Input value={etkilesimKonusu} onChange={(e) => setEtkilesimKonusu(e.target.value)} required minLength={2} /></Field>
                      <Field label="Açıklama"><Input value={etkilesimAciklamasi} onChange={(e) => setEtkilesimAciklamasi(e.target.value)} /></Field>
                      <Button type="submit" size="sm" variant="primary">Etkileşimi kaydet</Button>
                    </form>
                  </Card>
                  <Card className="grow" style={{ minWidth: 320 }}>
                    <div className="card__title">Yeni Görev ve Hatırlatma</div>
                    <form className="stack" onSubmit={crmGorevEkle}>
                      <Field label="Başlık"><Input value={gorevBasligi} onChange={(e) => setGorevBasligi(e.target.value)} required minLength={2} /></Field>
                      <Field label="Açıklama"><Input value={gorevAciklamasi} onChange={(e) => setGorevAciklamasi(e.target.value)} /></Field>
                      <div className="row">
                        <Field label="Atanan"><Select value={gorevAtanan} onChange={(e) => setGorevAtanan(e.target.value)}><option value="">Kendim</option>{crm.kullanicilar.map((k) => <option key={k.id} value={k.id}>{k.adSoyad}</option>)}</Select></Field>
                        <Field label="Öncelik"><Select value={gorevOnceligi} onChange={(e) => setGorevOnceligi(e.target.value)}><option value="dusuk">Düşük</option><option value="normal">Normal</option><option value="yuksek">Yüksek</option></Select></Field>
                      </div>
                      <div className="row">
                        <Field label="Son tarih"><Input type="datetime-local" value={gorevSonTarihi} onChange={(e) => setGorevSonTarihi(e.target.value)} required /></Field>
                        <Field label="Hatırlatma"><Input type="datetime-local" value={gorevHatirlatmaTarihi} onChange={(e) => setGorevHatirlatmaTarihi(e.target.value)} /></Field>
                      </div>
                      <Button type="submit" size="sm" variant="primary">Görevi oluştur</Button>
                    </form>
                  </Card>
                </div>
                <Card>
                  <div className="card__title">Açık Görevler</div>
                  {crm.gorevler.filter((g) => g.durum === "acik").length === 0 ? <p className="subtle">Açık görev bulunmuyor.</p> : <TableWrap><thead><tr><th>Görev</th><th>Atanan</th><th>Öncelik</th><th>Son tarih</th><th>Hatırlatma</th><th className="center">İşlem</th></tr></thead><tbody>{crm.gorevler.filter((g) => g.durum === "acik").map((g) => <tr key={g.id}><td><strong>{g.baslik}</strong>{g.aciklama && <div className="muted">{g.aciklama}</div>}</td><td>{g.atanan.adSoyad}</td><td><Badge variant={g.oncelik === "yuksek" ? "danger" : "neutral"}>{g.oncelik}</Badge></td><td>{new Date(g.sonTarih).toLocaleString("tr-TR")}</td><td>{g.hatirlatmaTarihi ? new Date(g.hatirlatmaTarihi).toLocaleString("tr-TR") : "—"}</td><td className="center"><div className="row-tight"><Button size="sm" onClick={() => crmGorevDurumu(g.id, "tamamlandi")}>Tamamla</Button><Button size="sm" onClick={() => crmGorevDurumu(g.id, "iptal")}>İptal</Button></div></td></tr>)}</tbody></TableWrap>}
                </Card>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <Card className="grow" style={{ minWidth: 320 }}><div className="card__title">Etkileşim Geçmişi</div>{crm.etkilesimler.length === 0 ? <p className="subtle">Henüz etkileşim kaydı yok.</p> : <div className="stack">{crm.etkilesimler.map((e) => <div key={e.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: ".75rem" }}><div className="between"><strong>{e.konu}</strong><Badge variant="neutral">{e.tip}</Badge></div><p className="muted" style={{ margin: ".25rem 0" }}>{e.aciklama || "Açıklama yok"}</p><small className="subtle">{new Date(e.tarih).toLocaleString("tr-TR")} · {e.user.adSoyad}</small></div>)}</div>}</Card>
                  <Card className="grow" style={{ minWidth: 320 }}><div className="card__title">Teklif Geçmişi</div>{crm.teklifler.length === 0 ? <p className="subtle">Bu cariye ait teklif yok.</p> : <TableWrap><thead><tr><th>Teklif</th><th>Tarih</th><th>Durum</th><th className="num">Tutar</th></tr></thead><tbody>{crm.teklifler.map((t) => <tr key={t.id}><td><a className="btn-link" href={`/panel/belgeler?yon=satis&tur=teklif&odak=${t.id}`}>{t.no}</a></td><td>{new Date(t.tarih).toLocaleDateString("tr-TR")}</td><td><Status tone={t.durum === "onaylandi" ? "ok" : t.durum === "iptal" ? "danger" : "warn"}>{t.durum}</Status></td><td className="num">{Number(t.genelToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {t.dovizCinsi}</td></tr>)}</tbody></TableWrap>}</Card>
                </div>
              </>}
            </div>
          )}

          {aktifSekme === "ekstre" && (
            <Card aria-labelledby="cari-detay-tab-ekstre" id="cari-detay-panel-ekstre" role="tabpanel" tabIndex={0}>
              <div className="card__title">📊 Cari Hesap Ekstresi</div>
              {!ekstre ? (
                <p className="subtle" style={{ fontSize: "0.85rem" }}>Ekstre yükleniyor...</p>
              ) : ekstre.satirlar.length === 0 ? (
                <p className="subtle" style={{ fontSize: "0.85rem" }}>Cari hesaba ait herhangi bir hareket bulunmuyor.</p>
              ) : (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>Vade Tarihi</th>
                      <th>Açıklama</th>
                      <th className="num">Borç (TL)</th>
                      <th className="num">Alacak (TL)</th>
                      <th className="num">Bakiye (TL)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ekstre.satirlar.map((row, idx) => {
                      const borcVal = row.tip === "borc" ? Number(row.tutarTry) : 0;
                      const alacakVal = row.tip === "alacak" ? Number(row.tutarTry) : 0;
                      const bakiyeNum = Number(row.yuruyenBakiye);
                      return (
                        <tr key={idx}>
                          <td>{row.tarih}</td>
                          <td>{row.vadeTarihi || "—"}</td>
                          <td>{row.aciklama || "—"}</td>
                          <td className="num" style={{ color: borcVal > 0 ? "var(--danger)" : undefined }}>{borcVal > 0 ? tl(borcVal) : "—"}</td>
                          <td className="num" style={{ color: alacakVal > 0 ? "var(--success)" : undefined }}>{alacakVal > 0 ? tl(alacakVal) : "—"}</td>
                          <td className={`num money ${bakiyeNum > 0 ? "pos" : bakiyeNum < 0 ? "neg" : ""}`}>{tl(bakiyeNum)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
              )}
            </Card>
          )}

          {aktifSekme === "adresler" && (
            <Card aria-labelledby="cari-detay-tab-adresler" className="stack" id="cari-detay-panel-adresler" role="tabpanel" tabIndex={0}>
              <div className="card__title" style={{ margin: 0 }}>🏢 Adres Bilgileri</div>
              {detay.adresler && detay.adresler.length === 0 ? (
                <p className="subtle" style={{ fontSize: "0.85rem", margin: 0 }}>Kayıtlı adres bilgisi yok.</p>
              ) : (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Başlık</th><th>Tip</th><th>Adres</th><th>İl / İlçe</th>
                      <th>Posta Kodu</th><th className="center">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detay.adresler?.map((a) => (
                      <tr key={a.id}>
                        <td>{a.baslik}</td>
                        <td>{ADRES_TIP_ETIKETI[a.tip] ?? a.tip}</td>
                        <td>{a.adres}</td>
                        <td>{a.ilce ? `${a.ilce} / ` : ""}{a.il || "—"}</td>
                        <td className="mono">{a.postaKodu || "—"}</td>
                        <td className="center">
                          <button className="btn-link" style={{ color: "var(--danger)" }} onClick={() => adresSil(a.id)}>Sil</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
              <form onSubmit={adresEkle} className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                <div className="row">
                  <FormAlan flex={1} min={150}>
                    <Field label="Adres Tipi">
                      <Select value={adresTip} onChange={(e) => setAdresTip(e.target.value)}>
                        <option value="fatura">Fatura Adresi</option>
                        <option value="sevk">Sevk Adresi</option>
                        <option value="merkez">Merkez</option>
                        <option value="sube">Şube</option>
                        <option value="depo">Depo</option>
                      </Select>
                    </Field>
                  </FormAlan>
                  <FormAlan flex={2} min={180}>
                    <Field label="Başlık *">
                      <Input value={adresBaslik} onChange={(e) => setAdresBaslik(e.target.value)} placeholder="Örn. Merkez Ofis" required />
                    </Field>
                  </FormAlan>
                  <FormAlan flex={1} min={120}>
                    <Field label="İl">
                      <Input value={adresIl} onChange={(e) => setAdresIl(e.target.value)} placeholder="İstanbul" />
                    </Field>
                  </FormAlan>
                  <FormAlan flex={1} min={120}>
                    <Field label="İlçe">
                      <Input value={adresIlce} onChange={(e) => setAdresIlce(e.target.value)} placeholder="Kadıköy" />
                    </Field>
                  </FormAlan>
                  <FormAlan flex={1} min={110}>
                    <Field label="Posta Kodu">
                      <Input value={adresPostaKodu} onChange={(e) => setAdresPostaKodu(e.target.value)} placeholder="34000" maxLength={10} />
                    </Field>
                  </FormAlan>
                </div>
                <div className="row-tight" style={{ flexWrap: "nowrap" }}>
                  <Input
                    className="grow"
                    value={adresMetin}
                    onChange={(e) => setAdresMetin(e.target.value)}
                    placeholder="Açık adres *"
                    required
                    minLength={2}
                    maxLength={500}
                  />
                  <Button size="sm" type="submit">➕ Ekle</Button>
                </div>
              </form>
            </Card>
          )}

          {aktifSekme === "kisiler" && (
            <Card aria-labelledby="cari-detay-tab-kisiler" className="stack" id="cari-detay-panel-kisiler" role="tabpanel" tabIndex={0}>
              <div className="card__title" style={{ margin: 0 }}>👥 İlgili Kişiler</div>
              {detay.kisiler && detay.kisiler.length === 0 ? (
                <p className="subtle" style={{ fontSize: "0.85rem", margin: 0 }}>Kayıtlı ilgili kişi yok.</p>
              ) : (
                <TableWrap>
                  <thead>
                    <tr><th>Ad Soyad</th><th>Görev</th><th>Telefon</th><th>E-posta</th><th className="center">İşlem</th></tr>
                  </thead>
                  <tbody>
                    {detay.kisiler?.map((k) => (
                      <tr key={k.id}>
                        <td>{k.adSoyad}</td>
                        <td>{k.gorev || "—"}</td>
                        <td>{k.telefon || "—"}</td>
                        <td>{k.eposta || "—"}</td>
                        <td className="center">
                          <button className="btn-link" style={{ color: "var(--danger)" }} onClick={() => kisiSil(k.id)}>Sil</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
              <form onSubmit={kisiEkle} className="row-tight" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", flexWrap: "nowrap" }}>
                <Input
                  className="grow"
                  value={kisiAdSoyad}
                  onChange={(e) => setKisiAdSoyad(e.target.value)}
                  placeholder="Ad Soyad *"
                  required
                  minLength={2}
                  style={{ minWidth: 150 }}
                />
                <Input value={kisiGorev} onChange={(e) => setKisiGorev(e.target.value)} placeholder="Görev" style={{ minWidth: 120 }} />
                <Input value={kisiTelefon} onChange={(e) => setKisiTelefon(e.target.value)} placeholder="Telefon" style={{ minWidth: 130 }} />
                <Input type="email" value={kisiEposta} onChange={(e) => setKisiEposta(e.target.value)} placeholder="E-posta" style={{ flex: 2, minWidth: 170 }} />
                <Button size="sm" type="submit">➕ Ekle</Button>
              </form>
            </Card>
          )}

          {aktifSekme === "bankalar" && (
            <Card aria-labelledby="cari-detay-tab-bankalar" className="stack" id="cari-detay-panel-bankalar" role="tabpanel" tabIndex={0}>
              <div className="card__title" style={{ margin: 0 }}>🏦 Banka Hesapları</div>
              {detay.bankaHesaplari.length === 0 ? (
                <p className="subtle" style={{ fontSize: "0.85rem", margin: 0 }}>Kayıtlı banka hesabı yok.</p>
              ) : (
                <TableWrap>
                  <thead>
                    <tr><th>Banka Adı</th><th>IBAN</th><th>Döviz</th><th className="center">İşlem</th></tr>
                  </thead>
                  <tbody>
                    {detay.bankaHesaplari.map((b) => (
                      <tr key={b.id}>
                        <td>{b.bankaAdi}{b.subeAdi ? ` / ${b.subeAdi}` : ""}</td>
                        <td className="mono">{b.iban}</td>
                        <td>{b.paraBirimi}</td>
                        <td className="center"><button className="btn-link" style={{ color: "var(--danger)" }} onClick={() => bankaHesabiSil(b.id)}>Sil</button></td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
              <form onSubmit={bankaHesabiEkle} className="row-tight" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", flexWrap: "nowrap" }}>
                <Input className="grow" value={bankaAdi} onChange={(e) => setBankaAdi(e.target.value)} placeholder="Banka adı" required style={{ minWidth: 140 }} />
                <Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="TR + 24 rakam" required style={{ flex: 2, minWidth: 220 }} />
                <Select value={paraBirimi} onChange={(e) => setParaBirimi(e.target.value)} style={{ width: 90 }}>
                  <option>TRY</option><option>USD</option><option>EUR</option>
                </Select>
                <Button size="sm" type="submit">➕ Ekle</Button>
              </form>
            </Card>
          )}
        </Card>
      )}

      <StatGrid>
        <Stat label="Toplam Cari" value={cariler.length} />
        <Stat label="Müşteri" value={musteriSayisi} tone="accent" />
        <Stat label="Tedarikçi" value={tedarikciSayisi} tone="info" />
        <Stat label="Bloke" value={blokeSayisi} tone={blokeSayisi > 0 ? "danger" : "default"} />
      </StatGrid>

      <section className="saved-view-bar" aria-label="Cari görünümü ve filtreleri">
        <div className="saved-view-filters">
          <Field label="Cari türü"><Select aria-label="Cari türü" value={filtreTip} onChange={(e) => filtreyiUygula(e.target.value as FiltreTip)}><option value="tumu">Tümü</option><option value="musteri">Müşteri</option><option value="tedarikci">Tedarikçi</option><option value="bloke">Bloke</option></Select></Field>
          <Field label="Kaydedilmiş görünüm"><Select value="" onChange={(e) => { const gorunum = kayitliGorunumler.find((g) => g.id === e.target.value); if (gorunum) gorunumuUygula(gorunum); }}><option value="">Görünüm seçin</option>{kayitliGorunumler.map((g) => <option value={g.id} key={g.id}>{g.ad}</option>)}</Select></Field>
        </div>
        <div className="saved-view-actions">
          {filtreTip !== "tumu" && <Button size="sm" type="button" onClick={() => filtreyiUygula("tumu")}>Filtreleri temizle</Button>}
          <Button size="sm" type="button" onClick={() => setGorunumFormuAcik((acik) => !acik)}>Görünümü kaydet</Button>
        </div>
        {gorunumFormuAcik && <form className="saved-view-form" onSubmit={gorunumKaydet}><Input autoFocus aria-label="Görünüm adı" value={gorunumAdi} onChange={(e) => setGorunumAdi(e.target.value)} placeholder="Örn. Tahsilat yapılacak müşteriler" required /><Button size="sm" variant="primary" type="submit">Kaydet</Button><Button size="sm" type="button" onClick={() => setGorunumFormuAcik(false)}>Vazgeç</Button></form>}
        {kayitliGorunumler.length > 0 && <div className="saved-view-list" aria-label="Kaydedilmiş görünümleri yönet">{kayitliGorunumler.map((g) => <span key={g.id}><button type="button" onClick={() => gorunumuUygula(g)}>{g.ad}</button><button aria-label={g.ad + " görünümünü sil"} title="Görünümü sil" type="button" onClick={() => gorunumSil(g.id)}>×</button></span>)}</div>}
      </section>

      <div className="toolbar">
        <SearchInput
          className="grow"
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Cari adı, kodu, VKN veya telefon ile ara..."
        />
        <Segmented<FiltreTip>
          value={filtreTip}
          onChange={filtreyiUygula}
          items={[
            { deger: "tumu", baslik: "Tümü" },
            { deger: "musteri", baslik: "Müşteri" },
            { deger: "tedarikci", baslik: "Tedarikçi" },
            { deger: "bloke", baslik: "Bloke" },
          ]}
        />
      </div>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Cari Adı</th>
              <th>Tür</th>
              <th>Sektör</th>
              <th>VKN / TCKN</th>
              <th className="num">Bakiye</th>
              <th>Risk</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {filtrelenmisCariler.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">Arama kriterlerinize uygun cari hesap kaydı bulunamadı.</td>
              </tr>
            ) : (
              filtrelenmisCariler.map((c) => {
                const bakiyeNum = Number(c.bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? "0.00");
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="cell-entity">
                        <Avatar isim={c.unvan} />
                        <div>
                          <div className="cell-entity__name">
                            {c.karaListe && <span title="Kara liste / işlem blokajı">🚫 </span>}
                            {c.unvan}
                          </div>
                          <div className="cell-entity__meta">{c.kod}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge variant={c.tip === "musteri" ? "success" : c.tip === "tedarikci" ? "info" : "accent"}>
                        {c.tip === "musteri" ? "Müşteri" : c.tip === "tedarikci" ? "Tedarikçi" : "İkisi de"}
                      </Badge>
                    </td>
                    <td>{c.sektor || "—"}</td>
                    <td>{c.vknTckn || "—"}</td>
                    <td className={`num money ${bakiyeNum > 0 ? "pos" : bakiyeNum < 0 ? "neg" : ""}`}>{tl(bakiyeNum)}</td>
                    <td>
                      <Status tone={c.karaListe ? "danger" : "ok"}>{c.karaListe ? "Bloke" : "Normal"}</Status>
                    </td>
                    <td className="center">
                      <div className="row-tight" style={{ flexWrap: "nowrap", justifyContent: "center" }}>
                        <Button size="sm" onClick={() => detayAc(c.id)}>🔍 Detay</Button>
                        <Button size="sm" onClick={() => ekstreIndir(c.id, c.unvan)}>📊 Ekstre</Button>
                        <Button size="sm" onClick={() => kopyala(c.id)}>📋 Kopyala</Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
        {sonrakiCariImleci && (
          <div style={{ padding: "1rem", textAlign: "center" }}>
            <Button type="button" onClick={() => void yukle(sonrakiCariImleci)} disabled={cariListesiYukleniyor}>
              {cariListesiYukleniyor ? "Cariler yükleniyor…" : "Daha fazla cari yükle"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── Sayfaya özel küçük yardımcılar ─────────────────────────────────────── */
function FormBolum({ baslik, children }: { baslik?: string; children: React.ReactNode }) {
  return (
    <div>
      {baslik && <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--accent-text)", margin: "0 0 0.5rem" }}>{baslik}</p>}
      <div className="row">{children}</div>
    </div>
  );
}

function FormAlan({ flex, min, children }: { flex: number; min: number; children: React.ReactNode }) {
  return <div style={{ flex: flex === 0 ? `0 1 ${min}px` : flex, minWidth: min }}>{children}</div>;
}

function SatirCift({ ad, deger }: { ad: string; deger: string }) {
  return (
    <tr>
      <td className="muted" style={{ padding: "0.4rem 0" }}>{ad}</td>
      <td className="num" style={{ color: "var(--text)" }}>{deger}</td>
    </tr>
  );
}
