"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BOS_ILGILI_KISI, IlgiliKisiAlanlari, ilgiliKisiGovdesi, type IlgiliKisiDegeri } from "@/components/ilgili-kisi-alanlari";
import { api, apiPdfAc, tokenAl, tumSayfalariAl } from "@/lib/api";
import { kullanimOlayi } from "@/lib/kullanim";
import { AramaSecici } from "@/components/arama-secici";
import { DepoSecici } from "@/components/depo-secici";
import { BelgeOnizlemeEkrani } from "@/components/belge-onizleme-ekrani";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { BelgeDosyalari, belgeDosyalariniYukle } from "@/components/belge-dosyalari";
import { FaturaEkPaneli } from "@/components/fatura-ek-paneli";
import { IrsaliyeBaglaPaneli } from "@/components/irsaliye-bagla-paneli";
import { UrunSecimModali } from "@/components/urun-secim-modali";
import { DurumGecmisi } from "@/components/durum-gecmisi";
import { bugunTR, faturaHesapla, idisEngelleri, ILAVE_FATURA_TIPLERI, ilaveFaturaTipiBul, sgkEngelleri, SGK_TANIMSIZ_KOD, SGK_VKN, faturaSenaryosuTuret, GIB_KOD_LISTESI_SURUMU, iadeEngelleri, IHRAC_KAYITLI_KODLARI, ihracKayitliHatalari, internetSatisEngelleri, izinliIstisnaKodlari, kamuEngelleri, ODEME_SEKILLERI, OZEL_MATRAH_KODLARI, ozelMatrahHatalari, ozelMatrahKdvsi, ozelMatrahTabani, sarjEngelleri, sarjTuruCoz, SARJ_TURU_ADLARI, YTB_HARCAMA_TIPLERI, YTB_MAKINE_HARCAMA_TIPI, ytbEngelleri, ytbHarcamaTipiBul, SEVKIYAT_YONTEMLERI, sevkiyatEksikleri, irsaliyeYerineIbaresi, type SevkiyatYontemi, senaryoHatalari, senaryoUblKodu, KAP_CINSLERI, kapEksigiVarMi, SIK_KAP_CINSLERI, TASIMA_SEKILLERI, TESLIM_SARTLARI, TEVKIFAT_KODLARI, tevkifatKoduBul, tevkifatPayPayda, type FaturaHesaplaSatirGirdi, type FaturaSenaryosu, ULKELER, yolcuBeraberiEngelleri } from "@tekirextra/shared";
import { zamanAlaniDegeri, zamanAlaniIso, zamanAlaniMetni } from "@/lib/zaman-alani";
import { dovizUyumsuzlugu, fiyatCevir, paraBicimi, paraBirimiEtiketi } from "@/lib/doviz-uyumu";
import { birimKisaAdi } from "@tekirextra/shared";
import { BirimSecimi, birimKatsayisi, SatirBirimi } from "@/components/birim-secimi";
import { BOS_TESLIMAT_ADRESI, faturaTeslimYeriEksik, TeslimatAdresiAlanlari, teslimatAdresiGovdesi, type TeslimatAdresi } from "@/components/teslimat-adresi-alanlari";
import { ebelgeGitmemisMi, ebelgeKullanilmiyor, faturaGecikmeUyarilari, faturaGeriAlmaEngeli, type EbelgeUygulamalari } from "@tekirextra/shared";
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
  EylemCubugu,
  EylemMenusu,
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
  efaturaProfili?: "temel" | "ticari";
}

interface Stok {
  id: string;
  kod: string;
  ad: string;
  barkod?: string | null;
  tedarikciUrunKodlari?: string[];
  anaBirim?: string;
  /** STK-10: satırda seçilebilen ek birimler. */
  birimler?: { ad: string; katsayi: string }[];
  kullanilabilirMiktar?: string;
  alisFiyati: string | null;
  satisFiyati: string | null;
  alisFiyatiDoviz?: string;
  satisFiyatiDoviz?: string;
  kdvOrani: string;
  takipTipi?: "yok" | "lot" | "seri";
  /** EBLG-71: doluysa bu kartı taşıyan fatura şarj faturası olur. */
  sarjTuru?: string | null;
}
interface StokVaryant { id: string; kod: string; ad: string; barkod: string | null; satisFiyati: string | null; alisFiyati: string | null; mevcutMiktar: string; aktif: boolean }
interface Proje { id: string; kod: string; ad: string; durum: string; altKirilimlar?: { id: string; kod: string; ad: string }[] }

interface FaturaSatir {
  stokId: string;
  varyantId?: string;
  miktar: number;
  /** STK-01/10: kartın ana birimi ya da ek birimi; boşsa ana birim. */
  birim?: string;
  birimFiyat: number;
  iskontoOrani: number;
  kdvOrani: number;
  gibIstisnaKodu?: string;
  tevkifatKodu?: string;
  tevkifatOrani?: string;
  projeId?: string;
  projeAltKirilimId?: string;
  /** EBLG-72: İDİS etiket numarası; İDİS belgesinde her satırda zorunlu. */
  idisEtiketNo?: string;
  /** EBLG-78: yatırım teşvik harcama tipi ve makine kimlikleri. */
  ytbHarcamaTipi?: string;
  ytbMakineAdi?: string;
  ytbMakineId?: string;
  ytbMakineSiraNo?: string;
  /** EBLG-71: SARJANLIK faturasında şarj ünitesinin seri numarası. */
  sarjUniteSeriNo?: string;
  lotNo?: string; seriNolar?: string; sonKullanmaTarihi?: string; uretimTarihi?: string;
  /** FTR-28: ürünün fiyatı başka dövizdeydi, fiyat yazılmadı; elle fiyat girilince kalkar. Sunucuya gitmez. */
  dovizUyarisi?: string;
}

interface Fatura {
  id: string;
  no: string | null;
  tip: string;
  dovizCinsi: string;
  tarih: string;
  vadeTarihi?: string | null;
  siparisNo?: string | null;
  siparisTarihi?: string | null;
  /** FTR-31: müşterinin talep referansı; zincirden gelir ya da elle girilir. */
  talepNo?: string | null;
  talepTarihi?: string | null;
  /** FTR-32: müşteri tarafında ilgili kişi. */
  ilgiliKisi?: string | null;
  ilgiliKisiGorevi?: string | null;
  /** FTR-30: teslim yeri; bağlı irsaliyeler farklıysa sunucu uyarı döner. */
  teslimatAdres?: string | null;
  teslimatIl?: string | null;
  teslimatIlce?: string | null;
  teslimatPostaKodu?: string | null;
  teslimYeriUyarisi?: string | null;
  aciklama?: string | null;
  durum: string;
  toplamMatrah: string;
  toplamKdv: string;
  genelToplam: string;
  cari: { unvan: string };
  /** Satırlardan türetilen GİB senaryosu (FTR-16) ve UBL'e yazılan profil (FTR-19). */
  senaryo?: FaturaSenaryosu;
  efaturaProfili?: "temel" | "ticari";
  /** EBLG-60: ihraç kayıtlı satış kodu (701/702); doluysa KDV tahsil edilmez. */
  ihracKayitliKodu?: string | null;
  /** Özel matrah (KDV K. 23): kod, KDV'nin hesaplandığı matrah ve oranı. */
  ozelMatrahKodu?: string | null;
  ozelMatrahTutari?: string | null;
  ozelMatrahOrani?: string | null;
  /** EBLG-72: Darphane bildiriminden dönen sevkiyat no; doluysa belge İDİS kapsamında. */
  idisSevkiyatNo?: string | null;
  ytbNo?: string | null;
  ytbTarihi?: string | null;
  /** Belge e-Arşiv olarak düzenlenirse teslim şekli (EBLG-26). */
  earsivGonderimSekli?: "elektronik" | "kagit";
  /**
   * API iç içe döner; gönderilmemiş faturada null. `durum` zarfın GİB durumu,
   * `aliciYaniti` ise alıcının kabul/ret kararıdır — ikisi ayrı eksendir
   * (EBLG-13): zarf kabul edilmiş olabilir ama alıcı faturayı reddetmiş olabilir.
   */
  /** `takiliGonderim`: gönderim yarım kalmış, yeniden gönderilebilir (EBLG-37). */
  ebelge?: { id: string; durum: string; tur: string; entegratorRef?: string | null; takiliGonderim?: boolean; aliciYaniti?: "kabul" | "ret" | null; aliciYanitZamani?: string | null; aliciYanitNotu?: string | null } | null;
  /** Sunucunun rol ve durum politikası (fatura eylemleri). */
  izinliEylemler?: string[];
  /** EBLG-63: ihraç kayıtlıda malın ihraç edilmesi gereken son gün; beyanname gelince takip biter. */
  ihracKayitliSonTarih?: string | null;
  gumrukBeyannameNo?: string | null;
  odemeOzeti?: { durum: "beklemede" | "odenmedi" | "kismi" | "odendi"; odenen: string; kalan: string };
}

interface FaturaDetay extends Fatura {
  cari: { id: string; kod: string; unvan: string; vknTckn: string | null; eFaturaMukellefi: boolean | null };
  dovizCinsi: string;
  /** EBLG-53/54: ihracat ve gümrük alanları; yurt içi faturada boş. */
  ihracatTeslimTarihi?: string | null;
  ihracatTeslimSarti?: string | null;
  ihracatTasimaSekli?: string | null;
  gumrukBeyannameNo?: string | null;
  gumrukBeyannameTarihi?: string | null;
  notlar?: string | null;
  depoId?: string | null;
  satirlar: { stokId: string; varyantId?: string | null; stokKod: string; stokAd: string; miktar: string; birim: string; birimFiyat: string; iskontoOrani: string; kdvOrani: string; gibIstisnaKodu?: string | null; tevkifatKodu?: string | null; tevkifatOrani?: string | null; idisEtiketNo?: string | null; sarjUniteSeriNo?: string | null; ytbHarcamaTipi?: string | null; ytbMakineAdi?: string | null; ytbMakineId?: string | null; ytbMakineSiraNo?: string | null }[];
  ebelge?: {
    id: string;
    durum: string;
    tur: string;
    entegratorRef: string | null;
    takiliGonderim?: boolean;
    hataMesaji: string | null;
    aliciYaniti?: "kabul" | "ret" | null;
    aliciYanitZamani?: string | null;
    aliciYanitNotu?: string | null;
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
/** L: son adımdaki önizleme; entegratörün önizleme ucu yoksa yalnız kanal kararı gelir. */
type EbelgeOnizleme =
  | { durum: "yukleniyor" }
  | { durum: "hata"; mesaj: string }
  | {
      durum: "hazir";
      tur: "efatura" | "earsiv";
      profil?: string;
      tip?: string;
      destekleniyor: boolean;
      basarili?: boolean;
      html?: string;
      hataMesaji?: string;
    };

interface EbelgeWizardBilgisi {
  /** EBLG-76: sevkiyatın nasıl belgelendiği; yalnız firma e-İrsaliye mükellefiyse sorulur. */
  sevkiyat?: {
    mukellef: boolean | null;
    kaynak: string;
    listeGuncel: boolean;
    gerekli: boolean;
    yontem: string | null;
    fiiliSevkZamani: string | null;
    adaylar: { id: string; no: string | null; tarih: string; faturaId: string | null; sevkGunu?: string }[];
    /** EBLG-82: faturalama süresi ayarı ve bağlı irsaliyelerin gecikme uyarıları. */
    irsaliyeFaturaGunSayisi?: number;
    gecikmeler?: string[];
  };
  gonderilebilir: boolean;
  neden?: string;
  faturaNo?: string | null;
  cari: string;
  vknTckn?: string | null;
  saglayici?: string;
  earsivGonderimSekli?: "elektronik" | "kagit";
  /** EBLG-60: faturada işaretlenen ihraç kayıtlı kodu; sihirbaz yalnız gösterir. */
  ihracKayitliKodu?: string | null;
  /** TCKN'li alıcıda e-Arşiv'e yazılacak ad/soyad; `tahmin` ise kartta girilmemiş (CARI-21). */
  aliciAdi?: { ad: string; soyad: string; tahmin: boolean };
  /** GİB birim kod listesinde karşılığı olmayan satırlar; belgeye adet olarak gider. */
  birimUyarilari?: { sira: number; stok: string; birim: string }[];
  /** EBLG-55: cari kartında adres yok; belgeye il/ilçe "-" gidecek. */
  adresEksik?: boolean;
  /** EBLG-56: internet satışı işareti ve alan grubu; yalnız e-Arşiv kanalında belgeye yazılır. */
  internetSatisi?: {
    isaretli: boolean;
    webAdresi?: string | null;
    odemeSekli?: string | null;
    odemeTarihi?: string | null;
    odemeAracisi?: string | null;
    tasiyiciUnvan?: string | null;
    tasiyiciVkn?: string | null;
    gonderiTarihi?: string | null;
    siparisNo?: string | null;
    siparisTarihi?: string | null;
    teslimatAdresiVar: boolean;
    engeller: { alan: string; mesaj: string }[];
  };
  /**
   * EBLG-53: alıcı yurt dışıysa dolu gelir. Kanal kullanıcıya sorulmaz, cari
   * adresinden türer; sihirbaz kararı gerekçesiyle gösterir ve türe özel
   * alanları toplar.
   */
  ihracat?: {
    ulkeKodu?: string;
    ulkeAdi?: string;
    teslimTarihi?: string | null;
    teslimSarti?: string | null;
    tasimaSekli?: string | null;
    beyannameNo?: string | null;
    /** EBLG-103: kap bilgisi kalem bazında girilir. */
    satirlar: { id: string; sira: number; stokAdi: string; miktar: number; birim: string; kapCinsi: string | null; kapNo: string | null; kapAdet: number | null }[];
    engeller: { alan: string; mesaj: string }[];
    menseiEksikleri: { sira: number; stokAdi: string; mensei: string }[];
  };
  /** EBLG-80: yurt dışı alıcıya e-Arşiv istisna (hizmet ya da e-Fatura kullanmayan firma). */
  yurtDisiEarsiv?: { ulkeKodu?: string; ulkeAdi?: string; engeller: { alan: string; mesaj: string }[] };
  /**
   * EBLG-58: alış iadesinde iade edilen faturalar. Adaylar aynı tedarikçinin
   * GİB numaralı alış faturalarıdır; listede olmayan elle girilir.
   */
  iade?: {
    referanslar: { belgeNo: string; tarih: string; kaynakFaturaId: string | null }[];
    adaylar: { id: string; no: string; tarih: string; genelToplam: string; dovizCinsi: string }[];
    engeller: { sira?: number; mesaj: string }[];
  };
  /** Yolcu beraberi (tax-free): satış faturasında sihirbazda işaretlenir. */
  yolcuBeraberi?: {
    isaretli: boolean;
    /** Genel carinin VKN'si yok; işaret konmazsa belge gönderilemez. */
    aliciVknEksik: boolean;
    yolcu: { ad?: string | null; soyad?: string | null; uyruk?: string | null; pasaportNo?: string | null; pasaportTarihi?: string | null; sehir?: string | null; ulke?: string | null; bankaHesapNo?: string | null; bankaAdi?: string | null };
    araciKurum: { vkn?: string | null; etiket?: string | null; unvan?: string | null };
    engeller: { alan: string; mesaj: string }[];
  };
  /** SGK faturası: alıcının VKN'si SGK'nınki (EBLG-70). */
  sgk?: {
    ilaveFaturaTipi: string | null;
    mukellefKodu: string | null;
    mukellefAdi: string | null;
    dosyaNo: string | null;
    donemBaslangic: string | null;
    donemBitis: string | null;
    engeller: { alan: string; mesaj: string }[];
  };
  /** Şarj faturası (EBLG-71): tip satırdaki stok kartından türemiştir. */
  sarj?: {
    turu: "sarj" | "sarjanlik";
    plaka: string | null;
    baslangic: string | null;
    bitis: string | null;
    esuRaporlari: { raporId: string; tarih: string }[];
    satirlar: { sira: number; stok: string; uniteSeriNo: string | null }[];
    engeller: { alan: string; mesaj: string }[];
  };
  /** İDİS (EBLG-72): alanlar fatura formunda girilir, burada yalnız eksik gösterilir. */
  idis?: {
    sevkiyatNo: string;
    engeller: { alan: string; mesaj: string }[];
  };
  /** Yatırım teşvik (EBLG-78): alanlar fatura formunda, burada yalnız eksik gösterilir. */
  ytb?: {
    ytbNo: string;
    ytbTarihi: string | null;
    engeller: { alan: string; mesaj: string; satirIndeksi?: number }[];
  };
  /** KAMU senaryosu: alıcı listede KAMU ya da kartında işaretli. */
  kamu?: {
    kaynak: "liste" | "kart";
    harcamaBirimiVkn: string | null;
    harcamaBirimiAdi: string | null;
    iban: string | null;
    hesaplar: { id: string; ad: string; bankaAdi: string; iban: string }[];
    engeller: { alan: string; mesaj: string }[];
  };
  not?: string;
}
interface KayitliGorunum { id: string; ad: string; yon: "satis" | "alis" | null; durum: string | null; ebelge: string | null; odeme: string | null; /** EBLG-63 */ ihracKayitli?: string | null; }
const GORUNUM_ANAHTARI = "tekir_fatura_gorunumleri";

/** FaturaTip enum'u; iade ve proforma da listede ayırt edilmeli. */
const TIP_ETIKETLERI: Record<string, string> = {
  satis: "📤 Satış",
  alis: "📥 Alış",
  satis_iade: "↩️ Satış İade",
  alis_iade: "↪️ Alış İade",
  proforma: "📄 Proforma",
};

/** Senaryo özetindeki Türkçe adlar; UBL'e yazılan kod `senaryoUblKodu`dur (FTR-20). */
const SENARYO_ADLARI: Record<FaturaSenaryosu, string> = {
  satis: "Satış",
  iade: "İade",
  tevkifat: "Tevkifat",
  tevkifatiade: "Tevkifatlı iade",
  istisna: "İstisna",
  ihrackayitli: "İhraç kayıtlı",
  ozelmatrah: "Özel matrah",
  sgk: "SGK",
  sarj: "Şarj hizmeti",
  sarjanlik: "Şarj ünitesi",
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

/** Tutar ve para birimi; para birimi verilmezse TL (cari TRY bakiyesi, risk). */
const tl = (deger: string | number, doviz: string | null | undefined = "TRY"): string => paraBicimi(deger, doviz);

/** EBLG-103: sihirbazda kalem başına girilen kap bilgisi (alanlar metin olarak tutulur). */
interface IhracatKapSatiri { id: string; kapCinsi: string; kapNo: string; kapAdet: string }

/** Boş ya da geçersiz adet `null` olur; sunucu tam sayıyı ayrıca denetler. */
const kapAdediSayisi = (metin: string): number | null => {
  const sayi = Number(metin.trim());
  return metin.trim() && Number.isInteger(sayi) && sayi > 0 ? sayi : null;
};

const KAYDEDILMEMIS_DEGISIKLIK_UYARISI = "Bu faturadaki kaydedilmemiş değişiklikler silinecek. Formdan ayrılmak istiyor musunuz?";

// Taslak ya da e-belgesi oluşmamış kesin fatura düzenlenebilir (FTR-05); diğerleri salt okunur açılır.
/** FTR-29: yalnız taslak düzenlenir; gönderilmemiş kesin fatura önce taslağa geri alınır. */
function faturaDuzenlenebilir(fatura: { durum: string; ebelge?: unknown }): boolean {
  return fatura.durum === "taslak" && !fatura.ebelge;
}

function FaturaDurumRozeti({ fatura }: { fatura: Fatura }) {
  return (
    <>
      {fatura.durum === "taslak" ? <Badge variant="warning">📝 Taslak</Badge> : fatura.durum === "iptal" ? <Badge variant="danger">İptal</Badge> : <Badge variant="success">🔒 Kesinleşti</Badge>}
      {fatura.ebelge && (
        <Badge variant={EBELGE_DURUMLARI[fatura.ebelge.durum]?.renk ?? "neutral"}>
          {EBELGE_DURUMLARI[fatura.ebelge.durum]?.baslik ?? fatura.ebelge.durum}
          {fatura.ebelge.tur === "efatura" ? " · e-Fatura" : " · e-Arşiv"}
        </Badge>
      )}
    </>
  );
}
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
  /** FTR-26: faturaya sonradan irsaliye bağlama paneli. */
  const [irsaliyeBaglaFaturaId, setIrsaliyeBaglaFaturaId] = useState<string | null>(null);
  const [epostaAdresi, setEpostaAdresi] = useState("");
  const [formAcik, setFormAcik] = useState(yeniSayfasi);
  // EBLG-77: firma e-Fatura/e-Arşiv'e kayıtlı değilse fatura kağıda basılır;
  // "e-Fatura Oluştur" düğmesi hiç gösterilmez.
  const [ebelgeUygulamalari, setEbelgeUygulamalari] = useState<EbelgeUygulamalari | null>(null);
  const [duzenlenenId, setDuzenlenenId] = useState<string | null>(null);
  /** Satırdan açılan fatura; eylem çubuğu ve salt okunur kararı buna bakar. */
  const [acikFatura, setAcikFatura] = useState<FaturaDetay | null>(null);
  const [yonBaglami, setYonBaglami] = useState<"satis" | "alis" | null>(null);
  const [durumFiltresi, setDurumFiltresi] = useState<string | null>(null);
  const [ebelgeFiltresi, setEbelgeFiltresi] = useState<string | null>(null);
  /** EBLG-63: "acik" → çıkış beyannamesi gelmemiş ihraç kayıtlı satışlar (sunucuda süzülür). */
  const [ihracKayitliFiltresi, setIhracKayitliFiltresi] = useState<string | null>(null);
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
  // EBLG-77: kapalı uygulamanın düğmesi hiç çizilmesin diye bir kez okunur.
  useEffect(() => { void api<EbelgeUygulamalari>("/ebelge/uygulamalar").then(setEbelgeUygulamalari).catch(() => undefined); }, []);
  const saltOkunur = acikFatura !== null && !faturaDuzenlenebilir(acikFatura);
  /** EBLG-77: e-belge gönderimi yalnız e-Fatura ya da e-Arşiv açıkken mümkündür. */
  const ebelgeGonderilebilirFirma = ebelgeUygulamalari === null || !ebelgeKullanilmiyor(ebelgeUygulamalari);
  const faturayiAc = (id: string) => router.push(`/panel/fatura/yeni?ac=${id}${yonBaglami ? `&yon=${yonBaglami}` : ""}`);
  // Eylemler başarıda mesaj yazıp listeyi tazeler; açık faturanın çubuğu da yeni
  // durumu (kesinleşti, e-belge kuyrukta, iptal…) göstersin diye fatura yeniden okunur.
  useEffect(() => {
    if (!basari || !acikFatura) return;
    void api<FaturaDetay>(`/fatura/${acikFatura.id}`).then(setAcikFatura).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basari]);
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
  const [yeniStokBirim, setYeniStokBirim] = useState("adet");
  const [yeniStokFiyat, setYeniStokFiyat] = useState("");
  const [kesinlestirmeOzeti, setKesinlestirmeOzeti] = useState<KesinlestirmeOzeti | null>(null);
  const [ebelgeWizard, setEbelgeWizard] = useState<{
    fatura: Fatura;
    bilgi: EbelgeWizardBilgisi;
    earsivSekli: "elektronik" | "kagit";
    sevkiyat: { yontem: SevkiyatYontemi | ""; irsaliyeIds: string[]; fiiliSevkZamani: string };
    ihracat: { teslimTarihi: string; teslimSarti: string; tasimaSekli: string; satirlar: IhracatKapSatiri[] };
    internet: {
      isaretli: boolean;
      webAdresi: string;
      odemeSekli: string;
      odemeTarihi: string;
      odemeAracisi: string;
      tasiyiciUnvan: string;
      tasiyiciVkn: string;
      gonderiTarihi: string;
    };
    iade: {
      referanslar: { kaynakFaturaId: string | null; belgeNo: string; tarih: string }[];
      /** Elle girilecek referansın taslağı. */
      elleNo: string;
      elleTarih: string;
    };
    kamu: { harcamaBirimiVkn: string; harcamaBirimiAdi: string; iban: string };
    sgk: { ilaveFaturaTipi: string; mukellefKodu: string; mukellefAdi: string; dosyaNo: string; donemBaslangic: string; donemBitis: string };
    sarj: { plaka: string; baslangic: string; bitis: string; esuRaporlari: { raporId: string; tarih: string }[] };
    yolcu: {
      isaretli: boolean;
      ad: string; soyad: string; uyruk: string; pasaportNo: string; pasaportTarihi: string;
      sehir: string; ulke: string; bankaHesapNo: string; bankaAdi: string;
      araciKurumVkn: string; araciKurumEtiket: string; araciKurumUnvan: string;
    };
    /** L: 1 kontrol, 2 türe özel bilgiler, 3 önizleme ve gönderim. */
    adim: 1 | 2 | 3;
    onizleme: EbelgeOnizleme | null;
    /** Önizleme ayrı, tam ekran katmanda açık mı. */
    tamEkran?: boolean;
  } | null>(null);
  /** EBLG-54: gümrük beyanname panelinin taslak değerleri. */
  const [beyanname, setBeyanname] = useState<{ no: string; tarih: string } | null>(null);
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
  const [tarih, setTarih] = useState(bugunTR());
  const [vadeTarihi, setVadeTarihi] = useState("");
  const [vadeElleDegisti, setVadeElleDegisti] = useState(false);
  // Profil cari kartından gelir ama fatura üzerinde değiştirilebilir (FTR-19);
  // kullanıcı bir kez seçtiyse cari değişse de seçimi ezilmez.
  const [efaturaProfili, setEfaturaProfili] = useState<"temel" | "ticari">("temel");
  const [profilElleDegisti, setProfilElleDegisti] = useState(false);
  /** EBLG-60: ihraç kayıtlı satış kodu; boşsa normal satış. */
  const [ihracKayitliKodu, setIhracKayitliKodu] = useState("");
  /** Özel matrah (KDV K. 23): kod, KDV'nin hesaplandığı matrah ve oranı. */
  const [ozelMatrahKodu, setOzelMatrahKodu] = useState("");
  const [ozelMatrahTutari, setOzelMatrahTutari] = useState("");
  const [ozelMatrahOrani, setOzelMatrahOrani] = useState("20");
  /** Yardımcı: KDV dahil kâr farkı; matrahı iç yüzdeyle buradan çözeriz. */
  const [ozelMatrahFarki, setOzelMatrahFarki] = useState("");
  /** EBLG-72: İDİS sevkiyat numarası; doluysa belge IDIS profiliyle gider. */
  const [idisSevkiyatNo, setIdisSevkiyatNo] = useState("");
  // EBLG-78: teşvik belge numarası girilirse fatura YATIRIMTESVIK profiliyle gider.
  const [ytbNo, setYtbNo] = useState("");
  const [ytbTarihi, setYtbTarihi] = useState("");
  const [siparisNo, setSiparisNo] = useState("");
  /** FTR-30: teslim yeri ve elle girileni cariye kaydetme isteği. */
  const [teslimat, setTeslimat] = useState<TeslimatAdresi>(BOS_TESLIMAT_ADRESI);
  const [teslimatiCariyeKaydet, setTeslimatiCariyeKaydet] = useState(false);
  const [siparisTarihi, setSiparisTarihi] = useState("");
  const [talepNo, setTalepNo] = useState("");
  const [talepTarihi, setTalepTarihi] = useState("");
  const [ilgili, setIlgili] = useState<IlgiliKisiDegeri>(BOS_ILGILI_KISI);
  const [faturaNo, setFaturaNo] = useState("");
  const [aciklama, setAciklama] = useState("");
  const [kuruAciklamayaEkle, setKuruAciklamayaEkle] = useState(true);
  const [notlar, setNotlar] = useState("");
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [satirlar, setSatirlar] = useState<FaturaSatir[]>([
    { stokId: "", miktar: 1, birimFiyat: 0, iskontoOrani: 0, kdvOrani: 20, gibIstisnaKodu: "" },
  ]);
  const [stokVaryantlari, setStokVaryantlari] = useState<Record<string, StokVaryant[]>>({});
  /** FTR-28: belge dövizi değişti, kalem fiyatları hâlâ eski dövizde; kullanıcı onayı bekleniyor. */
  const [bekleyenCevrim, setBekleyenCevrim] = useState<{ eskiDoviz: string; eskiKur: number } | null>(null);
  const bugun = bugunTR();
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
  const girdiSatirlar: FaturaHesaplaSatirGirdi[] = satirlar.map((s) => {
    // Oran GİB kodundan gelir (FTR-18); önizleme bunu hesaba katmazsa ekranda
    // yazan tutar ile kaydedilen fatura ayrışır.
    const tevkifat = tevkifatPayPayda(s.tevkifatKodu, s.tevkifatOrani);
    return {
      stokId: s.stokId || "gecici-id",
      miktar: s.miktar,
      birimFiyat: s.birimFiyat,
      kdvOrani: s.kdvOrani,
      iskontoOrani: s.iskontoOrani,
      tevkifatPay: tevkifat?.pay,
      tevkifatPayda: tevkifat?.payda,
    };
  });
  // EBLG-60: ihraç kayıtlı yalnız satışta; tip değişince seçim yok sayılır.
  const ihracKayitli = tip === "satis" && ihracKayitliKodu ? ihracKayitliKodu : null;
  // Özel matrahta KDV satırlardan değil belgeye girilen matrahtan doğar ve
  // genel toplama eklenir; ekrandaki özet sunucunun hesabıyla aynı olsun diye
  // aynı girdi buraya da verilir (karar 2026-09-20).
  const ozelMatrahSecili = tip === "satis" && ozelMatrahKodu ? ozelMatrahKodu : null;
  const sonuc = faturaHesapla({
    satirlar: girdiSatirlar,
    kdvTahsilEdilmez: Boolean(ihracKayitli),
    ozelMatrahKdvsi: ozelMatrahSecili ? ozelMatrahKdvsi(ozelMatrahTutari || 0, ozelMatrahOrani || 0) : 0,
  });

  // Senaryo ve GİB kural hataları sunucudakiyle aynı işlevden gelir; kullanıcı
  // kaydetmeden önce ne göndereceğini görür (FTR-16, FTR-20).
  const senaryoSatirlari = satirlar.map((s) => ({
    kdvOrani: Number(s.kdvOrani),
    tevkifatKodu: s.tevkifatKodu,
    tevkifatOrani: s.tevkifatOrani,
    gibIstisnaKodu: s.gibIstisnaKodu,
  }));
  // Özel matrah yalnız satışta; satırlar KDV hariç girilir, KDV matrahtan doğar.
  const ozelMatrah = ozelMatrahSecili;
  // EBLG-71: şarj türü satırdaki stok kartından gelir; kullanıcı seçmez (S-01).
  const sarjSecimi = sarjTuruCoz(satirlar.map((s) => ({ sarjTuru: stoklar.find((x) => x.id === s.stokId)?.sarjTuru })));
  const turetilenSenaryo = faturaSenaryosuTuret(tip, senaryoSatirlari, ihracKayitli, ozelMatrah, undefined, sarjSecimi.turu);
  const ozelMatrahUyarilari = ozelMatrahHatalari({
    tip,
    ozelMatrahKodu: ozelMatrah,
    ozelMatrahTutari,
    ozelMatrahOrani,
    satirlar: senaryoSatirlari,
    satisBedeli: sonuc.toplamMatrah,
  });
  const ihracKayitliUyarilari = ihracKayitliHatalari({ tip, ihracKayitliKodu: ihracKayitli, satirlar: senaryoSatirlari });
  // EBLG-59: tevkifatlı faturada sıfır KDV satırı yalnız 351 alabilir; liste sunucudaki kuralla süzülür.
  const istisnaSecenekleri = izinliIstisnaKodlari(senaryoSatirlari);
  const senaryoUyarilari = senaryoHatalari(senaryoSatirlari, Boolean(ozelMatrah));
  // EBLG-72: sevkiyat numarasının biçimi ve satır etiketleri sunucudaki kuralla denetlenir.
  const idisUyarilari = idisEngelleri({
    sevkiyatNo: idisSevkiyatNo,
    satirlar: satirlar.map((satir, index) => ({ sira: index + 1, etiketNo: satir.idisEtiketNo })),
  });
  // EBLG-71: iki şarj türü aynı belgede karışamaz; belge tek InvoiceTypeCode taşır.
  const sarjUyarilari = sarjSecimi.karisik
    ? ["Aynı faturada hem şarj hizmeti hem şarj ünitesi kartı var; ikisi ayrı faturaya kesilmelidir."]
    // Plaka, süre ve ESU raporları sihirbazda toplanır; formda yalnız satır alanı aranır.
    : sarjEngelleri({ turu: sarjSecimi.turu, satirlar: satirlar.map((satir, index) => ({ sira: index + 1, uniteSeriNo: satir.sarjUniteSeriNo })) })
        .filter((engel) => engel.alan === "uniteSeriNo")
        .map((engel) => engel.mesaj);
  const istisnaliSatirSayisi = senaryoSatirlari.filter((s) => Boolean(s.gibIstisnaKodu)).length;
  const tevkifatliSatirSayisi = senaryoSatirlari.filter((s) => Boolean(s.tevkifatKodu)).length;
  // Profil yalnız bizim kestiğimiz belgelerde anlamlı; alış faturası bize gelir.
  // EBLG-58: iade faturasını malı geri gönderen keser; bizim kestiğimiz iade alış iadesidir.
  const gidenBelge = ["satis", "alis_iade"].includes(tip);

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
      if (ihracKayitliFiltresi) parametreler.set("ihracKayitli", ihracKayitliFiltresi);
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
  }, [yonBaglami, durumFiltresi, ebelgeFiltresi, ihracKayitliFiltresi, aramaFiltresi]);

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
    const duzenleId = parametreler.get("ac") ?? parametreler.get("duzenle");
    if (yeniSayfasi && duzenleId) {
      void api<FaturaDetay>(`/fatura/${duzenleId}`).then((fatura) => {
        setAcikFatura(fatura);
        setDuzenlenenId(faturaDuzenlenebilir(fatura) ? fatura.id : null); setTip(fatura.tip); setFaturaNo(fatura.no ?? ""); setTarih(fatura.tarih.slice(0, 10)); setDovizCinsi(fatura.dovizCinsi); setVadeTarihi(fatura.vadeTarihi?.slice(0, 10) ?? ""); setSiparisNo(fatura.siparisNo ?? ""); setSiparisTarihi(fatura.siparisTarihi?.slice(0, 10) ?? ""); setTalepNo(fatura.talepNo ?? ""); setTalepTarihi(fatura.talepTarihi?.slice(0, 10) ?? ""); setIlgili({ ilgiliKisi: fatura.ilgiliKisi ?? "", ilgiliKisiGorevi: fatura.ilgiliKisiGorevi ?? "" }); setVadeElleDegisti(true);
        setTeslimat({ teslimatAdres: fatura.teslimatAdres ?? "", teslimatIl: fatura.teslimatIl ?? "", teslimatIlce: fatura.teslimatIlce ?? "", teslimatPostaKodu: fatura.teslimatPostaKodu ?? "" }); setTeslimatiCariyeKaydet(false);
        setCariId(fatura.cari.id); setDepoId(fatura.depoId ?? ""); setAciklama(fatura.aciklama ?? ""); setNotlar(fatura.notlar ?? "");
        setEfaturaProfili(fatura.efaturaProfili ?? "temel"); setProfilElleDegisti(true); setIhracKayitliKodu(fatura.ihracKayitliKodu ?? "");
        setOzelMatrahKodu(fatura.ozelMatrahKodu ?? ""); setOzelMatrahTutari(fatura.ozelMatrahTutari ?? ""); setOzelMatrahOrani(fatura.ozelMatrahOrani ?? "20"); setOzelMatrahFarki("");
        setIdisSevkiyatNo(fatura.idisSevkiyatNo ?? "");
        setYtbNo(fatura.ytbNo ?? "");
        setYtbTarihi(fatura.ytbTarihi ?? "");
        setSatirlar(fatura.satirlar.map((satir) => ({
          stokId: satir.stokId, varyantId: satir.varyantId ?? undefined,
          miktar: Number(satir.miktar), birim: satir.birim, birimFiyat: Number(satir.birimFiyat),
          iskontoOrani: Number(satir.iskontoOrani), kdvOrani: Number(satir.kdvOrani),
          gibIstisnaKodu: satir.gibIstisnaKodu ?? "",
          tevkifatKodu: satir.tevkifatKodu ?? "",
          tevkifatOrani: satir.tevkifatOrani ?? "",
          idisEtiketNo: satir.idisEtiketNo ?? "",
          ytbHarcamaTipi: satir.ytbHarcamaTipi ?? "",
          ytbMakineAdi: satir.ytbMakineAdi ?? "",
          ytbMakineId: satir.ytbMakineId ?? "",
          ytbMakineSiraNo: satir.ytbMakineSiraNo ?? "",
          sarjUniteSeriNo: satir.sarjUniteSeriNo ?? "",
          projeId: (satir as any).projeId ?? (satir as any).proje?.id ?? undefined,
          projeAltKirilimId: (satir as any).projeAltKirilimId ?? (satir as any).projeAltKirilim?.id ?? undefined,
        })));
      }).catch((h) => setHata(h instanceof Error ? h.message : "Fatura açılamadı"));
    }
    setDurumFiltresi(parametreler.get("durum"));
    setEbelgeFiltresi(parametreler.get("ebelge"));
    setAramaFiltresi(parametreler.get("arama"));
    setOdemeFiltresi(parametreler.get("odeme"));
    setIhracKayitliFiltresi(parametreler.get("ihracKayitli"));
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
    setYonBaglami(filtreler.yon); setDurumFiltresi(filtreler.durum); setEbelgeFiltresi(filtreler.ebelge); setOdemeFiltresi(filtreler.odeme); setIhracKayitliFiltresi(filtreler.ihracKayitli ?? null);
    const parametreler = new URLSearchParams();
    if (filtreler.yon) parametreler.set("yon", filtreler.yon);
    if (filtreler.durum) parametreler.set("durum", filtreler.durum);
    if (filtreler.ebelge) parametreler.set("ebelge", filtreler.ebelge);
    if (filtreler.odeme) parametreler.set("odeme", filtreler.odeme);
    if (filtreler.ihracKayitli) parametreler.set("ihracKayitli", filtreler.ihracKayitli);
    window.history.replaceState(null, "", "/panel/fatura" + (parametreler.size ? "?" + parametreler.toString() : ""));
  }

  function filtreDegistir(alan: "durum" | "ebelge" | "odeme" | "ihracKayitli", deger: string) {
    filtreleriUygula({ yon: yonBaglami, durum: alan === "durum" ? deger || null : durumFiltresi, ebelge: alan === "ebelge" ? deger || null : ebelgeFiltresi, odeme: alan === "odeme" ? deger || null : odemeFiltresi, ihracKayitli: alan === "ihracKayitli" ? deger || null : ihracKayitliFiltresi });
  }

  function gorunumKaydet(event: React.FormEvent) {
    event.preventDefault(); const ad = gorunumAdi.trim(); if (!ad) return;
    const yeni: KayitliGorunum = { id: Date.now().toString(), ad, yon: yonBaglami, durum: durumFiltresi, ebelge: ebelgeFiltresi, odeme: odemeFiltresi, ihracKayitli: ihracKayitliFiltresi };
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
    setCariId(""); setCariOzeti(null); setDepoId(""); setTip(yonBaglami ?? "satis"); setGelirTuru("ticari_satis"); setTarih(bugunTR()); setDovizCinsi("TRY"); setKur("1");
    setAciklama(""); setKuruAciklamayaEkle(true); setFaturaNo("");
    setNotlar(""); setVadeTarihi(""); setVadeElleDegisti(false); setSiparisNo(""); setSiparisTarihi(""); setTalepNo(""); setTalepTarihi(""); setIlgili(BOS_ILGILI_KISI);
    setTeslimat(BOS_TESLIMAT_ADRESI); setTeslimatiCariyeKaydet(false);
    setEfaturaProfili("temel"); setProfilElleDegisti(false); setIhracKayitliKodu(""); setIdisSevkiyatNo("");
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
    if (!cariOzeti || profilElleDegisti || duzenlenenId) return;
    setEfaturaProfili(cariOzeti.efaturaProfili ?? "temel");
  }, [cariOzeti, profilElleDegisti, duzenlenenId]);

  useEffect(() => {
    if (!cariOzeti || vadeElleDegisti || duzenlenenId) return;
    const temel = new Date(`${tarih}T00:00:00`);
    temel.setDate(temel.getDate() + (cariOzeti.varsayilanVadeGun ?? 0));
    // Tarih yerel gece yarısından kurulur; `toISOString` UTC'ye çevirdiği için
    // Türkiye'de vade bir gün geriye kayıyordu (vade günü 0 olan caride fatura
    // 20.09 iken vade 19.09 görünüyordu).
    setVadeTarihi(`${temel.getFullYear()}-${String(temel.getMonth() + 1).padStart(2, "0")}-${String(temel.getDate()).padStart(2, "0")}`);
  }, [cariOzeti, tarih, vadeElleDegisti, duzenlenenId]);

  useEffect(() => {
    if (dovizCinsi === "TRY") { setKur("1"); setKurBilgisi(""); return; }
    let gecerli = true;
    api<{ kaynak: string; kurTarihi: string; oncekiIsGunuKullanildi: boolean; kurlar: Record<string, number> }>(`/doviz-kurlari?tarih=${tarih}&tip=alis`)
      .then((veri) => { if (gecerli && veri.kurlar[dovizCinsi]) { setKur(String(veri.kurlar[dovizCinsi])); setKurBilgisi(`${veri.kaynak === "TCMB_XML" ? "TCMB" : "TCMB EVDS"} · ${veri.kurTarihi}${veri.oncekiIsGunuKullanildi ? " (önceki iş günü)" : ""}`); } })
      .catch(() => { if (gecerli) setKurBilgisi("TCMB kuru alınamadı; manuel kur girin"); });
    return () => { gecerli = false; };
  }, [dovizCinsi, tarih]);

  // Özel matrah faturasında satırlar KDV'siz olmak zorundadır (EBLG-69). Oran
  // ürün kartından geldiği için kullanıcı her satırda elle sıfırlamak zorunda
  // kalıyor, unutursa kaydederken kural hatası alıyordu; seçim yapıldığı anda
  // ve sonradan eklenen satırlarda oran kendiliğinden sıfırlanır.
  useEffect(() => {
    if (!ozelMatrahSecili) return;
    setSatirlar((eskiler) => eskiler.some((satir) => Number(satir.kdvOrani) !== 0)
      ? eskiler.map((satir) => ({ ...satir, kdvOrani: 0 }))
      : eskiler);
  }, [ozelMatrahSecili, satirlar]);

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

  /**
   * FTR-28: ürün/varyant fiyatı belge dövizinde gelir. Fiyat başka dövizdeyse
   * satıra yazılmaz (kullanıcı kararı: eklemeyi engelle), satır uyarıyla işaretlenir.
   */
  async function kalemFiyatiGetir(stokId: string, varyantId?: string): Promise<Pick<FaturaSatir, "birimFiyat" | "iskontoOrani" | "dovizUyarisi"> | null> {
    const p = new URLSearchParams({ cariId, tip, dovizCinsi, belgeKuru: dovizCinsi === "TRY" ? "1" : kur || "1" });
    if (varyantId) p.set("varyantId", varyantId);
    try {
      const t = await api<{ kaynakFiyat: number; kaynakDoviz: string; iskontoOrani: number }>(`/stok/${stokId}/tavsiye-fiyat?${p}`);
      const uyari = dovizUyumsuzlugu(t.kaynakDoviz, dovizCinsi);
      return { birimFiyat: uyari ? 0 : t.kaynakFiyat, iskontoOrani: t.iskontoOrani, dovizUyarisi: uyari };
    } catch (err) {
      console.error("Tavsiye fiyat alınamadı", err);
      return null;
    }
  }

  /** FTR-28: kalem varken belge dövizi değişirse fiyatlar onayla yeni dövize çevrilir. */
  function belgeDoviziDegistir(yeniDoviz: string) {
    if (yeniDoviz === dovizCinsi) return;
    if (satirlar.some((s) => s.birimFiyat > 0)) setBekleyenCevrim((onceki) => onceki ?? { eskiDoviz: dovizCinsi, eskiKur: dovizCinsi === "TRY" ? 1 : Number(kur) || 0 });
    // Yeni kur yüklenene kadar çeviri onayı kapalı kalsın; kur efekti bilgiyi yeniden yazar.
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
    // Kaydetmede gösterilen "önce çevirin" uyarısı artık geçersiz.
    setHata("");
  }
  function dovizDegisiminiGeriAl() {
    if (!bekleyenCevrim) return;
    setDovizCinsi(bekleyenCevrim.eskiDoviz);
    setKur(String(bekleyenCevrim.eskiKur || 1));
    setBekleyenCevrim(null);
    setHata("");
  }

  async function satirGuncelle(index: number, alan: keyof FaturaSatir, deger: string | number) {
    const yeni = [...satirlar];
    yeni[index] = { ...yeni[index], [alan]: deger };
    // Elle girilen fiyat belge dövizindedir; uyumsuzluk uyarısı kalkar.
    if (alan === "birimFiyat") yeni[index].dovizUyarisi = undefined;

    // Eğer stok seçildiyse varsayılan fiyatları yükleyelim
    if (alan === "stokId") {
      yeni[index].varyantId = undefined;
      const stok = stoklar.find((s) => s.id === deger);
      yeni[index].birim = stok?.anaBirim;
      if (stok) {
        yeni[index].kdvOrani = Number(stok.kdvOrani || 20);
      }
      yeni[index].dovizUyarisi = undefined;
      if (deger) {
        const fiyat = await kalemFiyatiGetir(String(deger));
        if (fiyat) yeni[index] = { ...yeni[index], ...fiyat };
      }
    }
    setSatirlar(yeni);
  }

  /** STK-10: ek birime geçince fiyat birim başına ölçeklenir (1 koli = 12 adet → fiyat × 12). */
  function satirBirimiDegistir(index: number, birim: string) {
    setSatirlar((eskiler) => eskiler.map((satir, i) => {
      if (i !== index) return satir;
      const stok = stoklar.find((x) => x.id === satir.stokId);
      const oran = birimKatsayisi(stok, birim) / birimKatsayisi(stok, satir.birim);
      return { ...satir, birim, birimFiyat: Number((satir.birimFiyat * oran).toFixed(4)) };
    }));
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
          anaBirim: yeniStokBirim,
          alisFiyati: tip.startsWith("alis") && yeniStokFiyat ? yeniStokFiyat : null,
          satisFiyati: !tip.startsWith("alis") && yeniStokFiyat ? yeniStokFiyat : null,
          // FTR-28: hızlı kartta fiyat, girildiği belgenin dövizindedir.
          alisFiyatiDoviz: dovizCinsi,
          satisFiyatiDoviz: dovizCinsi,
        }),
      });
      setStoklar((eskiler) => [yeni, ...eskiler]);
      setSatirlar((eskiler) => eskiler.map((satir, index) =>
        index === hizliStokSatir
          ? {
              ...satir,
              stokId: yeni.id,
              birim: yeni.anaBirim,
              kdvOrani: Number(yeni.kdvOrani),
              birimFiyat: Number(tip.startsWith("alis") ? yeni.alisFiyati ?? 0 : yeni.satisFiyati ?? 0),
            }
          : satir,
      ));
      setHizliPanel(null);
      setYeniStokKod("");
      setYeniStokAd("");
      setYeniStokBarkod("");
      setYeniStokBirim("adet");
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
    // Salt okunur açılan fatura da kayıtlıdır; duzenlenenId boş olsa bile
    // fiyatları ezilmez.
    if (duzenlenenId || acikFatura) return;
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
  }, [cariId, tip, dovizCinsi, duzenlenenId, acikFatura]);

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

    // FTR-28: kalemler belge dövizinde olmalı.
    if (bekleyenCevrim) {
      setHata(`Belge dövizi değişti; önce kalem fiyatlarını ${paraBirimiEtiketi(dovizCinsi)}'ye çevirin ya da değişikliği geri alın.`);
      return;
    }
    const uyumsuz = satirlar.findIndex((s) => s.dovizUyarisi);
    if (uyumsuz >= 0) {
      setHata(`Satır ${uyumsuz + 1}: ${satirlar[uyumsuz].dovizUyarisi}`);
      requestAnimationFrame(() => urunRefleri.current[uyumsuz]?.focus());
      return;
    }

    // Eksik istisna kodu gibi senaryo hataları burada durdurulur; sunucuya
    // gitse de aynı kuraldan dönerdi (FTR-20).
    if (ozelMatrahUyarilari.length > 0) {
      setHata(ozelMatrahUyarilari[0]);
      return;
    }
    if (ihracKayitliUyarilari.length > 0) {
      setHata(ihracKayitliUyarilari[0]);
      kullanimOlayi("fatura_dogrulama_hatasi");
      return;
    }
    if (idisUyarilari.length > 0 || sarjUyarilari.length > 0) {
      setHata((idisUyarilari[0]?.mesaj ?? sarjUyarilari[0]) as string);
      kullanimOlayi("fatura_dogrulama_hatasi");
      return;
    }
    if (senaryoUyarilari.length > 0) {
      const ilk = senaryoUyarilari[0];
      setHata(`Satır ${ilk.satirIndeksi + 1}: ${ilk.mesaj}`);
      setAcikSatir(ilk.satirIndeksi);
      kullanimOlayi("fatura_dogrulama_hatasi");
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
          efaturaProfili,
          ihracKayitliKodu: ihracKayitli,
          ozelMatrahKodu: ozelMatrah,
          ozelMatrahTutari: ozelMatrah ? ozelMatrahTutari || "0" : null,
          ozelMatrahOrani: ozelMatrah ? ozelMatrahOrani || "0" : null,
          idisSevkiyatNo: idisSevkiyatNo.trim() || null,
          ytbNo: ytbNo.trim() || null,
          ytbTarihi: ytbNo.trim() && ytbTarihi ? ytbTarihi : null,
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
          talepNo: talepNo.trim() || null,
          talepTarihi: talepTarihi || null,
          ...ilgiliKisiGovdesi(ilgili),
          ...teslimatAdresiGovdesi(teslimat),
          teslimatAdresiniCariyeKaydet: teslimatiCariyeKaydet && !faturaTeslimYeriEksik(teslimat) && Boolean(teslimat.teslimatAdres.trim()),
          aciklama: kayitAciklamasi || null,
          notlar: notlar.trim() || null,
          satirlar: satirlar.map((s) => ({
            stokId: s.stokId,
            varyantId: s.varyantId || null,
            miktar: String(s.miktar),
            birim: s.birim || stoklar.find((stok) => stok.id === s.stokId)?.anaBirim || "adet",
            birimFiyat: String(s.birimFiyat),
            iskontoOrani: String(s.iskontoOrani),
            kdvOrani: String(s.kdvOrani),
            gibIstisnaKodu: s.gibIstisnaKodu || undefined,
            tevkifatKodu: s.tevkifatKodu || undefined,
            tevkifatOrani: s.tevkifatOrani || undefined,
            idisEtiketNo: s.idisEtiketNo?.trim() || undefined,
            ytbHarcamaTipi: s.ytbHarcamaTipi?.trim() || undefined,
            ytbMakineAdi: s.ytbMakineAdi?.trim() || undefined,
            ytbMakineId: s.ytbMakineId?.trim() || undefined,
            ytbMakineSiraNo: s.ytbMakineSiraNo?.trim() || undefined,
            sarjUniteSeriNo: s.sarjUniteSeriNo?.trim() || undefined,
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

  /**
   * Kesin faturanın iptali: e-belgesiz (kâğıt) fatura, e-Arşiv (8 gün, EBLG-22)
   * ve e-Belgesi entegratöre hiç ulaşmamış fatura (EBLG-81). Gönderilmiş
   * e-Fatura iptal edilmez, iade faturası düzenlenir. Süre ve entegratör
   * kontrolü sunucudadır.
   */
  function kesinIptalEdilebilir(fatura: Fatura) {
    if (!fatura.izinliEylemler?.includes("iptal")) return false;
    if (!fatura.ebelge) return true;
    if (fatura.ebelge.durum === "iptal") return false;
    return fatura.ebelge.tur === "earsiv" || ebelgeGitmemisMi({ faturaNo: fatura.no, ebelge: fatura.ebelge });
  }

  async function kesinIptalEt(fatura: Fatura) {
    const gitmemis = ebelgeGitmemisMi({ faturaNo: fatura.no, ebelge: fatura.ebelge });
    const uyari = gitmemis
      ? "e-Belgesi entegratöre hiç ulaşmamış bu fatura iptal edilecek. Önce entegratöre belgenin oluşmadığı sorulur; stok ve cari için ters kayıt yazılır."
      : fatura.ebelge
        ? "Bu e-Arşiv faturası iptal edilecek ve iptal entegratöre bildirilecek. Bu işlem geri alınamaz; stok ve cari için ters kayıt yazılır."
        : "Bu kesin fatura iptal edilecek; stok ve cari için ters kayıt yazılır.";
    if (!window.confirm(`${uyari} Devam edilsin mi?`)) return;
    setHata(""); setBasari("");
    try { await api(`/fatura/${fatura.id}/iptal`, { method: "POST" }); setBasari("Fatura iptal edildi."); void yukle(); }
    catch (h) { setHata(h instanceof Error ? h.message : "Fatura iptal edilemedi"); }
  }

  /** FTR-29: stok ve cari ters kayıtla geri alınır, fatura taslakta düzenlenir; numara korunur. */
  async function taslagaGeriAl(fatura: FaturaDetay) {
    const ebelgeNotu = fatura.ebelge ? " Entegratöre ulaşmamış e-Belge kaydı, önce entegratöre sorularak silinir." : "";
    if (!window.confirm(`Fatura taslağa geri alınacak: stok ve cari hareketleri ters kayıtla kaldırılır, numarası korunur.${ebelgeNotu} Düzelttikten sonra yeniden kesinleştirmeniz gerekir. Devam edilsin mi?`)) return;
    setHata(""); setBasari("");
    try {
      await api(`/fatura/${fatura.id}/taslaga-geri-al`, { method: "POST" });
      const guncel = await api<FaturaDetay>(`/fatura/${fatura.id}`);
      setAcikFatura(guncel);
      setDuzenlenenId(guncel.id);
      setBasari("Fatura taslağa geri alındı; düzenleyip yeniden kesinleştirebilirsiniz.");
      void yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "Fatura taslağa geri alınamadı"); }
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
      setEbelgeWizard({
        fatura,
        bilgi,
        earsivSekli: bilgi.earsivGonderimSekli ?? "elektronik",
        sevkiyat: {
          yontem: (bilgi.sevkiyat?.yontem as SevkiyatYontemi | undefined) ?? "",
          irsaliyeIds: bilgi.sevkiyat?.adaylar.filter((a) => a.faturaId === fatura.id).map((a) => a.id) ?? [],
          // Sevk anı girilmemişse varsayılan "şimdi": mal fatura beraberinde
          // çıktığı için sevk zamanı çoğunlukla gönderim anıdır.
          fiiliSevkZamani: zamanAlaniDegeri(bilgi.sevkiyat?.fiiliSevkZamani) || zamanAlaniMetni(new Date()),
        },
        ihracat: {
          teslimTarihi: bilgi.ihracat?.teslimTarihi?.slice(0, 10) ?? "",
          teslimSarti: bilgi.ihracat?.teslimSarti ?? "",
          tasimaSekli: bilgi.ihracat?.tasimaSekli ?? "",
          satirlar: bilgi.ihracat?.satirlar.map((s) => ({
            id: s.id,
            kapCinsi: s.kapCinsi ?? "",
            kapNo: s.kapNo ?? "",
            kapAdet: s.kapAdet != null ? String(s.kapAdet) : "",
          })) ?? [],
        },
        internet: {
          isaretli: bilgi.internetSatisi?.isaretli ?? false,
          webAdresi: bilgi.internetSatisi?.webAdresi ?? "",
          odemeSekli: bilgi.internetSatisi?.odemeSekli ?? "",
          odemeTarihi: bilgi.internetSatisi?.odemeTarihi?.slice(0, 10) ?? "",
          odemeAracisi: bilgi.internetSatisi?.odemeAracisi ?? "",
          tasiyiciUnvan: bilgi.internetSatisi?.tasiyiciUnvan ?? "",
          tasiyiciVkn: bilgi.internetSatisi?.tasiyiciVkn ?? "",
          gonderiTarihi: bilgi.internetSatisi?.gonderiTarihi?.slice(0, 10) ?? "",
        },
        iade: {
          referanslar: (bilgi.iade?.referanslar ?? []).map((r) => ({ kaynakFaturaId: r.kaynakFaturaId, belgeNo: r.belgeNo, tarih: r.tarih.slice(0, 10) })),
          elleNo: "",
          elleTarih: "",
        },
        yolcu: {
          isaretli: bilgi.yolcuBeraberi?.isaretli ?? false,
          ad: bilgi.yolcuBeraberi?.yolcu.ad ?? "",
          soyad: bilgi.yolcuBeraberi?.yolcu.soyad ?? "",
          uyruk: bilgi.yolcuBeraberi?.yolcu.uyruk ?? "",
          pasaportNo: bilgi.yolcuBeraberi?.yolcu.pasaportNo ?? "",
          pasaportTarihi: bilgi.yolcuBeraberi?.yolcu.pasaportTarihi?.slice(0, 10) ?? "",
          sehir: bilgi.yolcuBeraberi?.yolcu.sehir ?? "",
          ulke: bilgi.yolcuBeraberi?.yolcu.ulke ?? "",
          bankaHesapNo: bilgi.yolcuBeraberi?.yolcu.bankaHesapNo ?? "",
          bankaAdi: bilgi.yolcuBeraberi?.yolcu.bankaAdi ?? "",
          araciKurumVkn: bilgi.yolcuBeraberi?.araciKurum.vkn ?? "",
          araciKurumEtiket: bilgi.yolcuBeraberi?.araciKurum.etiket ?? "",
          araciKurumUnvan: bilgi.yolcuBeraberi?.araciKurum.unvan ?? "",
        },
        kamu: {
          harcamaBirimiVkn: bilgi.kamu?.harcamaBirimiVkn ?? "",
          harcamaBirimiAdi: bilgi.kamu?.harcamaBirimiAdi ?? "",
          iban: bilgi.kamu?.iban ?? "",
        },
        sgk: {
          ilaveFaturaTipi: bilgi.sgk?.ilaveFaturaTipi ?? "",
          mukellefKodu: bilgi.sgk?.mukellefKodu ?? "",
          mukellefAdi: bilgi.sgk?.mukellefAdi ?? "",
          dosyaNo: bilgi.sgk?.dosyaNo ?? "",
          donemBaslangic: bilgi.sgk?.donemBaslangic ?? "",
          donemBitis: bilgi.sgk?.donemBitis ?? "",
        },
        sarj: {
          plaka: bilgi.sarj?.plaka ?? "",
          baslangic: bilgi.sarj?.baslangic ?? "",
          bitis: bilgi.sarj?.bitis ?? "",
          esuRaporlari: bilgi.sarj?.esuRaporlari ?? [],
        },
        adim: 1,
        onizleme: null,
      });
    } catch (h) { setHata(h instanceof Error ? h.message : "e-Fatura wizard'ı açılamadı"); }
  }

  /** Sihirbazda girilenler; gönderim ve önizleme aynı gövdeyi yollar. */
  function wizardSecimi(w: NonNullable<typeof ebelgeWizard>) {
    return {
          sevkiyat: w.bilgi.sevkiyat?.gerekli && w.bilgi.sevkiyat.mukellef && w.sevkiyat.yontem
            ? {
                yontem: w.sevkiyat.yontem,
                irsaliyeIds: w.sevkiyat.yontem === "irsaliye" ? w.sevkiyat.irsaliyeIds : [],
                fiiliSevkZamani: w.sevkiyat.yontem === "irsaliye_yerine" ? zamanAlaniIso(w.sevkiyat.fiiliSevkZamani) : null,
              }
            : undefined,
          earsivGonderimSekli: w.earsivSekli,
          // İhracat alanları yalnız ihracat faturasında gönderilir; sunucu
          // eksikleri kendi listesiyle yeniden denetler.
          ihracat: w.bilgi.ihracat
            ? {
                teslimTarihi: w.ihracat.teslimTarihi || null,
                teslimSarti: w.ihracat.teslimSarti || null,
                tasimaSekli: w.ihracat.tasimaSekli || null,
                satirlar: w.ihracat.satirlar.map((s) => ({
                  id: s.id,
                  kapCinsi: s.kapCinsi || null,
                  kapNo: s.kapNo.trim() || null,
                  kapAdet: kapAdediSayisi(s.kapAdet),
                })),
              }
            : undefined,
          // İnternet satışı işareti her gönderimde yazılır; kutu kaldırıldıysa
          // sunucu alanları da temizler.
          internetSatisi: w.bilgi.internetSatisi
            ? {
                internetSatisi: w.internet.isaretli,
                webAdresi: w.internet.webAdresi || null,
                odemeSekli: w.internet.odemeSekli || null,
                odemeTarihi: w.internet.odemeTarihi || null,
                odemeAracisi: w.internet.odemeAracisi || null,
                tasiyiciUnvan: w.internet.tasiyiciUnvan || null,
                tasiyiciVkn: w.internet.tasiyiciVkn || null,
                gonderiTarihi: w.internet.gonderiTarihi || null,
              }
            : undefined,
          // İade referansları her gönderimde baştan yazılır; listeden seçilen
          // faturanın numarasını sunucu kendi kaydından okur.
          iade: w.bilgi.iade
            ? {
                referanslar: w.iade.referanslar.map((r) =>
                  r.kaynakFaturaId ? { kaynakFaturaId: r.kaynakFaturaId } : { belgeNo: r.belgeNo, tarih: r.tarih },
                ),
              }
            : undefined,
          // Yolcu beraberi işareti her gönderimde yazılır; kaldırılırsa sunucu
          // yolcu bilgisini de siler.
          yolcuBeraberi: w.bilgi.yolcuBeraberi
            ? {
                isaretli: w.yolcu.isaretli,
                yolcu: {
                  ad: w.yolcu.ad || null, soyad: w.yolcu.soyad || null, uyruk: w.yolcu.uyruk || null,
                  pasaportNo: w.yolcu.pasaportNo || null, pasaportTarihi: w.yolcu.pasaportTarihi || null,
                  sehir: w.yolcu.sehir || null, ulke: w.yolcu.ulke || null,
                  bankaHesapNo: w.yolcu.bankaHesapNo || null, bankaAdi: w.yolcu.bankaAdi || null,
                },
                araciKurum: { vkn: w.yolcu.araciKurumVkn || null, etiket: w.yolcu.araciKurumEtiket || null, unvan: w.yolcu.araciKurumUnvan || null },
              }
            : undefined,
          sgk: w.bilgi.sgk
            ? {
                ilaveFaturaTipi: w.sgk.ilaveFaturaTipi || null,
                mukellefKodu: w.sgk.mukellefKodu || null,
                mukellefAdi: w.sgk.mukellefAdi || null,
                dosyaNo: w.sgk.dosyaNo || null,
                donemBaslangic: w.sgk.donemBaslangic || null,
                donemBitis: w.sgk.donemBitis || null,
              }
            : undefined,
          kamu: w.bilgi.kamu
            ? { harcamaBirimiVkn: w.kamu.harcamaBirimiVkn || null, harcamaBirimiAdi: w.kamu.harcamaBirimiAdi || null, iban: w.kamu.iban || null }
            : undefined,
          // Şarj faturasının plakası, süresi ve ESU raporları (EBLG-71).
          sarj: w.bilgi.sarj
            ? {
                plaka: w.sarj.plaka || null,
                baslangic: w.sarj.baslangic || null,
                bitis: w.sarj.bitis || null,
                esuRaporlari: w.sarj.esuRaporlari.filter((r) => r.raporId.trim()),
              }
            : undefined,
        };
  }

  /** L: son adıma geçerken belge gönderilecek hâliyle entegratörde önizlenir. */
  async function ebelgeOnizle(w: NonNullable<typeof ebelgeWizard>) {
    setEbelgeWizard({ ...w, adim: 3, onizleme: { durum: "yukleniyor" } });
    try {
      const sonuc = await api<Omit<Extract<EbelgeOnizleme, { durum: "hazir" }>, "durum">>(`/ebelge/onizle/${w.fatura.id}`, {
        method: "POST",
        body: JSON.stringify(wizardSecimi(w)),
      });
      setEbelgeWizard((guncel) => guncel && guncel.adim === 3 ? { ...guncel, onizleme: { durum: "hazir", ...sonuc } } : guncel);
    } catch (h) {
      const mesaj = h instanceof Error ? h.message : "Önizleme alınamadı";
      setEbelgeWizard((guncel) => guncel && guncel.adim === 3 ? { ...guncel, onizleme: { durum: "hata", mesaj } } : guncel);
    }
  }

  async function ebelgeWizardGonder() {
    if (!ebelgeWizard) return;
    setHata(""); setBasari("");
    try {
      await api(`/ebelge/gonder/${ebelgeWizard.fatura.id}`, {
        method: "POST",
        body: JSON.stringify(wizardSecimi(ebelgeWizard)),
      });
      setEbelgeWizard(null);
      setBasari("e-Belge oluşturuldu ve entegratöre gönderim kuyruğuna alındı.");
      void yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "e-Belge gönderilemedi"); }
  }

  /**
   * EBLG-54: gümrük beyanname numarası belge gönderildikten sonra belli olur;
   * yalnız kayda işlenir, GİB'e ikinci bir gönderim yapılmaz.
   */
  async function beyannameKaydet(faturaId: string) {
    if (!beyanname) return;
    setHata(""); setBasari("");
    try {
      await api(`/ebelge/gumruk-beyannamesi/${faturaId}`, {
        method: "POST",
        body: JSON.stringify({ no: beyanname.no.trim() || null, tarih: beyanname.tarih || null }),
      });
      setBeyanname(null);
      setBasari("Gümrük beyanname bilgisi faturaya işlendi.");
      await ebelgeDetayAc(faturaId);
      void yukle();
    } catch (h) { setHata(h instanceof Error ? h.message : "Beyanname bilgisi kaydedilemedi"); }
  }

  /**
   * Sunucunun ihracat engelleri panel açıldığı andaki faturayı yansıtır; fiili
   * ihracat tarihi panelde girildiği için o engel kullanıcı tarihi doldurunca
   * düşer. Gönderim aynı listeyi kaydettikten sonra yeniden üretir, bu yüzden
   * burada gevşetmek kuralı atlatmaz.
   */
  const ihracatEngelleri = ebelgeWizard?.bilgi.ihracat?.engeller.filter(
    (engel) => !(engel.alan === "teslimTarihi" && ebelgeWizard.ihracat.teslimTarihi) && engel.alan !== "kap",
  ) ?? [];
  /** Kap eksiği panelde girilen değerlerle yeniden hesaplanır; kural sunucudakiyle aynı işlevdir. */
  const kapEksikSatirlari = ebelgeWizard?.bilgi.ihracat
    ? ebelgeWizard.bilgi.ihracat.satirlar.filter((satir) => {
        const girilen = ebelgeWizard.ihracat.satirlar.find((s) => s.id === satir.id);
        return girilen && kapEksigiVarMi({ kapCinsi: girilen.kapCinsi, kapNo: girilen.kapNo, kapAdet: kapAdediSayisi(girilen.kapAdet) });
      })
    : [];
  /**
   * İnternet satışı eksikleri panelde girilen değerlerle yeniden hesaplanır —
   * kural sunucudakiyle aynı işlevden gelir. Gönderim kaydettikten sonra aynı
   * denetimi tekrarlar, bu yüzden burada hesaplamak kuralı gevşetmez.
   */
  const internetEngelleri = ebelgeWizard?.bilgi.internetSatisi && ebelgeWizard.internet.isaretli
    ? internetSatisEngelleri({
        internetSatisi: true,
        siparisNo: ebelgeWizard.bilgi.internetSatisi.siparisNo,
        siparisTarihi: ebelgeWizard.bilgi.internetSatisi.siparisTarihi,
        webAdresi: ebelgeWizard.internet.webAdresi,
        odemeSekli: ebelgeWizard.internet.odemeSekli,
        odemeTarihi: ebelgeWizard.internet.odemeTarihi || null,
        tasiyiciVkn: ebelgeWizard.internet.tasiyiciVkn,
        teslimatAdresiVar: ebelgeWizard.bilgi.internetSatisi.teslimatAdresiVar,
      })
    : [];
  // EBLG-58: iade eksikleri de panelde seçilenlerle, sunucudaki kuralla hesaplanır.
  const iadeEksikleri = ebelgeWizard?.bilgi.iade
    ? iadeEngelleri(ebelgeWizard.iade.referanslar, ebelgeWizard.fatura.tarih)
    : [];
  // KAMU senaryosu: harcama birimi ve IBAN panelde seçilenlerle denetlenir.
  const kamuEksikleri = ebelgeWizard?.bilgi.kamu ? kamuEngelleri(ebelgeWizard.kamu) : [];
  const sgkEksikleri = ebelgeWizard?.bilgi.sgk ? sgkEngelleri(ebelgeWizard.sgk) : [];
  /**
   * Şarj eksikleri panelde girilenlerle yeniden hesaplanır; satır seri
   * numaraları panelde değişmediği için sunucunun listesinden alınır (EBLG-71).
   */
  const sarjEksikleri = ebelgeWizard?.bilgi.sarj
    ? [
        ...sarjEngelleri({
          turu: ebelgeWizard.bilgi.sarj.turu,
          plaka: ebelgeWizard.sarj.plaka,
          baslangic: ebelgeWizard.sarj.baslangic,
          bitis: ebelgeWizard.sarj.bitis,
          esuRaporlari: ebelgeWizard.sarj.esuRaporlari,
        }),
        ...ebelgeWizard.bilgi.sarj.engeller.filter((engel) => engel.alan === "uniteSeriNo"),
      ]
    : [];
  /** İDİS eksikleri fatura formunda düzeltilir; sihirbaz yalnız gösterir (EBLG-72). */
  const idisEksikleri = ebelgeWizard?.bilgi.idis?.engeller ?? [];
  /** EBLG-78: yatırım teşvik eksikleri; alanlar fatura ekranında düzeltilir. */
  const ytbEksikleri = ebelgeWizard?.bilgi.ytb?.engeller ?? [];
  /**
   * Yolcu beraberi eksikleri panelde girilenlerle, sunucudaki kuralla hesaplanır.
   * İşaret konmamışsa tek eksik, VKN'si olmayan alıcıdır: o belge ancak yolcu
   * beraberi olarak gönderilebilir.
   */
  const yolcuEksikleri = ebelgeWizard?.bilgi.yolcuBeraberi
    ? ebelgeWizard.yolcu.isaretli
      // Sunucunun listesinden yalnız panelde hesaplanamayanlar alınır (satır ve
      // tip kuralları); kalanlar panelde girilen güncel değerlerden üretilir,
      // yoksa kullanıcı düzelttiği eksiği görmeye devam ederdi.
      ? [...ebelgeWizard.bilgi.yolcuBeraberi.engeller.filter((e) => e.alan === "satir" || e.alan === "tip"), ...yolcuBeraberiEngelleri(
          {
            yolcu: {
              ad: ebelgeWizard.yolcu.ad, soyad: ebelgeWizard.yolcu.soyad, uyruk: ebelgeWizard.yolcu.uyruk,
              pasaportNo: ebelgeWizard.yolcu.pasaportNo, pasaportTarihi: ebelgeWizard.yolcu.pasaportTarihi || null,
              sehir: ebelgeWizard.yolcu.sehir, ulke: ebelgeWizard.yolcu.ulke,
            },
            araciKurum: { vkn: ebelgeWizard.yolcu.araciKurumVkn, etiket: ebelgeWizard.yolcu.araciKurumEtiket, unvan: ebelgeWizard.yolcu.araciKurumUnvan },
          },
          // Satır kuralları (sıfır KDV, tevkifat) sunucunun listesinden gelir;
          // listedeki fatura satırları burada yok.
          { tip: ebelgeWizard.fatura.tip, tarih: ebelgeWizard.fatura.tarih, satirlar: [] },
        )].filter((e, i, liste) => liste.findIndex((d) => d.mesaj === e.mesaj) === i).map((e) => ({ mesaj: e.mesaj }))
      : ebelgeWizard.bilgi.yolcuBeraberi.aliciVknEksik
        ? [{ mesaj: "Alıcının VKN/TCKN'si yok; bu fatura ancak yolcu beraberi (tax-free) olarak gönderilebilir" }]
        : []
    : [];
  /*
   * EBLG-76: sevkiyat eksikleri sunucudaki kuralın aynısıyla hesaplanır, ama
   * sihirbazda girilen güncel değerlerle — kullanıcı seçimi yaptığı anda uyarı
   * kalkar. Firma e-İrsaliye mükellefi değilse kural hiç çalışmaz.
   */
  const sevkiyatWizardEksikleri = ebelgeWizard?.bilgi.sevkiyat
    ? sevkiyatEksikleri({
        sorulur: ebelgeWizard.bilgi.sevkiyat.gerekli,
        mukellef: ebelgeWizard.bilgi.sevkiyat.mukellef,
        yontem: ebelgeWizard.sevkiyat.yontem || null,
        irsaliyeSayisi: ebelgeWizard.sevkiyat.irsaliyeIds.length,
        fiiliSevkZamani: ebelgeWizard.sevkiyat.fiiliSevkZamani || null,
      })
    : [];
  /** İrsaliye yolunda seçilebilecek, gönderilmiş e-İrsaliyeler. */
  const sevkiyatAdaylari = ebelgeWizard?.bilgi.sevkiyat?.adaylar ?? [];
  /**
   * EBLG-82: fatura, bağlı irsaliyelerin faturalama süresinden sonra mı?
   * Faturaya zaten bağlı olanları sunucu söyler; sihirbazda yeni seçilen
   * e-İrsaliyeler burada aynı kuralla hesaplanır. Uyarıdır, engel değil.
   */
  const irsaliyeGecikmeUyarilari = (() => {
    if (!ebelgeWizard) return [];
    const sevkiyat = ebelgeWizard.bilgi.sevkiyat;
    const secilenler = ebelgeWizard.sevkiyat.yontem === "irsaliye"
      ? sevkiyatAdaylari.filter((a) => ebelgeWizard.sevkiyat.irsaliyeIds.includes(a.id) && a.faturaId !== ebelgeWizard.fatura.id && a.sevkGunu)
      : [];
    const yeniler = faturaGecikmeUyarilari({
      faturaTarihi: ebelgeWizard.fatura.tarih,
      yon: "satis",
      irsaliyeler: secilenler.map((a) => ({ no: a.no, sevkGunu: a.sevkGunu as string })),
      gunSayisi: sevkiyat?.irsaliyeFaturaGunSayisi,
    });
    return [...new Set([...(sevkiyat?.gecikmeler ?? []), ...yeniler])];
  })();
  const wizardGonderilebilir = Boolean(
    ebelgeWizard?.bilgi.gonderilebilir && sevkiyatWizardEksikleri.length === 0 && ihracatEngelleri.length === 0 && internetEngelleri.length === 0 && iadeEksikleri.length === 0 && kamuEksikleri.length === 0 && sgkEksikleri.length === 0 && sarjEksikleri.length === 0 && idisEksikleri.length === 0 && ytbEksikleri.length === 0 && yolcuEksikleri.length === 0,
  );

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
    if (!confirm("Bu faturanın iptalini e-Arşiv servisine bildirmek istediğinize emin misiniz? İptal geri alınamaz.")) return;
    setHata(""); setBasari("");
    try {
      await api(`/ebelge/earsiv/${id}/iptal-bildir`, { method: "POST", body: JSON.stringify({ iptalTarihi: new Date().toISOString() }) });
      setBasari("e-Arşiv iptali entegratöre bildirildi.");
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

  async function pdfAc(id: string) {
    setHata("");
    try {
      await apiPdfAc(`/fatura/${id}/pdf`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "PDF açılamadı");
    }
  }

  /**
   * EBLG-27: alıcıya giden belgenin görünümü. Kaynak arşivlenen UBL olduğu için
   * bu, yukarıdaki iç fatura çıktısından ayrı bir belgedir.
   */
  async function ebelgePdfAc(faturaId: string) {
    setHata("");
    try {
      await apiPdfAc(`/ebelge/giden/${faturaId}/pdf`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "e-Belge PDF açılamadı");
    }
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
            {yeniSayfasi ? <Button onClick={() => router.push(`/panel/fatura${yonBaglami ? `?yon=${yonBaglami}` : ""}`)}>Listeye dön</Button> : <ButtonLabel as="a" role="button" variant="primary" href={`/panel/fatura/yeni${yonBaglami ? `?yon=${yonBaglami}` : ""}`}>➕ Yeni Fatura</ButtonLabel>}
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
          <Field label="İhraç kayıtlı"><Select aria-label="İhraç kayıtlı" value={ihracKayitliFiltresi ?? ""} onChange={(e) => filtreDegistir("ihracKayitli", e.target.value)}><option value="">Tümü</option><option value="acik">Beyannamesi gelmemiş</option></Select></Field>
          <Field label="Kaydedilmiş görünüm"><Select aria-label="Kaydedilmiş görünüm" value="" onChange={(e) => { const gorunum = kayitliGorunumler.find((g) => g.id === e.target.value); if (gorunum) gorunumUygula(gorunum); }}><option value="">Görünüm seçin</option>{kayitliGorunumler.map((g) => <option value={g.id} key={g.id}>{g.ad}</option>)}</Select></Field>
        </div>
        <div className="saved-view-actions">
          {(durumFiltresi || ebelgeFiltresi || odemeFiltresi || ihracKayitliFiltresi) && <Button size="sm" type="button" onClick={() => filtreleriUygula({ yon: yonBaglami, durum: null, ebelge: null, odeme: null, ihracKayitli: null })}>Filtreleri temizle</Button>}
          <Button size="sm" type="button" onClick={() => setGorunumFormuAcik((acik) => !acik)}>Görünümü kaydet</Button>
        </div>
        {gorunumFormuAcik && <form className="saved-view-form" onSubmit={gorunumKaydet}><Input autoFocus aria-label="Görünüm adı" value={gorunumAdi} onChange={(e) => setGorunumAdi(e.target.value)} placeholder="Örn. Takip edilecek tahsilatlar" required /><Button size="sm" variant="primary" type="submit">Kaydet</Button><Button size="sm" type="button" onClick={() => setGorunumFormuAcik(false)}>Vazgeç</Button></form>}
        {kayitliGorunumler.length > 0 && <div className="saved-view-list" aria-label="Kaydedilmiş görünümleri yönet">{kayitliGorunumler.map((g) => <span key={g.id}><button type="button" onClick={() => filtreleriUygula(g)}>{g.ad}</button><button aria-label={g.ad + " görünümünü sil"} title="Görünümü sil" type="button" onClick={() => gorunumSil(g.id)}>×</button></span>)}</div>}
      </section>

      {epostaGonderilen && (
        <Card className="stack create-page__keep" style={{ marginBottom: "1.5rem", borderColor: "var(--accent)", maxWidth: 620 }}>
          <div className="between">
            <div className="card__title" style={{ margin: 0 }}>
              ✉️ Fatura PDF&apos;ini E-posta ile Gönder
            </div>
            <Button size="sm" onClick={() => { setEpostaGonderilen(null); setEpostaAdresi(""); }}>✖ Vazgeç</Button>
          </div>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            {epostaGonderilen.no} · {epostaGonderilen.cari.unvan} · {tl(epostaGonderilen.genelToplam, epostaGonderilen.dovizCinsi)}
          </p>
          {epostaGonderilen.ebelge?.tur === "earsiv" && epostaGonderilen.earsivGonderimSekli === "kagit" && (
            <div className="approval-impact is-warning">
              Bu e-Arşiv fatura GİB&apos;e kâğıt olarak teslim edilecek şekilde bildirildi. E-postayla göndermek yalnız bilgi amaçlı bir kopya olur.
            </div>
          )}
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
          <h3>{acikFatura ? `${saltOkunur ? "Fatura" : "Faturayı düzenle"} · ${acikFatura.no ?? (acikFatura.durum === "taslak" ? "Taslak" : acikFatura.durum === "kesin" ? "numara bekliyor" : "numarasız")}` :`Yeni ${tip.startsWith("alis") ? (tip === "alis_iade" ? "alış iade" : "alış") : tip === "proforma" ? "proforma" : "satış"} faturası`}</h3>
            <div className="row-tight">{acikFatura ? <FaturaDurumRozeti fatura={acikFatura} /> : <span className="badge badge--warning">Taslak</span>}{!yeniSayfasi && <Button size="sm" type="button" onClick={faturaFormunuAcKapat}>Vazgeç</Button>}</div>
          </div>
          {acikFatura && (
            <EylemCubugu etiket="Fatura eylemleri">
              {acikFatura.durum === "taslak" && <Button variant="primary" size="sm" type="button" onClick={() => void kesinlestirmeOzetiAc(acikFatura.id)}>🔒 Kesinleştir</Button>}
              {!acikFatura.ebelge && acikFatura.durum === "kesin" && ["satis", "alis_iade"].includes(acikFatura.tip) && ebelgeGonderilebilirFirma && <Button variant="primary" size="sm" type="button" onClick={() => void ebelgeWizardAc(acikFatura)}>🧾 e-Fatura Oluştur</Button>}
              {!acikFatura.ebelge && acikFatura.durum === "kesin" && !ebelgeGonderilebilirFirma && <span className="muted">Firma e-Fatura/e-Arşiv'e kayıtlı değil; fatura kağıt olarak düzenlenir.</span>}
              {faturaGeriAlmaEngeli(acikFatura) === null && <Button size="sm" type="button" onClick={() => void taslagaGeriAl(acikFatura)}>↩ Taslağa geri al</Button>}
              {acikFatura.ebelge && <Button size="sm" type="button" onClick={() => void ebelgePdfAc(acikFatura.id)}>📄 e-Belge PDF</Button>}
              {acikFatura.durum !== "taslak" && <Button size="sm" type="button" onClick={() => void pdfAc(acikFatura.id)}>🖨 PDF</Button>}
              {acikFatura.durum !== "taslak" && <Button size="sm" type="button" onClick={() => setEpostaGonderilen(acikFatura)}>✉️ E-posta</Button>}
              {acikFatura.ebelge?.entegratorRef && ["kuyrukta", "iletildi"].includes(acikFatura.ebelge.durum) && <Button size="sm" type="button" onClick={() => void ebelgeSorgula(acikFatura.id)}>Sorgula</Button>}
              {(acikFatura.ebelge?.durum === "hata" || acikFatura.ebelge?.takiliGonderim) && <Button size="sm" type="button" onClick={() => void ebelgeYenidenGonder(acikFatura.id)}>Yeniden gönder</Button>}
              <Button size="sm" type="button" onClick={() => setEkleriAcikFatura(acikFatura)}>📎 Ekler</Button>
              <EylemMenusu>
                {["satis", "alis"].includes(acikFatura.tip) && ["taslak", "kesin"].includes(acikFatura.durum) && (!acikFatura.ebelge || ["hata", "ret"].includes(acikFatura.ebelge.durum)) && <Button size="sm" type="button" onClick={() => setIrsaliyeBaglaFaturaId(acikFatura.id)}>🔗 İrsaliye bağla</Button>}
                {acikFatura.tip === "proforma" && <Button size="sm" type="button" onClick={() => void satisaDonustur(acikFatura.id)}>➡️ Satışa Dönüştür</Button>}
                <Button size="sm" type="button" onClick={() => void kopyala(acikFatura.id)}>📋 Kopyala</Button>
                <Button size="sm" type="button" onClick={() => router.push(`/panel/fatura/tekrarlayan?sablonFaturaId=${acikFatura.id}`)}>↻ Tekrarla</Button>
                <Button size="sm" type="button" onClick={() => void odemeDetayAc(acikFatura.id)}>Ödeme ayrıntısı</Button>
                {acikFatura.ebelge && <Button size="sm" type="button" onClick={() => void ebelgeDetayAc(acikFatura.id)}>e-Belge ayrıntısı</Button>}
                {acikFatura.durum === "taslak" && <Button variant="danger" size="sm" type="button" onClick={() => void iptalEt(acikFatura.id)}>İptal et</Button>}
                {acikFatura.durum === "kesin" && kesinIptalEdilebilir(acikFatura) && <Button variant="danger" size="sm" type="button" onClick={() => void kesinIptalEt(acikFatura)}>İptal et</Button>}
              </EylemMenusu>
            </EylemCubugu>
          )}
          {saltOkunur && (
            <p className="document-editor__note">
              {acikFatura?.durum === "iptal"
                ? "Bu fatura iptal edildiği için değiştirilemez."
                : acikFatura && faturaGeriAlmaEngeli(acikFatura) === null
                ? "Kesinleşmiş fatura doğrudan değiştirilemez. Düzeltmek için \"Taslağa geri al\" düğmesini kullanın."
                : "Bu faturanın e-belgesi oluşturulduğu için değiştirilemez; düzeltme iade faturasıyla yapılır."}
            </p>
          )}
          <fieldset className="document-editor__fieldset" disabled={saltOkunur}>
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
                  {/* Bağlantıyla açılan iade faturasında yön bağlamı boştur; seçenek yoksa
                      tarayıcı ilk seçeneği ("Satış Faturası") gösterir. */}
                  {(yonBaglami === "alis" || tip === "alis_iade") && <option value="alis_iade">Alış İade Faturası</option>}
                  {tip === "satis_iade" && <option value="satis_iade">Satış İade Faturası</option>}
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
                <Select value={dovizCinsi} onChange={(e) => belgeDoviziDegistir(e.target.value)}>
                  <option value="TRY">TRY — Türk Lirası</option><option value="USD">USD — Amerikan Doları</option><option value="EUR">EUR — Euro</option>
                </Select>
              </Field>
              {bekleyenCevrim && (
                <Alert tone="warning">
                  Kalem fiyatları {paraBirimiEtiketi(bekleyenCevrim.eskiDoviz)} cinsinden girildi. {paraBirimiEtiketi(dovizCinsi)} faturada kullanmak için kalemleri {yeniKurHazir ? `${dovizCinsi === "TRY" ? "1" : kur} kuruyla` : "yeni kur yüklenince"} {paraBirimiEtiketi(dovizCinsi)}'ye çevirin.{" "}
                  <Button size="sm" type="button" variant="primary" disabled={!yeniKurHazir || !(bekleyenCevrim.eskiKur > 0)} onClick={kalemleriCevir}>Kalemleri {paraBirimiEtiketi(dovizCinsi)}'ye çevir</Button>{" "}
                  <Button size="sm" type="button" onClick={dovizDegisiminiGeriAl}>Vazgeç ({paraBirimiEtiketi(bekleyenCevrim.eskiDoviz)} kalsın)</Button>
                </Alert>
              )}
              {dovizCinsi !== "TRY" && <Field label="Kur (1 döviz = TRY)"><Input type="number" min="0.000001" step="0.000001" value={kur} onChange={(e) => { setKur(e.target.value); setKurBilgisi("Manuel kur"); }} required /><small className="muted">{kurBilgisi || "TCMB EVDS kuru yükleniyor…"}</small></Field>}
              <Field label="Vade Tarihi">
                <Input aria-label="Vade Tarihi" type="date" value={vadeTarihi} onChange={(e) => { setVadeTarihi(e.target.value); setVadeElleDegisti(true); }} />
                {cariOzeti?.varsayilanVadeGun != null && <small className="muted">Cari varsayılanı: {cariOzeti.varsayilanVadeGun} gün</small>}
              </Field>
              {gidenBelge && (
                <Field label="e-Fatura Profili">
                  <Select
                    aria-label="e-Fatura Profili"
                    value={efaturaProfili}
                    onChange={(e) => { setEfaturaProfili(e.target.value as "temel" | "ticari"); setProfilElleDegisti(true); }}
                  >
                    <option value="temel">TEMELFATURA — alıcı yanıt veremez</option>
                    <option value="ticari">TICARIFATURA — alıcı 8 gün içinde kabul/ret verir</option>
                  </Select>
                  <small className="muted">
                    {cariOzeti ? `Cari varsayılanı: ${(cariOzeti.efaturaProfili ?? "temel") === "ticari" ? "TICARIFATURA" : "TEMELFATURA"}` : "Cari seçilince varsayılanı gelir"}
                  </small>
                </Field>
              )}
              {tip === "satis" && (
                <Field label="Özel matrah (KDV K. 23)">
                  <Select aria-label="Özel matrah" value={ozelMatrahKodu} onChange={(e) => setOzelMatrahKodu(e.target.value)}>
                    <option value="">Hayır — normal satış</option>
                    {OZEL_MATRAH_KODLARI.map((k) => <option key={k.kod} value={k.kod}>{k.kod} — {k.ad}</option>)}
                  </Select>
                  {ozelMatrahKodu ? (
                    <>
                      {/* Üç kutu da etiketlidir: değer girilince placeholder
                          kaybolduğu için hangisinin ne olduğu görünmez kalıyordu. */}
                      <Field label="KDV oranı (%)">
                        <Input
                          type="number" min="0" max="100" step="0.01" value={ozelMatrahOrani}
                          onChange={(e) => setOzelMatrahOrani(e.target.value)}
                        />
                      </Field>
                      {/* Satıcı "92.000'e aldım, 95.500'e satıyorum" diye düşünür;
                          farkın içindeki KDV'yi ayırmayı ondan beklemeyelim. */}
                      <Field label="KDV dahil kâr farkı (alış ile satış arası)">
                        <Input
                          type="number" min="0" step="0.01" value={ozelMatrahFarki}
                          placeholder="Örn. 3500"
                          onChange={(e) => {
                            setOzelMatrahFarki(e.target.value);
                            setOzelMatrahTutari(e.target.value ? ozelMatrahTabani(e.target.value, ozelMatrahOrani || 0).toFixed(2) : "");
                          }}
                        />
                      </Field>
                      <Field label="KDV matrahı (özel matrah)">
                        <Input
                          type="number" min="0" step="0.01" value={ozelMatrahTutari}
                          onChange={(e) => { setOzelMatrahTutari(e.target.value); setOzelMatrahFarki(""); }}
                        />
                      </Field>
                      <small className="muted">
                        Satırlara <strong>KDV hariç</strong> satış bedeli girilir (satır KDV oranları sıfırlandı); özel matrahın KDV'si ({ozelMatrahKdvsi(ozelMatrahTutari || 0, ozelMatrahOrani || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {dovizCinsi === "TRY" ? "TL" : dovizCinsi}) genel toplama eklenir.
                      </small>
                    </>
                  ) : <small className="muted">İkinci el araç/taşınmaz, müzayede, bayi satışı gibi KDV'si satış bedelinin tamamı üzerinden hesaplanmayan işlemlerde seçilir.</small>}
                </Field>
              )}
              {tip === "satis" && (
                <Field label="İhraç kayıtlı satış">
                  <Select aria-label="İhraç kayıtlı satış" value={ihracKayitliKodu} onChange={(e) => setIhracKayitliKodu(e.target.value)}>
                    <option value="">Hayır — normal satış</option>
                    {IHRAC_KAYITLI_KODLARI.map((k) => <option key={k.kod} value={k.kod}>{k.kod} — {k.ad}</option>)}
                  </Select>
                  <small className="muted">
                    {ihracKayitliKodu ? "KDV hesaplanır ve belgede görünür ama tahsil edilmez; ödenecek tutar matrahtır." : "İhracatçıya ihraç kaydıyla teslimde seçilir."}
                  </small>
                </Field>
              )}
              {gidenBelge && (
                /* EBLG-72: sevkiyat numarası Darphane bildiriminden döner; girilirse
                   belge İDİS profiliyle gider ve her satır etiket numarası ister. */
                <Field label="İDİS sevkiyat numarası">
                  <Input aria-label="İDİS sevkiyat numarası" value={idisSevkiyatNo} maxLength={20} placeholder="Örn. SE-0152457" onChange={(e) => setIdisSevkiyatNo(e.target.value)} />
                  <small className="muted">
                    {idisSevkiyatNo.trim()
                      ? "Belge İDİS kapsamında gider; satır ayrıntılarında etiket numaralarını girin."
                      : "İnşaat demiri teslimlerinde Darphane bildiriminden dönen numara yazılır; boşsa belge normal gider."}
                  </small>
                </Field>
              )}
              {gidenBelge && (
                /* EBLG-78: teşvik belge numarası girilirse belge YATIRIMTESVIK
                   profiliyle gider; satırlarda harcama tipi istenir. */
                <Field label="Yatırım teşvik belge no">
                  <Input aria-label="Yatırım teşvik belge no" value={ytbNo} maxLength={6} inputMode="numeric" placeholder="6 hane, örn. 123456" onChange={(e) => setYtbNo(e.target.value)} />
                  <small className="muted">
                    {ytbNo.trim()
                      ? "Belge yatırım teşvik kapsamında gider; satır ayrıntılarında harcama tipini seçin."
                      : "Yatırım teşvik belgeli teslimlerde E-TUYS'tan doğrulanan belge numarası yazılır; boşsa fatura normal gider."}
                  </small>
                </Field>
              )}
              {gidenBelge && ytbNo.trim() && (
                <Field label="Yatırım teşvik belge tarihi (zorunlu)">
                  <Input aria-label="Yatırım teşvik belge tarihi" type="date" value={ytbTarihi} onChange={(e) => setYtbTarihi(e.target.value)} />
                </Field>
              )}
              <Field label="Müşteri Sipariş No"><Input value={siparisNo} onChange={(e) => setSiparisNo(e.target.value)} maxLength={100} placeholder="Opsiyonel" /></Field>
              <Field label="Müşteri Sipariş Tarihi">
                <Input type="date" value={siparisTarihi} onChange={(e) => setSiparisTarihi(e.target.value)} />
                {/* EBLG-73: UBL'de sipariş tarihi zorunlu; boşsa belgeye fatura tarihi yazılır. */}
                {siparisNo.trim() && !siparisTarihi && <small className="muted">Boş bırakılırsa e-Belgeye fatura tarihi yazılır (GİB sipariş tarihini zorunlu tutuyor).</small>}
              </Field>
              {/* FTR-31: müşterinin talep referansı; sipariş no boşsa e-Belgeye o yazılır. */}
              {(tip === "satis" || tip === "proforma" || talepNo) && (
                <>
                  <Field label="Müşteri Talep No">
                    <Input aria-label="Müşteri talep numarası" value={talepNo} onChange={(e) => setTalepNo(e.target.value)} maxLength={100} placeholder="Opsiyonel" />
                    {talepNo.trim() && <small className="muted">{siparisNo.trim() ? "e-Belgede not olarak yazılır." : "Sipariş no boş olduğu için e-Belgede sipariş referansı olarak yazılır."}</small>}
                  </Field>
                  <Field label="Talep Tarihi"><Input aria-label="Müşteri talep tarihi" type="date" value={talepTarihi} onChange={(e) => setTalepTarihi(e.target.value)} /></Field>
                </>
              )}
              {/* FTR-32: müşteri tarafında ilgili kişi; zincirden gelir, faturada da değişir. */}
              {(tip === "satis" || tip === "proforma" || ilgili.ilgiliKisi) && (
                <IlgiliKisiAlanlari deger={ilgili} onChange={setIlgili} cariId={cariId || null} />
              )}
              {/* FTR-30: teslim yeri — irsaliyeden gelir, cari adresinden seçilir ya da elle girilir. */}
              {(tip === "satis" || teslimat.teslimatAdres) && (
                <div className="invoice-delivery">
                  <h4 className="invoice-delivery__title">Teslim yeri</h4>
                  <TeslimatAdresiAlanlari deger={teslimat} onChange={setTeslimat} cariId={cariId || null} kullanim="fatura" disabled={saltOkunur} />
                  {!saltOkunur && teslimat.teslimatAdres.trim() && !faturaTeslimYeriEksik(teslimat) && (
                    <label className="row invoice-delivery__full" style={{ gap: "0.4rem", alignItems: "center" }}>
                      <input type="checkbox" checked={teslimatiCariyeKaydet} onChange={(e) => setTeslimatiCariyeKaydet(e.target.checked)} />
                      <span>Bu adresi carinin sevk adreslerine ekle</span>
                    </label>
                  )}
                  {acikFatura?.teslimYeriUyarisi && <div className="invoice-delivery__full"><Alert tone="warning">{acikFatura.teslimYeriUyarisi}</Alert></div>}
                </div>
              )}
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
                  const stokYetersiz = !saltOkunur && tip === "satis" && seciliStok?.kullanilabilirMiktar !== undefined && Number(s.miktar) * birimKatsayisi(seciliStok, s.birim) > kullanilabilir;
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
                              stok.kullanilabilirMiktar !== undefined && `Stok: ${Number(stok.kullanilabilirMiktar).toLocaleString("tr-TR")} ${birimKisaAdi(stok.anaBirim ?? "adet")}`,
                              tip.startsWith("alis")
                                ? stok.alisFiyati && `Alış: ${tl(stok.alisFiyati, stok.alisFiyatiDoviz)}`
                                : stok.satisFiyati && `Satış: ${tl(stok.satisFiyati, stok.satisFiyatiDoviz)}`,
                              `KDV %${Number(stok.kdvOrani)}`,
                            ].filter(Boolean).join(" · "),
                            aramaMetni: [stok.kod, stok.barkod, ...(stok.tedarikciUrunKodlari ?? [])].filter(Boolean).join(" "),
                          }))}
                        />
                        {(stokVaryantlari[s.stokId]?.length ?? 0) > 0 && <Select aria-label="Varyant" required value={s.varyantId ?? ""} onChange={(e) => { const varyantId = e.target.value; setSatirlar((eskiler) => eskiler.map((x, i) => i === index ? { ...x, varyantId } : x)); if (varyantId) void kalemFiyatiGetir(s.stokId, varyantId).then((fiyat) => { if (fiyat) setSatirlar((eskiler) => eskiler.map((x, i) => i === index && x.varyantId === varyantId ? { ...x, ...fiyat } : x)); }); }}><option value="">Varyant seçin</option>{stokVaryantlari[s.stokId].filter((v) => v.aktif).map((v) => <option key={v.id} value={v.id}>{v.kod} — {v.ad} · Stok {Number(v.mevcutMiktar).toLocaleString("tr-TR")}</option>)}</Select>}
                        {satirDogrulamaHatalari.includes(index) && <p className="field-error" id={`fatura-satir-${index}-hatasi`} role="alert">Bu satır için ürün veya hizmet seçin.</p>}
                        {s.dovizUyarisi && <p className="field-error" role="alert">{s.dovizUyarisi}</p>}
                        {seciliStok && (
                          <span className={`document-line-stock${stokYetersiz ? " is-warning" : ""}`}>
                            {stokYetersiz
                              ? `Yetersiz stok: ${kullanilabilir.toLocaleString("tr-TR")} ${birimKisaAdi(seciliStok.anaBirim ?? "adet")} kullanılabilir`
                              : `Stok: ${kullanilabilir.toLocaleString("tr-TR")} ${birimKisaAdi(seciliStok.anaBirim ?? "adet")}`}
                          </span>
                        )}
                      </td>
                      <td className="invoice-line__field" data-label="Miktar"><div className="document-line-qty"><Input className="document-line-number" aria-label="Miktar" type="number" min="0.01" step="any" inputMode="decimal" ref={(eleman) => { miktarRefleri.current[index] = eleman; }} value={s.miktar} onChange={(e) => satirGuncelle(index, "miktar", Number(e.target.value))} required /><SatirBirimi stok={s.stokId ? seciliStok : undefined} value={s.birim} onChange={(birim) => satirBirimiDegistir(index, birim)} disabled={saltOkunur} /></div></td>
                      <td className="invoice-line__field" data-label="Birim fiyat"><Input className="document-line-number" aria-label="Birim fiyat" type="number" min="0" step="any" inputMode="decimal" value={s.birimFiyat} onChange={(e) => satirGuncelle(index, "birimFiyat", Number(e.target.value))} required /></td>
                      <td className="invoice-line__field" data-label="İskonto %"><Input className="document-line-number" aria-label="İskonto yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.iskontoOrani} onChange={(e) => satirGuncelle(index, "iskontoOrani", Number(e.target.value))} /></td>
                      <td className="invoice-line__field" data-label="KDV %"><Input className="document-line-number" aria-label="KDV yüzdesi" type="number" min="0" max="100" inputMode="decimal" value={s.kdvOrani} onChange={(e) => satirGuncelle(index, "kdvOrani", Number(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); satirEkle(); } }} required /></td>
                      <td className="num document-line-total invoice-line__total" data-label="Tutar">{tl(satirSonuc ? satirSonuc.toplamTutar : 0, dovizCinsi)}</td>
                      <td className="center invoice-line__action">
                        <Button aria-expanded={acikSatir === index} aria-label="Satır ayrıntıları" title="Satır ayrıntıları" size="sm" type="button" onClick={() => setAcikSatir(acikSatir === index ? null : index)}>⋯</Button>
                      </td>
                    </tr>
                    {acikSatir === index && (
                      <tr className="document-line-detail">
                        <td colSpan={7}>
                          <div className="document-line-detail__content">
                            <Field label={Number(s.kdvOrani) === 0 ? "GİB istisna kodu (zorunlu)" : "GİB istisna kodu"}>
                              <Select
                                aria-label="GİB istisna kodu"
                                value={s.gibIstisnaKodu || ""}
                                onChange={(e) => satirGuncelle(index, "gibIstisnaKodu", e.target.value)}
                              >
                                <option value="">{Number(s.kdvOrani) === 0 ? "Kod seçin" : "(KDV oranı sıfır değil)"}</option>
                                {/* Süzülen listede olmayan eski seçim görünür kalır; hatası satırda yazar. */}
                                {s.gibIstisnaKodu && !istisnaSecenekleri.some((k) => k.kod === s.gibIstisnaKodu) && (
                                  <option value={s.gibIstisnaKodu}>{s.gibIstisnaKodu} — bu faturada kullanılamaz</option>
                                )}
                                {(["tam", "kismi"] as const).map((tur) => {
                                  const kodlar = istisnaSecenekleri.filter((k) => k.tur === tur);
                                  return kodlar.length > 0 && (
                                    <optgroup key={tur} label={tur === "tam" ? "Tam istisna" : "Kısmi istisna"}>
                                      {kodlar.map((k) => <option key={k.kod} value={k.kod}>{k.kod} — {k.ad}</option>)}
                                    </optgroup>
                                  );
                                })}
                              </Select>
                            </Field>
                            <Field label="Tevkifat kodu">
                              <Select
                                aria-label="GİB tevkifat kodu"
                                value={s.tevkifatKodu || ""}
                                onChange={(e) => {
                                  const kod = tevkifatKoduBul(e.target.value);
                                  const yeniSatirlar = [...satirlar];
                                  // Oran koddan gelir; yalnız 650 için kullanıcı seçer (FTR-18).
                                  yeniSatirlar[index] = {
                                    ...s,
                                    tevkifatKodu: e.target.value,
                                    tevkifatOrani: kod && kod.oranlar.length === 1 ? kod.oranlar[0] : "",
                                  };
                                  setSatirlar(yeniSatirlar);
                                }}
                              >
                                <option value="">Tevkifat yok</option>
                                {TEVKIFAT_KODLARI.map((k) => (
                                  <option key={k.kod} value={k.kod}>
                                    {k.kod} — {k.ad}{k.oranlar.length === 1 ? ` (${k.oranlar[0]})` : ""}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            {(tevkifatKoduBul(s.tevkifatKodu)?.oranlar.length ?? 0) > 1 && (
                              <Field label="Tevkifat oranı">
                                <Select aria-label="Tevkifat oranı" value={s.tevkifatOrani || ""} onChange={(e) => satirGuncelle(index, "tevkifatOrani", e.target.value)}>
                                  <option value="">Oran seçin</option>
                                  {tevkifatKoduBul(s.tevkifatKodu)!.oranlar.map((o) => <option key={o} value={o}>{o}</option>)}
                                </Select>
                              </Field>
                            )}
                            {idisSevkiyatNo.trim() && (
                              <Field label="İDİS etiket numarası (zorunlu)">
                                <Input aria-label="İDİS etiket numarası" value={s.idisEtiketNo ?? ""} maxLength={20} placeholder="Örn. CV0152457" onChange={(e) => satirGuncelle(index, "idisEtiketNo", e.target.value)} />
                              </Field>
                            )}
                            {ytbNo.trim() && (
                              /* EBLG-78: harcama tipi belgede en az bir satırda zorunlu;
                                 makine kimlikleri yalnız 01'de istenir. */
                              <Field label="Yatırım teşvik harcama tipi">
                                <Select aria-label="Yatırım teşvik harcama tipi" value={s.ytbHarcamaTipi ?? ""} onChange={(e) => satirGuncelle(index, "ytbHarcamaTipi", e.target.value)}>
                                  <option value="">Seçilmedi</option>
                                  {YTB_HARCAMA_TIPLERI.map((h) => <option key={h.kod} value={h.kod}>{h.kod} — {h.ad}</option>)}
                                </Select>
                                <small className="muted">
                                  {ytbHarcamaTipiBul(s.ytbHarcamaTipi)?.kdvsizOlabilir
                                    ? `KDV'siz düzenlenecekse istisna kodu ${ytbHarcamaTipiBul(s.ytbHarcamaTipi)!.istisnaKodu} olmalıdır.`
                                    : ytbHarcamaTipiBul(s.ytbHarcamaTipi)
                                      ? "Bu harcama tipi KDV'siz düzenlenemez."
                                      : "Belgede en az bir satırda harcama tipi bulunmalıdır."}
                                </small>
                              </Field>
                            )}
                            {ytbNo.trim() && s.ytbHarcamaTipi === YTB_MAKINE_HARCAMA_TIPI && (<>
                              <Field label="Makine adı (zorunlu)">
                                <Input aria-label="Makine adı" value={s.ytbMakineAdi ?? ""} maxLength={200} onChange={(e) => satirGuncelle(index, "ytbMakineAdi", e.target.value)} />
                              </Field>
                              <Field label="Makine ID (zorunlu)">
                                <Input aria-label="Makine ID" value={s.ytbMakineId ?? ""} maxLength={60} placeholder="E-TUYS listesindeki makine kimliği" onChange={(e) => satirGuncelle(index, "ytbMakineId", e.target.value)} />
                              </Field>
                              <Field label="Makine teçhizat sıra no (zorunlu)">
                                <Input aria-label="Makine teçhizat sıra no" value={s.ytbMakineSiraNo ?? ""} maxLength={60} placeholder="Teşvik listesindeki satır numarası" onChange={(e) => satirGuncelle(index, "ytbMakineSiraNo", e.target.value)} />
                              </Field>
                            </>)}
                            {sarjSecimi.turu === "sarjanlik" && (
                              <Field label="Şarj ünitesi seri numarası (zorunlu)">
                                <Input aria-label="Şarj ünitesi seri numarası" value={s.sarjUniteSeriNo ?? ""} maxLength={60} onChange={(e) => satirGuncelle(index, "sarjUniteSeriNo", e.target.value)} />
                              </Field>
                            )}
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
                  <span>Brüt toplam</span><span>{tl(sonuc.toplamBrut, dovizCinsi)}</span>
                </div>
                <div className="document-total-line is-discount">
                  <span>Toplam iskonto</span><span>-{tl(sonuc.toplamSatirIskontosu, dovizCinsi)}</span>
                </div>
                <div className="document-total-line is-tax">
                  <span>{ihracKayitli ? "Hesaplanan KDV (tahsil edilmez)" : "KDV toplamı"}</span><span>{tl(sonuc.toplamKdv, dovizCinsi)}</span>
                </div>
                {sonuc.toplamTevkifat > 0 && (
                  <div className="document-total-line is-discount">
                    <span>Tevkifat</span><span>-{tl(sonuc.toplamTevkifat, dovizCinsi)}</span>
                  </div>
                )}
                <div className="document-total-line is-grand">
                  <span>Ödenecek</span><span>{tl(sonuc.genelToplam, dovizCinsi)}</span>
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

          {/* FTR-20: kaydetmeden önceki son kontrol. Ne göndereceğimizi
              satırlardan türetip gösterir; geçersiz senaryo burada durdurulur. */}
          <div className="document-editor__section">
            <h4 className="document-editor__section-title">Senaryo özeti</h4>
            <div className={`scenario-summary${senaryoUyarilari.length + ihracKayitliUyarilari.length + ozelMatrahUyarilari.length + idisUyarilari.length + sarjUyarilari.length > 0 ? " is-warning" : ""}`}>
              <div>
                <span>GİB senaryosu</span>
                <strong>{SENARYO_ADLARI[turetilenSenaryo]} · {senaryoUblKodu(turetilenSenaryo)}</strong>
              </div>
              {gidenBelge && (
                <div>
                  <span>e-Fatura profili</span>
                  <strong>{efaturaProfili === "ticari" ? "TICARIFATURA" : "TEMELFATURA"}</strong>
                </div>
              )}
              {idisSevkiyatNo.trim() && (
                <div>
                  <span>İDİS profili</span>
                  <strong>IDIS · {idisSevkiyatNo.trim().toUpperCase()}</strong>
                </div>
              )}
              {sarjSecimi.turu && (
                <div>
                  <span>Şarj belgesi</span>
                  <strong>{SARJ_TURU_ADLARI[sarjSecimi.turu]}</strong>
                </div>
              )}
              <div>
                <span>İstisnalı satır</span>
                <strong>{istisnaliSatirSayisi} / {satirlar.length}</strong>
              </div>
              <div>
                <span>Tevkifatlı satır</span>
                <strong>{tevkifatliSatirSayisi} / {satirlar.length}</strong>
              </div>
              <div>
                <span>{sonuc.toplamTevkifat > 0 ? "Tevkifat sonrası tahsil edilecek" : "Tahsil edilecek"}</span>
                <strong>{tl(sonuc.genelToplam, dovizCinsi)}</strong>
              </div>
              {ozelMatrahUyarilari.length > 0 && (
                <ul className="scenario-warnings">
                  {ozelMatrahUyarilari.map((mesaj) => <li key={mesaj}>{mesaj}</li>)}
                </ul>
              )}
              {ihracKayitliUyarilari.length > 0 && (
                <ul role="alert">{ihracKayitliUyarilari.map((mesaj) => <li key={mesaj}>{mesaj}</li>)}</ul>
              )}
              {senaryoUyarilari.length > 0 && (
                <ul role="alert">
                  {senaryoUyarilari.map((uyari, sira) => (
                    <li key={`${uyari.satirIndeksi}-${uyari.alan}-${sira}`}>Satır {uyari.satirIndeksi + 1}: {uyari.mesaj}</li>
                  ))}
                </ul>
              )}
              {(idisUyarilari.length > 0 || sarjUyarilari.length > 0) && (
                <ul role="alert">
                  {idisUyarilari.map((engel, sira) => <li key={`idis-${sira}`}>{engel.mesaj}</li>)}
                  {sarjUyarilari.map((mesaj) => <li key={mesaj}>{mesaj}</li>)}
                </ul>
              )}
            </div>
            <small className="muted">GİB kod listesi: {GIB_KOD_LISTESI_SURUMU}</small>
          </div>

          </fieldset>

          {!saltOkunur && (
            <div className="document-editor__actions">
              <Button variant="primary" onClick={kaydet}>{duzenlenenId ? "Değişiklikleri kaydet" : "Taslak faturayı kaydet"}</Button>
            </div>
          )}
        </div>
      )}
      <UrunSecimModali acik={urunModali !== null} baslangicStokId={urunModali?.stokId} stoklar={stoklar} cariId={cariId} tip={tip.startsWith("alis") ? "alis" : "satis"} belgeDovizi={dovizCinsi} belgeKuru={kur} belgeTarihi={tarih} onKapat={() => setUrunModali(null)} onEkle={(urun) => {
        setSatirlar((eskiler) => {
          const satir = { stokId: urun.stokId, varyantId: urun.varyantId, miktar: urun.miktar, birim: urun.birim, birimFiyat: urun.birimFiyat, iskontoOrani: urun.iskontoOrani, kdvOrani: urun.kdvOrani, gibIstisnaKodu: "" };
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

      {irsaliyeBaglaFaturaId && (
        <IrsaliyeBaglaPaneli
          kaynak={{ faturaId: irsaliyeBaglaFaturaId }}
          onKapat={() => setIrsaliyeBaglaFaturaId(null)}
          onBaglandi={(mesaj) => { setIrsaliyeBaglaFaturaId(null); setHata(""); setBasari(mesaj); void yukle(); }}
        />
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
            <Field label="Birim"><BirimSecimi value={yeniStokBirim} onChange={setYeniStokBirim} required /></Field>
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
                <div><dt>Matrah</dt><dd>{tl(fatura.toplamMatrah, fatura.dovizCinsi)}</dd></div>
                <div><dt>KDV</dt><dd>{tl(fatura.toplamKdv, fatura.dovizCinsi)}</dd></div>
                <div><dt>Genel toplam</dt><dd>{tl(fatura.genelToplam, fatura.dovizCinsi)}</dd></div>
              </dl>
              <div className="approval-effects">
                <div><span>Stok</span><strong>{proforma ? "Değişmeyecek" : `${toplamMiktar.toLocaleString("tr-TR")} birim ${satisYonlu ? "azalacak" : "artacak"}`}</strong></div>
                <div><span>Cari hesap</span><strong>{proforma ? "Değişmeyecek" : `${tl(fatura.genelToplam, fatura.dovizCinsi)} ${satisYonlu ? "borç" : "alacak"} yazılacak`}</strong></div>
                <div><span>e-Belge</span><strong>{proforma ? "Oluşmayacak" : "Kesinleştirme sonrası ayrıca wizard ile oluşturulacak"}</strong></div>
                <div><span>Tahmini risk</span><strong>{fatura.tip === "satis" ? tl(tahminiRisk) : "Değişmeyecek"}</strong></div>
              </div>
              {!fatura.cari.vknTckn && !proforma && <div className="approval-impact is-warning">Cari VKN/TCKN bilgisi eksik. e-Belge gönderiminden önce cari kartını tamamlayın.</div>}
              {riskAsimi && <div className="approval-impact is-warning">Kesinleştirme sonrasında tahmini risk {tl(tahminiRisk)} ile {tl(riskLimiti)} limitini aşacak.</div>}
              {/* Alış iadesini biz keseriz, numarası kendi serimizden gelir (EBLG-58). */}
              {fatura.tip === "alis" && <Field label="Tedarikçi fatura no *"><Input autoFocus value={faturaNo} onChange={(e) => setFaturaNo(e.target.value)} maxLength={100} placeholder="Tedarikçinin belge numarası" required /></Field>}
              <div className="quick-panel__actions">
                <Button type="button" onClick={() => setKesinlestirmeOzeti(null)}>Vazgeç</Button>
                <Button type="button" variant="primary" disabled={fatura.tip === "alis" && !faturaNo.trim()} onClick={() => void kesinlestir(fatura.id, faturaNo)}>Kesinleştir</Button>
              </div>
            </div>
          </HizliKayitPaneli>
        );
      })()}

      {ebelgeWizard && (
        <HizliKayitPaneli baslik="e-Fatura oluştur ve gönder" onKapat={() => setEbelgeWizard(null)}>
          <div className="approval-summary">
            <div className="approval-summary__identity">
              <strong>{ebelgeWizard.bilgi.cari}</strong>
              <span>{ebelgeWizard.fatura.no ?? "Numara gönderimde verilir"}</span>
            </div>
            <ol aria-label="Sihirbaz adımları" className="ebelge-steps ebelge-steps--sihirbaz">
              {(["Kontrol", "Bilgiler", "Önizle ve gönder"] as const).map((baslik, index) => {
                const sira = index + 1;
                const durum = sira < ebelgeWizard.adim ? "tamam" : sira === ebelgeWizard.adim ? "suanki" : "bekliyor";
                return (
                  <li className={`ebelge-steps__item is-${durum}`} key={baslik} aria-current={durum === "suanki" ? "step" : undefined}>
                    <strong><i aria-hidden="true">{durum === "tamam" ? "✓" : sira}</i>{baslik}</strong>
                  </li>
                );
              })}
            </ol>
            {ebelgeWizard.adim === 1 && <div className="approval-effects">
              <div><span>Alıcı VKN/TCKN</span><strong>{ebelgeWizard.bilgi.vknTckn || "Eksik"}</strong></div>
              <div><span>Entegratör</span><strong>{ebelgeWizard.bilgi.saglayici || "Tanımlı değil"}</strong></div>
              <div>
                <span>Belge türü</span>
                <strong>
                  {ebelgeWizard.bilgi.ihracat
                    ? `İhracat faturası — alıcı ${ebelgeWizard.bilgi.ihracat.ulkeAdi ?? ebelgeWizard.bilgi.ihracat.ulkeKodu} adresli`
                    : ebelgeWizard.bilgi.yurtDisiEarsiv
                      ? `e-Arşiv istisna (yurt dışı alıcı${ebelgeWizard.bilgi.yurtDisiEarsiv.ulkeAdi ? ` — ${ebelgeWizard.bilgi.yurtDisiEarsiv.ulkeAdi}` : ""}) — 301 mal / 302 hizmet`
                    : ebelgeWizard.bilgi.ihracKayitliKodu
                      ? `İhraç kayıtlı satış (${ebelgeWizard.bilgi.ihracKayitliKodu}) — KDV gösterilir, tahsil edilmez`
                      : "Mükellefiyet gönderim onayında sorgulanacak: e-Fatura / e-Arşiv"}
                </strong>
              </div>
            </div>}
            {ebelgeWizard.adim === 1 && Boolean(ebelgeWizard.bilgi.yurtDisiEarsiv?.engeller.length) && (
              <Alert tone="warning">{ebelgeWizard.bilgi.yurtDisiEarsiv!.engeller.map((e) => e.mesaj).join(" ")}</Alert>
            )}
            {ebelgeWizard.adim === 2 && (<>
            {ebelgeWizard.bilgi.ihracat && (
              <>
                <Field label="Fiili ihracat tarihi">
                  <Input
                    type="date"
                    value={ebelgeWizard.ihracat.teslimTarihi}
                    onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, ihracat: { ...ebelgeWizard.ihracat, teslimTarihi: e.target.value } })}
                  />
                </Field>
                <Field label="Teslim şartı (Incoterms)">
                  <Select
                    value={ebelgeWizard.ihracat.teslimSarti}
                    onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, ihracat: { ...ebelgeWizard.ihracat, teslimSarti: e.target.value } })}
                  >
                    <option value="">Belirtilmedi</option>
                    {TESLIM_SARTLARI.map((t) => <option key={t.kod} value={t.kod}>{t.ad}</option>)}
                  </Select>
                </Field>
                <Field label="Taşıma şekli">
                  <Select
                    value={ebelgeWizard.ihracat.tasimaSekli}
                    onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, ihracat: { ...ebelgeWizard.ihracat, tasimaSekli: e.target.value } })}
                  >
                    <option value="">Belirtilmedi</option>
                    {TASIMA_SEKILLERI.map((t) => <option key={t.kod} value={t.kod}>{t.ad}</option>)}
                  </Select>
                </Field>
                {ebelgeWizard.bilgi.ihracat.satirlar.length > 0 && (() => {
                  const kapSatirlari = ebelgeWizard.ihracat.satirlar;
                  const kapGuncelle = (id: string, degisiklik: Partial<IhracatKapSatiri>) => setEbelgeWizard({
                    ...ebelgeWizard,
                    ihracat: { ...ebelgeWizard.ihracat, satirlar: kapSatirlari.map((s) => (s.id === id ? { ...s, ...degisiklik } : s)) },
                  });
                  const ilkCins = kapSatirlari.find((s) => s.kapCinsi)?.kapCinsi ?? "";
                  return (
                    <Field label="Kap bilgisi (isteğe bağlı)">
                      <small className="muted">
                        Kalemin bulunduğu kabın cinsi, numarası ve adedi belgeye kalem bazında yazılır. Numara ya da adet giren satırda kap cinsi de seçilmelidir.
                      </small>
                      <div className="kap-listesi">
                        {ebelgeWizard.bilgi.ihracat!.satirlar.map((satir) => {
                          const girilen = kapSatirlari.find((s) => s.id === satir.id);
                          if (!girilen) return null;
                          return (
                            <div className="kap-listesi__kalem" key={satir.id}>
                              <strong>{satir.sira}. {satir.stokAdi}</strong> <small className="muted">· {satir.miktar.toLocaleString("tr-TR")} {satir.birim}</small>
                              <div className="kap-listesi__alanlar">
                                <Select aria-label={`${satir.sira}. satır kap cinsi`} value={girilen.kapCinsi} onChange={(e) => kapGuncelle(satir.id, { kapCinsi: e.target.value })}>
                                  <option value="">Kap cinsi —</option>
                                  <optgroup label="Sık kullanılanlar">
                                    {SIK_KAP_CINSLERI.map((k) => <option key={k.kod} value={k.kod}>{k.kod} — {k.ad}</option>)}
                                  </optgroup>
                                  <optgroup label="Tüm kodlar (UN/ECE Rec. 21)">
                                    {KAP_CINSLERI.map((k) => <option key={k.kod} value={k.kod}>{k.kod} — {k.ad}</option>)}
                                  </optgroup>
                                </Select>
                                <Input aria-label={`${satir.sira}. satır kap numarası`} placeholder="Kap no" maxLength={35} value={girilen.kapNo} onChange={(e) => kapGuncelle(satir.id, { kapNo: e.target.value })} />
                                <Input aria-label={`${satir.sira}. satır kap adedi`} placeholder="Adet" type="number" min={1} step={1} inputMode="numeric" value={girilen.kapAdet} onChange={(e) => kapGuncelle(satir.id, { kapAdet: e.target.value })} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {ilkCins && kapSatirlari.some((s) => s.kapCinsi !== ilkCins) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEbelgeWizard({ ...ebelgeWizard, ihracat: { ...ebelgeWizard.ihracat, satirlar: kapSatirlari.map((s) => ({ ...s, kapCinsi: ilkCins })) } })}
                        >
                          Kap cinsini ({ilkCins}) tüm kalemlere uygula
                        </Button>
                      )}
                    </Field>
                  );
                })()}
                {kapEksikSatirlari.length > 0 && (
                  <div className="approval-impact is-warning">
                    Kap numarası ya da adedi girilen şu satırlarda kap cinsi seçilmelidir: {kapEksikSatirlari.map((s) => `${s.sira}. ${s.stokAdi}`).join(", ")}
                  </div>
                )}
                {ihracatEngelleri.length > 0 && (
                  <div className="approval-impact is-warning">
                    <strong>Gönderimi engelleyen eksikler:</strong>
                    <ul>{ihracatEngelleri.map((e) => <li key={e.alan}>{e.mesaj}</li>)}</ul>
                    GTİP stok kartında, KDV oranı fatura satırında düzeltilir.
                  </div>
                )}
                {ebelgeWizard.bilgi.ihracat.menseiEksikleri.length > 0 && (
                  <div className="approval-impact is-warning">
                    Şu satırların menşei ülkesi çözülemedi, belgeye menşei yazılmayacak:{" "}
                    {ebelgeWizard.bilgi.ihracat.menseiEksikleri.map((m) => `${m.sira}. ${m.stokAdi} (${m.mensei})`).join(", ")}. Stok kartında ülke adını ya da iki harfli kodunu yazın.
                  </div>
                )}
              </>
            )}
            {ebelgeWizard.bilgi.yolcuBeraberi && (() => {
              const y = ebelgeWizard.yolcu;
              const yGuncelle = (degisiklik: Partial<typeof y>) => setEbelgeWizard({ ...ebelgeWizard, yolcu: { ...y, ...degisiklik } });
              return (
                <>
                  <label className="check-row">
                    <input type="checkbox" checked={y.isaretli} onChange={(e) => yGuncelle({ isaretli: e.target.checked })} />
                    Bu bir yolcu beraberi (tax-free) satışı — belge Gümrük Bakanlığı'na gider, KDV'yi yolcuya aracı kurum iade eder
                  </label>
                  {y.isaretli && (
                    <>
                      <Field label="Yolcunun adı *"><Input value={y.ad} maxLength={100} onChange={(e) => yGuncelle({ ad: e.target.value })} /></Field>
                      <Field label="Yolcunun soyadı *"><Input value={y.soyad} maxLength={100} onChange={(e) => yGuncelle({ soyad: e.target.value })} /></Field>
                      <Field label="Uyruğu (pasaportta yazan ülke) *">
                        <Select value={y.uyruk} onChange={(e) => yGuncelle({ uyruk: e.target.value })}>
                          <option value="">Ülke seçin…</option>
                          {ULKELER.map((u) => <option key={u.kod} value={u.kod}>{u.ad}</option>)}
                        </Select>
                      </Field>
                      <Field label="Pasaport no *"><Input value={y.pasaportNo} maxLength={40} onChange={(e) => yGuncelle({ pasaportNo: e.target.value })} /></Field>
                      <Field label="Pasaportun veriliş tarihi">
                        <Input type="date" value={y.pasaportTarihi} onChange={(e) => yGuncelle({ pasaportTarihi: e.target.value })} />
                        <small className="muted">Bilinmiyorsa boş bırakın; belgeye GİB'in kabul ettiği 01.01.2005 yazılır.</small>
                      </Field>
                      <Field label="İkamet ettiği şehir *"><Input value={y.sehir} maxLength={80} onChange={(e) => yGuncelle({ sehir: e.target.value })} /></Field>
                      <Field label="İkamet ettiği ülke *">
                        <Select value={y.ulke} onChange={(e) => yGuncelle({ ulke: e.target.value })}>
                          <option value="">Ülke seçin…</option>
                          {ULKELER.filter((u) => u.kod !== "TR").map((u) => <option key={u.kod} value={u.kod}>{u.ad}</option>)}
                        </Select>
                      </Field>
                      <Field label="İade hesabı (isteğe bağlı)">
                        <Input value={y.bankaHesapNo} maxLength={40} placeholder="Hesap no / IBAN" onChange={(e) => yGuncelle({ bankaHesapNo: e.target.value })} />
                        <Input value={y.bankaAdi} maxLength={120} placeholder="Banka adı" onChange={(e) => yGuncelle({ bankaAdi: e.target.value })} />
                      </Field>
                      <Field label="Aracı kurum VKN *"><Input value={y.araciKurumVkn} inputMode="numeric" maxLength={10} onChange={(e) => yGuncelle({ araciKurumVkn: e.target.value.replace(/\D/g, "") })} /></Field>
                      <Field label="Aracı kurum etiketi *"><Input value={y.araciKurumEtiket} maxLength={200} placeholder="urn:mail:yolcuberaberpk@firma.com.tr" onChange={(e) => yGuncelle({ araciKurumEtiket: e.target.value.trim() })} /></Field>
                      <Field label="Aracı kurum unvanı *"><Input value={y.araciKurumUnvan} maxLength={200} onChange={(e) => yGuncelle({ araciKurumUnvan: e.target.value })} /></Field>
                    </>
                  )}
                  {yolcuEksikleri.length > 0 && (
                    <div className="approval-impact is-warning">
                      <strong>Yolcu beraberi faturasında eksik olanlar:</strong>
                      <ul>{yolcuEksikleri.map((e, i) => <li key={i}>{e.mesaj}</li>)}</ul>
                    </div>
                  )}
                </>
              );
            })()}
            {ebelgeWizard.bilgi.sgk && (() => {
              const sgk = ebelgeWizard.sgk;
              const sgkGuncelle = (degisiklik: Partial<typeof sgk>) => setEbelgeWizard({ ...ebelgeWizard, sgk: { ...sgk, ...degisiklik } });
              const tip = ilaveFaturaTipiBul(sgk.ilaveFaturaTipi);
              return (
                <>
                  <strong>SGK faturası</strong>
                  <p className="muted" style={{ margin: 0 }}>
                    Alıcı Sosyal Güvenlik Kurumu (VKN {SGK_VKN}); belge SGK tipiyle ve Temel Fatura senaryosuyla düzenlenir.
                    Sabit alanların varsayılanı Ayarlar › Firma'da durur.
                  </p>
                  <Field label="İlave fatura tipi *">
                    <Select value={sgk.ilaveFaturaTipi} onChange={(e) => sgkGuncelle({ ilaveFaturaTipi: e.target.value })}>
                      <option value="">Seçin…</option>
                      {ILAVE_FATURA_TIPLERI.map((t) => <option key={t.kod} value={t.kod}>{t.kod} — {t.ad}</option>)}
                    </Select>
                  </Field>
                  {tip?.mukellefKoduEtiketi && (
                    <Field label={`${tip.mukellefKoduEtiketi} *`}>
                      <Input value={sgk.mukellefKodu} maxLength={40} placeholder={SGK_TANIMSIZ_KOD} onChange={(e) => sgkGuncelle({ mukellefKodu: e.target.value })} />
                    </Field>
                  )}
                  {tip?.mukellefAdiEtiketi && (
                    <Field label={`${tip.mukellefAdiEtiketi} *`}>
                      <Input value={sgk.mukellefAdi} maxLength={200} onChange={(e) => sgkGuncelle({ mukellefAdi: e.target.value })} />
                    </Field>
                  )}
                  {tip?.dosyaNoEtiketi && (
                    <Field label={`${tip.dosyaNoEtiketi} *`}>
                      <Input value={sgk.dosyaNo} maxLength={40} placeholder={SGK_TANIMSIZ_KOD} onChange={(e) => sgkGuncelle({ dosyaNo: e.target.value })} />
                    </Field>
                  )}
                  {tip?.donem && (
                    <>
                      <Field label="Dönem başlangıcı *">
                        <Input type="date" value={sgk.donemBaslangic} onChange={(e) => sgkGuncelle({ donemBaslangic: e.target.value })} />
                      </Field>
                      <Field label="Dönem bitişi *">
                        <Input type="date" value={sgk.donemBitis} onChange={(e) => sgkGuncelle({ donemBitis: e.target.value })} />
                      </Field>
                    </>
                  )}
                  {sgkEksikleri.length > 0 && (
                    <div className="approval-impact is-warning">
                      <strong>SGK faturasında eksik olanlar:</strong>
                      <ul>{sgkEksikleri.map((e) => <li key={e.alan}>{e.mesaj}</li>)}</ul>
                    </div>
                  )}
                </>
              );
            })()}
            {/* Şarj faturası (EBLG-71): tip stok kartından türedi; plaka, süre ve
                ESU raporları burada toplanır, ünite seri numarası satırdadır. */}
            {ebelgeWizard.bilgi.sarj && (() => {
              const sarj = ebelgeWizard.sarj;
              const sarjGuncelle = (degisiklik: Partial<typeof sarj>) => setEbelgeWizard({ ...ebelgeWizard, sarj: { ...sarj, ...degisiklik } });
              const raporlar = sarj.esuRaporlari;
              const raporGuncelle = (sira: number, degisiklik: Partial<{ raporId: string; tarih: string }>) =>
                sarjGuncelle({ esuRaporlari: raporlar.map((rapor, index) => index === sira ? { ...rapor, ...degisiklik } : rapor) });
              return (
                <>
                  <strong>{SARJ_TURU_ADLARI[ebelgeWizard.bilgi.sarj.turu]}</strong>
                  <p className="muted" style={{ margin: 0 }}>
                    Belge {ebelgeWizard.bilgi.sarj.turu === "sarj" ? "SARJ" : "SARJANLIK"} tipiyle gider; tip satırdaki stok kartından türedi.
                    Şarj edilen aracın plakası ile şarjın başlangıç ve bitiş anı zorunludur.
                  </p>
                  <Field label="Şarj edilen aracın plakası *">
                    <Input value={sarj.plaka} maxLength={20} placeholder="34ABC123" onChange={(e) => sarjGuncelle({ plaka: e.target.value })} />
                    <small className="muted">Yabancı plaka da yazılabilir; yalnız büyük harf, rakam, _ ve - kabul edilir.</small>
                  </Field>
                  <Field label="Şarj başlangıcı *">
                    <Input type="datetime-local" value={sarj.baslangic} onChange={(e) => sarjGuncelle({ baslangic: e.target.value })} />
                  </Field>
                  <Field label="Şarj bitişi *">
                    <Input type="datetime-local" value={sarj.bitis} onChange={(e) => sarjGuncelle({ bitis: e.target.value })} />
                  </Field>
                  {ebelgeWizard.bilgi.sarj.turu === "sarj" && (
                    <Field label="ESU rapor kimlikleri *">
                      {raporlar.map((rapor, index) => (
                        <div className="sarj-rapor" key={index}>
                          <Input
                            aria-label={`${index + 1}. ESU rapor kimliği`}
                            value={rapor.raporId}
                            maxLength={40}
                            placeholder="00000000-0000-0000-0000-000000000000"
                            onChange={(e) => raporGuncelle(index, { raporId: e.target.value.trim() })}
                          />
                          <Input
                            aria-label={`${index + 1}. ESU rapor tarihi`}
                            type="date"
                            value={rapor.tarih}
                            onChange={(e) => raporGuncelle(index, { tarih: e.target.value })}
                          />
                          <Button size="sm" type="button" variant="danger" onClick={() => sarjGuncelle({ esuRaporlari: raporlar.filter((_, i) => i !== index) })}>Sil</Button>
                        </div>
                      ))}
                      <Button size="sm" type="button" onClick={() => sarjGuncelle({ esuRaporlari: [...raporlar, { raporId: "", tarih: ebelgeWizard.fatura.tarih.slice(0, 10) }] })}>+ Rapor ekle</Button>
                      <small className="muted">Elektrikli Şarj Ünitesi raporunun GUID kimliği; belgede birden çok rapor bulunabilir.</small>
                    </Field>
                  )}
                  {ebelgeWizard.bilgi.sarj.turu === "sarjanlik" && (
                    <div className="approval-impact">
                      Ünite seri numaraları fatura satırlarında durur:{" "}
                      {ebelgeWizard.bilgi.sarj.satirlar.map((satir) => `${satir.sira}. ${satir.stok} — ${satir.uniteSeriNo ?? "eksik"}`).join(", ")}
                    </div>
                  )}
                  {sarjEksikleri.length > 0 && (
                    <div className="approval-impact is-warning">
                      <strong>Şarj faturasında eksik olanlar:</strong>
                      <ul>{sarjEksikleri.map((e, sira) => <li key={`${e.alan}-${sira}`}>{e.mesaj}</li>)}</ul>
                    </div>
                  )}
                </>
              );
            })()}
            {/* İDİS (EBLG-72): alanlar fatura formunda; sihirbaz eksikleri gösterir. */}
            {ebelgeWizard.bilgi.idis && (
              <>
                <strong>İDİS kapsamında teslim</strong>
                <p className="muted" style={{ margin: 0 }}>
                  Belge IDIS profiliyle gider; sevkiyat numarası {ebelgeWizard.bilgi.idis.sevkiyatNo}, etiket numaraları satırlarda taşınır.
                </p>
                {idisEksikleri.length > 0 && (
                  <div className="approval-impact is-warning">
                    <strong>İDİS belgesinde eksik olanlar:</strong>
                    <ul>{idisEksikleri.map((e, sira) => <li key={`${e.alan}-${sira}`}>{e.mesaj}</li>)}</ul>
                    Sevkiyat ve etiket numaraları fatura ekranında düzeltilir.
                  </div>
                )}
              </>
            )}
            {/* Yatırım teşvik (EBLG-78): alanlar fatura formunda; sihirbaz eksikleri gösterir. */}
            {ebelgeWizard.bilgi.ytb && (
              <>
                <strong>Yatırım teşvik kapsamında teslim</strong>
                <p className="muted" style={{ margin: 0 }}>
                  Belge YATIRIMTESVIK profiliyle gider (e-Arşiv&apos;e düşerse tip YTB önekli olur); teşvik belgesi {ebelgeWizard.bilgi.ytb.ytbNo}
                  {ebelgeWizard.bilgi.ytb.ytbTarihi ? `, ${new Date(ebelgeWizard.bilgi.ytb.ytbTarihi).toLocaleDateString("tr-TR")}` : ""}.
                </p>
                {ytbEksikleri.length > 0 && (
                  <div className="approval-impact is-warning">
                    <strong>Yatırım teşvik faturasında eksik olanlar:</strong>
                    <ul>{ytbEksikleri.map((e, sira) => <li key={`${e.alan}-${sira}`}>{e.mesaj}</li>)}</ul>
                    Teşvik belge bilgileri ve harcama tipi fatura ekranında düzeltilir.
                  </div>
                )}
              </>
            )}
            {ebelgeWizard.bilgi.kamu && (() => {
              const kamu = ebelgeWizard.kamu;
              const kamuGuncelle = (degisiklik: Partial<typeof kamu>) => setEbelgeWizard({ ...ebelgeWizard, kamu: { ...kamu, ...degisiklik } });
              const hesaplar = ebelgeWizard.bilgi.kamu.hesaplar;
              return (
                <>
                  <strong>KAMU senaryosu</strong>
                  <p className="muted" style={{ margin: 0 }}>
                    {ebelgeWizard.bilgi.kamu.kaynak === "liste"
                      ? "Alıcı GİB listesinde kamu idaresi olarak kayıtlı."
                      : "Alıcı, cari kartında kamu idaresi olarak işaretli."}{" "}
                    Belgeye ödemeyi yapacak harcama birimi ve ödemenin yapılacağı IBAN yazılır.
                  </p>
                  <Field label="Harcama birimi VKN *">
                    <Input value={kamu.harcamaBirimiVkn} inputMode="numeric" maxLength={10} onChange={(e) => kamuGuncelle({ harcamaBirimiVkn: e.target.value.replace(/\D/g, "") })} />
                  </Field>
                  <Field label="Harcama birimi adı *">
                    <Input value={kamu.harcamaBirimiAdi} maxLength={200} onChange={(e) => kamuGuncelle({ harcamaBirimiAdi: e.target.value })} />
                  </Field>
                  <Field label="Ödemenin yapılacağı IBAN *">
                    <Select value={kamu.iban} onChange={(e) => kamuGuncelle({ iban: e.target.value })}>
                      <option value="">{hesaplar.length ? "Hesap seçin…" : "IBAN'lı TRY banka hesabı yok"}</option>
                      {hesaplar.map((h) => <option key={h.id} value={h.iban}>{h.ad} · {h.bankaAdi} · {h.iban}</option>)}
                    </Select>
                  </Field>
                  {kamuEksikleri.length > 0 && (
                    <div className="approval-impact is-warning">
                      <strong>KAMU faturasında eksik olanlar:</strong>
                      <ul>{kamuEksikleri.map((e) => <li key={e.alan}>{e.mesaj}</li>)}</ul>
                    </div>
                  )}
                </>
              );
            })()}
            {ebelgeWizard.bilgi.iade && (() => {
              const iade = ebelgeWizard.iade;
              const iadeGuncelle = (degisiklik: Partial<typeof iade>) => setEbelgeWizard({ ...ebelgeWizard, iade: { ...iade, ...degisiklik } });
              const secilmemisAdaylar = ebelgeWizard.bilgi.iade.adaylar.filter((a) => !iade.referanslar.some((r) => r.kaynakFaturaId === a.id));
              return (
                <>
                  <strong>İade edilen faturalar</strong>
                  {iade.referanslar.length > 0 && (
                    <div className="approval-impact">
                      <ul>
                        {iade.referanslar.map((r, index) => (
                          <li key={`${r.belgeNo}-${index}`}>
                            {r.belgeNo} · {r.tarih ? new Date(r.tarih).toLocaleDateString("tr-TR") : "tarih yok"}{!r.kaynakFaturaId && " · elle girildi"}{" "}
                            <Button type="button" size="sm" onClick={() => iadeGuncelle({ referanslar: iade.referanslar.filter((_, i) => i !== index) })}>Kaldır</Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {secilmemisAdaylar.length > 0 && (
                    <Field label="Bu tedarikçinin alış faturalarından seç">
                      <Select
                        value=""
                        onChange={(e) => {
                          const aday = secilmemisAdaylar.find((a) => a.id === e.target.value);
                          if (aday) iadeGuncelle({ referanslar: [...iade.referanslar, { kaynakFaturaId: aday.id, belgeNo: aday.no, tarih: aday.tarih.slice(0, 10) }] });
                        }}
                      >
                        <option value="">Fatura seçin…</option>
                        {secilmemisAdaylar.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.no} · {new Date(a.tarih).toLocaleDateString("tr-TR")} · {Number(a.genelToplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {a.dovizCinsi}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field label="Sistemde olmayan fatura: 16 haneli numara ve tarih">
                    <Input
                      value={iade.elleNo}
                      maxLength={16}
                      placeholder="ABC2026000000001"
                      onChange={(e) => iadeGuncelle({ elleNo: e.target.value.toLocaleUpperCase("tr-TR") })}
                    />
                    <Input type="date" value={iade.elleTarih} onChange={(e) => iadeGuncelle({ elleTarih: e.target.value })} />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!iade.elleNo.trim() || !iade.elleTarih}
                      onClick={() => iadeGuncelle({ referanslar: [...iade.referanslar, { kaynakFaturaId: null, belgeNo: iade.elleNo.trim(), tarih: iade.elleTarih }], elleNo: "", elleTarih: "" })}
                    >
                      Ekle
                    </Button>
                  </Field>
                  {iadeEksikleri.length > 0 && (
                    <div className="approval-impact is-warning">
                      <strong>İade faturasında eksik olanlar:</strong>
                      <ul>{iadeEksikleri.map((e, i) => <li key={`${e.sira ?? 0}-${i}`}>{e.mesaj}</li>)}</ul>
                    </div>
                  )}
                </>
              );
            })()}
            {ebelgeWizard.bilgi.internetSatisi && !ebelgeWizard.bilgi.ihracat && !ebelgeWizard.bilgi.kamu && (
              <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={ebelgeWizard.internet.isaretli}
                    onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, internet: { ...ebelgeWizard.internet, isaretli: e.target.checked } })}
                  />
                  Bu bir internet satışı — e-Arşiv olarak düzenlenirse ödeme ve gönderi bilgisi belgeye yazılır
                </label>
                {ebelgeWizard.internet.isaretli && (
                  <>
                    <Field label="Satışın yapıldığı web adresi">
                      <Input
                        value={ebelgeWizard.internet.webAdresi}
                        placeholder="https://magaza.example.com"
                        onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, internet: { ...ebelgeWizard.internet, webAdresi: e.target.value } })}
                      />
                    </Field>
                    <Field label="Ödeme şekli">
                      <Select
                        value={ebelgeWizard.internet.odemeSekli}
                        onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, internet: { ...ebelgeWizard.internet, odemeSekli: e.target.value } })}
                      >
                        <option value="">Seçilmedi</option>
                        {ODEME_SEKILLERI.map((o) => <option key={o.kod} value={o.kod}>{o.ad}</option>)}
                      </Select>
                    </Field>
                    <Field label="Ödeme tarihi">
                      <Input
                        type="date"
                        value={ebelgeWizard.internet.odemeTarihi}
                        onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, internet: { ...ebelgeWizard.internet, odemeTarihi: e.target.value } })}
                      />
                    </Field>
                    <Field label="Ödeme aracısı (varsa)">
                      <Input
                        value={ebelgeWizard.internet.odemeAracisi}
                        placeholder="iyzico, PayPal…"
                        onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, internet: { ...ebelgeWizard.internet, odemeAracisi: e.target.value } })}
                      />
                    </Field>
                    <Field label="Kargo / taşıyıcı firma (varsa)">
                      <Input
                        value={ebelgeWizard.internet.tasiyiciUnvan}
                        onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, internet: { ...ebelgeWizard.internet, tasiyiciUnvan: e.target.value } })}
                      />
                    </Field>
                    <Field label="Taşıyıcı VKN/TCKN (varsa)">
                      <Input
                        value={ebelgeWizard.internet.tasiyiciVkn}
                        inputMode="numeric"
                        onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, internet: { ...ebelgeWizard.internet, tasiyiciVkn: e.target.value.replace(/\D/g, "") } })}
                      />
                    </Field>
                    <Field label="Gönderi tarihi (varsa)">
                      <Input
                        type="date"
                        value={ebelgeWizard.internet.gonderiTarihi}
                        onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, internet: { ...ebelgeWizard.internet, gonderiTarihi: e.target.value } })}
                      />
                    </Field>
                    {internetEngelleri.length > 0 && (
                      <div className="approval-impact is-warning">
                        <strong>İnternet satışında eksik olanlar:</strong>
                        <ul>{internetEngelleri.map((e) => <li key={e.alan}>{e.mesaj}</li>)}</ul>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {ebelgeWizard.bilgi.gonderilebilir && !ebelgeWizard.bilgi.ihracat && !ebelgeWizard.bilgi.kamu && (
              <Field label="e-Arşiv olarak düzenlenirse teslim şekli">
                <Select value={ebelgeWizard.earsivSekli} onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, earsivSekli: e.target.value as "elektronik" | "kagit" })}>
                  <option value="elektronik">Elektronik — PDF e-postayla iletilir</option>
                  <option value="kagit">Kâğıt — basılı olarak teslim edilir</option>
                </Select>
              </Field>
            )}
            </>)}
            {ebelgeWizard.adim === 1 && (<>
            {irsaliyeGecikmeUyarilari.length > 0 && (
              <Alert tone="warning">
                <strong>Faturalama süresi</strong> — gönderime engel değil:
                <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
                  {irsaliyeGecikmeUyarilari.map((u) => <li key={u}>{u}</li>)}
                </ul>
              </Alert>
            )}
            {/* Firma e-İrsaliye mükellefi değilse (ya da e-Fatura kapalıysa, EBLG-77) soru hiç sorulmaz. */}
            {ebelgeWizard.bilgi.sevkiyat?.gerekli && ebelgeWizard.bilgi.sevkiyat.mukellef !== false && (
              <div className="approval-impact">
                <strong>Sevkiyat ve e-İrsaliye</strong>
                {/* EBLG-76: yol seçilmeden belge gönderilmez; üç yol birbirini dışlar. */}
                {ebelgeWizard.bilgi.sevkiyat.mukellef === null ? (
                  <p>Firmanın e-İrsaliye mükellefiyeti bilinmiyor. Firma ayarlarından belirtin ya da entegratör mükellef listesini güncelleyin.</p>
                ) : (
                  <div className="stack">
                    {SEVKIYAT_YONTEMLERI.map((yol) => (
                      <div key={yol.kod}>
                        <label>
                          <input
                            type="radio"
                            name="sevkiyat-yontemi"
                            checked={ebelgeWizard.sevkiyat.yontem === yol.kod}
                            onChange={() => setEbelgeWizard({ ...ebelgeWizard, sevkiyat: { ...ebelgeWizard.sevkiyat, yontem: yol.kod, irsaliyeIds: yol.kod === "irsaliye" ? ebelgeWizard.sevkiyat.irsaliyeIds : [] } })}
                          />{" "}
                          {yol.etiket}
                        </label>
                        {yol.kod === "irsaliye" && ebelgeWizard.sevkiyat.yontem === "irsaliye" && (
                          <div className="stack" style={{ marginLeft: 24 }}>
                            {sevkiyatAdaylari.length === 0
                              ? <p className="muted">Bu müşteriye gönderilmiş, henüz faturaya bağlanmamış e-İrsaliye yok.</p>
                              : sevkiyatAdaylari.map((a) => (
                                <label key={a.id}>
                                  <input
                                    type="checkbox"
                                    checked={ebelgeWizard.sevkiyat.irsaliyeIds.includes(a.id)}
                                    onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, sevkiyat: { ...ebelgeWizard.sevkiyat, irsaliyeIds: e.target.checked ? [...ebelgeWizard.sevkiyat.irsaliyeIds, a.id] : ebelgeWizard.sevkiyat.irsaliyeIds.filter((id) => id !== a.id) } })}
                                  />{" "}
                                  {a.no} · {new Date(a.tarih).toLocaleDateString("tr-TR")}
                                </label>
                              ))}
                          </div>
                        )}
                        {yol.kod === "irsaliye_yerine" && ebelgeWizard.sevkiyat.yontem === "irsaliye_yerine" && (
                          <div className="stack" style={{ marginLeft: 24 }}>
                            <Field label="Fiili sevk tarihi ve saati">
                              <Input
                                aria-label="Fiili sevk tarihi ve saati"
                                type="datetime-local"
                                value={ebelgeWizard.sevkiyat.fiiliSevkZamani}
                                onChange={(e) => setEbelgeWizard({ ...ebelgeWizard, sevkiyat: { ...ebelgeWizard.sevkiyat, fiiliSevkZamani: e.target.value } })}
                              />
                            </Field>
                            {/* Belge e-Arşiv'e düşerse ibare o belgenin adını söyler; kararı sunucu verir. */}
                            <p className="muted">Belgeye şu ibare yazılır: &quot;{irsaliyeYerineIbaresi()}&quot;</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {sevkiyatWizardEksikleri.map((eksik) => <p key={eksik} className="muted">{eksik}</p>)}
              </div>
            )}
            {ebelgeWizard.bilgi.aliciAdi?.tahmin && (
              <div className="approval-impact is-warning">
                Carinin adı ve soyadı kartta girilmemiş; e-Arşiv&apos;e unvandan tahminle Ad: <strong>{ebelgeWizard.bilgi.aliciAdi.ad}</strong>, Soyad: <strong>{ebelgeWizard.bilgi.aliciAdi.soyad}</strong> yazılacak. Doğru değilse cari kartında düzeltin.
              </div>
            )}
            {ebelgeWizard.bilgi.adresEksik && (
              <div className="approval-impact is-warning">
                Cari kartında adres yok; belgeye il ve ilçe yerine &quot;-&quot; yazılacak. Doğru adresi cari kartının adresler bölümüne ekleyin.
              </div>
            )}
            {(ebelgeWizard.bilgi.birimUyarilari?.length ?? 0) > 0 && (
              <div className="approval-impact is-warning">
                Şu satırların birimi GİB kod listesinde yok, belgeye <strong>adet</strong> olarak yazılacak:{" "}
                {ebelgeWizard.bilgi.birimUyarilari!.map((u) => `${u.sira}. ${u.stok} (${u.birim})`).join(", ")}. Doğru değilse stok kartındaki birimi düzeltin.
              </div>
            )}
            {ebelgeWizard.bilgi.neden && !ebelgeWizard.bilgi.ihracat && <div className="approval-impact is-warning">{ebelgeWizard.bilgi.neden}</div>}
            {ebelgeWizard.bilgi.not && <div className="approval-impact">{ebelgeWizard.bilgi.not}</div>}
            </>)}
            {ebelgeWizard.adim === 3 && (() => {
              const o = ebelgeWizard.onizleme;
              if (!o || o.durum === "yukleniyor") return <p className="subtle">Belge gönderilecek hâliyle üretilip entegratörde denetleniyor…</p>;
              if (o.durum === "hata") return <div className="approval-impact is-warning"><strong>Önizleme alınamadı:</strong> {o.mesaj}</div>;
              return (
                <>
                  <div className="approval-effects">
                    <div><span>Kanal</span><strong>{o.tur === "efatura" ? "e-Fatura" : "e-Arşiv"}</strong></div>
                    {o.profil && <div><span>Senaryo</span><strong>{o.profil}</strong></div>}
                    {o.tip && <div><span>Fatura tipi</span><strong>{o.tip}</strong></div>}
                  </div>
                  {!o.destekleniyor && (
                    <div className="approval-impact">Entegratörün önizleme ucu yok; belge gönderimde denetlenecek.</div>
                  )}
                  {o.destekleniyor && !o.basarili && (
                    <div className="approval-impact is-warning">
                      <strong>Entegratör belgeyi kabul etmedi:</strong> {o.hataMesaji}
                      <br />Geri dönüp bilgileri düzeltin; belge gönderilmedi, numara harcanmadı.
                    </div>
                  )}
                  {o.destekleniyor && o.basarili && o.html && (
                    <>
                      <div className="approval-impact">
                        Entegratörün denetiminden geçti. Alıcının göreceği görünüm:{" "}
                        <Button type="button" size="sm" onClick={() => setEbelgeWizard({ ...ebelgeWizard, tamEkran: true })}>Tam ekran aç</Button>
                      </div>
                      {/* Görünüm entegratörden gelir ve karekodu betikle çizer; ayrı kökende, betiğe izinli ama sayfaya erişimsiz çalışır. */}
                      <iframe
                        title="Belge önizlemesi"
                        sandbox="allow-scripts"
                        srcDoc={o.html}
                        style={{ width: "100%", height: "32rem", border: "1px solid var(--border)", borderRadius: "0.6rem", background: "#fff" }}
                      />
                    </>
                  )}
                </>
              );
            })()}
            <div className="quick-panel__actions">
              {ebelgeWizard.adim === 1
                ? <Button type="button" onClick={() => setEbelgeWizard(null)}>Vazgeç</Button>
                : <Button type="button" onClick={() => setEbelgeWizard({ ...ebelgeWizard, adim: (ebelgeWizard.adim - 1) as 1 | 2, onizleme: null })}>← Geri</Button>}
              {ebelgeWizard.adim === 1 && (
                <Button type="button" variant="primary" disabled={!ebelgeWizard.bilgi.gonderilebilir} onClick={() => setEbelgeWizard({ ...ebelgeWizard, adim: 2 })}>İleri →</Button>
              )}
              {ebelgeWizard.adim === 2 && (
                <Button type="button" variant="primary" disabled={!wizardGonderilebilir} onClick={() => void ebelgeOnizle(ebelgeWizard)}>Önizle →</Button>
              )}
              {ebelgeWizard.adim === 3 && (
                <Button
                  type="button"
                  variant="primary"
                  disabled={!(ebelgeWizard.onizleme?.durum === "hazir" && (ebelgeWizard.onizleme.basarili || !ebelgeWizard.onizleme.destekleniyor))}
                  onClick={() => void ebelgeWizardGonder()}
                >
                  Gönder
                </Button>
              )}
            </div>
          </div>
        </HizliKayitPaneli>
      )}
      {ebelgeWizard?.tamEkran && ebelgeWizard.onizleme?.durum === "hazir" && ebelgeWizard.onizleme.html && (
        <BelgeOnizlemeEkrani
          baslik={`Önizleme · ${ebelgeWizard.bilgi.cari}`}
          html={ebelgeWizard.onizleme.html}
          onKapat={() => setEbelgeWizard({ ...ebelgeWizard, tamEkran: false })}
        />
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
              {ebelgeDetayi.ebelge.aliciYaniti && (
                <div className={`status-history__item${ebelgeDetayi.ebelge.aliciYaniti === "ret" ? " is-error" : " is-complete"}`}>
                  <span />
                  <div>
                    <strong>{ebelgeDetayi.ebelge.aliciYaniti === "ret" ? "Alıcı faturayı reddetti" : "Alıcı faturayı kabul etti"}</strong>
                    <small>{ebelgeDetayi.ebelge.aliciYanitZamani ? new Date(ebelgeDetayi.ebelge.aliciYanitZamani).toLocaleDateString("tr-TR") : "—"}</small>
                  </div>
                </div>
              )}
            </div>
            <dl>
              <div><dt>Entegratör referansı</dt><dd>{ebelgeDetayi.ebelge.entegratorRef || "Henüz oluşmadı"}</dd></div>
              <div><dt>Son güncelleme</dt><dd>{new Date(ebelgeDetayi.ebelge.updatedAt).toLocaleString("tr-TR")}</dd></div>
            </dl>
            {ebelgeDetayi.ebelge.hataMesaji && <div className="approval-impact is-warning">{ebelgeDetayi.ebelge.hataMesaji}</div>}
            {(ebelgeDetayi.ebelge.aliciYaniti === "ret" || ebelgeDetayi.ebelge.durum === "ret") && (
              <div className="approval-impact is-warning">
                Alıcı ret gerekçesi: {ebelgeDetayi.ebelge.aliciYanitNotu || "belirtilmedi"}. Ret alan ticari fatura için iade faturası kesilmesi gerekir.
              </div>
            )}
            {/* EBLG-35: kayıt güncellendikçe key değişir, geçmiş yeniden yüklenir. */}
            <DurumGecmisi
              key={ebelgeDetayi.ebelge.updatedAt}
              adres={`/fatura/${ebelgeDetayi.id}/durum-gecmisi`}
              akis={{
                tur: ebelgeDetayi.ebelge.tur === "earsiv" ? "earsiv" : "efatura",
                profil: ebelgeDetayi.efaturaProfili ?? "temel",
                durum: ebelgeDetayi.durum === "iptal" ? "iptal" : ebelgeDetayi.ebelge.durum,
                aliciYaniti: ebelgeDetayi.ebelge.aliciYaniti ?? null,
              }}
            />
            {/* EBLG-54: beyanname numarası gümrük kapandıktan sonra girilir; belge yeniden gönderilmez. */}
            {ebelgeDetayi.ebelge.tur === "efatura" && (
              beyanname ? (
                <div className="approval-impact">
                  <Field label="Gümrük beyanname numarası">
                    <Input value={beyanname.no} onChange={(e) => setBeyanname({ ...beyanname, no: e.target.value })} placeholder="26060100EX123456" />
                  </Field>
                  <Field label="Beyanname tarihi">
                    <Input type="date" value={beyanname.tarih} onChange={(e) => setBeyanname({ ...beyanname, tarih: e.target.value })} />
                  </Field>
                  <p className="subtle">Numara yalnız kayda işlenir; gönderilmiş e-Fatura değiştirilemediği için GİB&apos;e ikinci bir gönderim yapılmaz.</p>
                  <div className="quick-panel__actions">
                    <Button type="button" onClick={() => setBeyanname(null)}>Vazgeç</Button>
                    <Button type="button" variant="primary" onClick={() => void beyannameKaydet(ebelgeDetayi.id)}>Beyannameyi kaydet</Button>
                  </div>
                </div>
              ) : (
                <dl>
                  <div>
                    <dt>Gümrük beyannamesi</dt>
                    <dd>
                      {ebelgeDetayi.gumrukBeyannameNo
                        ? `${ebelgeDetayi.gumrukBeyannameNo}${ebelgeDetayi.gumrukBeyannameTarihi ? ` · ${ebelgeDetayi.gumrukBeyannameTarihi}` : ""}`
                        : "Girilmedi"}
                      {" "}
                      <Button type="button" size="sm" onClick={() => setBeyanname({ no: ebelgeDetayi.gumrukBeyannameNo ?? "", tarih: ebelgeDetayi.gumrukBeyannameTarihi ?? "" })}>
                        {ebelgeDetayi.gumrukBeyannameNo ? "Düzenle" : "Gir"}
                      </Button>
                    </dd>
                  </div>
                </dl>
              )
            )}
            <div className="quick-panel__actions">
              <Button type="button" onClick={() => setEbelgeDetayi(null)}>Kapat</Button>
              {ebelgeDetayi.ebelge.entegratorRef && ["kuyrukta", "iletildi"].includes(ebelgeDetayi.ebelge.durum) && <Button type="button" variant="primary" onClick={() => void ebelgeSorgula(ebelgeDetayi.id)}>Durumu sorgula</Button>}
              {(ebelgeDetayi.ebelge.durum === "hata" || ebelgeDetayi.ebelge.takiliGonderim) && <Button type="button" variant="primary" onClick={() => void ebelgeYenidenGonder(ebelgeDetayi.id)}>Yeniden gönder</Button>}
              {/* İptal artık faturayı iptal ederken bildiriliyor; bu düğme yalnızca bildirim düşmüş kayıtları kurtarmak için durur. */}
              {ebelgeDetayi.ebelge.tur === "earsiv" && ebelgeDetayi.durum === "iptal" && ebelgeDetayi.ebelge.durum !== "iptal" && <Button type="button" variant="danger" onClick={() => void earsivIptalBildir(ebelgeDetayi.id)}>İptali entegratöre bildir</Button>}
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
              <div><dt>Fatura toplamı</dt><dd>{tl(odemeDetayi.genelToplam, odemeDetayi.dovizCinsi)}</dd></div>
              <div><dt>Ödenen</dt><dd>{tl(odemeDetayi.odemeOzeti.odenen, odemeDetayi.dovizCinsi)}</dd></div>
              <div><dt>Kalan</dt><dd>{tl(odemeDetayi.odemeOzeti.kalan, odemeDetayi.dovizCinsi)}</dd></div>
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
                  <div><strong>Henüz ödeme eşleştirilmedi</strong><small>Kalan {tl(odemeDetayi.odemeOzeti.kalan, odemeDetayi.dovizCinsi)}</small></div>
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
            </tr>
          </thead>
          <tbody>
            {gorunenFaturalar.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty">{durumFiltresi || ebelgeFiltresi || odemeFiltresi || ihracKayitliFiltresi || aramaFiltresi ? "Bu filtrelere uyan fatura yok." : "Sistemde henüz kayıtlı fatura bulunmuyor."}</td>
              </tr>
            ) : (
              gorunenFaturalar.map((f) => (
                <tr
                  key={f.id}
                  className="row-link"
                  tabIndex={0}
                  aria-label={`${f.no || "Taslak"} faturasını aç`}
                  onClick={() => faturayiAc(f.id)}
                  onKeyDown={(olay) => { if (olay.key === "Enter" || olay.key === " ") { olay.preventDefault(); faturayiAc(f.id); } }}
                >
                  <td style={{ fontWeight: 700 }} className="mono">{f.no || "(Taslak)"}</td>
                  <td>{f.cari.unvan}</td>
                  <td>{f.tarih}</td>
                  <td>
                    {TIP_ETIKETLERI[f.tip] ?? f.tip}
                    {/* EBLG-63: beyanname gelene kadar ihracat süresi gösterilir. */}
                    {f.ihracKayitliSonTarih && !f.gumrukBeyannameNo && f.durum === "kesin" && (() => {
                      const kalan = Math.ceil((new Date(`${f.ihracKayitliSonTarih}T23:59:59`).getTime() - Date.now()) / 86400000);
                      return (
                        <small className={kalan < 0 ? undefined : "muted"} style={{ display: "block", color: kalan < 0 ? "var(--danger)" : undefined }}>
                          İhraç kayıtlı · son {new Date(`${f.ihracKayitliSonTarih}T00:00:00`).toLocaleDateString("tr-TR")} ({kalan < 0 ? `${-kalan} gün geçti` : `${kalan} gün`})
                        </small>
                      );
                    })()}
                  </td>
                  <td className="num">{tl(f.toplamMatrah, f.dovizCinsi)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{tl(f.genelToplam, f.dovizCinsi)}</td>
                  <td>
                    {f.durum === "taslak" ? <Badge variant="warning">📝 Taslak</Badge> : f.durum === "iptal" ? <Badge variant="danger">İptal</Badge> : <Badge variant="success">🔒 Kesinleşti</Badge>}
                  </td>
                  <td>
                    {f.ebelge ? (
                      <button className="status-trigger" onClick={(olay) => { olay.stopPropagation(); void ebelgeDetayAc(f.id); }} onKeyDown={(olay) => olay.stopPropagation()} title="e-Belge ayrıntısını aç" type="button">
                        <Badge variant={EBELGE_DURUMLARI[f.ebelge.durum]?.renk ?? "neutral"}>
                          {EBELGE_DURUMLARI[f.ebelge.durum]?.baslik ?? f.ebelge.durum}
                          {f.ebelge.tur === "efatura" ? " · e-Fatura" : " · e-Arşiv"}
                        </Badge>
                        {f.ebelge.aliciYaniti && (
                          <Badge variant={f.ebelge.aliciYaniti === "ret" ? "danger" : "success"}>
                            {f.ebelge.aliciYaniti === "ret" ? "Alıcı reddetti" : "Alıcı kabul etti"}
                          </Badge>
                        )}
                      </button>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td>
                    <button className="status-trigger" onClick={(olay) => { olay.stopPropagation(); void odemeDetayAc(f.id); }} onKeyDown={(olay) => olay.stopPropagation()} title="Ödeme ayrıntısını aç" type="button">
                      <Badge variant={ODEME_DURUMLARI[f.odemeOzeti?.durum ?? "beklemede"].renk}>
                        {ODEME_DURUMLARI[f.odemeOzeti?.durum ?? "beklemede"].baslik}
                      </Badge>
                    </button>
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
