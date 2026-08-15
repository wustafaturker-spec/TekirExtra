"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiHata, tokenAl, tumSayfalariAl } from "@/lib/api";
import { kullanimOlayi } from "@/lib/kullanim";
import { AramaSecici } from "@/components/arama-secici";
import { DepoSecici } from "@/components/depo-secici";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { BelgeDosyalari, belgeDosyalariniYukle } from "@/components/belge-dosyalari";
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
  SearchInput,
  Segmented,
  Select,
  TableWrap,
} from "@/components/ui";

const TUR_ADI: Record<string, string> = { teklif: "Teklif", siparis: "Sipariş", irsaliye: "İrsaliye" };
const YON_ADI: Record<string, string> = { satis: "Satış", alis: "Alış" };
const EBELGE_DURUM_ADI: Record<string, string> = { kuyrukta: "Kuyrukta", iletildi: "İletildi", kabul: "Kabul edildi", ret: "Reddedildi", hata: "Hata" };
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
  lotNo?: string; seriNolar?: string; sonKullanmaTarihi?: string; uretimTarihi?: string;
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
  eirsaliye?: { durum: string; entegratorRef?: string | null; hataMesaji?: string | null } | null;
}

interface ZincirRef { id: string; tur: string; no: string | null; durum: string }
interface BelgeDetay extends Belge {
  gecerlilikTarihi: string | null;
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
  satirlar: { stokId: string; miktar: string; birim: string; birimFiyat: string; iskontoOrani: string; kdvOrani: string }[];
}

const tl = (d: string | number, doviz = "TL"): string =>
  Number(d).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " " + doviz;
const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
function csvHucre(deger: string | number | null): string {
  return "\"" + String(deger ?? "").replaceAll("\"", "\"\"") + "\"";
}

function durumRozet(durum: string) {
  if (durum === "taslak") return <Badge variant="warning">📝 Taslak</Badge>;
  if (durum === "onaylandi") return <Badge variant="info">✅ Onaylı</Badge>;
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
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [topluFaturaYukleniyor, setTopluFaturaYukleniyor] = useState(false);
  const [olusanFaturaId, setOlusanFaturaId] = useState<string | null>(null);
  const [yonBaglami, setYonBaglami] = useState<Yon | null>(null);
  const [onayBekleyen, setOnayBekleyen] = useState<BelgeDetay | null>(null);
  const [donusumBekleyen, setDonusumBekleyen] = useState<{ belge: BelgeDetay; hedef: "siparis" | "irsaliye" | "fatura" } | null>(null);
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
  const [depoId, setDepoId] = useState("");
  const [tarih, setTarih] = useState(new Date().toISOString().substring(0, 10));
  const [gecerlilik, setGecerlilik] = useState("");
  const [aciklama, setAciklama] = useState("");
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
      if (durumFiltresi) parametreler.set("durum", durumFiltresi);
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
    setDurumFiltresi(parametreler.get("durum"));
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
  async function satirGuncelle(i: number, alan: keyof BelgeSatirForm, deger: string | number) {
    const yeni = [...satirlar];
    yeni[i] = { ...yeni[i], [alan]: deger };
    if (alan === "stokId") yeni[i].varyantId = undefined;
    if (alan === "stokId" && deger) {
      const stok = stoklar.find((s) => s.id === deger);
      void stok;
      try {
        const t = await api<{ birimFiyat: number; iskontoOrani: number }>(
          `/stok/${deger}/tavsiye-fiyat?cariId=${cariId}&tip=${yon}`,
        );
        yeni[i].birimFiyat = t.birimFiyat;
        yeni[i].iskontoOrani = t.iskontoOrani;
      } catch {
        /* tavsiye alınamazsa manuel */
      }
    }
    setSatirlar(yeni);
  }

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    if (!cariId) { setHata("Lütfen bir cari hesap seçin."); return; }
    if (satirlar.some((s) => !s.stokId)) { setHata("Lütfen tüm satırlarda ürün/hizmet seçin."); return; }
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
          // STK-07: rezerv ve stok etkisi bu depoya işlenir
          depoId: depoId || null,
          dovizCinsi,
          kur: dovizCinsi === "TRY" ? "1" : kur,
          aciklama: kayitAciklamasi || null,
          satirlar: satirlar.map((s) => ({
            stokId: s.stokId,
            varyantId: s.varyantId || null,
            miktar: String(s.miktar),
            birim: "adet",
            birimFiyat: String(s.birimFiyat),
            iskontoOrani: String(s.iskontoOrani),
            kdvOrani: String(s.kdvOrani),
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
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge oluşturulamadı");
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

  async function donustur(id: string, hedef: string) {
    setHata(""); setBasari("");
    try {
      await api(`/belgeler/${id}/donustur`, { method: "POST", body: JSON.stringify({ hedef }) });
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
      void yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "e-İrsaliye gönderilemedi"); }
  }

  async function donusumOzetiAc(id: string, hedef: "siparis" | "irsaliye" | "fatura") {
    setHata("");
    try {
      setDonusumBekleyen({ belge: await api<BelgeDetay>(`/belgeler/${id}`), hedef });
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Dönüşüm özeti yüklenemedi");
    }
  }

  async function donusumuTamamla() {
    if (!donusumBekleyen) return;
    const { belge, hedef } = donusumBekleyen;
    setDonusumBekleyen(null);
    await donustur(belge.id, hedef);
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

  async function detayAc(id: string) {
    setHata("");
    try {
      setDetay(await api<BelgeDetay>(`/belgeler/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge detayı yüklenemedi");
    }
  }

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
    if (durumFiltresi && b.durum !== durumFiltresi) return false;
    if (tarihBaslangic && b.tarih < tarihBaslangic) return false;
    if (tarihBitis && b.tarih > tarihBitis) return false;
    if (!arama) return true;
    const q = arama.toLocaleLowerCase("tr");
    return (b.no ?? "").toLocaleLowerCase("tr").includes(q) || b.cari.unvan.toLocaleLowerCase("tr").includes(q);
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
              </div>
              <Field label="Belge Türü"><Select value={tur} onChange={(e) => setTur(e.target.value as Tur)}><option value="teklif">Teklif</option><option value="siparis">Sipariş</option><option value="irsaliye">İrsaliye</option></Select></Field>
              <Field label="Yön"><Select value={yon} onChange={(e) => setYon(e.target.value as Yon)}><option value="satis">Satış</option><option value="alis">Alış</option></Select></Field>
              <Field label="Tarih"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} required /></Field>
              <Field label="Belge Dövizi"><Select value={dovizCinsi} onChange={(e) => { setDovizCinsi(e.target.value); if (e.target.value === "TRY") setKur("1"); }}><option>TRY</option><option>USD</option><option>EUR</option></Select></Field>
              {dovizCinsi !== "TRY" && <Field label="Kur (1 döviz = TRY)"><Input type="number" min="0.000001" step="0.000001" value={kur} onChange={(e) => { setKur(e.target.value); setKurBilgisi("Manuel kur"); }} required /><small className="muted">{kurBilgisi || "TCMB EVDS kuru yükleniyor…"}</small></Field>}
              <div><DepoSecici deger={depoId} onChange={setDepoId} /></div>
            {tur === "teklif" && (
                <Field label="Geçerlilik Tarihi"><Input type="date" value={gecerlilik} onChange={(e) => setGecerlilik(e.target.value)} /></Field>
            )}
            </div>
          </div>

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
                      {(stokVaryantlari[s.stokId]?.length ?? 0) > 0 && <Select aria-label="Varyant" required value={s.varyantId ?? ""} onChange={(e) => { const yeni = [...satirlar]; yeni[i] = { ...s, varyantId: e.target.value }; setSatirlar(yeni); }}><option value="">Varyant seçin</option>{stokVaryantlari[s.stokId].filter((v) => v.aktif).map((v) => <option key={v.id} value={v.id}>{v.kod} — {v.ad} · Stok {Number(v.mevcutMiktar).toLocaleString("tr-TR")}</option>)}</Select>}
                      {yon === "alis" && (() => { const takip = stoklar.find((x) => x.id === s.stokId)?.takipTipi; return takip && takip !== "yok" ? <div className="stack"><Input aria-label="Lot / Parti No" required placeholder="Lot / Parti No" value={s.lotNo ?? ""} onChange={(e) => void satirGuncelle(i, "lotNo", e.target.value)} />{takip === "seri" && <Input aria-label="Seri numaraları" required placeholder="Seri numaraları (virgülle)" value={s.seriNolar ?? ""} onChange={(e) => void satirGuncelle(i, "seriNolar", e.target.value)} />}<Input aria-label="Son kullanma tarihi" type="date" value={s.sonKullanmaTarihi ?? ""} onChange={(e) => void satirGuncelle(i, "sonKullanmaTarihi", e.target.value)} /></div> : null; })()}
                    </td>
                    <td><Input className="document-line-number" aria-label="Miktar" type="number" min="0.01" step="any" inputMode="decimal" value={s.miktar} onChange={(e) => satirGuncelle(i, "miktar", Number(e.target.value))} required /></td>
                    <td><Input className="document-line-number" aria-label="Birim fiyat" type="number" min="0" step="any" inputMode="decimal" value={s.birimFiyat} onChange={(e) => satirGuncelle(i, "birimFiyat", Number(e.target.value))} required /></td>
                    <td><Input className="document-line-number" aria-label="İskonto yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.iskontoOrani} onChange={(e) => satirGuncelle(i, "iskontoOrani", Number(e.target.value))} /></td>
                    <td><Input className="document-line-number" aria-label="KDV yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.kdvOrani} onChange={(e) => satirGuncelle(i, "kdvOrani", Number(e.target.value))} required /></td>
                    <td className="num document-line-total">{ss ? tl(ss.toplamTutar) : "0,00 TL"}</td>
                    <td className="center"><Button aria-label="Satırı sil" title="Satırı sil" variant="danger" size="sm" type="button" onClick={() => satirSil(i)}>×</Button></td>
                  </tr>
                );
              })}
            </tbody>
            </TableWrap>

            <div className="document-summary-row">
              <Button type="button" onClick={satirEkle}>+ Satır ekle</Button>
              <div className="document-totals">
                <div className="document-total-line"><span>Brüt toplam</span><span>{tl(sonuc.toplamBrut)}</span></div>
                <div className="document-total-line is-tax"><span>KDV toplamı</span><span>{tl(sonuc.toplamKdv)}</span></div>
                <div className="document-total-line is-grand"><span>Genel toplam</span><span>{tl(sonuc.genelToplam)}</span></div>
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
        <Card style={{ marginBottom: "1.5rem", borderColor: "var(--accent)" }}>
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ fontSize: "1.15rem", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {TUR_ADI[detay.tur]} {detay.no || "(Taslak)"} · {YON_ADI[detay.yon]} {durumRozet(detay.durum)}
              </h3>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                {detay.cari.unvan} · {detay.tarih}{detay.gecerlilikTarihi ? ` · Geçerlilik: ${detay.gecerlilikTarihi}` : ""} · {tl(detay.genelToplam, detay.dovizCinsi)}
              </p>
            </div>
            <Button size="sm" onClick={() => setDetay(null)}>✖ Kapat</Button>
          </div>
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
              const olusturulabilir = detay.durum === "onaylandi" && !kayit && hedefAdim !== null && DONUSUM[detay.tur]?.includes(hedefAdim);
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
            {detay.tur === "irsaliye" && <div className={"document-timeline__step" + (detay.eirsaliye?.durum === "kabul" ? " is-complete" : detalleDurumSinifi(detay.eirsaliye?.durum))}><span>{detay.eirsaliye?.durum === "kabul" ? "✓" : ""}</span><strong>e-İrsaliye</strong><small>{detay.eirsaliye ? detay.eirsaliye.durum : "Gönderilmedi"}</small></div>}
            {detay.fatura ? (
              <a className={"document-timeline__step" + odemeZincirSinifi(detay.fatura.odemeOzeti.durum)} href={"/panel/fatura?faturaId=" + detay.fatura.id + "&panel=odeme"}>
                <span>{detay.fatura.odemeOzeti.durum === "odendi" ? "✓" : ""}</span><strong>Tahsilat/Ödeme</strong><small>{ODEME_DURUM_ADI[detay.fatura.odemeOzeti.durum] ?? detay.fatura.odemeOzeti.durum}</small>
              </a>
            ) : (
              <div className="document-timeline__step" aria-disabled="true"><span /><strong>Tahsilat/Ödeme</strong><small>Bekliyor</small></div>
            )}
          </div>
          {detay.tur === "irsaliye" && detay.yon === "satis" && detay.eirsaliye?.durum === "hata" && <div className="row-tight" style={{ margin: "0 0 1rem" }}><span className="muted">{detay.eirsaliye.hataMesaji ?? "Gönderim başarısız."}</span><Button size="sm" variant="primary" onClick={() => void eirsaliyeGonder(detay.id)}>Tekrar gönder</Button></div>}
          <TableWrap>
            <thead>
              <tr><th>Ürün</th><th className="num">Miktar</th><th className="num">Birim Fiyat</th><th className="num">İskonto %</th><th className="num">KDV %</th></tr>
            </thead>
            <tbody>
              {detay.satirlar.map((s, i) => {
                const st = stoklar.find((x) => x.id === s.stokId);
                return (
                  <tr key={i}>
                    <td>{st ? `${st.ad} (${st.kod})` : s.stokId}</td>
                    <td className="num">{Number(s.miktar).toLocaleString("tr-TR")} {s.birim}</td>
                    <td className="num">{tl(s.birimFiyat)}</td>
                    <td className="num">%{Number(s.iskontoOrani)}</td>
                    <td className="num">%{Number(s.kdvOrani)}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
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
              {onayBekleyen.tur === "irsaliye" && "İrsaliye numara alacak; stok ve cari etkisi fatura kesinleştiğinde oluşacak."}
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
              <div><dt>Aktarılacak kalem</dt><dd>{donusumBekleyen.belge.satirlar.length}</dd></div>
              <div><dt>Genel toplam</dt><dd>{tl(donusumBekleyen.belge.genelToplam, donusumBekleyen.belge.dovizCinsi)}</dd></div>
              <div><dt>Kaynak referansı</dt><dd>{donusumBekleyen.belge.no ?? "Taslak belge"}</dd></div>
            </dl>
            <div className="approval-impact">
              Cari, belge kalemleri, fiyatlar, iskontolar, vergiler ve kaynak belge referansı yeni taslağa aktarılacak. Kaynak belge kapatılacak.
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
          <Field label="Belge durumu" htmlFor="belge-durum-filtresi"><Select id="belge-durum-filtresi" value={durumFiltresi ?? ""} onChange={(e) => gorunumuUygula({ tur: turFiltre, yon: yonBaglami, durum: e.target.value || null })}><option value="">Tümü</option><option value="taslak">Taslak</option><option value="onaylandi">Onaylı</option><option value="kapandi">Kapandı</option><option value="iptal">İptal</option></Select></Field>
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
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {listeYukleniyor && belgeler.length === 0 ? (
              <tr><td colSpan={8} className="empty" role="status">Belgeler yükleniyor…</td></tr>
            ) : hata && belgeler.length === 0 ? (
              <tr><td colSpan={8} className="empty">
                <div className="stack" role="alert"><span>Belge listesi yüklenemedi.</span><div><Button type="button" onClick={() => void yukle()}>Tekrar dene</Button></div></div>
              </td></tr>
            ) : gorunen.length === 0 ? (
              <tr><td colSpan={8} className="empty">{arama || turFiltre !== "tumu" || yonBaglami || durumFiltresi || tarihBaslangic || tarihBitis ? "Filtrelere uygun belge bulunamadı." : "Kayıtlı belge bulunmuyor."}</td></tr>
            ) : (
              gorunen.map((b) => (
                <tr key={b.id}>
                  <td className="center">
                    {faturalanabilir(b) && (
                      <input aria-label={(b.no ?? "Taslak") + " belgesini seç"} type="checkbox" checked={secili.has(b.id)} disabled={topluFaturaYukleniyor || Boolean(secimUyumlulukAnahtari && faturaUyumlulukAnahtari(b) !== secimUyumlulukAnahtari)} onChange={() => seciliDegistir(b.id)} title={secimUyumlulukAnahtari && faturaUyumlulukAnahtari(b) !== secimUyumlulukAnahtari ? "Seçilen belgeler aynı cari, döviz, kur, yön ve depoda olmalıdır" : "Toplu faturalama için seç"} />
                    )}
                  </td>
                  <td style={{ fontWeight: 700 }}>{b.no || "(Taslak)"}</td>
                  <td>{TUR_ADI[b.tur]} · {YON_ADI[b.yon]}</td>
                  <td>{b.cari.unvan}</td>
                  <td>{b.tarih}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{tl(b.genelToplam, b.dovizCinsi)}</td>
                  <td>{durumRozet(b.durum)}</td>
                  <td className="center">
                    <div className="row-tight" style={{ flexWrap: "nowrap", justifyContent: "center" }}>
                      <Button aria-label="Belge detayını aç" title="Belge detayını aç" size="sm" onClick={() => detayAc(b.id)}>🔍</Button>
                      {b.durum === "taslak" && (
                        <>
                          <Button variant="primary" size="sm" onClick={() => void onayOzetiAc(b.id)}>Onayla</Button>
                          <Button variant="danger" size="sm" onClick={() => sil(b.id)}>Sil</Button>
                        </>
                      )}
                      {b.durum === "onaylandi" && (
                        <>
                          {DONUSUM[b.tur]?.map((h) => (
                            <Button key={h} size="sm" onClick={() => void donusumOzetiAc(b.id, h)}>→ {h === "fatura" ? "Fatura" : TUR_ADI[h]}</Button>
                          ))}
                          <Button size="sm" onClick={() => eylem(b.id, "iptal", "Belge iptal edildi.")}>İptal</Button>
                          {b.tur === "irsaliye" && b.yon === "satis" && <Button size="sm" variant="primary" onClick={() => void eirsaliyeGonder(b.id)}>e-İrsaliye</Button>}
                        </>
                      )}
                      <Button size="sm" onClick={() => pdfAc(b.id)}>🖨</Button>
                      <Button size="sm" onClick={() => eylem(b.id, "kopyala", "Belge kopyalandı (taslak).")}>📋</Button>
                    </div>
                  </td>
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
