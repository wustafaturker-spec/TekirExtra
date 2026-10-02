"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, apiDosyaIndir, tokenAl } from "@/lib/api";
import { kullanimOlayi } from "@/lib/kullanim";
import { PostaKutusuSecimleri, type PostaKutusuSecimi } from "@/components/posta-kutusu-secimi";
import { FormGrubu } from "@/components/form-grubu";
import { Bakiye, CariEkstreTablosu, type EkstreVeri } from "@/components/cari-ekstre-tablosu";
import { CARI_EBELGE_ETIKETI, EKSTRE_TURU_ADLARI, EKSTRE_TURLERI, vknTcknGecerliMi, type CariEbelgeDurumu, type CariEbelgeTuru, type EkstreTuru } from "@tekirextra/shared";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ButtonLabel,
  Card,
  EylemCubugu,
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
  bakiyeler: { dovizCinsi: string; bakiye: string; bakiyeTry: string }[];
  /** CARI-23: GİB listesine göre e-Fatura / e-Arşiv; liste güncel değilse bilinmiyor. */
  ebelgeTuru?: CariEbelgeTuru;
}

/** CARI-23: cari kartındaki e-belge mükellefiyeti. */
function EbelgeMukellefiyeti({ durum }: { durum: CariEbelgeDurumu & { listeGuncellendi: string | null } }) {
  const gun = (tarih: string | null) => (tarih ? new Date(`${tarih}T00:00:00`).toLocaleDateString("tr-TR") : null);
  return (
    <div className="stack" style={{ gap: "0.25rem", marginTop: "0.5rem" }}>
      <div className="row-tight">
        {durum.tur === "efatura" && <Badge variant="info">e-Fatura mükellefi</Badge>}
        {durum.tur === "earsiv" && <Badge variant="neutral">e-Arşiv</Badge>}
        {durum.tur === "yurtdisi" && <Badge variant="accent">Yurt dışı</Badge>}
        {durum.tur === "bilinmiyor" && <Badge variant="warning">Mükellefiyet bilinmiyor</Badge>}
        {durum.kamu && <Badge variant="accent">Kamu</Badge>}
        <small className="muted">
          {durum.tur === "efatura"
            ? gun(durum.efaturaKayitTarihi) ? `GİB kaydı: ${gun(durum.efaturaKayitTarihi)}` : "GİB kayıt tarihi listede yok"
            : durum.tur === "earsiv"
              ? "e-Fatura mükellefi değil; faturalar e-Arşiv olarak kesilir"
              : durum.tur === "yurtdisi"
                ? "Mal satışı ihracat e-Faturasıyla, hizmet satışı e-Arşiv istisna ile kesilir; firma e-Fatura kullanmıyorsa ikisi de e-Arşiv istisnadır"
                : "Mükellef listesi güncel değil; entegratör listesini güncelleyin"}
        </small>
      </div>
      {(durum.tur === "efatura" || durum.tur === "earsiv") && (
        <small className="muted">
          {durum.eirsaliye
            ? `e-İrsaliye mükellefi${gun(durum.eirsaliyeKayitTarihi) ? ` · kayıt: ${gun(durum.eirsaliyeKayitTarihi)}` : ""}`
            : "e-İrsaliye mükellefi değil"}
        </small>
      )}
      {durum.listeGuncellendi && (
        <small className="subtle">GİB mükellef listesi: {new Date(durum.listeGuncellendi).toLocaleString("tr-TR")}</small>
      )}
    </div>
  );
}

interface Etiket {
  id: string;
  ad: string;
  renk: string | null;
  _count?: { atamalar: number };
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
  /** Gerçek kişide dolu; unvan bunlardan türer (CARI-21). */
  ad: string | null;
  soyad: string | null;
  temsilciUserId: string | null;
  temsilci: { id: string; adSoyad: string } | null;
  vergiDairesi: string | null;
  mersisNo: string | null;
  ticaretSicilNo: string | null;
  kvkkOnayTarihi: string | null;
  iban: string | null;
  notlar: string | null;
  webSitesi: string | null;
  faks: string | null;
  karaListeNotu: string | null;
  riskLimiti: string | null;
  varsayilanVadeGun: number | null;
  /** Bu cariye kesilen e-Faturaların varsayılan profili (FTR-19). */
  efaturaProfili: "temel" | "ticari";
  /** Bu cariye kesilen e-Arşiv faturaların varsayılan teslim şekli (EBLG-26). */
  earsivGonderimSekli: "elektronik" | "kagit";
  /** KAMU senaryosu: GİB listesinde ÖZEL görünen kamu idaresi için elle işaret. */
  kamuIdaresi?: boolean;
  harcamaBirimiVkn?: string | null;
  harcamaBirimiAdi?: string | null;
  varsayilanIskonto: string | null;
  fiyatListesiId: string | null;
  eFaturaMukellefi: boolean | null;
  ebelgeDurumu?: CariEbelgeDurumu & { listeGuncellendi: string | null };
  /** EBLG-86: alıcının GİB posta kutuları ve gönderimde kullanılacak olan. */
  postaKutulari?: { efatura: PostaKutusuSecimi; eirsaliye: PostaKutusuSecimi } | null;
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

/** Cari kartında e-Belge ve iletişim için eksik bilgiler (sağ panel). */
// Kontrol hanesi burada sorulmaz: kayıtlı cari sunucudan geçmiştir (test ortamının
// sentetik kimlikleri ve yurt dışı/muhtelif özel numaraları kontrol hanesi tutmaz).
function cariKartEksikleri(d: { eposta?: string | null; vknTckn?: string | null; vergiDairesi: string | null; kisiTipi: string; adresler: unknown[] }): string[] {
  const vkn = d.vknTckn?.trim() ?? "";
  return [
    !vkn && "VKN/TCKN yok: e-Fatura/e-Arşiv düzenlenemez",
    d.kisiTipi !== "gercek" && !d.vergiDairesi?.trim() && "Vergi dairesi girilmedi",
    d.adresler.length === 0 && "Adres yok: belgelerde alıcı adresi boş kalır (Adresler sekmesi)",
    !d.eposta?.trim() && "E-posta yok: fatura, ekstre ve ödeme bağlantısı gönderilemez",
  ].filter((e): e is string => Boolean(e));
}

export default function CariSayfasi() {
  const pathname = usePathname(); const router = useRouter(); const yeniSayfasi = pathname.endsWith("/yeni");
  const detayId = !yeniSayfasi ? pathname.match(/^\/panel\/cari\/([^/]+)$/)?.[1] ?? null : null;
  const detaySayfasi = Boolean(detayId);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [arama, setArama] = useState("");
  const [aramaSorgusu, setAramaSorgusu] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(yeniSayfasi);
  useEffect(() => { if (yeniSayfasi) setFormAcik(true); }, [yeniSayfasi]);
  const [detay, setDetay] = useState<CariDetay | null>(null);
  const [ekstre, setEkstre] = useState<EkstreVeri | null>(null);
  const [crm, setCrm] = useState<CrmVeri | null>(null);
  const [cariAnalizi, setCariAnalizi] = useState<CariAnalizi | null>(null);
  const [etiketler, setEtiketler] = useState<Etiket[]>([]);
  const [aktifSekme, setAktifSekme] = useState<Sekme>("genel");
  const [ekstreBaslangic, setEkstreBaslangic] = useState("");
  const [ekstreBitis, setEkstreBitis] = useState("");
  const [ekstreEposta, setEkstreEposta] = useState("");
  const [ekstreIslemde, setEkstreIslemde] = useState(false);
  const [ekstreIptaller, setEkstreIptaller] = useState(false);
  /** CARI-24/25/26: ekstre türü, döviz ekstresinde gösterim ("" = her döviz ayrı) ve mutabakat metni. */
  const [ekstreTuru, setEkstreTuru] = useState<EkstreTuru>("standart");
  const [ekstreDoviz, setEkstreDoviz] = useState<"" | "USD" | "EUR">("");
  const [ekstreMutabakat, setEkstreMutabakat] = useState(false);
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
  const [ad, setAd] = useState("");
  const [soyad, setSoyad] = useState("");
  // Detay formunda seçilen kişi tipi; kaydedilene kadar ad/soyad ya da unvan alanını belirler.
  const [detayKisiTipi, setDetayKisiTipi] = useState<string | null>(null);
  const [kisaAd, setKisaAd] = useState("");
  const [tip, setTip] = useState("musteri");
  const [kisiTipi, setKisiTipi] = useState("tuzel");
  const cariFormRef = useRef<HTMLFormElement>(null);
  const [sektor, setSektor] = useState("");
  const [temsilciUserId, setTemsilciUserId] = useState("");
  // Vergi / resmi
  const [vknTckn, setVknTckn] = useState("");
  const [vergiDairesi, setVergiDairesi] = useState("");
  const [mersisNo, setMersisNo] = useState("");
  const [ticaretSicilNo, setTicaretSicilNo] = useState("");
  const [kvkkOnayTarihi, setKvkkOnayTarihi] = useState("");
  // İletişim & Banka
  const [eposta, setEposta] = useState("");
  const [telefon, setTelefon] = useState("");
  const [webSitesi, setWebSitesi] = useState("");
  const [faks, setFaks] = useState("");
  const [anaIban, setAnaIban] = useState("");
  const [notlar, setNotlar] = useState("");
  // Finans (CARI-10: özel satış koşulları)
  const [riskLimiti, setRiskLimiti] = useState("");
  const [fiyatListesiId, setFiyatListesiId] = useState("");
  const [varsayilanIskonto, setVarsayilanIskonto] = useState("");
  const [varsayilanVadeGun, setVarsayilanVadeGun] = useState("");
  const [efaturaProfili, setEfaturaProfili] = useState<"temel" | "ticari">("temel");
  const [earsivGonderimSekli, setEarsivGonderimSekli] = useState<"elektronik" | "kagit">("elektronik");
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
  const [adresUlke, setAdresUlke] = useState("TR");
  const [duzenlenenAdresId, setDuzenlenenAdresId] = useState<string | null>(null);
  // İlgili kişi formu (CARI-09)
  const [kisiAdSoyad, setKisiAdSoyad] = useState("");
  const [kisiGorev, setKisiGorev] = useState("");
  const [kisiTelefon, setKisiTelefon] = useState("");
  const [kisiEposta, setKisiEposta] = useState("");
  const [yeniEtiket, setYeniEtiket] = useState("");
  const [yeniEtiketRengi, setYeniEtiketRengi] = useState("#2563EB");
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
      const veri = await api<Etiket[]>("/cari/etiketler");
      setEtiketler(Array.isArray(veri) ? veri : []);
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
        .then((veri) => setFiyatListeleri(Array.isArray(veri) ? veri : []))
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
        // Seçili ekstre türü korunur; tarih süzgeci yeni caride sıfırdan başlar.
        api<EkstreVeri>(`/cari/${id}/ekstre?${new URLSearchParams({ ...(ekstreTuru !== "standart" ? { tur: ekstreTuru } : {}), ...(ekstreTuru === "doviz" && ekstreDoviz ? { doviz: ekstreDoviz } : {}) })}`).catch(() => null),
        api<CrmVeri>(`/cari/${id}/crm`).catch(() => null),
        api<CariAnalizi>(`/cari/${id}/davranis-analizi`).catch(() => null),
      ]);
      setDetay(cDetay);
      setDetayKisiTipi(null);
      setEkstreEposta(cDetay.eposta || "");
      setEkstre(cEkstre ?? { cari: cDetay, devirBakiyesi: "0", donemBorc: "0", donemAlacak: "0", donemSonuBakiyesi: "0", dovizOzet: [], satirlar: [] });
      setCrm(cCrm ?? { etkilesimler: [], gorevler: [], teklifler: [], kullanicilar: [] });
      setCariAnalizi(cAnaliz);
      if (!sekmeyiKoru) setAktifSekme("genel");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Detay veya ekstre yüklenemedi");
    }
  }

  /** Ekstre sorgusu; ekran, PDF ve Excel aynı parametrelerle istenir. */
  function ekstreSorgusu(s: { iptaller?: boolean; tur?: EkstreTuru; doviz?: "" | "USD" | "EUR" } = {}) {
    const qs = new URLSearchParams();
    const tur = s.tur ?? ekstreTuru; const doviz = s.doviz ?? ekstreDoviz;
    if (ekstreBaslangic) qs.set("baslangic", ekstreBaslangic);
    if (ekstreBitis) qs.set("bitis", ekstreBitis);
    if (s.iptaller ?? ekstreIptaller) qs.set("iptaller", "1");
    if (tur !== "standart") qs.set("tur", tur);
    if (tur === "doviz" && doviz) qs.set("doviz", doviz);
    return qs;
  }

  async function ekstreFiltrele(s: { iptaller?: boolean; tur?: EkstreTuru; doviz?: "" | "USD" | "EUR" } = {}) {
    if (!detay) return;
    if (ekstreBaslangic && ekstreBitis && ekstreBaslangic > ekstreBitis) { setHata("Başlangıç tarihi bitiş tarihinden sonra olamaz."); return; }
    setEkstreIslemde(true); setHata("");
    try { setEkstre(await api<EkstreVeri>(`/cari/${detay.id}/ekstre?${ekstreSorgusu(s)}`)); }
    catch (h) { setHata(h instanceof Error ? h.message : "Ekstre yüklenemedi"); }
    finally { setEkstreIslemde(false); }
  }

  function ekstreYolu(uzanti: "pdf" | "excel") {
    if (!detay) return "";
    const qs = ekstreSorgusu();
    if (uzanti === "pdf" && ekstreMutabakat) qs.set("mutabakat", "1");
    return `/cari/${detay.id}/ekstre/${uzanti}?${qs}`;
  }

  async function ekstreGonder() {
    if (!detay || !ekstreEposta) return;
    setEkstreIslemde(true); setHata(""); setBasari("");
    try { const sonuc = await api<{ mesaj: string }>(`/cari/${detay.id}/ekstre/eposta`, { method: "POST", body: JSON.stringify({ baslangic: ekstreBaslangic || undefined, bitis: ekstreBitis || undefined, alici: ekstreEposta, iptalleriGoster: ekstreIptaller, tur: ekstreTuru, hedefDoviz: ekstreTuru === "doviz" && ekstreDoviz ? ekstreDoviz : undefined, mutabakat: ekstreMutabakat }) }); setBasari(sonuc.mesaj); }
    catch (h) { setHata(h instanceof Error ? h.message : "Ekstre gönderilemedi"); }
    finally { setEkstreIslemde(false); }
  }

  async function finansGuncelle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!detay) return; const veri = new FormData(e.currentTarget);
    setHata(""); setBasari("");
    try { await api(`/cari/${detay.id}`, { method: "PATCH", body: JSON.stringify({ riskLimiti: String(veri.get("riskLimiti") || "") || undefined, varsayilanVadeGun: veri.get("varsayilanVadeGun") === "" ? undefined : Number(veri.get("varsayilanVadeGun")), varsayilanIskonto: String(veri.get("varsayilanIskonto") || "") || undefined, fiyatListesiId: String(veri.get("fiyatListesiId") || "") || undefined, efaturaProfili: veri.get("efaturaProfili") as "temel" | "ticari", earsivGonderimSekli: veri.get("earsivGonderimSekli") as "elektronik" | "kagit", kamuIdaresi: veri.get("kamuIdaresi") === "on", harcamaBirimiVkn: String(veri.get("harcamaBirimiVkn") || "").trim() || null, harcamaBirimiAdi: String(veri.get("harcamaBirimiAdi") || "").trim() || null }) }); await detayAc(detay.id, true); setBasari("Risk ve finans koşulları güncellendi."); }
    catch (h) { setHata(h instanceof Error ? h.message : "Finans bilgileri güncellenemedi"); }
  }

  useEffect(() => {
    if (detayId && tokenAl()) void detayAc(detayId);
    // detayAc yalnız rota kimliği değiştiğinde çalışmalı.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detayId]);

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
          // Gerçek kişide unvanı API ad ve soyaddan kurar (CARI-21).
          unvan: kisiTipi === "gercek" ? `${ad.trim()} ${soyad.trim()}` : unvan,
          ad: kisiTipi === "gercek" ? ad : undefined,
          soyad: kisiTipi === "gercek" ? soyad : undefined,
          kisaAd: kisaAd || undefined,
          tip,
          kisiTipi,
          sektor: sektor || undefined,
          temsilciUserId: temsilciUserId || undefined,
          vknTckn: vknTckn || undefined,
          vergiDairesi: vergiDairesi || undefined,
          mersisNo: mersisNo || undefined,
          ticaretSicilNo: ticaretSicilNo || undefined,
          kvkkOnayTarihi: kvkkOnayTarihi || undefined,
          eposta: eposta || undefined,
          telefon: telefon || undefined,
          webSitesi: webSitesi || undefined,
          faks: faks || undefined,
          iban: anaIban || undefined,
          riskLimiti: riskLimiti || undefined,
          fiyatListesiId: fiyatListesiId || undefined,
          varsayilanIskonto: varsayilanIskonto || undefined,
          varsayilanVadeGun: varsayilanVadeGun ? Number(varsayilanVadeGun) : undefined,
          efaturaProfili,
          earsivGonderimSekli,
          notlar: notlar || undefined,
        }),
      });
      setBasari("Cari kart başarıyla oluşturuldu.");
      setFormAcik(false);
      setKod("");
      setUnvan("");
      setAd("");
      setSoyad("");
      setKisaAd("");
      setSektor("");
      setTemsilciUserId("");
      setVknTckn("");
      setVergiDairesi("");
      setMersisNo("");
      setTicaretSicilNo("");
      setKvkkOnayTarihi("");
      setEposta("");
      setTelefon("");
      setWebSitesi("");
      setFaks("");
      setAnaIban("");
      setNotlar("");
      setRiskLimiti("");
      setFiyatListesiId("");
      setVarsayilanIskonto("");
      setVarsayilanVadeGun("");
      setEfaturaProfili("temel");
      setEarsivGonderimSekli("elektronik");
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
      const degerler = {
        eposta: String(f.get("eposta") || "").trim(),
        telefon: String(f.get("telefon") || "").trim(),
        webSitesi: String(f.get("webSitesi") || "").trim(),
        faks: String(f.get("faks") || "").trim(),
        iban: String(f.get("iban") || "").trim(),
        notlar: String(f.get("notlar") || "").trim(),
      };
      const onceki = {
        eposta: detay.eposta ?? "",
        telefon: detay.telefon ?? "",
        webSitesi: detay.webSitesi ?? "",
        faks: detay.faks ?? "",
        iban: detay.iban ?? "",
        notlar: detay.notlar ?? "",
      };
      const degisen = Object.fromEntries(Object.entries(degerler).filter(([alan, deger]) => deger !== onceki[alan as keyof typeof onceki]).map(([alan, deger]) => [alan, deger || null]));
      if (!Object.keys(degisen).length) { setBasari("İletişim ve not bilgilerinde değişiklik yok."); return; }
      await api(`/cari/${detay.id}`, { method: "PATCH", body: JSON.stringify(degisen) });
      await detayAc(detay.id, true); void yukle(); setBasari("Cari iletişim ve not bilgileri güncellendi.");
    } catch (h) { setHata(h instanceof Error ? h.message : "İletişim bilgileri güncellenemedi"); }
  }

  async function cariKimligiGuncelle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!detay) return; const f = new FormData(e.currentTarget); setHata(""); setBasari("");
    const degerler = {
      unvan: String(f.get("unvan") || "").trim(), ad: String(f.get("ad") || "").trim(), soyad: String(f.get("soyad") || "").trim(),
      kisaAd: String(f.get("kisaAd") || "").trim(),
      tip: String(f.get("tip") || detay.tip), kisiTipi: String(f.get("kisiTipi") || detay.kisiTipi), sektor: String(f.get("sektor") || "").trim(),
      temsilciUserId: String(f.get("temsilciUserId") || "").trim(),
      vknTckn: String(f.get("vknTckn") || "").trim(), vergiDairesi: String(f.get("vergiDairesi") || "").trim(),
      mersisNo: String(f.get("mersisNo") || "").trim(), ticaretSicilNo: String(f.get("ticaretSicilNo") || "").trim(),
      kvkkOnayTarihi: String(f.get("kvkkOnayTarihi") || "").trim(),
    };
    // Gerçek kişide unvan ad ve soyaddan türer (CARI-21); tüzelde ad/soyad tutulmaz.
    if (degerler.kisiTipi === "gercek") {
      if (!degerler.ad || !degerler.soyad) { setHata("Gerçek kişide ad ve soyad zorunludur."); return; }
      degerler.unvan = `${degerler.ad} ${degerler.soyad}`;
    } else {
      degerler.ad = ""; degerler.soyad = "";
    }
    if (!degerler.unvan) { setHata("Ünvan zorunludur."); return; }
    const onceki = {
      unvan: detay.unvan, ad: detay.ad ?? "", soyad: detay.soyad ?? "", kisaAd: detay.kisaAd ?? "", tip: detay.tip, kisiTipi: detay.kisiTipi,
      sektor: detay.sektor ?? "", temsilciUserId: detay.temsilciUserId ?? "", vknTckn: detay.vknTckn ?? "", vergiDairesi: detay.vergiDairesi ?? "",
      mersisNo: detay.mersisNo ?? "", ticaretSicilNo: detay.ticaretSicilNo ?? "", kvkkOnayTarihi: detay.kvkkOnayTarihi ?? "",
    };
    const degisen = Object.fromEntries(Object.entries(degerler).filter(([alan, deger]) => deger !== onceki[alan as keyof typeof onceki]).map(([alan, deger]) => [alan, deger === "" ? null : deger]));
    if (!Object.keys(degisen).length) { setBasari("Cari bilgilerinde değişiklik yok."); return; }
    try {
      await api(`/cari/${detay.id}`, { method: "PATCH", body: JSON.stringify(degisen) });
      await detayAc(detay.id, true); void yukle(); setBasari("Cari kimlik ve resmî bilgileri güncellendi.");
    } catch (h) { setHata(h instanceof Error ? h.message : "Cari bilgileri güncellenemedi"); }
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
      await api(duzenlenenAdresId ? `/cari/${detay.id}/adresler/${duzenlenenAdresId}` : `/cari/${detay.id}/adresler`, {
        method: duzenlenenAdresId ? "PATCH" : "POST",
        body: JSON.stringify({
          tip: adresTip,
          baslik: adresBaslik.trim(),
          adres: adresMetin.trim(),
          ulke: adresUlke.trim().toUpperCase() || "TR",
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
      setAdresUlke("TR");
      setDuzenlenenAdresId(null);
      await detayAc(detay.id, true);
      setBasari(duzenlenenAdresId ? "Adres güncellendi." : "Adres eklendi.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Adres eklenemedi");
    }
  }

  function adresDuzenle(adres: CariAdres) {
    setDuzenlenenAdresId(adres.id); setAdresTip(adres.tip); setAdresBaslik(adres.baslik); setAdresMetin(adres.adres);
    setAdresIl(adres.il ?? ""); setAdresIlce(adres.ilce ?? ""); setAdresPostaKodu(adres.postaKodu ?? ""); setAdresUlke(adres.ulke ?? "TR"); setHata(""); setBasari("");
  }

  function adresFormunuTemizle() {
    setDuzenlenenAdresId(null); setAdresTip("fatura"); setAdresBaslik(""); setAdresMetin(""); setAdresIl(""); setAdresIlce(""); setAdresPostaKodu(""); setAdresUlke("TR");
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
        body: JSON.stringify({ ad: yeniEtiket.trim(), renk: yeniEtiketRengi }),
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

  async function etiketiSistemdenSil(etiket: Etiket) {
    if (!confirm(`“${etiket.ad}” etiketi sistemden silinsin mi? Bu etiket tüm cari kartlarından kaldırılır.`)) return;
    setHata(""); setBasari("");
    try {
      await api(`/cari/etiketler/${etiket.id}`, { method: "DELETE" });
      await Promise.all([detay ? detayAc(detay.id, true) : Promise.resolve(), etiketleriYukle()]);
      setBasari("Etiket sistemden silindi.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Etiket silinemedi");
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

  async function kopyala(id: string) {
    setHata("");
    setBasari("");
    try {
      const kopya = await api<CariDetay>(`/cari/${id}/kopyala`, { method: "POST" });
      void yukle();
      router.push(`/panel/cari/${kopya.id}`);
      setBasari(`Cari kopyalandı; “${kopya.unvan}” kartı açıldı.`);
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

  /** Yeni cari formunda VKN/TCKN'nin anlık durumu (sağ panel). */
  const vknDurumu = !vknTckn.trim()
    ? { metin: "Girilmedi", sinif: "" }
    : vknTcknGecerliMi(vknTckn.trim())
      ? { metin: `${vknTckn.trim()} · geçerli`, sinif: "is-positive" }
      : { metin: `${vknTckn.trim()} · kontrol hanesi tutmuyor`, sinif: "is-negative" };
  /** Kaydetmeden önce giderilmesi ya da bilinmesi gerekenler. */
  const cariKontrolListesi = [
    (kisiTipi === "gercek" ? !(ad.trim() && soyad.trim()) : !unvan.trim()) && (kisiTipi === "gercek" ? "Ad ve soyad girilmedi" : "Ünvan girilmedi"),
    !kod.trim() && "Cari kodu girilmedi",
    vknTckn.trim() && !vknTcknGecerliMi(vknTckn.trim()) && `${kisiTipi === "gercek" ? "TCKN" : "VKN"} kontrol hanesi tutmuyor; yalnız e-Belge test ortamında kaydedilir`,
    !vknTckn.trim() && "VKN/TCKN yok: e-Fatura/e-Arşiv düzenlemek için gerekir",
    !eposta.trim() && "E-posta yok: fatura, ekstre ve ödeme bağlantısı gönderilemez",
  ].filter((e): e is string => Boolean(e));

  // Ctrl+S (macOS'ta Cmd+S) yeni cari formunu gönderir.
  useEffect(() => {
    if (!formAcik) return;
    const dinle = (olay: KeyboardEvent) => {
      if ((olay.ctrlKey || olay.metaKey) && olay.key.toLowerCase() === "s") {
        olay.preventDefault();
        cariFormRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", dinle);
    return () => window.removeEventListener("keydown", dinle);
  }, [formAcik]);

  return (
    <div className={yeniSayfasi ? "create-page" : detaySayfasi ? "detail-page" : undefined}>
      <PageHeader
        title={detaySayfasi ? (detay?.unvan ?? "Cari Detayı") : yeniSayfasi ? "Yeni Cari" : "Cari Hesaplar"}
        subtitle={detaySayfasi ? "Cari bilgileri, finansal durum, CRM ve iletişim kayıtları." : yeniSayfasi ? "Yeni müşteri, tedarikçi veya diğer cari kartını oluşturun." : "Müşterileriniz, tedarikçileriniz ve diğer cari ortaklarınızı buradan yönetin."}
        actions={
          <>
            {!yeniSayfasi && !detaySayfasi && <ButtonLabel as="a" href="/panel/kasa-banka/kur-farki">💱 Kur Farkı</ButtonLabel>}
            {!yeniSayfasi && !detaySayfasi && <ButtonLabel as="a" href="/panel/cari/raporlar">📈 Raporlar</ButtonLabel>}
            {!yeniSayfasi && !detaySayfasi && <ButtonLabel>
              📥 Excel&apos;den İçe Aktar
              <input type="file" accept=".xlsx" onChange={excelYukle} style={{ display: "none" }} />
            </ButtonLabel>}
            {(yeniSayfasi || detaySayfasi) ? <Button onClick={() => router.push("/panel/cari")}>Listeye dön</Button> : <ButtonLabel as="a" role="button" variant="primary" href="/panel/cari/yeni">➕ Yeni Cari</ButtonLabel>}
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <form ref={cariFormRef} className="document-editor invoice-editor" onSubmit={kaydet}>
          <div className="document-editor__head">
            <h3>Yeni cari hesap</h3>
            <span className="badge badge--warning">Yeni</span>
          </div>
          <div className="invoice-layout">
          <div className="invoice-layout__main">
          <div className="document-editor__section">
            <h4 className="document-editor__section-title">Temel bilgiler</h4>
            <div className="document-fields document-fields--belge">
              {/* Kişi tipi ünvan ile ad-soyad arasında seçim yaptırdığı için önce gelir. */}
              <Field label="Kişi tipi"><Select value={kisiTipi} onChange={(e) => setKisiTipi(e.target.value)}><option value="tuzel">Tüzel kişi</option><option value="gercek">Gerçek kişi</option></Select></Field>
              {kisiTipi === "gercek" ? (
                <>
                  <Field label="Ad"><Input value={ad} onChange={(e) => setAd(e.target.value)} required placeholder="Ayşe Nur" /></Field>
                  <Field label="Soyad"><Input value={soyad} onChange={(e) => setSoyad(e.target.value)} required placeholder="Yılmaz" /></Field>
                </>
              ) : (
                <Field label="Ünvan" className="document-fields__genis"><Input value={unvan} onChange={(e) => setUnvan(e.target.value)} required placeholder="Teknoloji A.Ş." /></Field>
              )}
              <Field label="Cari kodu"><Input value={kod} onChange={(e) => setKod(e.target.value)} required placeholder="CARI-001" /></Field>
              <Field label="Cari tipi"><Select value={tip} onChange={(e) => setTip(e.target.value)}>{Object.entries(TIP_ETIKETLERI).map(([deger, etiket]) => (<option key={deger} value={deger}>{etiket}</option>))}</Select></Field>
              <Field label={kisiTipi === "gercek" ? "TCKN" : "VKN"}><Input value={vknTckn} onChange={(e) => setVknTckn(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={11} placeholder={kisiTipi === "gercek" ? "11 hane" : "10 hane"} /></Field>
              <Field label="Vergi dairesi"><Input value={vergiDairesi} onChange={(e) => setVergiDairesi(e.target.value)} /></Field>
              <Field label="E-posta"><Input type="email" value={eposta} onChange={(e) => setEposta(e.target.value)} placeholder="muhasebe@firma.com" /></Field>
              <Field label="Telefon"><Input value={telefon} onChange={(e) => setTelefon(e.target.value)} /></Field>
            </div>
          </div>

          {/* Seyrek kullanılan alanlar katlanır gruplarda; dolu grup açık gelir. */}
          <FormGrubu baslik="Resmî ve ticari bilgiler" aciklama="Kısa ad, sektör, temsilci, MERSİS, ticaret sicil, KVKK" doluSayisi={[kisaAd, sektor, temsilciUserId, mersisNo, ticaretSicilNo, kvkkOnayTarihi].filter((d) => d.trim()).length}>
            <div className="document-fields document-fields--belge">
              <Field label="Kısa ad"><Input value={kisaAd} onChange={(e) => setKisaAd(e.target.value)} placeholder="Teknoloji" /></Field>
              <Field label="Sektör"><Input value={sektor} onChange={(e) => setSektor(e.target.value)} placeholder="Perakende" /></Field>
              <Field label="Müşteri temsilcisi"><Select value={temsilciUserId} onChange={(e) => setTemsilciUserId(e.target.value)}><option value="">Seçiniz (İsteğe bağlı)</option>{crm?.kullanicilar?.map((u) => <option key={u.id} value={u.id}>{u.adSoyad}</option>)}</Select></Field>
              <Field label="MERSİS no"><Input value={mersisNo} onChange={(e) => setMersisNo(e.target.value)} placeholder="16 hane" /></Field>
              <Field label="Ticaret sicil no"><Input value={ticaretSicilNo} onChange={(e) => setTicaretSicilNo(e.target.value)} /></Field>
              <Field label="KVKK onay tarihi"><Input type="date" value={kvkkOnayTarihi} onChange={(e) => setKvkkOnayTarihi(e.target.value)} /></Field>
            </div>
          </FormGrubu>
          <FormGrubu baslik="İletişim ve banka" aciklama="Web sitesi, faks, ana IBAN ve cari notları" doluSayisi={[webSitesi, faks, anaIban, notlar].filter((d) => d.trim()).length}>
            <div className="document-fields document-fields--belge">
              <Field label="Web sitesi"><Input value={webSitesi} onChange={(e) => setWebSitesi(e.target.value)} placeholder="https://..." /></Field>
              <Field label="Faks"><Input value={faks} onChange={(e) => setFaks(e.target.value)} /></Field>
              <Field label="Ana IBAN" className="document-fields__genis"><Input value={anaIban} onChange={(e) => setAnaIban(e.target.value)} placeholder="TR..." maxLength={34} /></Field>
              <Field label="Cari notları" className="document-fields__genis"><Input value={notlar} onChange={(e) => setNotlar(e.target.value)} placeholder="Özel açıklamalar..." /></Field>
            </div>
          </FormGrubu>
          <FormGrubu baslik="Finans ve satış koşulları" aciklama="Fiyat listesi, iskonto, vade, risk limiti, e-Belge tercihleri" doluSayisi={[fiyatListesiId, varsayilanIskonto, varsayilanVadeGun, riskLimiti].filter((d) => d.trim()).length + (efaturaProfili === "ticari" ? 1 : 0) + (earsivGonderimSekli === "kagit" ? 1 : 0)}>
            <div className="document-fields document-fields--belge">
              <Field label="Fiyat listesi"><Select value={fiyatListesiId} onChange={(e) => setFiyatListesiId(e.target.value)}><option value="">Stok satış fiyatı</option>{fiyatListeleri.map((l) => (<option key={l.id} value={l.id}>{l.ad} ({l.dovizCinsi})</option>))}</Select></Field>
              <Field label="Varsayılan iskonto (%)"><Input className="record-number" type="number" step="0.01" min="0" max="100" inputMode="decimal" value={varsayilanIskonto} onChange={(e) => setVarsayilanIskonto(e.target.value)} placeholder="0" /></Field>
              <Field label="Varsayılan vade (gün)">
                <Input className="record-number" type="number" min="0" max="365" inputMode="numeric" value={varsayilanVadeGun} onChange={(e) => setVarsayilanVadeGun(e.target.value)} placeholder="0" />
                <div className="vade-cipleri" role="group" aria-label="Hızlı vade seçimi">
                  {[0, 30, 60, 90].map((gun) => <button type="button" key={gun} className={`vade-cipi${varsayilanVadeGun !== "" && Number(varsayilanVadeGun) === gun ? " is-active" : ""}`} onClick={() => setVarsayilanVadeGun(String(gun))}>{gun === 0 ? "Peşin" : `${gun} gün`}</button>)}
                </div>
              </Field>
              <Field label="Risk limiti (TL)"><Input className="record-number" type="number" min="0" step="0.01" inputMode="decimal" value={riskLimiti} onChange={(e) => setRiskLimiti(e.target.value)} placeholder="0,00" /></Field>
              {/* FTR-19: faturanın profili buradan gelir, fatura üzerinde değiştirilebilir. */}
              <Field label="e-Fatura profili"><Select value={efaturaProfili} onChange={(e) => setEfaturaProfili(e.target.value as "temel" | "ticari")}><option value="temel">TEMELFATURA</option><option value="ticari">TICARIFATURA</option></Select></Field>
              {/* EBLG-26: e-Belge sihirbazında fatura bazında değiştirilebilir. */}
              <Field label="e-Arşiv teslim şekli"><Select value={earsivGonderimSekli} onChange={(e) => setEarsivGonderimSekli(e.target.value as "elektronik" | "kagit")}><option value="elektronik">Elektronik</option><option value="kagit">Kâğıt</option></Select></Field>
            </div>
          </FormGrubu>
          </div>

          {/* Sayfa kaydırılsa da görünen özet: önizleme, doğrulama, kontrol listesi ve kaydet. */}
          <aside className="invoice-layout__side" aria-label="Cari özeti">
            <div className="invoice-summary">
              <h4>Cari önizleme</h4>
              <div className="cari-onizleme__ad">{(kisiTipi === "gercek" ? [ad, soyad].filter((d) => d.trim()).join(" ") : unvan.trim()) || "Ünvan girilmedi"}</div>
              <div className="invoice-summary__line"><span>Kod</span><strong>{kod.trim() || "—"}</strong></div>
              <div className="invoice-summary__line"><span>Tip</span><strong>{TIP_ETIKETLERI[tip] ?? tip} · {kisiTipi === "gercek" ? "Gerçek kişi" : "Tüzel kişi"}</strong></div>
              <div className="invoice-summary__line"><span>{kisiTipi === "gercek" ? "TCKN" : "VKN"}</span><strong className={vknDurumu.sinif}>{vknDurumu.metin}</strong></div>
              <small className="muted invoice-summary__tl">e-Fatura / e-Arşiv mükellefiyeti kayıttan sonra GİB listesinden belirlenir.</small>
            </div>
            <div className="invoice-summary">
              <h4>Koşullar</h4>
              <div className="invoice-summary__line"><span>Vade</span><strong>{varsayilanVadeGun === "" ? "Tanımsız" : Number(varsayilanVadeGun) === 0 ? "Peşin" : `${varsayilanVadeGun} gün`}</strong></div>
              <div className="invoice-summary__line"><span>İskonto</span><strong>{varsayilanIskonto ? `%${varsayilanIskonto}` : "—"}</strong></div>
              <div className="invoice-summary__line"><span>Risk limiti</span><strong>{riskLimiti ? tl(riskLimiti) : "Tanımsız"}</strong></div>
              <div className="invoice-summary__line"><span>e-Fatura profili</span><strong>{efaturaProfili === "ticari" ? "TICARIFATURA" : "TEMELFATURA"}</strong></div>
            </div>
            {cariKontrolListesi.length > 0 && (
              <div className="invoice-summary is-warning" role="status">
                <h4>Kontrol listesi</h4>
                <ul>{cariKontrolListesi.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            <div className="invoice-summary__actions">
              <Button variant="primary" type="submit">Cari hesabı kaydet</Button>
              <small className="muted">Kısayol: Ctrl+S</small>
            </div>
          </aside>
          </div>
        </form>
      )}

      {detay && (
        <Card className="record-detail" style={{ marginBottom: "1.5rem", borderColor: "var(--accent)" }}>
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
              {detay.ebelgeDurumu && <EbelgeMukellefiyeti durum={detay.ebelgeDurumu} />}
              {/* EBLG-86: birden çok kutusu olan alıcıda gönderilecek kutu; yetkiyi sunucu denetler. */}
              <PostaKutusuSecimleri cariId={detay.id} secimler={detay.postaKutulari} duzenlenebilir onDegisti={() => void detayAc(detay.id, true)} />
            </div>
          </div>
          <EylemCubugu etiket="Cari eylemleri">
            <Button size="sm" type="button" onClick={() => setAktifSekme("ekstre")}>📊 Ekstre</Button>
            <Button size="sm" type="button" onClick={() => void kopyala(detay.id)}>📋 Kopyala</Button>
            <Button size="sm" type="button" variant={detay.karaListe ? undefined : "danger"} onClick={() => void karaListeDegistir()}>{detay.karaListe ? "✅ Blokajı Kaldır" : "🚫 Kara Listeye Al"}</Button>
          </EylemCubugu>

          <div style={{ marginTop: "1.25rem" }}>
            <Tabs<Sekme>
              ariaLabel="Cari hesap bölümleri"
              idPrefix="cari-detay"
              value={aktifSekme}
              onChange={setAktifSekme}
              items={[
                { deger: "genel", baslik: "Genel Bakış" },
                { deger: "ekstre", baslik: "Ekstre" },
                { deger: "crm", baslik: "CRM" },
                { deger: "adresler", baslik: "Adresler" },
                { deger: "kisiler", baslik: "İlgili Kişiler" },
                { deger: "bankalar", baslik: "Banka Hesapları" },
              ]}
            />
          </div>

          {aktifSekme === "genel" && (
            <div aria-labelledby="cari-detay-tab-genel" id="cari-detay-panel-genel" role="tabpanel" tabIndex={0}>
              <div className="document-editor invoice-editor document-editor--gomulu">
              <div className="invoice-layout">
              <div className="invoice-layout__main">
              <div className="document-editor__section">
                <h4 className="document-editor__section-title">Kimlik ve resmî bilgiler</h4>
                <form className="cari-kart-form" onSubmit={cariKimligiGuncelle}>
                  {(detayKisiTipi ?? detay.kisiTipi) === "gercek" ? (
                    <>
                      <Field label="Ad"><Input name="ad" defaultValue={detay.ad ?? ""} required /></Field>
                      <Field label="Soyad"><Input name="soyad" defaultValue={detay.soyad ?? ""} required /></Field>
                    </>
                  ) : (
                    <Field label="Ünvan"><Input name="unvan" defaultValue={detay.unvan} required /></Field>
                  )}
                  <Field label="Kısa ad"><Input name="kisaAd" defaultValue={detay.kisaAd ?? ""} /></Field>
                  <Field label="Cari tipi"><Select name="tip" defaultValue={detay.tip}>{Object.entries(TIP_ETIKETLERI).map(([deger, ad]) => <option key={deger} value={deger}>{ad}</option>)}</Select></Field>
                  <Field label="Kişi tipi"><Select name="kisiTipi" defaultValue={detay.kisiTipi} onChange={(e) => setDetayKisiTipi(e.target.value)}><option value="tuzel">Tüzel kişi</option><option value="gercek">Gerçek kişi</option></Select></Field>
                  <Field label="Sektör"><Input name="sektor" defaultValue={detay.sektor ?? ""} placeholder="Örn. Perakende" /></Field>
                  <Field label="Müşteri temsilcisi"><Select name="temsilciUserId" defaultValue={detay.temsilciUserId ?? ""}><option value="">Seçiniz</option>{crm?.kullanicilar?.map((u) => <option key={u.id} value={u.id}>{u.adSoyad}</option>)}</Select></Field>
                  <Field label="VKN / TCKN"><Input name="vknTckn" defaultValue={detay.vknTckn ?? ""} inputMode="numeric" maxLength={11} pattern="[0-9]{10,11}" title="VKN 10, TCKN 11 rakam olmalıdır" placeholder="VKN 10 · TCKN 11 hane" /></Field>
                  <Field label="Vergi dairesi"><Input name="vergiDairesi" defaultValue={detay.vergiDairesi ?? ""} /></Field>
                  <Field label="MERSİS no"><Input name="mersisNo" defaultValue={detay.mersisNo ?? ""} inputMode="numeric" maxLength={16} pattern="[0-9]{16}" title="MERSİS numarası 16 rakam olmalıdır" placeholder="16 hane" /></Field>
                  <Field label="Ticaret sicil no"><Input name="ticaretSicilNo" defaultValue={detay.ticaretSicilNo ?? ""} /></Field>
                  <Field label="KVKK onay tarihi"><Input name="kvkkOnayTarihi" type="date" defaultValue={detay.kvkkOnayTarihi ?? ""} /></Field>
                  <div className="cari-kart-form__alt"><span className="muted">Cari kodu <b>{detay.kod}</b></span><Button type="submit" size="sm" variant="primary">Kimlik bilgilerini güncelle</Button></div>
                </form>
              </div>

              <div className="document-editor__section">
                <h4 className="document-editor__section-title">İletişim ve notlar</h4>
                <form className="cari-kart-form" onSubmit={iletisimGuncelle}>
                    <Field label="E-posta"><Input name="eposta" type="email" defaultValue={detay.eposta ?? ""} placeholder="odeme@firma.com" /></Field>
                    <Field label="Telefon"><Input name="telefon" defaultValue={detay.telefon ?? ""} maxLength={32} /></Field>
                    <Field label="Web sitesi"><Input name="webSitesi" type="url" defaultValue={detay.webSitesi ?? ""} placeholder="https://..." /></Field>
                    <Field label="Faks"><Input name="faks" defaultValue={detay.faks ?? ""} maxLength={32} /></Field>
                    <Field label="Ana IBAN"><Input name="iban" defaultValue={detay.iban ?? ""} placeholder="TR..." maxLength={34} /></Field>
                    <Field label="Cari Notları"><Input name="notlar" defaultValue={detay.notlar ?? ""} placeholder="Özel açıklamalar..." /></Field>
                  <div className="cari-kart-form__alt"><span /><Button type="submit" size="sm" variant="primary">İletişim ve notları güncelle</Button></div>
                </form>
              </div>

              <div className="document-editor__section">
                <h4 className="document-editor__section-title">Risk ve finans koşulları</h4>
                <form className="cari-kart-form" onSubmit={finansGuncelle}>
                    <Field label="Risk limiti (TL)"><Input name="riskLimiti" type="number" min="0" step="0.01" defaultValue={detay.riskLimiti ?? ""} placeholder="Limit tanımlayın" /></Field>
                    <Field label="Varsayılan vade (gün)"><Input name="varsayilanVadeGun" type="number" min="0" max="365" defaultValue={detay.varsayilanVadeGun ?? ""} /></Field>
                    <Field label="Varsayılan iskonto (%)"><Input name="varsayilanIskonto" type="number" min="0" max="100" step="0.01" defaultValue={detay.varsayilanIskonto ?? ""} /></Field>
                    <Field label="Fiyat listesi"><Select name="fiyatListesiId" defaultValue={detay.fiyatListesiId ?? ""}><option value="">Stok satış fiyatı</option>{fiyatListeleri.map((liste) => <option key={liste.id} value={liste.id}>{liste.ad} · {liste.dovizCinsi}</option>)}</Select></Field>
                    <Field label="e-Fatura profili"><Select name="efaturaProfili" defaultValue={detay.efaturaProfili}><option value="temel">TEMELFATURA</option><option value="ticari">TICARIFATURA — alıcı kabul/ret verir</option></Select></Field>
                    <Field label="e-Arşiv teslim şekli"><Select name="earsivGonderimSekli" defaultValue={detay.earsivGonderimSekli ?? "elektronik"}><option value="elektronik">Elektronik — PDF e-postayla</option><option value="kagit">Kâğıt — basılı teslim</option></Select></Field>
                    <label className="check-row"><input type="checkbox" name="kamuIdaresi" defaultChecked={detay.kamuIdaresi ?? false} /> Kamu idaresi — e-Faturası KAMU senaryosuyla gider (GİB listesinde KAMU türündeyse işaretlemek gerekmez)</label>
                    <Field label="Harcama birimi VKN (varsayılan)"><Input name="harcamaBirimiVkn" defaultValue={detay.harcamaBirimiVkn ?? ""} inputMode="numeric" pattern="\d{10}" maxLength={10} placeholder="Boşsa carinin VKN'si kullanılır" /></Field>
                    <Field label="Harcama birimi adı (varsayılan)"><Input name="harcamaBirimiAdi" defaultValue={detay.harcamaBirimiAdi ?? ""} maxLength={200} placeholder="Boşsa carinin unvanı kullanılır" /></Field>
                  <div className="cari-kart-form__alt"><span /><Button type="submit" size="sm" variant="primary">Finans koşullarını güncelle</Button></div>
                </form>
              </div>

              <FormGrubu baslik="Etiketler" aciklama="Cariyi sınıflandıran renkli etiketler" doluSayisi={detay.etiketler.length}>
                <div className="cari-tag-studio">
                  <div className="cari-tag-studio__assigned">
                    <span className="cari-tag-studio__label">Bu cariye atanmış etiketler</span>
                    {detay.etiketler.length === 0 && <span className="subtle" style={{ fontSize: "0.78rem" }}>Henüz etiket atanmadı</span>}
                    {detay.etiketler.map((e) => (
                      <span key={e.id} className="cari-tag" style={{ backgroundColor: `${e.renk || "#64748B"}18`, borderColor: e.renk || "#64748B", color: e.renk || "#64748B" }}>
                        <i style={{ backgroundColor: e.renk || "#64748B" }} />
                        {e.ad}
                        <button aria-label={`${e.ad} etiketini kaldır`} onClick={() => void etiketKaldir(e.id)}>×</button>
                      </span>
                    ))}
                  </div>
                  <div className="cari-tag-studio__assign">
                    <Select className="grow" value={secilenEtiketId} onChange={(e) => setSecilenEtiketId(e.target.value)}>
                      <option value="">Kayıtlı etiket seçin...</option>
                      {etiketler.filter((e) => !detay.etiketler.some((d) => d.id === e.id)).map((e) => (
                        <option key={e.id} value={e.id}>{e.ad}{e._count ? ` · ${e._count.atamalar} cari` : ""}</option>
                      ))}
                    </Select>
                    <Button size="sm" disabled={!secilenEtiketId} onClick={() => void etiketAta()}>Cariye ata</Button>
                  </div>
                  <form onSubmit={etiketOlusturVeAta} className="cari-tag-designer">
                    <div className="cari-tag-designer__head"><div><strong>Yeni etiket tasarla</strong><small>Oluşturulan etiket bu cariye otomatik atanır.</small></div><span className="cari-tag cari-tag--preview" style={{ backgroundColor: `${yeniEtiketRengi}18`, borderColor: yeniEtiketRengi, color: yeniEtiketRengi }}><i style={{ backgroundColor: yeniEtiketRengi }} />{yeniEtiket.trim() || "Etiket önizleme"}</span></div>
                    <Field label="Etiket adı"><Input maxLength={40} value={yeniEtiket} onChange={(e) => setYeniEtiket(e.target.value)} placeholder="Örn. VIP Müşteri" /></Field>
                    <div><span className="cari-tag-studio__label">Renk seçimi</span><div className="cari-tag-palette">{["#2563EB", "#7C3AED", "#DB2777", "#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#0891B2", "#475569"].map((renk) => <button aria-label={`Etiket rengi ${renk}`} className={yeniEtiketRengi === renk ? "is-selected" : ""} key={renk} onClick={() => setYeniEtiketRengi(renk)} style={{ backgroundColor: renk }} type="button" />)}<label className="cari-tag-palette__custom" title="Özel renk"><input type="color" value={yeniEtiketRengi} onChange={(e) => setYeniEtiketRengi(e.target.value.toUpperCase())} /><span>＋</span></label></div></div>
                    <Button disabled={!yeniEtiket.trim()} size="sm" type="submit" variant="primary">Oluştur ve cariye ata</Button>
                  </form>
                  {etiketler.length > 0 && <details className="cari-tag-library"><summary>Etiket kütüphanesini yönet <span>{etiketler.length}</span></summary><div>{etiketler.map((e) => <div className="cari-tag-library__row" key={e.id}><span className="cari-tag" style={{ backgroundColor: `${e.renk || "#64748B"}18`, borderColor: e.renk || "#64748B", color: e.renk || "#64748B" }}><i style={{ backgroundColor: e.renk || "#64748B" }} />{e.ad}</span><small>{e._count?.atamalar ?? 0} cari</small><Button aria-label={`${e.ad} etiketini sistemden sil`} size="sm" variant="danger" onClick={() => void etiketiSistemdenSil(e)}>Sil</Button></div>)}</div></details>}
                </div>
              </FormGrubu>
              </div>

              {/* Sekme kaydırılsa da görünen finansal durum, risk ve eksikler. */}
              <aside className="invoice-layout__side" aria-label="Cari finansal durumu">
                <div className="invoice-summary">
                  <h4>Finansal durum</h4>
                  {(() => {
                    const toplam = detay.bakiyeler.reduce((t, b) => t + Number(b.bakiyeTry), 0);
                    return (
                      <div className="invoice-summary__line is-grand" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
                        <span>{toplam > 0 ? "Alacaklıyız" : toplam < 0 ? "Borçluyuz" : "Bakiye"}</span>
                        <span className={toplam > 0 ? "is-positive" : toplam < 0 ? "is-negative" : ""}>{tl(Math.abs(toplam))}</span>
                      </div>
                    );
                  })()}
                  {detay.bakiyeler.filter((b) => b.dovizCinsi !== "TRY" && Number(b.bakiye) !== 0).map((b) => (
                    <div className="invoice-summary__line" key={b.dovizCinsi}><span>{b.dovizCinsi} bakiye</span><strong>{Number(b.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {b.dovizCinsi}</strong></div>
                  ))}
                  <div className="invoice-summary__line"><span>Vadesi geçmiş</span><strong className={Number(detay.finansalOzet.vadesiGecmisBakiye) > 0 ? "is-negative" : ""}>{tl(detay.finansalOzet.vadesiGecmisBakiye)}</strong></div>
                  <div className="invoice-summary__line"><span>Varsayılan vade</span><strong>{detay.varsayilanVadeGun ? `${detay.varsayilanVadeGun} gün` : "Tanımsız"}</strong></div>
                </div>
                <div className={`invoice-summary${detay.risk.asim ? " is-warning" : ""}`}>
                  <h4>Risk</h4>
                  <div className="invoice-summary__line"><span>Mevcut risk</span><strong>{tl(detay.risk.mevcutRisk)}</strong></div>
                  <div className="invoice-summary__line"><span>Çek / senet riski</span><strong>{tl(detay.risk.cekSenetRiski)}</strong></div>
                  <div className="invoice-summary__line"><span>Risk limiti</span><strong>{detay.risk.limit ? tl(detay.risk.limit) : "Tanımsız"}</strong></div>
                  <div className="invoice-summary__line"><span>Kalan limit</span><strong className={detay.risk.asim ? "is-negative" : ""}>{detay.risk.kalanLimit === null ? "—" : tl(detay.risk.kalanLimit)}</strong></div>
                  {detay.risk.asim && <small className="muted">Limit aşıldı; yeni vadeli işlemden önce finans onayı alın.</small>}
                </div>
                <div className="invoice-summary">
                  <h4>Son hareketler</h4>
                  <div className="invoice-summary__line"><span>Son işlem</span><strong>{detay.finansalOzet.sonIslemTarihi ?? "—"}</strong></div>
                  <div className="invoice-summary__line"><span>Son tahsilat</span><strong>{detay.finansalOzet.sonTahsilatTarihi ?? "—"}</strong></div>
                  <div className="invoice-summary__line"><span>Son ödeme</span><strong>{detay.finansalOzet.sonOdemeTarihi ?? "—"}</strong></div>
                  <Button size="sm" type="button" onClick={() => setAktifSekme("ekstre")}>📊 Ekstreyi aç</Button>
                </div>
                {cariKartEksikleri(detay).length > 0 && (
                  <div className="invoice-summary is-warning" role="status">
                    <h4>Eksikler</h4>
                    <ul>{cariKartEksikleri(detay).map((e) => <li key={e}>{e}</li>)}</ul>
                  </div>
                )}
              </aside>
              </div>
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
            <Card aria-labelledby="cari-detay-tab-ekstre" className="cari-statement" id="cari-detay-panel-ekstre" role="tabpanel" tabIndex={0}>
              <div className="expense-entry__section-head"><span className="expense-entry__step">01</span><div><h3>Cari hesap ekstresi</h3><p>Standart, kalem ayrıntılı ya da döviz bazlı hesap dökümü</p></div></div>
              {/* CARI-24/25/26: ekstre türü; ekran, PDF, Excel ve e-posta aynı seçimle üretilir. */}
              <div className="cari-statement__turler" role="radiogroup" aria-label="Ekstre türü">
                {EKSTRE_TURLERI.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={ekstreTuru === t} className={`cari-statement__tur${ekstreTuru === t ? " is-active" : ""}`} disabled={ekstreIslemde} onClick={() => { setEkstreTuru(t); void ekstreFiltrele({ tur: t }); }}>
                    <strong>{EKSTRE_TURU_ADLARI[t]}</strong>
                    <small>{t === "standart" ? "Belge no, hareket türü ve ödeme şekliyle" : t === "ayrintili" ? "Faturaların kalemleri, miktar ve fiyatlarıyla" : "Döviz cinsinden bakiye ve kur"}</small>
                  </button>
                ))}
              </div>
              <div className="cari-statement__toolbar">
                <Field label="Başlangıç"><Input type="date" value={ekstreBaslangic} onChange={(e) => setEkstreBaslangic(e.target.value)} /></Field>
                <Field label="Bitiş"><Input type="date" value={ekstreBitis} onChange={(e) => setEkstreBitis(e.target.value)} /></Field>
                {ekstreTuru === "doviz" && (
                  <Field label="Gösterim">
                    <Select aria-label="Döviz ekstresi gösterimi" value={ekstreDoviz} disabled={ekstreIslemde} onChange={(e) => { const d = e.target.value as "" | "USD" | "EUR"; setEkstreDoviz(d); void ekstreFiltrele({ doviz: d }); }}>
                      <option value="">Her döviz ayrı bölüm</option>
                      <option value="USD">Tümü USD cinsinden</option>
                      <option value="EUR">Tümü EUR cinsinden</option>
                    </Select>
                  </Field>
                )}
                <Button disabled={ekstreIslemde} onClick={() => void ekstreFiltrele()}>Uygula</Button>
                <div className="cari-statement__secenekler">
                  <label className="check-row"><input type="checkbox" checked={ekstreIptaller} disabled={ekstreIslemde} onChange={(e) => { setEkstreIptaller(e.target.checked); void ekstreFiltrele({ iptaller: e.target.checked }); }} /> İptalleri de göster</label>
                  <label className="check-row"><input type="checkbox" checked={ekstreMutabakat} onChange={(e) => setEkstreMutabakat(e.target.checked)} /> PDF'e mutabakat metni ekle</label>
                </div>
                <div className="cari-statement__exports"><Button disabled={!detay} onClick={() => detay && void apiDosyaIndir(ekstreYolu("pdf"), `ekstre-${detay.kod}-${ekstreTuru}.pdf`)}>PDF indir</Button><Button disabled={!detay} onClick={() => detay && void apiDosyaIndir(ekstreYolu("excel"), `ekstre-${detay.kod}-${ekstreTuru}.xlsx`)}>Excel indir</Button></div>
              </div>
              <div className="cari-statement__mail"><Field label="Gönderilecek e-posta"><Input type="email" value={ekstreEposta} onChange={(e) => setEkstreEposta(e.target.value)} placeholder="muhasebe@firma.com" /></Field><Button variant="primary" disabled={!ekstreEposta || ekstreIslemde} onClick={() => void ekstreGonder()}>{ekstreIslemde ? "İşleniyor…" : "PDF + Excel e-posta gönder"}</Button></div>
              {!ekstre ? (
                <p className="subtle" style={{ fontSize: "0.85rem" }}>Ekstre yükleniyor...</p>
              ) : (
                <>
                  <CariEkstreTablosu v={ekstre} />
                  {ekstre.tur !== "doviz" && ekstre.dovizOzet.some((o) => o.dovizCinsi !== "TRY") && <div className="cari-statement__currency-summary">
                    <strong>Döviz bazında bakiye</strong>
                    <TableWrap className="cari-statement__currency-table"><thead><tr><th>Döviz</th><th className="num">Devir</th><th className="num">Dönem borç</th><th className="num">Dönem alacak</th><th className="num">Bakiye</th></tr></thead><tbody>{ekstre.dovizOzet.map((ozet) => <tr key={ozet.dovizCinsi}><td><b>{ozet.dovizCinsi}</b></td><td className="num">{Number(ozet.devir).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</td><td className="num">{Number(ozet.borc).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</td><td className="num">{Number(ozet.alacak).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</td><td className="num"><Bakiye deger={ozet.bakiye} birim={ozet.dovizCinsi === "TRY" ? "TL" : ozet.dovizCinsi} /></td></tr>)}</tbody></TableWrap>
                  </div>}
                </>
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
                      <th>Posta Kodu</th><th>Ülke</th><th className="center">İşlem</th>
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
                        <td className="mono">{a.ulke || "TR"}</td>
                        <td className="center"><div className="row-tight"><Button size="sm" onClick={() => adresDuzenle(a)}>Düzenle</Button><Button size="sm" variant="danger" onClick={() => void adresSil(a.id)}>Sil</Button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
              <form onSubmit={adresEkle} className="stack cari-address-form" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                <div className="between"><div><strong>{duzenlenenAdresId ? "Adresi düzenle" : "Yeni adres ekle"}</strong><p className="muted" style={{ fontSize: ".7rem", margin: ".2rem 0 0" }}>{duzenlenenAdresId ? "Seçili adres üzerindeki değişiklikleri kaydedin." : "Fatura, sevk, şube veya depo adresi tanımlayın."}</p></div>{duzenlenenAdresId && <Button size="sm" type="button" onClick={adresFormunuTemizle}>Vazgeç</Button>}</div>
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
                  <FormAlan flex={1} min={90}>
                    <Field label="Ülke">
                      <Input value={adresUlke} onChange={(e) => setAdresUlke(e.target.value)} placeholder="TR" maxLength={2} />
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
                  <Button size="sm" type="submit" variant="primary">{duzenlenenAdresId ? "Değişiklikleri kaydet" : "＋ Adres ekle"}</Button>
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
              <th>e-Belge</th>
              <th className="num">Bakiye</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {filtrelenmisCariler.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">Arama kriterlerinize uygun cari hesap kaydı bulunamadı.</td>
              </tr>
            ) : (
              filtrelenmisCariler.map((c) => {
                const bakiyeNum = c.bakiyeler.reduce((toplam, b) => toplam + Number(b.bakiyeTry), 0);
                return (
                  <tr
                    key={c.id}
                    className="row-link"
                    tabIndex={0}
                    aria-label={`${c.unvan} carisini aç`}
                    onClick={() => router.push(`/panel/cari/${c.id}`)}
                    onKeyDown={(olay) => { if (olay.key === "Enter" || olay.key === " ") { olay.preventDefault(); router.push(`/panel/cari/${c.id}`); } }}
                  >
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
                    <td>
                      {c.ebelgeTuru && (
                        <Badge variant={c.ebelgeTuru === "efatura" ? "info" : c.ebelgeTuru === "earsiv" ? "neutral" : c.ebelgeTuru === "yurtdisi" ? "accent" : "warning"}>
                          {CARI_EBELGE_ETIKETI[c.ebelgeTuru]}
                        </Badge>
                      )}
                    </td>
                    <td className={`num money ${bakiyeNum > 0 ? "pos" : bakiyeNum < 0 ? "neg" : ""}`}>{tl(bakiyeNum)}</td>
                    <td>
                      <Status tone={c.karaListe ? "danger" : "ok"}>{c.karaListe ? "Bloke" : "Normal"}</Status>
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
