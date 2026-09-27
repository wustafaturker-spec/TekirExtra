"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiHata, apiPdfAc, tokenAl, tumSayfalariAl } from "@/lib/api";
import { kullanimOlayi } from "@/lib/kullanim";
import { dovizUyumsuzlugu, fiyatCevir, paraBicimi, paraBirimiEtiketi } from "@/lib/doviz-uyumu";
import { AramaSecici } from "@/components/arama-secici";
import { DepoSecici } from "@/components/depo-secici";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { BelgeDosyalari, belgeDosyalariniYukle } from "@/components/belge-dosyalari";
import { UrunSecimModali } from "@/components/urun-secim-modali";
import { DurumGecmisi } from "@/components/durum-gecmisi";
import { TasimaBilgisiPaneli } from "@/components/tasima-bilgisi-paneli";
import type { DepoOzet } from "@/lib/depolar";
import { BOS_TESLIMAT_ADRESI, TeslimatAdresiAlanlari, teslimatAdresiGovdesi, type TeslimatAdresi } from "@/components/teslimat-adresi-alanlari";
import { IrsaliyeBaglaPaneli } from "@/components/irsaliye-bagla-paneli";
import { bugunTR, faturaHesapla, muhtelifMusteriMi, irsaliyeIptalUyarisi, GIB_ULASMIS_EIRSALIYE_DURUMLARI, gumrukSeferNotu, plakaNormalize, type FaturaHesaplaSatirGirdi } from "@tekirextra/shared";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  EylemCubugu,
  EylemMenusu,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  TableWrap,
} from "@/components/ui";

const TUR_ADI: Record<string, string> = { teklif: "Teklif", siparis: "Sipariş", irsaliye: "İrsaliye" };
const YON_ADI: Record<string, string> = { satis: "Satış", alis: "Alış" };
const EBELGE_DURUM_ADI: Record<string, string> = { kuyrukta: "Kuyrukta", iletildi: "İletildi", kabul: "Kabul edildi", ret: "Reddedildi", hata: "Hata", kismi_kabul: "Kısmi kabul", iptal: "İptal" };
const ODEME_DURUM_ADI: Record<string, string> = { beklemede: "Beklemede", odenmedi: "Ödenmedi", kismi: "Kısmi ödendi", odendi: "Ödendi" };
const ebelgeZincirSinifi = (durum: string) => ["hata", "ret"].includes(durum) ? " is-error" : durum === "kabul" ? " is-complete" : " is-current";
const detalleDurumSinifi = (durum?: string) => !durum ? "" : ["hata", "ret"].includes(durum) ? " is-error" : durum === "kabul" ? " is-complete" : " is-current";
const odemeZincirSinifi = (durum: string) => durum === "odendi" ? " is-complete" : durum === "kismi" ? " is-current" : "";
// Zincir: her türün dönüşebileceği hedefler (yalnız onaylı belgede)
const DONUSUM: Record<string, ("siparis" | "irsaliye" | "fatura")[]> = {
  teklif: ["siparis"],
  siparis: ["irsaliye", "fatura"],
  irsaliye: ["fatura"],
};

type AracKarti = { id: string; plaka: string; dorsePlaka: string | null; aciklama: string | null };
type SoforKarti = { id: string; ad: string; soyad: string; tckn: string | null };

type Tur = "teklif" | "siparis" | "irsaliye";
type Yon = "satis" | "alis";
type TurFiltre = "tumu" | Tur;

interface BelgeGorunumu {
  id: string; ad: string; tur: TurFiltre; yon: Yon | null; durum: string | null;
  baslangic?: string; bitis?: string;
}

const GORUNUM_ANAHTARI = "tekir_belge_gorunumleri";

interface Cari { id: string; kod?: string; unvan: string; vknTckn?: string | null; telefon?: string | null }
interface Stok { id: string; kod: string; ad: string; tedarikciUrunKodlari?: string[]; takipTipi?: "yok" | "lot" | "seri" }
interface StokVaryant { id: string; kod: string; ad: string; aktif: boolean; mevcutMiktar: string }

interface BelgeSatirForm {
  stokId: string;
  varyantId?: string;
  miktar: number;
  birimFiyat: number;
  iskontoOrani: number;
  kdvOrani: number;
  /** EBLG-72: İDİS etiket numarası; İDİS irsaliyesinde her satırda zorunlu. */
  idisEtiketNo?: string;
  lotNo?: string; seriNolar?: string; sonKullanmaTarihi?: string; uretimTarihi?: string;
  /** FTR-28: ürünün fiyatı başka dövizdeydi, fiyat yazılmadı; elle fiyat girilince kalkar. Sunucuya gitmez. */
  dovizUyarisi?: string;
}

/** FTR-27 / EBLG-83: belgenin karşı ya da basılı numarası ve düzenleme ucu. */
interface DisNumara { alan: "tedarikciBelgeNo" | "matbuBelgeNo"; yol: string; etiket: string }

function disNumaraAlani(b: Belge): DisNumara | null {
  if (b.tur !== "irsaliye") return null;
  if (b.yon === "alis") return { alan: "tedarikciBelgeNo", yol: "tedarikci-belge-no", etiket: "Tedarikçi irsaliye no" };
  if (b.kagitIrsaliye) return { alan: "matbuBelgeNo", yol: "matbu-belge-no", etiket: "Matbu irsaliye no" };
  return null;
}

/** EBLG-83: onaylı e-İrsaliyenin numarası gönderimde verilir; o zamana dek numarasızdır. */
function belgeNoGoster(b: Belge): string {
  if (b.no) return b.no;
  return b.durum === "taslak" ? "(Taslak)" : "(Numara gönderimde)";
}

/** EBLG-87: e-İrsaliyesini firmanın gönderdiği irsaliye — satış ya da gümrükten depoya sevk. */
function firmaGonderir(b: Belge): boolean {
  return b.tur === "irsaliye" && (b.yon === "satis" || Boolean(b.gumrukDepoSevki));
}


interface Belge {
  id: string;
  tur: string;
  yon: string;
  durum: string;
  no: string | null;
  tarih: string;
  genelToplam: string;
  dovizCinsi: string;
  kur?: string;
  depoId?: string | null;
  cari: { id: string; kod: string; unvan: string };
  faturaId: string | null;
  /** FTR-27: alış irsaliyesinde tedarikçinin irsaliye numarası. */
  tedarikciBelgeNo?: string | null;
  /** EBLG-83: e-İrsaliye kullanıcısı olmayan firmanın satış irsaliyesi ve matbu numarası. */
  kagitIrsaliye?: boolean;
  matbuBelgeNo?: string | null;
  /** EBLG-87: ithal malın gümrükten depoya kısım kısım taşınması; firma e-İrsaliye gönderir. */
  gumrukDepoSevki?: boolean;
  gumrukBeyannameNo?: string | null;
  gumrukBeyannameTarihi?: string | null;
  gumrukSeferNo?: number | null;
  yuklemeAdres?: string | null;
  yuklemeIl?: string | null;
  yuklemeIlce?: string | null;
  yuklemePostaKodu?: string | null;
  /** EBLG-85: `aliciKayitsiz` — alıcı GİB listesinde değildi, çıktısı verilir. */
  eirsaliye?: { durum: string; entegratorRef?: string | null; hataMesaji?: string | null; aliciKayitsiz?: boolean; geciciHata?: boolean; yenidenDenemeSayisi?: number } | null;
  /** EBLG-82: faturalanmayı bekleyen irsaliyenin süresi; bekleyen değilse null. */
  faturalamaSuresi?: FaturalamaSuresi | null;
}

interface FaturalamaSuresi { sevkGunu: string; sonGun: string; kalanGun: number; gecti: boolean; yaklasiyor: boolean }

interface ZincirRef { id: string; tur: string; no: string | null; durum: string }
interface BelgeDetay extends Belge {
  gecerlilikTarihi: string | null;
  fiiliSevkZamani?: string | null;
  tasiyiciCariId?: string | null;
  plaka?: string | null;
  dorsePlaka?: string | null;
  soforAdi?: string | null;
  soforSoyadi?: string | null;
  soforTckn?: string | null;
  siparisNo?: string | null;
  siparisTarihi?: string | null;
  idisSevkiyatNo?: string | null;
  /** EBLG-84: irsaliyeye özel teslimat adresi (ihracatta gümrük kapısı). */
  teslimatAdres?: string | null;
  teslimatIl?: string | null;
  teslimatIlce?: string | null;
  teslimatPostaKodu?: string | null;
  aciklama: string | null;
  notlar: string | null;
  kaynakBelge: ZincirRef | null;
  turetilenler: ZincirRef[];
  zincirBelgeleri?: ZincirRef[];
  fatura: {
    id: string; no: string | null; durum: string;
    ebelge: { tur: string; durum: string } | null;
    odemeOzeti: { durum: string; odenen: string; kalan: string };
  } | null;
  satirlar: { id: string; stokId: string; miktar: string; birim: string; birimFiyat: string; iskontoOrani: string; kdvOrani: string; teslimEdilenMiktar?: string; kalanMiktar?: string; idisEtiketNo?: string | null }[];
  /** SAT-10: siparişin teslim geçmişi (iptal edilen irsaliyeler sayılmaz). */
  teslimatlar?: {
    id: string; no: string | null; durum: string; tarih: string;
    kalemler: { satirId: string | null; stokKod: string; stokAd: string; miktar: string; birim: string }[];
  }[];
}

/** Tutar ve para birimi (FTR-28: TRY "TL" yazılır, diğerleri kodla). */
const tl = (d: string | number, doviz: string | null | undefined = "TRY"): string => paraBicimi(d, doviz);
const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
function csvHucre(deger: string | number | null): string {
  return "\"" + String(deger ?? "").replaceAll("\"", "\"\"") + "\"";
}

/** SAT-10: satır bazında miktar yalnız siparişten irsaliyeye dönüşümde girilir. */
function kismiTeslimVar(belge: { tur: string }, hedef: string) {
  return belge.tur === "siparis" && hedef === "irsaliye";
}

/** Belge durumu süzgecinde durum değil, "faturalanmayı bekleyen irsaliye" seçimi (EBLG-82). */
const FATURA_BEKLEYEN = "fatura_bekleyen";

const gunTRBicim = (gun: string) => gun.split("-").reverse().join(".");

/** EBLG-82: irsaliyenin faturalama süresi rozeti. */
function sureRozeti(sure: FaturalamaSuresi | null | undefined) {
  if (!sure) return null;
  if (sure.gecti) return <Badge variant="danger">⏰ Fatura süresi {-sure.kalanGun} gün geçti</Badge>;
  if (sure.kalanGun === 0) return <Badge variant="warning">⏰ Fatura için son gün bugün</Badge>;
  return <Badge variant={sure.yaklasiyor ? "warning" : "neutral"}>⏰ Fatura için {sure.kalanGun} gün</Badge>;
}

function FaturalamaSuresiNotu({ sure, yon }: { sure: FaturalamaSuresi; yon: string }) {
  const sonGun = gunTRBicim(sure.sonGun);
  if (sure.gecti) {
    return (
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.85rem", color: "var(--danger)", fontWeight: 600 }}>
        {yon === "satis"
          ? `Faturalama süresi ${-sure.kalanGun} gün önce doldu (son gün ${sonGun}). Faturayı hemen düzenleyin.`
          : `Tedarikçi faturasının süresi ${-sure.kalanGun} gün önce doldu (son gün ${sonGun}). Faturayı isteyin.`}
      </p>
    );
  }
  return (
    <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem", ...(sure.yaklasiyor ? { color: "var(--warning)", fontWeight: 600 } : {}) }}>
      Fatura için son gün {sonGun} · {sure.kalanGun === 0 ? "bugün" : `${sure.kalanGun} gün kaldı`}
    </p>
  );
}

function durumRozet(durum: string) {
  if (durum === "taslak") return <Badge variant="warning">📝 Taslak</Badge>;
  if (durum === "onaylandi") return <Badge variant="info">✅ Onaylı</Badge>;
  if (durum === "kismen_kapandi") return <Badge variant="warning">📦 Kısmen teslim</Badge>;
  if (durum === "kapandi") return <Badge variant="neutral">🔗 Kapandı</Badge>;
  return <Badge variant="danger">İptal</Badge>;
}

export default function BelgelerSayfasi() {
  const pathname = usePathname(); const router = useRouter(); const yeniSayfasi = pathname.endsWith("/yeni");
  const [belgeler, setBelgeler] = useState<Belge[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [stoklar, setStoklar] = useState<Stok[]>([]);
  const [turFiltre, setTurFiltre] = useState<TurFiltre>("tumu");
  const [arama, setArama] = useState("");
  const [aramaSorgusu, setAramaSorgusu] = useState("");
  const [tarihBaslangic, setTarihBaslangic] = useState("");
  const [tarihBitis, setTarihBitis] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(yeniSayfasi);
  useEffect(() => { if (yeniSayfasi) setFormAcik(true); }, [yeniSayfasi]);
  const [detay, setDetay] = useState<BelgeDetay | null>(null);
  const [tasimaPaneli, setTasimaPaneli] = useState<{ id: string; no: string | null } | null>(null);
  /** FTR-26: irsaliyeyi var olan bir faturaya bağlama paneli. */
  const [baglaPaneli, setBaglaPaneli] = useState<string | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [topluFaturaYukleniyor, setTopluFaturaYukleniyor] = useState(false);
  const [olusanFaturaId, setOlusanFaturaId] = useState<string | null>(null);
  const [yonBaglami, setYonBaglami] = useState<Yon | null>(null);
  const [onayBekleyen, setOnayBekleyen] = useState<BelgeDetay | null>(null);
  /** EBLG-90: GİB'e ulaşmış e-İrsaliyenin iptalinde yasal yolu hatırlatan onay. */
  const [iptalUyarisi, setIptalUyarisi] = useState<{ id: string; metin: string } | null>(null);
  const [donusumBekleyen, setDonusumBekleyen] = useState<{ belge: BelgeDetay; hedef: "siparis" | "irsaliye" | "fatura" } | null>(null);
  /** SAT-10: siparişten irsaliyeye dönüşümde satır başına teslim miktarı. */
  const [teslimMiktarlari, setTeslimMiktarlari] = useState<Record<string, string>>({});
  const [durumFiltresi, setDurumFiltresi] = useState<string | null>(null);
  const [kayitliGorunumler, setKayitliGorunumler] = useState<BelgeGorunumu[]>([]);
  const [gorunumFormuAcik, setGorunumFormuAcik] = useState(false);
  const [gorunumAdi, setGorunumAdi] = useState("");
  const [sonrakiImlec, setSonrakiImlec] = useState<string | null>(null);
  const [listeYukleniyor, setListeYukleniyor] = useState(true);
  const [filtrelerHazir, setFiltrelerHazir] = useState(false);
  const yuklemeSirasi = useRef(0);
  const tumunuSecRef = useRef<HTMLInputElement | null>(null);

  // Form
  const [tur, setTur] = useState<Tur>("teklif");
  const [yon, setYon] = useState<Yon>("satis");
  const [cariId, setCariId] = useState("");
  /** EBLG-95: müşterisi sevkiyat başında belli olmayan dağıtım için sistem carisi. */
  async function muhtelifSec() {
    try {
      const cari = await api<Cari>("/cari/muhtelif-musteri", { method: "POST" });
      setCariler((liste) => (liste.some((c) => c.id === cari.id) ? liste : [...liste, cari]));
      setCariId(cari.id);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Muhtelif müşteriler carisi açılamadı");
    }
  }
  const [faturaId, setFaturaId] = useState("");
  const [sevkiyatFaturalari, setSevkiyatFaturalari] = useState<{ id: string; no: string | null; tarih: string }[]>([]);
  const [depoId, setDepoId] = useState("");
  useEffect(() => {
    setFaturaId("");
    if (tur !== "irsaliye" || yon !== "satis" || !cariId) { setSevkiyatFaturalari([]); return; }
    let aktif = true;
    void api<{ id: string; no: string | null; tarih: string }[]>(`/belgeler/sevkiyat-bekleyen-faturalar?cariId=${encodeURIComponent(cariId)}`).then((sonuc) => { if (aktif) setSevkiyatFaturalari(sonuc); }).catch(() => { if (aktif) setSevkiyatFaturalari([]); });
    return () => { aktif = false; };
  }, [tur, yon, cariId]);
  const [tarih, setTarih] = useState(bugunTR());
  const [gecerlilik, setGecerlilik] = useState("");
  const [aciklama, setAciklama] = useState("");
  // e-İrsaliye taşıma bilgileri (EBLG-23); yalnız irsaliyede sorulur.
  const [fiiliSevkZamani, setFiiliSevkZamani] = useState("");
  const [tasiyiciCariId, setTasiyiciCariId] = useState("");
  const [plaka, setPlaka] = useState("");
  /** EBLG-72: İDİS sevkiyat numarası; irsaliyede girilir. */
  const [idisSevkiyatNo, setIdisSevkiyatNo] = useState("");
  /** EBLG-74: müşterinin sipariş referansı; e-İrsaliyeye OrderReference olur. */
  const [siparisNo, setSiparisNo] = useState("");
  const [siparisTarihi, setSiparisTarihi] = useState("");
  /** FTR-27: alış irsaliyesinde tedarikçinin numarası; bizim no'muz iç seridir. */
  const [tedarikciBelgeNo, setTedarikciBelgeNo] = useState("");
  /** EBLG-84: irsaliyeye özel teslimat adresi; ihracatta gümrük kapısı. */
  const [teslimat, setTeslimat] = useState<TeslimatAdresi>(BOS_TESLIMAT_ADRESI);
  /** EBLG-87: alış irsaliyesinde gümrükten depoya kısım kısım sevk. */
  const [gumrukDepo, setGumrukDepo] = useState(false);
  const [beyannameNo, setBeyannameNo] = useState("");
  const [beyannameTarihi, setBeyannameTarihi] = useState("");
  /** Yükleme (gümrük) adresi; alan adları teslimat bileşeniyle aynı kalıpta. */
  const [yukleme, setYukleme] = useState<TeslimatAdresi>(BOS_TESLIMAT_ADRESI);
  /** Detayda tedarikçi/matbu numarasını düzeltme; null = düzenlenmiyor. */
  const [disNoTaslak, setDisNoTaslak] = useState<string | null>(null);
  const [dorsePlaka, setDorsePlaka] = useState("");
  const [soforAdi, setSoforAdi] = useState("");
  const [soforSoyadi, setSoforSoyadi] = useState("");
  const [soforTckn, setSoforTckn] = useState("");
  // Kayıtlı kartlar (EBLG-25): seçim yalnızca alanları doldurur; belge kartı
  // referans almaz, gönderilmiş irsaliye kart değişse de olduğu gibi kalır.
  const [araclar, setAraclar] = useState<AracKarti[]>([]);
  const [soforKartlari, setSoforKartlari] = useState<SoforKarti[]>([]);
  const [kuruAciklamayaEkle, setKuruAciklamayaEkle] = useState(true);
  const [dovizCinsi, setDovizCinsi] = useState("TRY");
  const [kur, setKur] = useState("1");
  const [kurBilgisi, setKurBilgisi] = useState("");
  const [urunModali, setUrunModali] = useState<{ satir: number; stokId?: string } | null>(null);
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [satirlar, setSatirlar] = useState<BelgeSatirForm[]>([
    { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 },
  ]);
  const [stokVaryantlari, setStokVaryantlari] = useState<Record<string, StokVaryant[]>>({});
  /** FTR-28: belge dövizi değişti, kalem fiyatları hâlâ eski dövizde; kullanıcı onayı bekleniyor. */
  const [bekleyenCevrim, setBekleyenCevrim] = useState<{ eskiDoviz: string; eskiKur: number } | null>(null);

  const girdiSatirlar: FaturaHesaplaSatirGirdi[] = satirlar.map((s) => ({
    stokId: s.stokId || "gecici-id",
    miktar: s.miktar,
    birimFiyat: s.birimFiyat,
    kdvOrani: s.kdvOrani,
    iskontoOrani: s.iskontoOrani,
  }));
  const sonuc = faturaHesapla({ satirlar: girdiSatirlar });

  useEffect(() => {
    if (dovizCinsi === "TRY") { setKur("1"); setKurBilgisi(""); return; }
    let gecerli = true;
    api<{ kaynak: string; kurTarihi: string; oncekiIsGunuKullanildi: boolean; kurlar: Record<string, number> }>(`/doviz-kurlari?tarih=${tarih}&tip=alis`)
      .then((veri) => { if (gecerli && veri.kurlar[dovizCinsi]) { setKur(String(veri.kurlar[dovizCinsi])); setKurBilgisi(`${veri.kaynak === "TCMB_XML" ? "TCMB" : "TCMB EVDS"} · ${veri.kurTarihi}${veri.oncekiIsGunuKullanildi ? " (önceki iş günü)" : ""}`); } })
      .catch(() => { if (gecerli) setKurBilgisi("TCMB kuru alınamadı; manuel kur girin"); });
    return () => { gecerli = false; };
  }, [dovizCinsi, tarih]);

  const yukle = useCallback(async (imlec?: string) => {
    const istekSirasi = ++yuklemeSirasi.current;
    setHata(""); setListeYukleniyor(true);
    try {
      const parametreler = new URLSearchParams();
      if (turFiltre !== "tumu") parametreler.set("tur", turFiltre);
      if (yonBaglami) parametreler.set("yon", yonBaglami);
      if (durumFiltresi === FATURA_BEKLEYEN) parametreler.set("faturaBekleyen", "1");
      else if (durumFiltresi) parametreler.set("durum", durumFiltresi);
      if (imlec) parametreler.set("imlec", imlec);
      if (aramaSorgusu) parametreler.set("arama", aramaSorgusu);
      if (tarihBaslangic) parametreler.set("baslangic", tarihBaslangic);
      if (tarihBitis) parametreler.set("bitis", tarihBitis);
      const sorgu = parametreler.size ? "?" + parametreler.toString() : "";
      const veri = await api<{ kayitlar: Belge[]; sonrakiImlec: string | null }>("/belgeler" + sorgu);
      if (istekSirasi !== yuklemeSirasi.current) return;
      setBelgeler((eskiler) => imlec ? [...eskiler, ...veri.kayitlar] : veri.kayitlar);
      setSonrakiImlec(veri.sonrakiImlec);
      if (!imlec) setSecili(new Set());
    } catch (h) {
      if (istekSirasi === yuklemeSirasi.current) setHata(h instanceof Error ? h.message : "Belgeler yüklenemedi");
    } finally {
      if (istekSirasi === yuklemeSirasi.current) setListeYukleniyor(false);
    }
  }, [turFiltre, yonBaglami, durumFiltresi, aramaSorgusu, tarihBaslangic, tarihBitis]);

  useEffect(() => {
    const zamanlayici = window.setTimeout(() => setAramaSorgusu(arama.trim()), 300);
    return () => window.clearTimeout(zamanlayici);
  }, [arama]);

  useEffect(() => {
    if (!filtrelerHazir || !tokenAl()) return;
    void yukle();
  }, [filtrelerHazir, yukle]);

  useEffect(() => {
    if (!tokenAl()) return;
    tumSayfalariAl<Cari>("/cari").then(setCariler).catch(() => undefined);
    tumSayfalariAl<Stok>("/stok").then(setStoklar).catch(() => undefined);
    api<AracKarti[]>("/sevkiyat/araclar").then(setAraclar).catch(() => undefined);
    api<SoforKarti[]>("/sevkiyat/soforler").then(setSoforKartlari).catch(() => undefined);
  }, []);

  useEffect(() => {
    const parametreler = new URLSearchParams(window.location.search);
    const yonParametresi = parametreler.get("yon");
    const turParametresi = parametreler.get("tur");
    if (yonParametresi === "satis" || yonParametresi === "alis") {
      setYonBaglami(yonParametresi);
      setYon(yonParametresi);
    }
    if (turParametresi === "teklif" || turParametresi === "siparis" || turParametresi === "irsaliye") {
      setTur(turParametresi);
      setTurFiltre(turParametresi);
    }
    if (parametreler.get("yeni") === "1") setFormAcik(true);
    setTarihBaslangic(parametreler.get("baslangic") ?? "");
    setTarihBitis(parametreler.get("bitis") ?? "");
    // Bildirim Merkezi faturalanmayı bekleyen irsaliyelere `faturaBekleyen=1` ile gelir (EBLG-82).
    setDurumFiltresi(parametreler.get("faturaBekleyen") === "1" ? FATURA_BEKLEYEN : parametreler.get("durum"));
    // Başka ekrandan bir belgeye verilen bağlantı (ör. cari CRM'deki teklif) o belgeyi açar.
    const odak = parametreler.get("odak");
    if (odak && tokenAl()) void detayAc(odak);
    try { setKayitliGorunumler(JSON.parse(localStorage.getItem(GORUNUM_ANAHTARI) ?? "[]") as BelgeGorunumu[]); }
    catch { localStorage.removeItem(GORUNUM_ANAHTARI); }
    setFiltrelerHazir(true);
  }, []);

  function gorunumuUygula(
    gorunum: Omit<BelgeGorunumu, "id" | "ad">,
    tarihAraligi = { baslangic: tarihBaslangic, bitis: tarihBitis },
  ) {
    setSecili(new Set());
    setTurFiltre(gorunum.tur); setYonBaglami(gorunum.yon); setDurumFiltresi(gorunum.durum);
    setTarihBaslangic(tarihAraligi.baslangic); setTarihBitis(tarihAraligi.bitis);
    const parametreler = new URLSearchParams();
    if (gorunum.tur !== "tumu") parametreler.set("tur", gorunum.tur);
    if (gorunum.yon) parametreler.set("yon", gorunum.yon);
    if (gorunum.durum) parametreler.set("durum", gorunum.durum);
    if (tarihAraligi.baslangic) parametreler.set("baslangic", tarihAraligi.baslangic);
    if (tarihAraligi.bitis) parametreler.set("bitis", tarihAraligi.bitis);
    window.history.replaceState(null, "", "/panel/belgeler" + (parametreler.size ? "?" + parametreler.toString() : ""));
  }

  function tarihFiltresiDegistir(alan: "baslangic" | "bitis", deger: string) {
    setSecili(new Set());
    if (alan === "baslangic") setTarihBaslangic(deger); else setTarihBitis(deger);
    const parametreler = new URLSearchParams(window.location.search);
    if (deger) parametreler.set(alan, deger); else parametreler.delete(alan);
    window.history.replaceState(null, "", "/panel/belgeler" + (parametreler.size ? "?" + parametreler.toString() : ""));
  }

  function tumFiltreleriTemizle() {
    setTarihBaslangic(""); setTarihBitis("");
    gorunumuUygula({ tur: "tumu", yon: null, durum: null }, { baslangic: "", bitis: "" });
    window.history.replaceState(null, "", "/panel/belgeler");
  }

  function gorunumKaydet(event: React.FormEvent) {
    event.preventDefault(); const ad = gorunumAdi.trim(); if (!ad) return;
    const yeni: BelgeGorunumu = { id: Date.now().toString(), ad, tur: turFiltre, yon: yonBaglami, durum: durumFiltresi, baslangic: tarihBaslangic, bitis: tarihBitis };
    const gorunumler = [...kayitliGorunumler.filter((g) => g.ad.toLocaleLowerCase("tr-TR") !== ad.toLocaleLowerCase("tr-TR")), yeni];
    setKayitliGorunumler(gorunumler); localStorage.setItem(GORUNUM_ANAHTARI, JSON.stringify(gorunumler));
    setGorunumAdi(""); setGorunumFormuAcik(false); setBasari("“" + ad + "” görünümü kaydedildi.");
    kullanimOlayi("gorunum_kaydedildi");
  }

  function gorunumSil(id: string) {
    const gorunumler = kayitliGorunumler.filter((gorunum) => gorunum.id !== id);
    setKayitliGorunumler(gorunumler); localStorage.setItem(GORUNUM_ANAHTARI, JSON.stringify(gorunumler));
  }

  function kayitliGorunumuUygula(gorunum: BelgeGorunumu) {
    gorunumuUygula(gorunum, { baslangic: gorunum.baslangic ?? "", bitis: gorunum.bitis ?? "" }); kullanimOlayi("gorunum_kullanildi");
  }

  function satirEkle() {
    setSatirlar([...satirlar, { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]);
  }
  function satirSil(i: number) {
    if (satirlar.length === 1) return;
    setSatirlar(satirlar.filter((_, idx) => idx !== i));
  }
  /**
   * FTR-28: ürün/varyant fiyatı belge dövizinde gelir. Fiyat başka dövizdeyse
   * satıra yazılmaz (kullanıcı kararı: eklemeyi engelle), satır uyarıyla işaretlenir.
   * Eskiden belge dövizi uca hiç gönderilmiyordu; fiyat her belgede TRY sayılıyordu.
   */
  async function kalemFiyatiGetir(stokId: string, varyantId?: string): Promise<Pick<BelgeSatirForm, "birimFiyat" | "iskontoOrani" | "dovizUyarisi"> | null> {
    const p = new URLSearchParams({ cariId, tip: yon, dovizCinsi, belgeKuru: dovizCinsi === "TRY" ? "1" : kur || "1" });
    if (varyantId) p.set("varyantId", varyantId);
    try {
      const t = await api<{ kaynakFiyat: number; kaynakDoviz: string; iskontoOrani: number }>(`/stok/${stokId}/tavsiye-fiyat?${p}`);
      const uyari = dovizUyumsuzlugu(t.kaynakDoviz, dovizCinsi);
      return { birimFiyat: uyari ? 0 : t.kaynakFiyat, iskontoOrani: t.iskontoOrani, dovizUyarisi: uyari };
    } catch {
      return null; /* tavsiye alınamazsa manuel */
    }
  }

  /** FTR-28: kalem varken belge dövizi değişirse fiyatlar onayla yeni dövize çevrilir. */
  function belgeDoviziDegistir(yeniDoviz: string) {
    if (yeniDoviz === dovizCinsi) return;
    if (satirlar.some((s) => s.birimFiyat > 0)) setBekleyenCevrim((onceki) => onceki ?? { eskiDoviz: dovizCinsi, eskiKur: dovizCinsi === "TRY" ? 1 : Number(kur) || 0 });
    setKurBilgisi("");
    setDovizCinsi(yeniDoviz);
    if (yeniDoviz === "TRY") setKur("1");
  }
  const yeniKurHazir = dovizCinsi === "TRY" || (kurBilgisi !== "" && Number(kur) > 0);
  function kalemleriCevir() {
    if (!bekleyenCevrim) return;
    const yeniKur = dovizCinsi === "TRY" ? 1 : Number(kur);
    setSatirlar((eskiler) => eskiler.map((s) => ({ ...s, birimFiyat: fiyatCevir(s.birimFiyat, bekleyenCevrim.eskiKur, yeniKur) })));
    setBekleyenCevrim(null);
  }
  function dovizDegisiminiGeriAl() {
    if (!bekleyenCevrim) return;
    setDovizCinsi(bekleyenCevrim.eskiDoviz);
    setKur(String(bekleyenCevrim.eskiKur || 1));
    setBekleyenCevrim(null);
  }

  async function satirGuncelle(i: number, alan: keyof BelgeSatirForm, deger: string | number) {
    const yeni = [...satirlar];
    yeni[i] = { ...yeni[i], [alan]: deger };
    // Elle girilen fiyat belge dövizindedir; uyumsuzluk uyarısı kalkar.
    if (alan === "birimFiyat") yeni[i].dovizUyarisi = undefined;
    if (alan === "stokId") { yeni[i].varyantId = undefined; yeni[i].dovizUyarisi = undefined; }
    if (alan === "stokId" && deger) {
      const fiyat = await kalemFiyatiGetir(String(deger));
      if (fiyat) yeni[i] = { ...yeni[i], ...fiyat };
    }
    setSatirlar(yeni);
  }

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    if (!cariId) { setHata("Lütfen bir cari hesap seçin."); return; }
    if (satirlar.some((s) => !s.stokId)) { setHata("Lütfen tüm satırlarda ürün/hizmet seçin."); return; }
    // FTR-28: kalemler belge dövizinde olmalı.
    if (bekleyenCevrim) { setHata(`Belge dövizi değişti; önce kalem fiyatlarını ${paraBirimiEtiketi(dovizCinsi)}'ye çevirin ya da değişikliği geri alın.`); return; }
    const uyumsuz = satirlar.findIndex((s) => s.dovizUyarisi);
    if (uyumsuz >= 0) { setHata(`Satır ${uyumsuz + 1}: ${satirlar[uyumsuz].dovizUyarisi}`); return; }
    try {
      const kurAciklamasi = kuruAciklamayaEkle && dovizCinsi !== "TRY" ? `Döviz kuru: 1 ${dovizCinsi} = ${Number(kur).toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 6 })} TRY${kurBilgisi ? ` (${kurBilgisi})` : ""}` : "";
      const kullaniciAciklamasi = aciklama.split("\n").filter((satir) => !satir.startsWith("Döviz kuru:")).join("\n").trim();
      const kayitAciklamasi = [kullaniciAciklamasi, kurAciklamasi].filter(Boolean).join("\n");
      if (kayitAciklamasi.length > 500) { setHata("Açıklama, döviz kuru bilgisiyle birlikte 500 karakteri aşamaz."); return; }
      const kayit = await api<Belge>("/belgeler", {
        method: "POST",
        body: JSON.stringify({
          tur,
          yon,
          tarih,
          gecerlilikTarihi: tur === "teklif" && gecerlilik ? gecerlilik : undefined,
          cariId,
          faturaId: tur === "irsaliye" && yon === "satis" ? faturaId || null : null,
          // STK-07: rezerv ve stok etkisi bu depoya işlenir
          depoId: depoId || null,
          dovizCinsi,
          kur: dovizCinsi === "TRY" ? "1" : kur,
          aciklama: kayitAciklamasi || null,
          ...(tur === "irsaliye"
            ? {
                fiiliSevkZamani: fiiliSevkZamani ? new Date(fiiliSevkZamani).toISOString() : null,
                tasiyiciCariId: tasiyiciCariId || null,
                plaka: plaka || null,
                dorsePlaka: dorsePlaka || null,
                soforAdi: soforAdi || null,
                soforSoyadi: soforSoyadi || null,
                soforTckn: soforTckn || null,
                idisSevkiyatNo: idisSevkiyatNo.trim() || null,
                ...teslimatAdresiGovdesi(teslimat),
              }
            : {}),
          siparisNo: siparisNo.trim() || null,
          siparisTarihi: siparisTarihi || null,
          ...(tur === "irsaliye" && yon === "alis"
            ? {
                gumrukDepoSevki: gumrukDepo,
                gumrukBeyannameNo: gumrukDepo ? beyannameNo.trim() || null : null,
                gumrukBeyannameTarihi: gumrukDepo ? beyannameTarihi || null : null,
                yuklemeAdres: gumrukDepo ? yukleme.teslimatAdres.trim() || null : null,
                yuklemeIl: gumrukDepo ? yukleme.teslimatIl.trim() || null : null,
                yuklemeIlce: gumrukDepo ? yukleme.teslimatIlce.trim() || null : null,
                yuklemePostaKodu: gumrukDepo ? yukleme.teslimatPostaKodu.trim() || null : null,
              }
            : {}),
          tedarikciBelgeNo: tur === "irsaliye" && yon === "alis" ? tedarikciBelgeNo.trim() || null : null,
          satirlar: satirlar.map((s) => ({
            stokId: s.stokId,
            varyantId: s.varyantId || null,
            miktar: String(s.miktar),
            birim: "adet",
            birimFiyat: String(s.birimFiyat),
            iskontoOrani: String(s.iskontoOrani),
            kdvOrani: String(s.kdvOrani),
            idisEtiketNo: s.idisEtiketNo?.trim() || null,
            partiBilgileri: (() => { const stok = stoklar.find((x) => x.id === s.stokId); if (yon !== "alis" || !stok?.takipTipi || stok.takipTipi === "yok") return []; if (stok.takipTipi === "seri") return (s.seriNolar ?? "").split(/[\n,;]/).map((x) => x.trim()).filter(Boolean).map((seriNo) => ({ lotNo: s.lotNo || seriNo, seriNo, sonKullanmaTarihi: s.sonKullanmaTarihi || null, uretimTarihi: s.uretimTarihi || null, miktar: "1" })); return [{ lotNo: s.lotNo ?? "", seriNo: null, sonKullanmaTarihi: s.sonKullanmaTarihi || null, uretimTarihi: s.uretimTarihi || null, miktar: String(s.miktar) }]; })(),
          })),
        }),
      });
      if (dosyalar.length > 0) await belgeDosyalariniYukle("belge", kayit.id, dosyalar);
      setBasari(`${TUR_ADI[tur]} taslağı oluşturuldu.`);
      setFormAcik(false);
      setCariId("");
      setGecerlilik("");
      setAciklama(""); setKuruAciklamayaEkle(true);
      setDosyalar([]);
      setSatirlar([{ stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20 }]);
      setSiparisNo(""); setSiparisTarihi(""); setIdisSevkiyatNo(""); setTedarikciBelgeNo(""); setTeslimat(BOS_TESLIMAT_ADRESI);
      setGumrukDepo(false); setBeyannameNo(""); setBeyannameTarihi(""); setYukleme(BOS_TESLIMAT_ADRESI);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge oluşturulamadı");
    }
  }

  async function gibUyarisiylaIptal() {
    if (!iptalUyarisi) return;
    const { id } = iptalUyarisi;
    setHata("");
    setBasari("");
    try {
      await api(`/belgeler/${id}/iptal`, { method: "POST", body: JSON.stringify({ uyariOnaylandi: true }) });
      setIptalUyarisi(null);
      setBasari("İrsaliye programda iptal edildi.");
      if (detay?.id === id) await detayAc(id);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İptal başarısız");
    }
  }

  async function eylem(id: string, yol: string, mesaj: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/belgeler/${id}/${yol}`, { method: "POST" });
      setBasari(mesaj);
      if (detay?.id === id) await detayAc(id);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem başarısız");
    }
  }

  async function onayOzetiAc(id: string) {
    setHata("");
    try {
      setOnayBekleyen(await api<BelgeDetay>(`/belgeler/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Onay özeti yüklenemedi");
    }
  }

  async function onayiTamamla() {
    if (!onayBekleyen) return;
    const id = onayBekleyen.id;
    setOnayBekleyen(null);
    await eylem(id, "onayla", "Belge onaylandı.");
  }

  async function sil(id: string) {
    if (!confirm("Taslak belgeyi silmek istediğinize emin misiniz?")) return;
    setHata(""); setBasari("");
    try {
      await api(`/belgeler/${id}`, { method: "DELETE" });
      setBasari("Belge silindi.");
      if (detay?.id === id) setDetay(null);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Silme hatası");
    }
  }

  /** FTR-26: irsaliye yeniden "onaylı" olur ve faturalanabilir listesine döner. */
  async function faturaBaginiKaldir(id: string) {
    if (!confirm("İrsaliyenin fatura bağı kaldırılsın mı? İrsaliye yeniden faturalanabilir hâle gelir; aynı malı ikinci kez faturalamamaya dikkat edin.")) return;
    setHata(""); setBasari("");
    try {
      await api(`/belgeler/${id}/fatura-bagini-kaldir`, { method: "POST" });
      setBasari("İrsaliyenin fatura bağı kaldırıldı.");
      if (detay?.id === id) await detayAc(id);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Bağ kaldırılamadı");
    }
  }

  async function donustur(id: string, hedef: string, kalemler?: { satirId: string; miktar: string }[]) {
    setHata(""); setBasari("");
    try {
      await api(`/belgeler/${id}/donustur`, { method: "POST", body: JSON.stringify({ hedef, ...(kalemler?.length ? { kalemler } : {}) }) });
      setBasari(hedef === "fatura" ? "Belge faturaya dönüştürüldü (taslak fatura oluştu)." : `Belge ${TUR_ADI[hedef] ?? hedef}'e dönüştürüldü.`);
      if (detay?.id === id) await detayAc(id);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Dönüştürme hatası");
    }
  }

  async function eirsaliyeGonder(id: string) {
    setHata(""); setBasari("");
    try {
      await api(`/ebelge/irsaliye/${id}/gonder`, { method: "POST" });
      setBasari("e-İrsaliye entegratöre gönderildi. Stok etkisi oluşmadı; stok faturada işlenecek.");
      if (detay?.id === id) await detayAc(id);
      void yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "e-İrsaliye gönderilemedi"); }
  }

  async function disNoKaydet(id: string, alan: DisNumara) {
    setHata(""); setBasari("");
    try {
      await api(`/belgeler/${id}/${alan.yol}`, { method: "PATCH", body: JSON.stringify({ [alan.alan]: disNoTaslak?.trim() || null }) });
      setDisNoTaslak(null);
      await detayAc(id);
      void yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "Tedarikçi numarası kaydedilemedi"); }
  }

  async function donusumOzetiAc(id: string, hedef: "siparis" | "irsaliye" | "fatura") {
    setHata("");
    try {
      const belge = await api<BelgeDetay>(`/belgeler/${id}`);
      // SAT-10: teslim miktarı varsayılan olarak satırın kalanıdır; kalanı
      // bitmiş satır dönüşüme hiç girmez.
      setTeslimMiktarlari(
        kismiTeslimVar(belge, hedef)
          ? Object.fromEntries(belge.satirlar.filter((s) => Number(s.kalanMiktar ?? s.miktar) > 0).map((s) => [s.id, String(Number(s.kalanMiktar ?? s.miktar))]))
          : {},
      );
      setDonusumBekleyen({ belge, hedef });
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Dönüşüm özeti yüklenemedi");
    }
  }

  async function donusumuTamamla() {
    if (!donusumBekleyen) return;
    const { belge, hedef } = donusumBekleyen;
    const kalemler = kismiTeslimVar(belge, hedef)
      ? Object.entries(teslimMiktarlari)
          .filter(([, miktar]) => Number(miktar) > 0)
          .map(([satirId, miktar]) => ({ satirId, miktar: String(Number(miktar)) }))
      : undefined;
    if (kalemler && kalemler.length === 0) {
      setHata("En az bir satır için teslim miktarı girin");
      return;
    }
    setDonusumBekleyen(null);
    await donustur(belge.id, hedef, kalemler);
  }

  async function topluFatura() {
    if (secili.size === 0 || topluFaturaYukleniyor) return;
    setHata(""); setBasari(""); setOlusanFaturaId(null); setTopluFaturaYukleniyor(true);
    try {
      const sonuc = await api<{ faturaId: string }>("/belgeler/toplu-fatura", { method: "POST", body: JSON.stringify({ belgeIds: [...secili] }) });
      setOlusanFaturaId(sonuc.faturaId);
      setBasari(`${secili.size} belge tek taslak faturada birleştirildi.`);
      void yukle();
    } catch (h) {
      if (h instanceof ApiHata && h.durum === 409) {
        await yukle();
      }
      setHata(h instanceof Error ? h.message : "Toplu faturalama hatası");
    } finally {
      setTopluFaturaYukleniyor(false);
    }
  }

  // EBLG-87: boşaltma adresi seçilen deponun (yoksa varsayılan deponun) adresidir; irsaliyede değiştirilebilir.
  useEffect(() => {
    if (!gumrukDepo) return;
    void api<DepoOzet[]>("/depo")
      .then((depolar) => {
        const d = depolar.find((x) => x.id === depoId) ?? depolar.find((x) => x.varsayilan);
        if (d) setTeslimat({ teslimatAdres: d.adres ?? "", teslimatIl: d.il ?? "", teslimatIlce: d.ilce ?? "", teslimatPostaKodu: d.postaKodu ?? "" });
      })
      .catch(() => undefined);
  }, [gumrukDepo, depoId]);

  async function detayAc(id: string) {
    setHata("");
    setDisNoTaslak(null);
    try {
      setDetay(await api<BelgeDetay>(`/belgeler/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge detayı yüklenemedi");
    }
  }

  // Kart listenin üstünde açılır; satırdan ya da zincirden açılan belge görünür olsun.
  useEffect(() => {
    if (detay?.id) document.getElementById("belge-detayi")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [detay?.id]);

  async function pdfAc(id: string) {
    try {
      const res = await fetch(`${apiBase()}/belgeler/${id}/pdf`, {
        headers: { Authorization: `Bearer ${tokenAl()}` },
      });
      if (!res.ok) throw new Error("PDF alınamadı");
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "PDF açılamadı");
    }
  }

  function seciliDegistir(id: string) {
    setSecili((eski) => {
      const y = new Set(eski);
      if (y.has(id)) y.delete(id); else y.add(id);
      return y;
    });
  }

  const gorunen = belgeler.filter((b) => {
    if (yonBaglami && b.yon !== yonBaglami) return false;
    if (durumFiltresi === FATURA_BEKLEYEN) { if (!b.faturalamaSuresi) return false; }
    else if (durumFiltresi && !durumFiltresi.split(",").includes(b.durum)) return false;
    if (tarihBaslangic && b.tarih < tarihBaslangic) return false;
    if (tarihBitis && b.tarih > tarihBitis) return false;
    if (!arama) return true;
    const q = arama.toLocaleLowerCase("tr");
    return (b.no ?? "").toLocaleLowerCase("tr").includes(q) || (b.tedarikciBelgeNo ?? "").toLocaleLowerCase("tr").includes(q) || (b.matbuBelgeNo ?? "").toLocaleLowerCase("tr").includes(q) || b.cari.unvan.toLocaleLowerCase("tr").includes(q);
  });
  function csvIndir() {
    const basliklar = ["Belge No", "Tür", "Yön", "Cari", "Tarih", "Genel Toplam", "Döviz", "Durum"];
    const satirlar = gorunen.map((belge) => [
      belge.no ?? "Taslak", TUR_ADI[belge.tur] ?? belge.tur, YON_ADI[belge.yon] ?? belge.yon,
      belge.cari.unvan, belge.tarih, belge.genelToplam, belge.dovizCinsi, belge.durum,
    ]);
    const icerik = "\uFEFF" + [basliklar, ...satirlar].map((satir) => satir.map(csvHucre).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([icerik], { type: "text/csv;charset=utf-8" }));
    const baglanti = document.createElement("a");
    baglanti.href = url; baglanti.download = "belgeler.csv"; baglanti.click();
    URL.revokeObjectURL(url);
    kullanimOlayi("belgeler_csv_indirildi");
  }

  // Toplu faturalanabilir: onaylı sipariş/irsaliye
  const faturalanabilir = (b: Belge) => b.durum === "onaylandi" && (b.tur === "siparis" || b.tur === "irsaliye");
  const faturaUyumlulukAnahtari = (b: Belge) => [b.cari.id, b.dovizCinsi, b.kur ?? "", b.yon, b.depoId ?? ""].join("|");
  const seciliIlkBelge = belgeler.find((belge) => secili.has(belge.id));
  const secimUyumlulukAnahtari = seciliIlkBelge ? faturaUyumlulukAnahtari(seciliIlkBelge) : null;
  const gorunenFaturalanabilirlerinTumu = gorunen.filter(faturalanabilir);
  const gorunenFaturaGruplari = new Set(gorunenFaturalanabilirlerinTumu.map(faturaUyumlulukAnahtari));
  const gorunenTopluSecimeUygun = secimUyumlulukAnahtari !== null || gorunenFaturaGruplari.size <= 1;
  const gorunenFaturalanabilir = gorunenFaturalanabilirlerinTumu.filter((belge) =>
    !secimUyumlulukAnahtari || faturaUyumlulukAnahtari(belge) === secimUyumlulukAnahtari,
  );
  const gorunenlerinTumuSecili = gorunenFaturalanabilir.length > 0 && gorunenFaturalanabilir.every((belge) => secili.has(belge.id));

  const gorunenlerdenSeciliVar = gorunenFaturalanabilir.some((belge) => secili.has(belge.id));
  const gorunenSecimKismi = gorunenlerdenSeciliVar && !gorunenlerinTumuSecili;

  useEffect(() => {
    if (tumunuSecRef.current) tumunuSecRef.current.indeterminate = gorunenSecimKismi;
  }, [gorunenSecimKismi]);

  function gorunenlerinSeciminiDegistir() {
    setSecili((eskiler) => {
      const yeni = new Set(eskiler);
      for (const belge of gorunenFaturalanabilir) {
        if (gorunenlerinTumuSecili) yeni.delete(belge.id); else yeni.add(belge.id);
      }
      return yeni;
    });
  }

  return (
    <div className={yeniSayfasi ? "create-page" : undefined}>
      <PageHeader
        title={
          yonBaglami === "satis"
            ? "Satış Belgeleri"
            : yonBaglami === "alis"
              ? "Satın Alma Belgeleri"
              : "Tüm Belgeler"
        }
        subtitle={
          yonBaglami
            ? "Teklif, sipariş ve irsaliyeleri iş akışına göre yönetin ve faturaya dönüştürün."
            : "Satış ve satın alma belge zincirlerini tek görünümde inceleyin."
        }
        actions={
          <>
            {secili.size > 0 && (
              <>
                <Button disabled={topluFaturaYukleniyor} onClick={() => setSecili(new Set())}>Seçimi temizle</Button>
                <Button variant="primary" disabled={topluFaturaYukleniyor} onClick={topluFatura}>{topluFaturaYukleniyor ? "Fatura oluşturuluyor…" : `🧾 Seçilenleri Faturala (${secili.size})`}</Button>
              </>
            )}
            {yeniSayfasi ? <Button onClick={() => router.push("/panel/belgeler")}>Listeye dön</Button> : <ButtonLabel as="a" variant={secili.size > 0 ? "ghost" : "primary"} href="/panel/belgeler/yeni">➕ Yeni Belge</ButtonLabel>}
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari && <>
        {basari}
        {olusanFaturaId && <a className="btn btn--ghost btn--sm" href={`/panel/fatura?faturaId=${olusanFaturaId}`}>Taslak faturayı aç</a>}
      </>}</Alert>

      {formAcik && (
        <div className="document-editor">
          <div className="document-editor__head">
            <h3>Yeni {TUR_ADI[tur].toLocaleLowerCase("tr")}</h3>
            <span className="badge badge--warning">Taslak</span>
          </div>

          <div className="document-editor__section">
            <h4 className="document-editor__section-title">Cari ve belge bilgileri</h4>
            <div className="document-fields document-fields--belge">
              <div>
              <Field label={yon === "satis" ? "Müşteri" : "Tedarikçi"}>
                <AramaSecici
                  ariaLabel={yon === "satis" ? "Müşteri ara" : "Tedarikçi ara"}
                  deger={cariId}
                  onChange={setCariId}
                  placeholder="Ünvan, cari kodu veya VKN ile ara"
                  secenekler={cariler.map((cari) => ({
                    deger: cari.id,
                    baslik: cari.unvan,
                    aciklama: [cari.kod, cari.vknTckn, cari.telefon].filter(Boolean).join(" · ") || "Cari hesap",
                    aramaMetni: [cari.kod, cari.vknTckn, cari.telefon].filter(Boolean).join(" "),
                  }))}
                />
              </Field>
              {tur === "irsaliye" && yon === "satis" && (muhtelifMusteriMi(cariler.find((c) => c.id === cariId))
                ? <small className="muted">Muhtelif müşteriler irsaliyesi (GİB 5555555555): dağıtımda teslim ettiğiniz her müşteriye ayrıca fatura ya da irsaliye kesin. Bu irsaliye faturaya bağlanmaz ve 7 gün takibine girmez.</small>
                : <Button type="button" size="sm" variant="ghost" onClick={() => void muhtelifSec()}>Müşteri belli değil: Muhtelif müşteriler</Button>)}
              </div>
              <Field label="Belge Türü"><Select value={tur} onChange={(e) => setTur(e.target.value as Tur)}><option value="teklif">Teklif</option><option value="siparis">Sipariş</option><option value="irsaliye">İrsaliye</option></Select></Field>
              <Field label="Yön"><Select value={yon} onChange={(e) => setYon(e.target.value as Yon)}><option value="satis">Satış</option><option value="alis">Alış</option></Select></Field>
              <Field label="Tarih"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} required /></Field>
              <Field label="Belge Dövizi"><Select value={dovizCinsi} onChange={(e) => belgeDoviziDegistir(e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></Select></Field>
              {bekleyenCevrim && (
                <Alert tone="warning">
                  Kalem fiyatları {paraBirimiEtiketi(bekleyenCevrim.eskiDoviz)} cinsinden girildi. {paraBirimiEtiketi(dovizCinsi)} belgede kullanmak için kalemleri {yeniKurHazir ? `${dovizCinsi === "TRY" ? "1" : kur} kuruyla` : "yeni kur yüklenince"} {paraBirimiEtiketi(dovizCinsi)}'ye çevirin.{" "}
                  <Button size="sm" type="button" variant="primary" disabled={!yeniKurHazir || !(bekleyenCevrim.eskiKur > 0)} onClick={kalemleriCevir}>Kalemleri {paraBirimiEtiketi(dovizCinsi)}'ye çevir</Button>{" "}
                  <Button size="sm" type="button" onClick={dovizDegisiminiGeriAl}>Vazgeç ({paraBirimiEtiketi(bekleyenCevrim.eskiDoviz)} kalsın)</Button>
                </Alert>
              )}
              {dovizCinsi !== "TRY" && <Field label="Kur (1 döviz = TRY)"><Input type="number" min="0.000001" step="0.000001" value={kur} onChange={(e) => { setKur(e.target.value); setKurBilgisi("Manuel kur"); }} required /><small className="muted">{kurBilgisi || "TCMB EVDS kuru yükleniyor…"}</small></Field>}
              <div><DepoSecici deger={depoId} onChange={setDepoId} /></div>
            {tur === "irsaliye" && yon === "alis" && (
              <Field label="Tedarikçi İrsaliye No">
                <Input aria-label="Tedarikçi irsaliye numarası" value={tedarikciBelgeNo} maxLength={50} placeholder="Opsiyonel" onChange={(e) => setTedarikciBelgeNo(e.target.value)} />
                <small className="muted">Belge numaramız onayda iç seriden verilir; bu alan tedarikçinin numarasıdır.</small>
              </Field>
            )}
            {tur === "teklif" && (
                <Field label="Geçerlilik Tarihi"><Input type="date" value={gecerlilik} onChange={(e) => setGecerlilik(e.target.value)} /></Field>
            )}
            </div>
          </div>

          {tur === "irsaliye" && (
            <div className="document-editor__section">
              <h4 className="document-editor__section-title">Sevkiyat</h4>
              {/* EBLG-76: sevkten önce kesilmiş fatura; numarası e-İrsaliyeye yazılır. */}
              {yon === "satis" && sevkiyatFaturalari.length > 0 && <Field label="Önceden düzenlenen fatura">
                <Select value={faturaId} onChange={(e) => setFaturaId(e.target.value)}>
                  <option value="">Bu sevkiyat için önceden fatura düzenlenmedi</option>
                  {sevkiyatFaturalari.map((f) => <option key={f.id} value={f.id}>{f.no} · {new Date(f.tarih).toLocaleDateString("tr-TR")}</option>)}
                </Select>
                <small className="muted">Seçilen faturanın numarası ve tarihi e-İrsaliyeye yazılır.</small>
              </Field>}
              <div className="document-fields document-fields--belge">
                <Field label="Fiili Sevk Tarihi ve Saati">
                  <Input type="datetime-local" value={fiiliSevkZamani} onChange={(e) => setFiiliSevkZamani(e.target.value)} />
                  <small className="muted">Boş bırakılırsa onay anı yazılır.</small>
                </Field>
                <Field label="Taşıyan">
                  <Select value={tasiyiciCariId} onChange={(e) => setTasiyiciCariId(e.target.value)}>
                    <option value="">Kendi aracımızla</option>
                    {cariler.map((c) => <option key={c.id} value={c.id}>{c.unvan}</option>)}
                  </Select>
                  <small className="muted">Nakliyeci ya da kargo firmasını cari kartından seçin.</small>
                </Field>
                {araclar.length > 0 && (
                  <Field label="Kayıtlı Araç">
                    <Select value="" onChange={(e) => { const a = araclar.find((x) => x.id === e.target.value); if (a) { setPlaka(a.plaka); setDorsePlaka(a.dorsePlaka ?? ""); } }}>
                      <option value="">Seçin — alanlara yazılır</option>
                      {araclar.map((a) => <option key={a.id} value={a.id}>{a.plaka}{a.aciklama ? ` — ${a.aciklama}` : ""}</option>)}
                    </Select>
                  </Field>
                )}
                {soforKartlari.length > 0 && (
                  <Field label="Kayıtlı Şoför">
                    <Select value="" onChange={(e) => { const k = soforKartlari.find((x) => x.id === e.target.value); if (k) { setSoforAdi(k.ad); setSoforSoyadi(k.soyad); setSoforTckn(k.tckn ?? ""); } }}>
                      <option value="">Seçin — alanlara yazılır</option>
                      {soforKartlari.map((k) => <option key={k.id} value={k.id}>{k.ad} {k.soyad}</option>)}
                    </Select>
                  </Field>
                )}
                {/* EBLG-74: müşterinin siparişi; boşsa zincirdeki sipariş belgesi yazılır. */}
                <Field label="Müşteri Sipariş No">
                  <Input value={siparisNo} onChange={(e) => setSiparisNo(e.target.value)} maxLength={100} placeholder="Opsiyonel" />
                  <small className="muted">Boşsa e-İrsaliyeye, irsaliyenin türediği sipariş belgesinin numarası yazılır.</small>
                </Field>
                <Field label="Müşteri Sipariş Tarihi">
                  <Input type="date" value={siparisTarihi} onChange={(e) => setSiparisTarihi(e.target.value)} />
                  {siparisNo.trim() && !siparisTarihi && <small className="muted">Boş bırakılırsa belgeye irsaliye tarihi yazılır (GİB tarihi zorunlu tutuyor).</small>}
                </Field>
                {/* EBLG-87: ithal mal gümrükten depoya kısım kısım taşınırken firma e-İrsaliye düzenler. */}
                {yon === "alis" && (
                  <Field label="Gümrükten Depoya Sevk">
                    <label className="row-tight">
                      <input type="checkbox" checked={gumrukDepo} onChange={(e) => setGumrukDepo(e.target.checked)} />
                      <span>İthal malın gümrükten depoya kısım kısım taşınması</span>
                    </label>
                    <small className="muted">Firma e-İrsaliye düzenler; satıcı da alıcı da firmanın kendisidir. Açıklama ve sefer numarası kendiliğinden yazılır.</small>
                  </Field>
                )}
                {yon === "alis" && gumrukDepo && (
                  <>
                    <Field label="Gümrük Beyanname No"><Input aria-label="Gümrük beyanname numarası" value={beyannameNo} maxLength={40} onChange={(e) => setBeyannameNo(e.target.value)} /></Field>
                    <Field label="Beyanname Tarihi"><Input aria-label="Gümrük beyanname tarihi" type="date" value={beyannameTarihi} onChange={(e) => setBeyannameTarihi(e.target.value)} /></Field>
                    <Field label="Yükleme Adresi (Gümrük)"><Input aria-label="Yükleme adresi" value={yukleme.teslimatAdres} maxLength={500} onChange={(e) => setYukleme({ ...yukleme, teslimatAdres: e.target.value })} /></Field>
                    <Field label="Yükleme İli"><Input aria-label="Yükleme ili" value={yukleme.teslimatIl} maxLength={60} onChange={(e) => setYukleme({ ...yukleme, teslimatIl: e.target.value })} /></Field>
                    <Field label="Yükleme İlçesi"><Input aria-label="Yükleme ilçesi" value={yukleme.teslimatIlce} maxLength={60} onChange={(e) => setYukleme({ ...yukleme, teslimatIlce: e.target.value })} /></Field>
                    <Field label="Yükleme Posta Kodu"><Input aria-label="Yükleme posta kodu" value={yukleme.teslimatPostaKodu} maxLength={10} onChange={(e) => setYukleme({ ...yukleme, teslimatPostaKodu: e.target.value })} /></Field>
                  </>
                )}
                {/* EBLG-84: satış irsaliyesinde malın gideceği yer; ihracatta gümrük kapısı. EBLG-87: gümrükten sevkte boşaltma (depo) adresi. */}
                {(yon === "satis" || gumrukDepo) && <TeslimatAdresiAlanlari deger={teslimat} onChange={setTeslimat} cariId={yon === "satis" ? cariId || null : null} />}
                {/* EBLG-72: numara girilirse belge IDISIRSALIYE profiliyle gider. */}
                <Field label="İDİS Sevkiyat Numarası">
                  <Input aria-label="İDİS sevkiyat numarası" value={idisSevkiyatNo} maxLength={20} placeholder="Örn. SE-0152457" onChange={(e) => setIdisSevkiyatNo(e.target.value)} />
                  <small className="muted">İnşaat demiri teslimlerinde girilir; satırlar etiket numarası ister.</small>
                </Field>
                <Field label="Plaka"><Input value={plaka} onChange={(e) => setPlaka(e.target.value)} onBlur={() => setPlaka((p) => plakaNormalize(p))} placeholder="34ABC123" /></Field>
                <Field label="Dorse Plakası"><Input value={dorsePlaka} onChange={(e) => setDorsePlaka(e.target.value)} onBlur={() => setDorsePlaka((p) => plakaNormalize(p))} /></Field>
                <Field label="Şoför Adı"><Input value={soforAdi} onChange={(e) => setSoforAdi(e.target.value)} /></Field>
                <Field label="Şoför Soyadı"><Input value={soforSoyadi} onChange={(e) => setSoforSoyadi(e.target.value)} /></Field>
                <Field label="Şoför TCKN"><Input value={soforTckn} onChange={(e) => setSoforTckn(e.target.value)} maxLength={11} /></Field>
              </div>
              <small className="muted">e-İrsaliye gönderiminde taşıyıcı firma ya da şoför adı, soyadı ve plaka zorunludur. Plaka boşluksuz yazılır (GİB kuralı): 34ABC123.</small>
            </div>
          )}

          <div className="document-editor__section document-lines">
            <div className="between"><h4 className="document-editor__section-title">Belge kalemleri</h4><Button type="button" variant="primary" onClick={() => setUrunModali({ satir: satirlar.findIndex((s) => !s.stokId) >= 0 ? satirlar.findIndex((s) => !s.stokId) : satirlar.length })}>+ Ürün çağır</Button></div>
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
              {satirlar.map((s, i) => {
                const ss = sonuc.satirlar[i];
                return (
                  <tr key={i}>
                    <td>
                      <AramaSecici
                        ariaLabel={`${i + 1}. satır ürün veya hizmet seçimi`}
                        deger={s.stokId}
                        onChange={(deger) => { if (deger) setUrunModali({ satir: i, stokId: deger }); }}
                        placeholder="Kod veya ürün adıyla ara"
                        secenekler={stoklar.map((stok) => ({
                          deger: stok.id,
                          baslik: stok.ad,
                          aciklama: stok.kod,
                          aramaMetni: [stok.kod, ...(stok.tedarikciUrunKodlari ?? [])].join(" "),
                        }))}
                      />
                      {(stokVaryantlari[s.stokId]?.length ?? 0) > 0 && <Select aria-label="Varyant" required value={s.varyantId ?? ""} onChange={(e) => { const varyantId = e.target.value; setSatirlar((eskiler) => eskiler.map((x, j) => j === i ? { ...x, varyantId } : x)); if (varyantId) void kalemFiyatiGetir(s.stokId, varyantId).then((fiyat) => { if (fiyat) setSatirlar((eskiler) => eskiler.map((x, j) => j === i && x.varyantId === varyantId ? { ...x, ...fiyat } : x)); }); }}><option value="">Varyant seçin</option>{stokVaryantlari[s.stokId].filter((v) => v.aktif).map((v) => <option key={v.id} value={v.id}>{v.kod} — {v.ad} · Stok {Number(v.mevcutMiktar).toLocaleString("tr-TR")}</option>)}</Select>}
                      {s.dovizUyarisi && <p className="field-error" role="alert">{s.dovizUyarisi}</p>}
                      {yon === "alis" && (() => { const takip = stoklar.find((x) => x.id === s.stokId)?.takipTipi; return takip && takip !== "yok" ? <div className="stack"><Input aria-label="Lot / Parti No" required placeholder="Lot / Parti No" value={s.lotNo ?? ""} onChange={(e) => void satirGuncelle(i, "lotNo", e.target.value)} />{takip === "seri" && <Input aria-label="Seri numaraları" required placeholder="Seri numaraları (virgülle)" value={s.seriNolar ?? ""} onChange={(e) => void satirGuncelle(i, "seriNolar", e.target.value)} />}<Input aria-label="Son kullanma tarihi" type="date" value={s.sonKullanmaTarihi ?? ""} onChange={(e) => void satirGuncelle(i, "sonKullanmaTarihi", e.target.value)} /></div> : null; })()}
                      {tur === "irsaliye" && idisSevkiyatNo.trim() && (
                        <Input aria-label={`${i + 1}. satır İDİS etiket numarası`} placeholder="İDİS etiket no (örn. CV0152457)" maxLength={20} value={s.idisEtiketNo ?? ""} onChange={(e) => satirGuncelle(i, "idisEtiketNo", e.target.value)} />
                      )}
                    </td>
                    <td><Input className="document-line-number" aria-label="Miktar" type="number" min="0.01" step="any" inputMode="decimal" value={s.miktar} onChange={(e) => satirGuncelle(i, "miktar", Number(e.target.value))} required /></td>
                    <td><Input className="document-line-number" aria-label="Birim fiyat" type="number" min="0" step="any" inputMode="decimal" value={s.birimFiyat} onChange={(e) => satirGuncelle(i, "birimFiyat", Number(e.target.value))} required /></td>
                    <td><Input className="document-line-number" aria-label="İskonto yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.iskontoOrani} onChange={(e) => satirGuncelle(i, "iskontoOrani", Number(e.target.value))} /></td>
                    <td><Input className="document-line-number" aria-label="KDV yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.kdvOrani} onChange={(e) => satirGuncelle(i, "kdvOrani", Number(e.target.value))} required /></td>
                    <td className="num document-line-total">{tl(ss ? ss.toplamTutar : 0, dovizCinsi)}</td>
                    <td className="center"><Button aria-label="Satırı sil" title="Satırı sil" variant="danger" size="sm" type="button" onClick={() => satirSil(i)}>×</Button></td>
                  </tr>
                );
              })}
            </tbody>
            </TableWrap>

            <div className="document-summary-row">
              <Button type="button" onClick={satirEkle}>+ Satır ekle</Button>
              <div className="document-totals">
                <div className="document-total-line"><span>Brüt toplam</span><span>{tl(sonuc.toplamBrut, dovizCinsi)}</span></div>
                <div className="document-total-line is-tax"><span>KDV toplamı</span><span>{tl(sonuc.toplamKdv, dovizCinsi)}</span></div>
                <div className="document-total-line is-grand"><span>Genel toplam</span><span>{tl(sonuc.genelToplam, dovizCinsi)}</span></div>
              </div>
            </div>
          </div>

          <div className="document-editor__section document-description">
            <Field label={`${TUR_ADI[tur]} açıklaması`}>
              <textarea className="textarea document-description__input" value={aciklama} onChange={(e) => setAciklama(e.target.value)} maxLength={500} rows={5} placeholder={`${TUR_ADI[tur]} üzerinde gösterilecek açıklamayı yazın (isteğe bağlı)`} />
              {dovizCinsi !== "TRY" && <label className="check-row"><input type="checkbox" checked={kuruAciklamayaEkle} onChange={(e) => setKuruAciklamayaEkle(e.target.checked)} /> Döviz kurunu açıklamaya ekle</label>}
            </Field>
          </div>

          <div className="document-editor__section">
            <BelgeDosyalari dosyalar={dosyalar} onChange={setDosyalar} />
          </div>

          <div className="document-editor__actions"><Button variant="primary" onClick={kaydet}>Taslak belgeyi kaydet</Button></div>
        </div>
      )}

      <UrunSecimModali acik={urunModali !== null} baslangicStokId={urunModali?.stokId} stoklar={stoklar} cariId={cariId} tip={yon} belgeDovizi={dovizCinsi} belgeKuru={kur} belgeTarihi={tarih} onKapat={() => setUrunModali(null)} onEkle={(urun) => {
        setSatirlar((eskiler) => {
          const satir: BelgeSatirForm = { stokId: urun.stokId, varyantId: urun.varyantId, miktar: urun.miktar, birimFiyat: urun.birimFiyat, iskontoOrani: urun.iskontoOrani, kdvOrani: urun.kdvOrani };
          if (urunModali == null || urunModali.satir >= eskiler.length) return [...eskiler, satir];
          return eskiler.map((x, i) => i === urunModali.satir ? satir : x);
        });
        setUrunModali(null);
      }} />

      {detay && (
        <Card key={detay.id} id="belge-detayi" className="record-detail" style={{ marginBottom: "1.5rem", borderColor: "var(--accent)", scrollMarginTop: "1rem" }}>
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ fontSize: "1.15rem", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {TUR_ADI[detay.tur]} {belgeNoGoster(detay)} · {YON_ADI[detay.yon]} {durumRozet(detay.durum)}
              </h3>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                {detay.cari.unvan} · {detay.tarih}{detay.gecerlilikTarihi ? ` · Geçerlilik: ${detay.gecerlilikTarihi}` : ""} · {tl(detay.genelToplam, detay.dovizCinsi)}
              </p>
              {detay.faturalamaSuresi && <FaturalamaSuresiNotu sure={detay.faturalamaSuresi} yon={detay.yon} />}
            </div>
            <Button size="sm" onClick={() => setDetay(null)}>✖ Kapat</Button>
          </div>
          <EylemCubugu etiket="Belge eylemleri">
            {detay.durum === "taslak" && <Button variant="primary" size="sm" type="button" onClick={() => void onayOzetiAc(detay.id)}>✅ Onayla</Button>}
            {(detay.durum === "onaylandi" || detay.durum === "kismen_kapandi") && DONUSUM[detay.tur]?.map((hedef) => (
              hedef === "fatura" && detay.durum !== "onaylandi" ? null : (
                <Button key={hedef} variant={hedef === "fatura" ? "primary" : undefined} size="sm" type="button" onClick={() => void donusumOzetiAc(detay.id, hedef)}>→ {hedef === "fatura" ? "Fatura" : TUR_ADI[hedef]}</Button>
              )
            ))}
            {/* EBLG-49: şoför/plaka mal yüklenirken belli olur; onaydan sonra da girilebilir (EBLG-23). */}
            {detay.tur === "irsaliye" && detay.durum !== "iptal" && (!detay.eirsaliye || detay.eirsaliye.durum === "hata") && (
              <Button size="sm" type="button" onClick={() => setTasimaPaneli({ id: detay.id, no: detay.no })}>🚚 Taşıma bilgisi</Button>
            )}
            {/* Faturalanmış (kapandı) irsaliye de sevk belgesidir; e-İrsaliyesi gönderilebilir (FTR-26). */}
            {(detay.durum === "onaylandi" || detay.durum === "kapandi") && firmaGonderir(detay) && !detay.kagitIrsaliye && !detay.eirsaliye && <Button size="sm" type="button" onClick={() => void eirsaliyeGonder(detay.id)}>🚚 e-İrsaliye gönder</Button>}
            {detay.durum === "onaylandi" && detay.tur === "irsaliye" && !detay.fatura && <Button size="sm" type="button" onClick={() => setBaglaPaneli(detay.id)}>🔗 Faturaya bağla</Button>}
            <Button size="sm" type="button" onClick={() => void pdfAc(detay.id)}>🖨 PDF</Button>
            <EylemMenusu>
              <Button size="sm" type="button" onClick={() => void eylem(detay.id, "kopyala", "Belge kopyalandı (taslak).")}>📋 Kopyala</Button>
              {(detay.durum === "onaylandi" || detay.durum === "kismen_kapandi") && <Button variant="danger" size="sm" type="button" onClick={() => { const metin = irsaliyeIptalUyarisi(detay); if (metin) setIptalUyarisi({ id: detay.id, metin }); else void eylem(detay.id, "iptal", "Belge iptal edildi."); }}>İptal et</Button>}
              {detay.durum === "taslak" && <Button variant="danger" size="sm" type="button" onClick={() => void sil(detay.id)}>Sil</Button>}
              {detay.tur === "irsaliye" && detay.fatura && (!detay.fatura.ebelge || ["hata", "ret"].includes(detay.fatura.ebelge.durum)) && <Button variant="danger" size="sm" type="button" onClick={() => void faturaBaginiKaldir(detay.id)}>Fatura bağını kaldır</Button>}
            </EylemMenusu>
          </EylemCubugu>
          <div className="document-timeline" aria-label="Belge yaşam döngüsü">
            {(["teklif", "siparis", "irsaliye"] as const).map((adim) => {
              const tamZincirKaydi = detay.zincirBelgeleri?.find((belge) => belge.tur === adim);
              const kayit = tamZincirKaydi ?? (detay.tur === adim
                ? { id: detay.id, tur: detay.tur, no: detay.no, durum: detay.durum }
                : detay.kaynakBelge?.tur === adim
                  ? detay.kaynakBelge
                  : detay.turetilenler.find((t) => t.tur === adim));
              const mevcut = detay.tur === adim;
              const hedefAdim = adim === "teklif" ? null : adim;
              const olusturulabilir = (detay.durum === "onaylandi" || (detay.durum === "kismen_kapandi" && hedefAdim === "irsaliye")) && !kayit && hedefAdim !== null && DONUSUM[detay.tur]?.includes(hedefAdim);
              return (
                <button
                  className={`document-timeline__step${kayit ? " is-complete" : ""}${mevcut ? " is-current" : ""}`}
                  disabled={(!kayit && !olusturulabilir) || mevcut}
                  key={adim}
                  onClick={() => kayit ? void detayAc(kayit.id) : olusturulabilir && hedefAdim && void donusumOzetiAc(detay.id, hedefAdim)}
                  type="button"
                >
                  <span>{kayit ? "✓" : ""}</span>
                  <strong>{TUR_ADI[adim]}</strong>
                  <small>{mevcut ? "Mevcut" : kayit?.no ?? (kayit ? "Taslak" : olusturulabilir ? "Oluştur" : "Bekliyor")}</small>
                </button>
              );
            })}
            {detay.fatura ? (
              <a className="document-timeline__step is-complete" href={"/panel/fatura?faturaId=" + detay.fatura.id}>
                <span>✓</span><strong>Fatura</strong><small>{detay.fatura.no ?? "Taslak"}</small>
              </a>
            ) : (
              <button
                className="document-timeline__step"
                disabled={detay.durum !== "onaylandi" || !DONUSUM[detay.tur]?.includes("fatura")}
                onClick={() => void donusumOzetiAc(detay.id, "fatura")}
                type="button"
              >
                <span /><strong>Fatura</strong><small>{detay.durum === "onaylandi" && DONUSUM[detay.tur]?.includes("fatura") ? "Oluştur" : "Bekliyor"}</small>
              </button>
            )}
            {detay.fatura?.ebelge ? (
              <a className={"document-timeline__step" + ebelgeZincirSinifi(detay.fatura.ebelge.durum)} href={"/panel/fatura?faturaId=" + detay.fatura.id + "&panel=ebelge"}>
                <span>{detay.fatura.ebelge.durum === "kabul" ? "✓" : ""}</span><strong>e-Belge</strong><small>{EBELGE_DURUM_ADI[detay.fatura.ebelge.durum] ?? detay.fatura.ebelge.durum}</small>
              </a>
            ) : (
              <div className="document-timeline__step" aria-disabled="true"><span /><strong>e-Belge</strong><small>{detay.fatura ? "Hazırlanıyor" : "Bekliyor"}</small></div>
            )}
            {detay.tur === "irsaliye" && <div className={"document-timeline__step" + (detay.eirsaliye?.durum === "kabul" ? " is-complete" : detalleDurumSinifi(detay.eirsaliye?.durum))}><span>{detay.eirsaliye?.durum === "kabul" ? "✓" : ""}</span><strong>e-İrsaliye</strong><small>{detay.eirsaliye ? (EBELGE_DURUM_ADI[detay.eirsaliye.durum] ?? detay.eirsaliye.durum) : "Gönderilmedi"}</small></div>}
            {detay.fatura ? (
              <a className={"document-timeline__step" + odemeZincirSinifi(detay.fatura.odemeOzeti.durum)} href={"/panel/fatura?faturaId=" + detay.fatura.id + "&panel=odeme"}>
                <span>{detay.fatura.odemeOzeti.durum === "odendi" ? "✓" : ""}</span><strong>Tahsilat/Ödeme</strong><small>{ODEME_DURUM_ADI[detay.fatura.odemeOzeti.durum] ?? detay.fatura.odemeOzeti.durum}</small>
              </a>
            ) : (
              <div className="document-timeline__step" aria-disabled="true"><span /><strong>Tahsilat/Ödeme</strong><small>Bekliyor</small></div>
            )}
          </div>
          {detay.tur === "irsaliye" && (
            <p className="muted" style={{ margin: "0 0 1rem", fontSize: "0.85rem" }}>
              Sevkiyat: {detay.tasiyiciCariId ? (cariler.find((c) => c.id === detay.tasiyiciCariId)?.unvan ?? "Taşıyıcı cari") : "Kendi aracımızla"}
              {" · "}Plaka {detay.plaka || "—"}
              {" · "}Şoför {[detay.soforAdi, detay.soforSoyadi].filter(Boolean).join(" ") || "—"}
              {detay.fiiliSevkZamani ? ` · Fiili sevk ${new Date(detay.fiiliSevkZamani).toLocaleString("tr-TR")}` : ""}
              {/* EBLG-74: belgeyle giden sipariş referansı; boşsa zincirdeki sipariş yazılır. */}
              {detay.siparisNo ? ` · Sipariş ${detay.siparisNo}${detay.siparisTarihi ? ` (${new Date(detay.siparisTarihi).toLocaleDateString("tr-TR")})` : ""}` : ""}
              {detay.idisSevkiyatNo ? ` · İDİS sevkiyat ${detay.idisSevkiyatNo}` : ""}
              {detay.teslimatAdres ? ` · ${detay.gumrukDepoSevki ? "Boşaltma" : "Teslimat"} ${detay.teslimatAdres}, ${[detay.teslimatIlce, detay.teslimatIl].filter(Boolean).join(" / ")} ${detay.teslimatPostaKodu ?? ""}` : ""}
              {detay.gumrukDepoSevki && detay.yuklemeAdres ? ` · Yükleme ${detay.yuklemeAdres}, ${[detay.yuklemeIlce, detay.yuklemeIl].filter(Boolean).join(" / ")} ${detay.yuklemePostaKodu ?? ""}` : ""}
            </p>
          )}
          {/* EBLG-87: e-İrsaliyeye yazılan açıklama; sefer numarası onayda verilir. */}
          {detay.tur === "irsaliye" && detay.gumrukDepoSevki && (
            <p className="muted" style={{ margin: "0 0 1rem", fontSize: "0.85rem" }}>
              <Badge variant="info">Gümrükten depoya sevk</Badge>{" "}
              {detay.gumrukBeyannameNo && detay.gumrukBeyannameTarihi && detay.gumrukSeferNo
                ? gumrukSeferNotu({ beyannameNo: detay.gumrukBeyannameNo, beyannameTarihi: detay.gumrukBeyannameTarihi, seferNo: detay.gumrukSeferNo })
                : `Beyanname ${detay.gumrukBeyannameNo ?? "girilmedi"}; sefer numarası onayda verilir.`}
            </p>
          )}
          {/* FTR-27 / EBLG-83: tedarikçinin ya da matbu irsaliyenin numarası onaydan sonra da girilir (kâğıt irsaliye elden gelir). */}
          {(() => {
            const alan = disNumaraAlani(detay);
            if (!alan) return null;
            const deger = detay[alan.alan] ?? null;
            return (
              <div className="row-tight" style={{ margin: "0 0 1rem", fontSize: "0.85rem" }}>
                {detay.kagitIrsaliye && <Badge variant="warning">Kâğıt irsaliye</Badge>}
                {disNoTaslak === null ? (
                  <>
                    <span className="muted">{alan.etiket}: {deger || "girilmedi"}</span>
                    {detay.durum !== "iptal" && <Button size="sm" type="button" onClick={() => setDisNoTaslak(deger ?? "")}>Düzenle</Button>}
                  </>
                ) : (
                  <>
                    <Input aria-label={alan.etiket} value={disNoTaslak} maxLength={50} onChange={(e) => setDisNoTaslak(e.target.value)} />
                    <Button size="sm" variant="primary" type="button" onClick={() => void disNoKaydet(detay.id, alan)}>Kaydet</Button>
                    <Button size="sm" type="button" onClick={() => setDisNoTaslak(null)}>Vazgeç</Button>
                  </>
                )}
              </div>
            );
          })()}
          {/* EBLG-85: GİB'e iletilmiş e-İrsaliyenin çıktısı; kayıtlı olmayan alıcıya bu verilir. */}
          {firmaGonderir(detay) && detay.eirsaliye && detay.eirsaliye.durum !== "hata" && (
            <div className="row-tight" style={{ margin: "0 0 1rem", fontSize: "0.85rem" }}>
              {detay.eirsaliye.aliciKayitsiz && <Badge variant="warning">Alıcı e-İrsaliye kullanıcısı değil</Badge>}
              {detay.eirsaliye.aliciKayitsiz && <span className="muted">Belge alıcıya GİB üzerinden ulaşmaz; çıktısını verin ya da e-postayla iletin. Alıcı yanıt veremez.</span>}
              <Button size="sm" type="button" onClick={() => void apiPdfAc(`/ebelge/irsaliye/giden/${detay.id}/pdf`).catch((h: unknown) => setHata(h instanceof Error ? h.message : "e-İrsaliye çıktısı açılamadı"))}>🖨 e-İrsaliye çıktısı</Button>
            </div>
          )}
          {firmaGonderir(detay) && detay.eirsaliye?.durum === "hata" && <div className="row-tight" style={{ margin: "0 0 1rem" }}><span className="muted">{detay.eirsaliye.hataMesaji ?? "Gönderim başarısız."}{detay.eirsaliye.geciciHata && (detay.eirsaliye.yenidenDenemeSayisi ?? 0) < 3 ? ` Geçici bir hata; aynı numarayla kendiliğinden yeniden denenecek (${detay.eirsaliye.yenidenDenemeSayisi ?? 0}/3).` : ""}</span><Button size="sm" variant="primary" onClick={() => void eirsaliyeGonder(detay.id)}>Tekrar gönder</Button></div>}
          {/* EBLG-35: e-İrsaliye ve bağlı fatura durum geçmişi; durum değiştikçe yeniden yüklenir. */}
          {(detay.eirsaliye || detay.fatura) && (
            <DurumGecmisi
              key={`${detay.id}-${detay.eirsaliye?.durum ?? ""}-${detay.fatura?.durum ?? ""}-${detay.fatura?.ebelge?.durum ?? ""}`}
              adres={`/belgeler/${detay.id}/durum-gecmisi`}
              // Şerit yalnız e-İrsaliye gönderilmiş irsaliyede anlamlı; teklif
              // ve siparişin resmi bir e-Belge akışı yoktur.
              // EBLG-90: programda iptal GİB'deki belgeyi iptal etmez; şerit GİB durumunu gösterir.
              akis={detay.tur === "irsaliye" && detay.eirsaliye ? { tur: "eirsaliye", durum: detay.eirsaliye.durum } : undefined}
            />
          )}
          {detay.tur === "irsaliye" && detay.durum === "iptal" && detay.eirsaliye && (
            (GIB_ULASMIS_EIRSALIYE_DURUMLARI as readonly string[]).includes(detay.eirsaliye.durum) ? (
              <p className="muted" style={{ margin: "0 0 1rem", fontSize: "0.85rem" }}>
                <Badge variant="warning">GİB'de geçerli — programda iptal</Badge>{" "}
                {detay.eirsaliye.aliciKayitsiz ? "Alıcı sistemden reddedemez; gerekirse iptali yazılı (KEP, noter) bildirin." : "Alıcı reddi bekleniyor; alıcıdan RET yanıtı vermesini isteyin."}
              </p>
            ) : detay.eirsaliye.durum === "ret" ? (
              <p className="muted" style={{ margin: "0 0 1rem", fontSize: "0.85rem" }}><Badge variant="neutral">Alıcı reddetti — belge GİB'de geçersiz</Badge></p>
            ) : null
          )}
          <TableWrap>
            <thead>
              <tr><th>Ürün</th><th className="num">Miktar</th>{detay.tur === "siparis" && <><th className="num">Teslim</th><th className="num">Kalan</th></>}<th className="num">Birim Fiyat</th><th className="num">İskonto %</th><th className="num">KDV %</th></tr>
            </thead>
            <tbody>
              {detay.satirlar.map((s, i) => {
                const st = stoklar.find((x) => x.id === s.stokId);
                return (
                  <tr key={i}>
                    <td>
                      {st ? `${st.ad} (${st.kod})` : s.stokId}
                      {/* EBLG-72: onaylı belgede etiket düzenlenemez ama belgeyle giden numara görünmelidir. */}
                      {s.idisEtiketNo && <small className="muted"> · İDİS etiket {s.idisEtiketNo}</small>}
                    </td>
                    <td className="num">{Number(s.miktar).toLocaleString("tr-TR")} {s.birim}</td>
                    {/* SAT-09/10: siparişin ne kadarı teslim edildi, ne kadarı bekliyor */}
                    {detay.tur === "siparis" && <>
                      <td className="num">{Number(s.teslimEdilenMiktar ?? 0).toLocaleString("tr-TR")}</td>
                      <td className="num">{Number(s.kalanMiktar ?? s.miktar) > 0 ? <strong>{Number(s.kalanMiktar ?? s.miktar).toLocaleString("tr-TR")}</strong> : "—"}</td>
                    </>}
                    <td className="num">{tl(s.birimFiyat, detay.dovizCinsi)}</td>
                    <td className="num">%{Number(s.iskontoOrani)}</td>
                    <td className="num">%{Number(s.kdvOrani)}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          {/* SAT-10: hangi irsaliye, ne zaman, ne kadar teslim etti */}
          {detay.tur === "siparis" && (detay.teslimatlar?.length ?? 0) > 0 && (
            <section aria-label="Teslim geçmişi">
              <h3>Teslim geçmişi</h3>
              <TableWrap>
                <thead>
                  <tr><th>İrsaliye</th><th>Tarih</th><th>Durum</th><th>Teslim edilenler</th></tr>
                </thead>
                <tbody>
                  {detay.teslimatlar?.map((t) => (
                    <tr key={t.id}>
                      <td><Button size="sm" type="button" onClick={() => void detayAc(t.id)}>{t.no ?? "Taslak irsaliye"}</Button></td>
                      <td>{t.tarih}</td>
                      <td>{durumRozet(t.durum)}</td>
                      <td>{t.kalemler.map((k) => `${k.stokKod}: ${Number(k.miktar).toLocaleString("tr-TR")} ${k.birim}`).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </section>
          )}
        </Card>
      )}

      {baglaPaneli && (
        <IrsaliyeBaglaPaneli
          kaynak={{ irsaliyeId: baglaPaneli }}
          onKapat={() => setBaglaPaneli(null)}
          onBaglandi={(mesaj) => { const id = baglaPaneli; setBaglaPaneli(null); setHata(""); setBasari(mesaj); void detayAc(id); void yukle(); }}
        />
      )}

      {tasimaPaneli && (
        <TasimaBilgisiPaneli
          belgeId={tasimaPaneli.id}
          belgeNo={tasimaPaneli.no}
          onKapat={() => setTasimaPaneli(null)}
          onKaydedildi={(mesaj) => { const id = tasimaPaneli.id; setTasimaPaneli(null); setHata(""); setBasari(mesaj); void detayAc(id); void yukle(); }}
        />
      )}

      {iptalUyarisi && (
        <HizliKayitPaneli baslik="İrsaliyeyi programda iptal et" onKapat={() => setIptalUyarisi(null)}>
          <Alert tone="warning">{iptalUyarisi.metin}</Alert>
          <div className="quick-panel__actions">
            <Button type="button" onClick={() => setIptalUyarisi(null)}>Vazgeç</Button>
            <Button type="button" variant="danger" onClick={() => void gibUyarisiylaIptal()}>Anladım, iptal et</Button>
          </div>
        </HizliKayitPaneli>
      )}

      {onayBekleyen && (
        <HizliKayitPaneli baslik="Belgeyi onayla" onKapat={() => setOnayBekleyen(null)}>
          <div className="approval-summary">
            <div className="approval-summary__identity">
              <strong>{TUR_ADI[onayBekleyen.tur]} · {YON_ADI[onayBekleyen.yon]}</strong>
              <span>{onayBekleyen.cari.unvan}</span>
            </div>
            <dl>
              <div><dt>Kalem</dt><dd>{onayBekleyen.satirlar.length}</dd></div>
              <div><dt>Toplam miktar</dt><dd>{onayBekleyen.satirlar.reduce((toplam, satir) => toplam + Number(satir.miktar), 0).toLocaleString("tr-TR")}</dd></div>
              <div><dt>Genel toplam</dt><dd>{tl(onayBekleyen.genelToplam, onayBekleyen.dovizCinsi)}</dd></div>
            </dl>
            <div className="approval-impact">
              {onayBekleyen.tur === "siparis" && onayBekleyen.yon === "satis" && "Onayla birlikte ürün miktarları seçilen depoda rezerve edilecek."}
              {onayBekleyen.tur === "siparis" && onayBekleyen.yon === "alis" && "Onayla birlikte ürün miktarları seçilen depo için yoldaki stok olarak işaretlenecek."}
              {onayBekleyen.tur === "teklif" && "Teklif numara alacak; stok ve cari bakiyesi değişmeyecek."}
              {onayBekleyen.tur === "irsaliye" && firmaGonderir(onayBekleyen) && onayBekleyen.gumrukDepoSevki && "Aynı beyannamenin sefer numarası onayda verilir. "}
              {onayBekleyen.tur === "irsaliye" && (firmaGonderir(onayBekleyen)
                ? "Firma e-İrsaliye kullanıcısıysa numara e-İrsaliye gönderiminde verilir; değilse kâğıt irsaliye olarak iç seriden numaralanır. Stok ve cari etkisi fatura kesinleştiğinde oluşacak."
                : "İrsaliye iç seriden numara alacak; stok ve cari etkisi fatura kesinleştiğinde oluşacak.")}
            </div>
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setOnayBekleyen(null)}>Vazgeç</Button>
              <Button type="button" variant="primary" onClick={() => void onayiTamamla()}>Onayla</Button>
            </div>
          </div>
        </HizliKayitPaneli>
      )}

      {donusumBekleyen && (
        <HizliKayitPaneli baslik="Belgeyi dönüştür" onKapat={() => setDonusumBekleyen(null)}>
          <div className="approval-summary">
            <div className="approval-summary__identity">
              <strong>{TUR_ADI[donusumBekleyen.belge.tur]} {donusumBekleyen.belge.no} → {donusumBekleyen.hedef === "fatura" ? "Fatura" : TUR_ADI[donusumBekleyen.hedef]}</strong>
              <span>{donusumBekleyen.belge.cari.unvan}</span>
            </div>
            <dl>
              <div><dt>Aktarılacak kalem</dt><dd>{kismiTeslimVar(donusumBekleyen.belge, donusumBekleyen.hedef) ? Object.values(teslimMiktarlari).filter((m) => Number(m) > 0).length : donusumBekleyen.belge.satirlar.length}</dd></div>
              <div><dt>Genel toplam</dt><dd>{tl(donusumBekleyen.belge.genelToplam, donusumBekleyen.belge.dovizCinsi)}</dd></div>
              <div><dt>Kaynak referansı</dt><dd>{donusumBekleyen.belge.no ?? "Taslak belge"}</dd></div>
            </dl>
            {/* EBLG-82: fatura bugünün tarihiyle oluşur; süre geçtiyse uyarı, engel değil. */}
            {donusumBekleyen.hedef === "fatura" && donusumBekleyen.belge.faturalamaSuresi?.gecti && (
              <Alert tone="warning">
                {donusumBekleyen.belge.yon === "satis"
                  ? `Fatura, ${donusumBekleyen.belge.no} irsaliyesinin faturalama süresinden sonra düzenleniyor (son gün ${gunTRBicim(donusumBekleyen.belge.faturalamaSuresi.sonGun)}). Süresinde düzenlenmeyen fatura hiç düzenlenmemiş sayılır; yine de kesilmesi gerekir.`
                  : `Tedarikçi faturası ${donusumBekleyen.belge.no} irsaliyesinin faturalama süresinden sonra geliyor (son gün ${gunTRBicim(donusumBekleyen.belge.faturalamaSuresi.sonGun)}).`}
              </Alert>
            )}
            {/* SAT-10: teslim edilen miktar satır başına girilir; kalanı biten satır listede yer almaz. */}
            {kismiTeslimVar(donusumBekleyen.belge, donusumBekleyen.hedef) && (
              <TableWrap>
                <thead>
                  <tr><th>Ürün</th><th className="num">Sipariş</th><th className="num">Kalan</th><th className="num">Teslim edilecek</th></tr>
                </thead>
                <tbody>
                  {donusumBekleyen.belge.satirlar.filter((s) => Number(s.kalanMiktar ?? s.miktar) > 0).map((s) => {
                    const st = stoklar.find((x) => x.id === s.stokId);
                    const kalan = Number(s.kalanMiktar ?? s.miktar);
                    const girilen = Number(teslimMiktarlari[s.id] ?? 0);
                    return (
                      <tr key={s.id}>
                        <td>{st ? `${st.ad} (${st.kod})` : s.stokId}</td>
                        <td className="num">{Number(s.miktar).toLocaleString("tr-TR")} {s.birim}</td>
                        <td className="num">{kalan.toLocaleString("tr-TR")}</td>
                        <td className="num">
                          <Input
                            aria-label={`${st?.ad ?? "Satır"} için teslim miktarı`}
                            aria-invalid={girilen > kalan}
                            max={kalan}
                            min={0}
                            step="0.001"
                            type="number"
                            value={teslimMiktarlari[s.id] ?? ""}
                            onChange={(e) => setTeslimMiktarlari((onceki) => ({ ...onceki, [s.id]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
            <div className="approval-impact">
              {kismiTeslimVar(donusumBekleyen.belge, donusumBekleyen.hedef)
                ? "Girilen miktarlar için taslak irsaliye oluşturulacak. Kalanı olan sipariş açık kalır ve sonraki teslimlerde yeniden dönüştürülebilir; stok etkisi fatura kesinleştiğinde oluşur."
                : "Cari, belge kalemleri, fiyatlar, iskontolar, vergiler ve kaynak belge referansı yeni taslağa aktarılacak. Kaynak belge kapatılacak."}
            </div>
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setDonusumBekleyen(null)}>Vazgeç</Button>
              <Button type="button" variant="primary" onClick={() => void donusumuTamamla()}>Dönüştür</Button>
            </div>
          </div>
        </HizliKayitPaneli>
      )}

      <section className="saved-view-bar" aria-label="Belge görünümü ve filtreleri">
        <div className="saved-view-filters">
          <Field label="Yön" htmlFor="belge-yon-filtresi"><Select id="belge-yon-filtresi" value={yonBaglami ?? ""} onChange={(e) => gorunumuUygula({ tur: turFiltre, yon: (e.target.value || null) as Yon | null, durum: durumFiltresi })}><option value="">Tümü</option><option value="satis">Satış</option><option value="alis">Satın alma</option></Select></Field>
          <Field label="Belge durumu" htmlFor="belge-durum-filtresi"><Select id="belge-durum-filtresi" value={durumFiltresi ?? ""} onChange={(e) => gorunumuUygula({ tur: turFiltre, yon: yonBaglami, durum: e.target.value || null })}><option value="">Tümü</option><option value="taslak">Taslak</option><option value="onaylandi">Onaylı</option><option value="kismen_kapandi">Kısmen teslim</option><option value="onaylandi,kismen_kapandi">Teslim bekleyen</option><option value="kapandi">Kapandı</option><option value="iptal">İptal</option><option value={FATURA_BEKLEYEN}>Faturalanmayı bekleyen irsaliye</option></Select></Field>
          <Field label="Başlangıç tarihi"><Input aria-label="Başlangıç tarihi" type="date" value={tarihBaslangic} onChange={(e) => tarihFiltresiDegistir("baslangic", e.target.value)} /></Field>
          <Field label="Bitiş tarihi"><Input aria-label="Bitiş tarihi" type="date" min={tarihBaslangic || undefined} value={tarihBitis} onChange={(e) => tarihFiltresiDegistir("bitis", e.target.value)} /></Field>
          <Field label="Kaydedilmiş görünüm"><Select aria-label="Kaydedilmiş görünüm" value="" onChange={(e) => { const gorunum = kayitliGorunumler.find((g) => g.id === e.target.value); if (gorunum) kayitliGorunumuUygula(gorunum); }}><option value="">Görünüm seçin</option>{kayitliGorunumler.map((g) => <option value={g.id} key={g.id}>{g.ad}</option>)}</Select></Field>
        </div>
        <div className="saved-view-actions">
          {(turFiltre !== "tumu" || yonBaglami || durumFiltresi || tarihBaslangic || tarihBitis) && <Button size="sm" type="button" onClick={tumFiltreleriTemizle}>Filtreleri temizle</Button>}
          <Button size="sm" type="button" onClick={() => setGorunumFormuAcik((acik) => !acik)}>Görünümü kaydet</Button>
        </div>
        {gorunumFormuAcik && <form className="saved-view-form" onSubmit={gorunumKaydet}><Input autoFocus aria-label="Görünüm adı" value={gorunumAdi} onChange={(e) => setGorunumAdi(e.target.value)} placeholder="Örn. Onay bekleyen satış siparişleri" required /><Button size="sm" variant="primary" type="submit">Kaydet</Button><Button size="sm" type="button" onClick={() => setGorunumFormuAcik(false)}>Vazgeç</Button></form>}
        {kayitliGorunumler.length > 0 && <div className="saved-view-list" aria-label="Kaydedilmiş görünümleri yönet">{kayitliGorunumler.map((g) => <span key={g.id}><button type="button" onClick={() => kayitliGorunumuUygula(g)}>{g.ad}</button><button aria-label={g.ad + " görünümünü sil"} title="Görünümü sil" type="button" onClick={() => gorunumSil(g.id)}>×</button></span>)}</div>}
      </section>

      <div className="toolbar">
        <SearchInput className="grow" value={arama} onChange={(e) => { setSecili(new Set()); setArama(e.target.value); }} placeholder="Belge no veya cari ile ara..." />
        <Button type="button" onClick={csvIndir} disabled={gorunen.length === 0}>CSV dışa aktar</Button>
        <Segmented<TurFiltre>
          value={turFiltre}
          onChange={(deger) => { setSecili(new Set()); setTurFiltre(deger); }}
          items={[
            { deger: "tumu", baslik: "Tümü" },
            { deger: "teklif", baslik: "Teklif" },
            { deger: "siparis", baslik: "Sipariş" },
            { deger: "irsaliye", baslik: "İrsaliye" },
          ]}
        />
      </div>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th style={{ width: 36 }}><input aria-label="Faturalanabilir belgelerin tümünü seç" aria-checked={gorunenSecimKismi ? "mixed" : gorunenlerinTumuSecili} ref={tumunuSecRef} type="checkbox" checked={gorunenlerinTumuSecili} disabled={topluFaturaYukleniyor || gorunenFaturalanabilir.length === 0 || !gorunenTopluSecimeUygun} title={!gorunenTopluSecimeUygun ? "Toplu seçim için cari, döviz, kur, yön ve depo filtresini daraltın" : undefined} onChange={gorunenlerinSeciminiDegistir} /></th>
              <th>Belge No</th>
              <th>Tür / Yön</th>
              <th>Cari</th>
              <th>Tarih</th>
              <th className="num">Genel Toplam</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {listeYukleniyor && belgeler.length === 0 ? (
              <tr><td colSpan={7} className="empty" role="status">Belgeler yükleniyor…</td></tr>
            ) : hata && belgeler.length === 0 ? (
              <tr><td colSpan={7} className="empty">
                <div className="stack" role="alert"><span>Belge listesi yüklenemedi.</span><div><Button type="button" onClick={() => void yukle()}>Tekrar dene</Button></div></div>
              </td></tr>
            ) : gorunen.length === 0 ? (
              <tr><td colSpan={7} className="empty">{arama || turFiltre !== "tumu" || yonBaglami || durumFiltresi || tarihBaslangic || tarihBitis ? "Filtrelere uygun belge bulunamadı." : "Kayıtlı belge bulunmuyor."}</td></tr>
            ) : (
              gorunen.map((b) => (
                <tr
                  key={b.id}
                  className="row-link"
                  tabIndex={0}
                  aria-label={`${TUR_ADI[b.tur]} ${b.no || "Taslak"} belgesini aç`}
                  onClick={() => void detayAc(b.id)}
                  onKeyDown={(olay) => { if (olay.target === olay.currentTarget && (olay.key === "Enter" || olay.key === " ")) { olay.preventDefault(); void detayAc(b.id); } }}
                >
                  <td className="center" onClick={(olay) => olay.stopPropagation()}>
                    {faturalanabilir(b) && (
                      <input aria-label={(b.no ?? "Taslak") + " belgesini seç"} type="checkbox" checked={secili.has(b.id)} disabled={topluFaturaYukleniyor || Boolean(secimUyumlulukAnahtari && faturaUyumlulukAnahtari(b) !== secimUyumlulukAnahtari)} onChange={() => seciliDegistir(b.id)} title={secimUyumlulukAnahtari && faturaUyumlulukAnahtari(b) !== secimUyumlulukAnahtari ? "Seçilen belgeler aynı cari, döviz, kur, yön ve depoda olmalıdır" : "Toplu faturalama için seç"} />
                    )}
                  </td>
                  <td style={{ fontWeight: 700 }}>{belgeNoGoster(b)}{b.tedarikciBelgeNo && <small className="muted" style={{ display: "block", fontWeight: 400 }}>Tedarikçi no {b.tedarikciBelgeNo}</small>}{b.matbuBelgeNo && <small className="muted" style={{ display: "block", fontWeight: 400 }}>Matbu no {b.matbuBelgeNo}</small>}</td>
                  <td>{TUR_ADI[b.tur]} · {YON_ADI[b.yon]}</td>
                  <td>{b.cari.unvan}</td>
                  <td>{b.tarih}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{tl(b.genelToplam, b.dovizCinsi)}</td>
                  <td><span style={{ display: "inline-flex", gap: "0.3rem", flexWrap: "wrap" }}>{durumRozet(b.durum)}{sureRozeti(b.faturalamaSuresi)}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
        {sonrakiImlec && (
          <div style={{ padding: "1rem", textAlign: "center" }}>
            <Button type="button" onClick={() => void yukle(sonrakiImlec)} disabled={listeYukleniyor}>
              {listeYukleniyor ? "Yükleniyor…" : "Daha fazla yükle"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
