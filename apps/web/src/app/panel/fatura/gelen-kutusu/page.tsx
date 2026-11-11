"use client";

import { useEkranKaydi } from "@/lib/asistan-baglami";
import { KdvOraniSecimi, useKodTablosu } from "@/components/kdv-orani-secimi";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiPdfAc, tokenAl } from "@/lib/api";
import { BirimSecimi } from "@/components/birim-secimi";
import { GelenFiyatAnalizi } from "@/components/gelen-fiyat-analizi";
import { OnDenetimPaneli, type AiDenetimSonucu, type OnDenetimMetinleri } from "@/components/on-denetim-paneli";
import { birimCoz, onDenetimAnahtari, varyantAdiEsit, varyantliAdAyir, type OnDenetimBulgusu } from "@tekirextra/shared";
import { EbelgeAdimSeridi } from "@/components/durum-gecmisi";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  EylemCubugu,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Select,
  Stat,
  StatGrid,
  TableWrap,
} from "@/components/ui";

/* ─── Tipler ─────────────────────────────────────────────────────────────── */

interface GelenOzet {
  id: string;
  belgeNo: string;
  gonderenVkn: string;
  gonderenUnvan: string;
  tarih: string;
  profilId: string | null;
  durum: "beklemede" | "islendi" | "reddedildi";
  yanit: "kabul" | "ret" | null;
  faturaId: string | null;
  satirSayisi: number;
  genelToplam: string | null;
  dovizCinsi: string;
  okunabilir: boolean;
  /** EBLG-144: son kural denetimindeki uyarı sayısı; null = henüz denetlenmedi. */
  denetimUyari: number | null;
}

/** Gelen kutusu sayfası: kayıtlar parça parça, sayaçlar seçilen süzgeçle sunucuda hesaplanır. */
interface GelenSayfa {
  kayitlar: GelenOzet[];
  sonrakiImlec: string | null;
  ozet: { adet: number; toplamTutar: string; kalem: number; beklemede: number; islendi: number; reddedildi: number };
}
const BOS_OZET: GelenSayfa["ozet"] = { adet: 0, toplamTutar: "0", kalem: 0, beklemede: 0, islendi: 0, reddedildi: 0 };

/** EBLG-144…149: gelen alış denetçisinin sonucu. */
interface GelenDenetim { bulgular: OnDenetimBulgusu[]; susturulan: number; cariId: string | null }

const GELEN_DENETIM_METINLERI: OnDenetimMetinleri = {
  baslik: "Gelen alış denetimi",
  altMetin: "Belge aktarılabilir ama büyük olasılıkla yanlış ya da şüpheli olabilir; uyarılar faturaya işlerken onayınızı ister.",
  temiz: "Gelen alış denetimi: fiyat, mükerrer, ödeme hesabı, vergi ve vade kontrollerinde dikkat edilecek bir şey bulunmadı.",
  taraf: "tedarikçi",
  faturaYonu: "alis",
};

interface OnerilenStok {
  id: string;
  kod: string;
  ad: string;
  anaBirim: string;
  kdvOrani: string;
  varyantlar?: KartVaryanti[];
}

interface KartVaryanti {
  id: string;
  kod: string;
  ad: string;
}

interface GelenSatir {
  siraNo: number;
  ad: string;
  saticiUrunKodu: string | null;
  aliciUrunKodu: string | null;
  ureticiUrunKodu: string | null;
  barkod: string | null;
  miktar: string;
  birim: string;
  birimFiyat: string;
  iskontoOrani: string;
  iskontoTutari: string;
  kdvOrani: string;
  kdvTutari: string;
  matrah: string;
  onerilenStokId: string | null;
  onerilenVaryantId?: string | null;
  onerilenStok: OnerilenStok | null;
  eslesmeKaynagi:
    | "alici_urun_kodu"
    | "barkod"
    | "tedarikci_urun_kodu"
    | "uretici_urun_kodu"
    | "ad"
    | null;
}

type IrsaliyeEslesmeDurumu = "bulundu" | "baska_faturada" | "islenmemis_eirsaliye" | "yok";
const IRSALIYE_ESLESME_METNI: Record<IrsaliyeEslesmeDurumu, string> = {
  bulundu: "alış irsaliyesiyle eşleşti, bağlanacak",
  baska_faturada: "eşleşen irsaliye başka bir faturaya bağlı",
  islenmemis_eirsaliye: "e-İrsaliyesi geldi ama alış irsaliyesine işlenmemiş",
  yok: "bizde bu numaralı irsaliye yok",
};

interface IrsaliyeBagi {
  baglanan: { id: string; no: string | null; tedarikciNo: string }[];
  bulunamayan: { no: string; durum: IrsaliyeEslesmeDurumu }[];
  farklar: { mesaj: string }[];
  gecikmeler: string[];
  baglamaHatasi: string | null;
}

interface GelenDetay {
  id: string;
  uuid: string;
  belgeNo: string;
  gonderenVkn: string;
  gonderenUnvan: string;
  tarih: string;
  profilId: string | null;
  durum: "beklemede" | "islendi" | "reddedildi";
  yanit: "kabul" | "ret" | null;
  yanitGerekce: string | null;
  faturaId: string | null;
  yanitGerekiyor: boolean;
  /** SAT-13: faturada adı geçen irsaliyelerin bizdeki karşılığı; işlenince bağlanır. */
  irsaliyeEslesmesi?: { no: string; durum: IrsaliyeEslesmeDurumu; irsaliyeNo: string | null }[];
  cari: { id: string; kod: string; unvan: string; karaListe: boolean } | null;
  /** Bulunan cari belgenin yönüne uygun tipte değil (ör. alışta müşteri kartı). */
  cariUyarisi?: string | null;
  dovizCinsi: string;
  belgeToplamlari: {
    satirToplami: string;
    iskontoToplami: string;
    matrah: string;
    kdv: string;
    genelToplam: string;
  };
  satirlar: GelenSatir[];
  /** EBLG-119: iade belgesi satış iadesi olarak işlenir. */
  faturaTipi?: "alis" | "satis_iade";
  /** EBLG-115: oluşacak faturanın belge toplamlarıyla karşılaştırması. */
  tutarDenetimi?: TutarDenetimi;
  /** EBLG-115…119: işlemeyi durduran nedenler (kur yok, tanınmayan kod…). */
  engeller?: string[];
  /** EBLG-144: açılıştaki önerilen eşleşmelerle gelen alış denetimi; hesaplanamadıysa null. */
  onDenetim?: GelenDenetim | null;
}

interface TutarFarki { alan: string; ad: string; belge: number; sistem: number; fark: number }
interface TutarDenetimi { tolerans: number; satirlar: TutarFarki[]; asanlar: TutarFarki[]; gecerli: boolean; aciklamalar?: string[] }

interface StokSecenek {
  id: string;
  kod: string;
  ad: string;
  anaBirim: string;
  varyantlar?: KartVaryanti[];
  /** Varyantlı kartta satırın varyantı; seçilmeden satır eşleşmiş sayılmaz. */
  varyantId?: string;
}

/* ─── Yardımcılar ────────────────────────────────────────────────────────── */

const para = (deger: string | number, dovizCinsi = "TRY"): string =>
  `${Number(deger).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${dovizCinsi === "TRY" ? "₺" : dovizCinsi}`;

const adet = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });


const ESLESME_ETIKETI: Record<string, string> = {
  alici_urun_kodu: "ürün kodumuz",
  barkod: "barkod",
  tedarikci_urun_kodu: "tedarikçi kodu",
  uretici_urun_kodu: "üretici kodu",
  ad: "ad",
};

function durumRozet(durum: string) {
  if (durum === "islendi") return <Badge variant="success">FATURAYA İŞLENDİ</Badge>;
  if (durum === "reddedildi") return <Badge variant="danger">REDDEDİLDİ</Badge>;
  return <Badge variant="warning">ONAY BEKLİYOR</Badge>;
}

function profilRozet(profilId: string | null) {
  if (profilId === "TICARIFATURA") return <Badge variant="info">TİCARİ</Badge>;
  if (profilId === "TEMELFATURA") return <Badge variant="neutral">TEMEL</Badge>;
  return <Badge variant="neutral">{profilId ?? "—"}</Badge>;
}

/* ─── Sayfa ──────────────────────────────────────────────────────────────── */

export default function GelenKutusuSayfasi() {
  const [liste, setListe] = useState<GelenOzet[]>([]);
  const [suzgec, setSuzgec] = useState<"beklemede" | "islendi" | "reddedildi" | "hepsi">(
    "beklemede",
  );
  const [detay, setDetay] = useState<GelenDetay | null>(null);
  // AI-78: açık gelen e-Fatura asistan bağlamı olur.
  useEkranKaydi(detay ? { tur: "gelen_efatura", id: detay.id, etiket: detay.belgeNo } : null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const [aranan, setAranan] = useState("");
  const [ozet, setOzet] = useState(BOS_OZET);
  const [sonrakiImlec, setSonrakiImlec] = useState<string | null>(null);
  const [listeYukleniyor, setListeYukleniyor] = useState(false);
  // Arama sunucuda yapılır; her tuşta istek gitmesin.
  useEffect(() => { const z = setTimeout(() => setAranan(arama.trim()), 300); return () => clearTimeout(z); }, [arama]);

  /** siraNo → seçili stok kartı; tümü dolmadan "Faturaya İşle" açılmaz (S-01). */
  const [eslesme, setEslesme] = useState<Record<number, StokSecenek | null>>({});

  // Stok seçici
  const [seciciSira, setSeciciSira] = useState<number | null>(null);
  const [seciciArama, setSeciciArama] = useState("");
  const [seciciSonuc, setSeciciSonuc] = useState<StokSecenek[]>([]);

  // Yeni kart formu
  const [yeniKartSira, setYeniKartSira] = useState<number | null>(null);
  // MVZ-11: stok kartı tarihsizdir; yeni kartın KDV oranı bugünkü merkezi listeden.
  const kartKodTablosu = useKodTablosu(null);
  const [yeniKod, setYeniKod] = useState("");
  const [yeniAd, setYeniAd] = useState("");
  const [yeniTip, setYeniTip] = useState<"urun" | "sarf" | "hizmet">("urun");
  const [yeniBirim, setYeniBirim] = useState("adet");
  const [yeniKdv, setYeniKdv] = useState("20");

  // Ret gerekçesi
  const [retAcik, setRetAcik] = useState(false);
  const [retGerekce, setRetGerekce] = useState("");

  // Yeni cari hesap onay kontrolü
  const [yeniCariOnay, setYeniCariOnay] = useState(false);
  /** SAT-13: son işlemede irsaliyelerin bağlanma sonucu (uyarılar dahil). */
  const [irsaliyeSonucu, setIrsaliyeSonucu] = useState<string[]>([]);
  // EBLG-150: gelen alış denetimi; eşleştirme değişince yeniden sorulur.
  const [denetim, setDenetim] = useState<GelenDenetim | null>(null);
  const [denetimOnay, setDenetimOnay] = useState(false);
  const [denetimGerekce, setDenetimGerekce] = useState("");
  const [yalnizUyarili, setYalnizUyarili] = useState(false);
  // AI-72: açılışta kendiliğinden sorulur; sonuç belgeyle saklanır.
  const [aiDenetim, setAiDenetim] = useState<AiDenetimSonucu | "yukleniyor" | null>(null);
  const acikBelge = useRef<string | null>(null);

  const listeYukle = useCallback(async (imlec?: string) => {
    setListeYukleniyor(true);
    try {
      const p = new URLSearchParams({ adet: "50" });
      if (suzgec !== "hepsi") p.set("durum", suzgec);
      if (aranan) p.set("arama", aranan);
      if (yalnizUyarili) p.set("uyarili", "true");
      if (imlec) p.set("imlec", imlec);
      const sayfa = await api<GelenSayfa>(`/ebelge/gelen/sayfa?${p}`);
      setListe((eski) => (imlec ? [...eski, ...sayfa.kayitlar] : sayfa.kayitlar));
      setSonrakiImlec(sayfa.sonrakiImlec);
      setOzet(sayfa.ozet);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Gelen kutusu yüklenemedi");
    } finally {
      setListeYukleniyor(false);
    }
  }, [suzgec, aranan, yalnizUyarili]);

  useEffect(() => {
    if (!tokenAl()) return;
    void listeYukle();
  }, [listeYukle]);

  // Süzgeç ve arama sunucuda uygulanır; liste yüklenen sayfalardır.
  const gorunenListe = liste;
  const bekleyenSayisi = ozet.beklemede;
  const toplamTutar = Number(ozet.toplamTutar);

  const detayAc = useCallback(async (id: string) => {
    setHata("");
    setBasari("");
    setIrsaliyeSonucu([]);
    setRetAcik(false);
    setRetGerekce("");
    setYeniCariOnay(false);
    setSeciciSira(null);
    setYeniKartSira(null);
    setDenetimOnay(false);
    setDenetimGerekce("");
    setAiDenetim(null);
    try {
      const d = await api<GelenDetay>(`/ebelge/gelen/${id}`);
      acikBelge.current = d.id;
      setDetay(d);
      setDenetim(d.onDenetim ?? null);
      // Otomatik eşleşenler baştan seçili gelir; kullanıcı değiştirebilir.
      const baslangic: Record<number, StokSecenek | null> = {};
      for (const s of d.satirlar) {
        baslangic[s.siraNo] = s.onerilenStok
          ? {
              id: s.onerilenStok.id,
              kod: s.onerilenStok.kod,
              ad: s.onerilenStok.ad,
              anaBirim: s.onerilenStok.anaBirim,
              varyantlar: s.onerilenStok.varyantlar,
              varyantId: s.onerilenVaryantId ?? undefined,
            }
          : null;
      }
      setEslesme(baslangic);
      if (d.durum === "beklemede" && d.faturaTipi !== "satis_iade") void aiSor(d.id, baslangic, false);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge detayı alınamadı");
    }
  }, []);

  // Stok seçici araması (açıkken ve arama değiştikçe)
  useEffect(() => {
    if (seciciSira === null) return;
    let iptal = false;
    const zamanlayici = setTimeout(() => {
      void api<{ kayitlar: StokSecenek[] }>(
        `/stok?adet=25${seciciArama.trim() ? `&arama=${encodeURIComponent(seciciArama.trim())}` : ""}`,
      )
        .then((v) => {
          if (!iptal) setSeciciSonuc(v.kayitlar);
        })
        .catch(() => {
          if (!iptal) setSeciciSonuc([]);
        });
    }, 250);
    return () => {
      iptal = true;
      clearTimeout(zamanlayici);
    };
  }, [seciciSira, seciciArama]);

  const eksikSatirlar = useMemo(
    () => (detay ? detay.satirlar.filter((s) => {
      const k = eslesme[s.siraNo];
      return !k || (!k.varyantId && (k.varyantlar?.length ?? 0) > 0);
    }) : []),
    [detay, eslesme],
  );

  // Bulgulardaki "Gelen belgeyi aç" bağlantısı (?ac=id).
  useEffect(() => {
    if (!tokenAl()) return;
    const ac = new URLSearchParams(window.location.search).get("ac");
    if (ac) void detayAc(ac);
  }, [detayAc]);

  // EBLG-144: kullanıcının eşleştirmesiyle denetim yeniden hesaplanır (fiyat ve KDV ürün kartına bağlıdır).
  const denetimEslesmeleri = useMemo(() => (detay ? detay.satirlar.flatMap((s) => {
    const e = eslesme[s.siraNo];
    return e && (!e.varyantlar?.length || e.varyantId) ? [{ siraNo: s.siraNo, stokId: e.id, varyantId: e.varyantId ?? null }] : [];
  }) : []), [detay, eslesme]);
  const denetimAnahtari = JSON.stringify(denetimEslesmeleri);
  useEffect(() => {
    if (!detay || detay.durum !== "beklemede" || !denetimEslesmeleri.length) return;
    let iptal = false;
    const zamanlayici = setTimeout(() => {
      void api<GelenDenetim>(`/ebelge/gelen/${detay.id}/denetim`, { method: "POST", body: JSON.stringify({ satirEslesmeleri: denetimEslesmeleri }) })
        .then((d) => {
          if (iptal) return;
          setDenetim((onceki) => {
            const anahtarlar = (x: GelenDenetim | null) => (x?.bulgular ?? []).filter((b) => b.duzey === "uyari").map(onDenetimAnahtari).sort().join("|");
            // Uyarılar değiştiyse önceki onay geçmez.
            if (anahtarlar(onceki) !== anahtarlar(d)) setDenetimOnay(false);
            return d;
          });
        })
        .catch(() => undefined);
    }, 500);
    return () => { iptal = true; clearTimeout(zamanlayici); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anahtar eşleşmelerin içeriğini izler
  }, [detay?.id, detay?.durum, denetimAnahtari]);

  const denetimUyarilari = denetim?.bulgular.filter((b) => b.duzey === "uyari") ?? [];

  async function denetimSustur(kod: OnDenetimBulgusu["kod"]) {
    if (!detay || !denetim?.cariId) return;
    setHata("");
    try {
      await api("/ebelge/on-denetim/susturmalar", { method: "POST", body: JSON.stringify({ cariId: denetim.cariId, kod }) });
      setDenetim(await api<GelenDenetim>(`/ebelge/gelen/${detay.id}/denetim`, { method: "POST", body: JSON.stringify({ satirEslesmeleri: denetimEslesmeleri }) }));
      setDenetimOnay(false);
    } catch (h) { setHata(h instanceof Error ? h.message : "Kural susturulamadı"); }
  }

  /** AI-72: ekran beklemez; belge değiştiyse geç gelen yanıt atılır. */
  async function aiSor(id: string, secim: Record<number, StokSecenek | null>, yeniden: boolean) {
    setAiDenetim("yukleniyor");
    const satirEslesmeleri = Object.entries(secim).flatMap(([sira, e]) =>
      e && (!e.varyantlar?.length || e.varyantId) ? [{ siraNo: Number(sira), stokId: e.id, varyantId: e.varyantId ?? null }] : []);
    try {
      const sonuc = await api<AiDenetimSonucu>(`/ebelge/gelen/${id}/ai`, { method: "POST", body: JSON.stringify({ satirEslesmeleri, yeniden }) });
      if (acikBelge.current === id) setAiDenetim(sonuc);
    } catch (h) {
      if (acikBelge.current === id) setAiDenetim({ durum: "hata", mesaj: h instanceof Error ? h.message : "Yapay zekâ kontrolü yapılamadı.", bulgular: [] });
    }
  }

  function retGerekcesineEkle(mesaj: string) {
    setRetAcik(true);
    setRetGerekce((g) => (g.includes(mesaj) ? g : [g.trim(), mesaj].filter(Boolean).join(" ")).slice(0, 500));
  }

  /* ─── Eylemler ─────────────────────────────────────────────────────────── */

  async function entegratordenCek() {
    setHata("");
    setBasari("");
    setIslemde("cek");
    try {
      const s = await api<{ isId: string; durum: string; tekrar: boolean }>(
        "/ebelge/gelenleri-cek",
        { method: "POST" },
      );
      setBasari(s.tekrar
        ? "Gelen belge senkronizasyonu zaten devam ediyor."
        : "Gelen belge senkronizasyonu kuyruğa alındı; sonucu e-Belge operasyon merkezinden izleyebilirsiniz.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belgeler çekilemedi");
    } finally {
      setIslemde(null);
    }
  }

  function seciciAc(sira: number, satir: GelenSatir) {
    setSeciciSira(sira);
    // Aramayı belgedeki adla başlatmak eşleştirmeyi hızlandırır; "Ürün — Varyant"
    // adında yalnız ürün adı aranır (kart adı varyantı içermez).
    setSeciciArama(varyantliAdAyir(satir.ad)?.stokAd ?? satir.ad);
    setSeciciSonuc([]);
    setYeniKartSira(null);
  }

  function yeniKartAc(satir: GelenSatir) {
    setYeniKartSira(satir.siraNo);
    setSeciciSira(null);
    setYeniKod(satir.barkod ?? satir.saticiUrunKodu ?? "");
    setYeniAd(satir.ad);
    setYeniTip("urun");
    // Gelen e-faturadaki birim standart listede varsa onu kullan, yoksa "adet" olarak varsay
    const belgedekiBirim = (satir.birim ?? "").trim().toLowerCase();
    const esleseBirim = birimCoz(belgedekiBirim) ?? "adet";
    setYeniBirim(esleseBirim);
    setYeniKdv(satir.kdvOrani);
  }

  async function yeniKartKaydet(satir: GelenSatir) {
    setHata("");
    setIslemde("yeni-kart");
    try {
      const kart = await api<{ id: string; kod: string; ad: string; anaBirim: string }>(
        "/stok",
        {
          method: "POST",
          body: JSON.stringify({
            kod: yeniKod.trim(),
            ad: yeniAd.trim(),
            tip: yeniTip,
            anaBirim: yeniBirim || "adet",
            kdvOrani: Number(yeniKdv || "20").toFixed(2),
            alisFiyati: Number(satir.birimFiyat).toFixed(4),
            barkod: satir.barkod ?? null,
          }),
        },
      );

      // Bir dahaki gelen faturada otomatik eşleşsin diye tedarikçi ürün kodunu
      // karta bağla (STK-18). Cari henüz açılmamışsa atlanır.
      if (detay?.cari && satir.saticiUrunKodu) {
        await api(`/stok/${kart.id}/tedarikciler`, {
          method: "POST",
          body: JSON.stringify({
            cariId: detay.cari.id,
            tedarikciUrunKodu: satir.saticiUrunKodu,
            alisFiyati: Number(satir.birimFiyat).toFixed(4),
          }),
        }).catch(() => undefined);
      }

      setEslesme((e) => ({
        ...e,
        [satir.siraNo]: {
          id: kart.id,
          kod: kart.kod,
          ad: kart.ad,
          anaBirim: kart.anaBirim,
        },
      }));
      setYeniKartSira(null);
      setBasari(`'${kart.ad}' stok kartı açıldı ve ${satir.siraNo}. satıra bağlandı.`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Stok kartı açılamadı");
    } finally {
      setIslemde(null);
    }
  }

  async function faturayaIsle() {
    if (!detay) return;
    if (!detay.cari && !yeniCariOnay) {
      setHata(
        `Gönderen firma (${detay.gonderenUnvan}) sisteminizde kayıtlı bir cari hesap değil. Lütfen yeni cari hesap açılması onay kutusunu işaretleyin.`,
      );
      return;
    }
    setHata("");
    setBasari("");
    setIslemde("onayla");
    try {
      const s = await api<{ faturaId: string; faturaTipi?: "alis" | "satis_iade"; irsaliyeBagi: IrsaliyeBagi | null }>(
        `/ebelge/gelen/${detay.id}/onayla`,
        {
          method: "POST",
          body: JSON.stringify({
            satirEslesmeleri: detay.satirlar.map((sa) => ({
              siraNo: sa.siraNo,
              stokId: eslesme[sa.siraNo]?.id,
              varyantId: eslesme[sa.siraNo]?.varyantId ?? null,
            })),
            yeniCariOnay,
            ...(denetimUyarilari.length && denetimOnay
              ? { onDenetimOnayi: { anahtarlar: denetimUyarilari.map(onDenetimAnahtari), gerekce: denetimGerekce.trim() || undefined } }
              : {}),
          }),
        },
      );
      await detayAc(detay.id);
      await listeYukle();
      // Detay yeniden yüklenince mesajlar temizlenir; sonuç ondan sonra yazılır.
      setBasari(s.faturaTipi === "satis_iade" ? "Taslak satış iade faturası oluşturuldu." : "Taslak alış faturası oluşturuldu.");
      const b = s.irsaliyeBagi;
      const sonuc = b ? [
        ...(b.baglanan.length ? [`${b.baglanan.length} irsaliye faturaya bağlandı: ${b.baglanan.map((x) => `${x.tedarikciNo} → ${x.no ?? "alış irsaliyesi"}`).join(", ")}.`] : []),
        ...b.bulunamayan.map((x) => `${x.no}: ${IRSALIYE_ESLESME_METNI[x.durum]}.`),
        ...(b.baglamaHatasi ? [`İrsaliyeler bağlanamadı: ${b.baglamaHatasi}`] : []),
        ...b.farklar.map((f) => `Fark — ${f.mesaj}`),
        ...b.gecikmeler,
      ] : [];
      setIrsaliyeSonucu(sonuc);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Belge faturaya işlenemedi");
    } finally {
      setIslemde(null);
    }
  }

  async function yanitGonder(yanit: "kabul" | "ret") {
    if (!detay) return;
    setHata("");
    setBasari("");
    setIslemde(`yanit-${yanit}`);
    try {
      await api(`/ebelge/gelen/${detay.id}/yanit`, {
        method: "POST",
        body: JSON.stringify({
          yanit,
          gerekce: yanit === "ret" ? retGerekce.trim() : null,
        }),
      });
      setBasari(
        yanit === "kabul"
          ? "Kabul yanıtı entegratöre gönderildi."
          : "Ret yanıtı entegratöre gönderildi; belge reddedildi olarak işaretlendi.",
      );
      setRetAcik(false);
      setRetGerekce("");
      await detayAc(detay.id);
      await listeYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yanıt gönderilemedi");
    } finally {
      setIslemde(null);
    }
  }

  async function taslakIptalEt() {
    if (!detay) return;
    if (
      !confirm(
        "Oluşturulan taslak alış faturası silinecek ve bu belge yeniden stok eşleştirmesi yapmanız için onaya düşürülecek. Devam etmek istiyor musunuz?",
      )
    )
      return;
    setHata("");
    setBasari("");
    setIslemde("taslak-iptal");
    try {
      await api(`/ebelge/gelen/${detay.id}/taslak-iptal`, { method: "POST" });
      setBasari("Taslak fatura iptal edildi ve belge yeniden onay bekliyor durumuna getirildi.");
      await detayAc(detay.id);
      await listeYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Taslak fatura iptal edilemedi");
    } finally {
      setIslemde(null);
    }
  }

  const [xmlModal, setXmlModal] = useState(false);
  const [xmlIcerik, setXmlIcerik] = useState("");

  /** EBLG-27: belgeyi gönderenin kendi görünümüyle PDF olarak açar. */
  async function pdfAc(id: string) {
    setHata("");
    try {
      await apiPdfAc(`/ebelge/gelen/${id}/pdf`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "PDF açılamadı");
    }
  }

  async function xmlYukleHander() {
    if (!xmlIcerik.trim()) return;
    setHata("");
    setBasari("");
    setIslemde("xml");
    try {
      const res = await api<{ mesaj: string }>(`/ebelge/xml-yukle`, {
        method: "POST",
        body: JSON.stringify({ xml: xmlIcerik }),
      });
      setBasari(res.mesaj);
      setXmlModal(false);
      setXmlIcerik("");
      await listeYukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "XML yüklenemedi");
    } finally {
      setIslemde(null);
    }
  }

  function xmlDosyaSec(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // EBLG-158: sunucu XML yüklemesini 10 MB ile sınırlar; büyük dosya gönderilmeden söylenir.
    if (file.size > 10 * 1024 * 1024) {
      setHata("XML dosyası 10 MB sınırını aşıyor");
      e.target.value = "";
      return;
    }
    setHata("");
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setXmlIcerik(text);
    };
    reader.readAsText(file, "UTF-8");
  }

  /* ─── Görünüm: liste ───────────────────────────────────────────────────── */

  if (!detay) {
    return (
      <div className="archive-page incoming-invoice-page">
        <header className="archive-hero">
          <div>
            <span>GELEN E-FATURA MERKEZİ</span>
            <h1>Gelen e-Faturalar</h1>
            <p>Entegratörden gelen faturaları, manuel XML dosyalarını ve faturaya işleme adımlarını tek merkezden yönetin.</p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <ButtonLabel as="a" href="/panel/fatura">← Faturalar</ButtonLabel>
            <Button onClick={() => setXmlModal(true)}>📁 XML Dosyası Yükle</Button>
            <Button variant="primary" onClick={() => void entegratordenCek()} disabled={islemde !== null}>
              {islemde === "cek" ? "Kuyruğa alınıyor…" : "↻ Entegratörden çek"}
            </Button>
          </div>
        </header>

        {xmlModal && (
          <div className="treasury-backdrop" style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
            <div style={{ backgroundColor: "#fff", padding: "24px", borderRadius: "12px", width: "90%", maxWidth: "600px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>📄 Manuel XML Alış Faturası Yükle</h3>
                <button onClick={() => setXmlModal(false)} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer" }}>×</button>
              </div>
              <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "16px" }}>Tedarikçinizden aldığınız UBL-TR formatındaki <strong>.xml</strong> fatura dosyasını seçebilir veya metin olarak yapıştırabilirsiniz. Dosya en fazla 10 MB olabilir.</p>
              <Alert tone="error">{hata}</Alert>

              <Field label="XML Dosyası Seç (.xml)">
                <input type="file" accept=".xml" onChange={xmlDosyaSec} style={{ width: "100%", padding: "8px", border: "1px solid #cbd5e1", borderRadius: "6px" }} />
              </Field>

              <div style={{ marginTop: "12px" }}>
                <Field label="Veya XML İçeriğini Yapıştırın">
                  <textarea rows={6} value={xmlIcerik} onChange={(e) => setXmlIcerik(e.target.value)} placeholder="<?xml version=..." style={{ width: "100%", padding: "8px", fontFamily: "monospace", fontSize: "12px", border: "1px solid #cbd5e1", borderRadius: "6px" }} />
                </Field>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
                <Button onClick={() => setXmlModal(false)}>İptal</Button>
                <Button variant="primary" onClick={() => void xmlYukleHander()} disabled={!xmlIcerik.trim() || islemde === "xml"}>
                  {islemde === "xml" ? "İçeri Aktarılıyor…" : "📥 İçeri Aktar & Gelen Kutusuna Ekle"}
                </Button>
              </div>
            </div>
          </div>
        )}

        <Alert tone="error">{hata}</Alert>
        <Alert tone="success">{basari}</Alert>

        <section className="archive-kpis incoming-kpis">
          <div className="is-lead"><span>Görünen belge toplamı</span><strong>{para(toplamTutar)}</strong><small>{ozet.adet} belge · {ozet.kalem} kalem</small></div>
          <div className={bekleyenSayisi ? "is-warning" : ""}><span>Onay bekleyen</span><strong>{bekleyenSayisi}</strong><small>İşlem yapılması gereken</small></div>
          <div><span>Faturaya işlenen</span><strong>{ozet.islendi}</strong><small>Başarıyla aktarılan</small></div>
          <div className={ozet.reddedildi ? "is-danger" : ""}><span>Reddedilen</span><strong>{ozet.reddedildi}</strong><small>Yanıt gönderilen</small></div>
        </section>

        <Card className="archive-filter">
          <div className="archive-filter__grid incoming-filter-grid">
            <Field label="Durum"><Select value={suzgec} onChange={(e) => setSuzgec(e.target.value as typeof suzgec)}><option value="beklemede">Onay bekleyen</option><option value="islendi">İşlenmiş</option><option value="reddedildi">Reddedilen</option><option value="hepsi">Tümü</option></Select></Field>
            <Field label="Belge ara"><Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Belge no, VKN veya gönderen…" /></Field>
            <label className="row-tight" style={{ alignSelf: "end", fontSize: "0.875rem" }}>
              <input type="checkbox" checked={yalnizUyarili} onChange={(e) => setYalnizUyarili(e.target.checked)} /> Yalnız denetim uyarısı olanlar
            </label>
            <div className="incoming-filter-hint"><span>Görüntülenen kayıt</span><strong>{gorunenListe.length} / {ozet.adet}</strong></div>
          </div>
        </Card>

        <div className="archive-toolbar"><div><strong>Gelen belge kayıtları</strong><span>{ozet.adet} sonuç</span></div><div><Button variant="ghost" onClick={() => void entegratordenCek()} disabled={islemde !== null}>{islemde === "cek" ? "Alınıyor…" : "Listeyi yenile"}</Button></div></div>

        <Card className="archive-register" pad={false}>
          <TableWrap>
            <thead>
              <tr>
                <th>Belge / Gönderen</th><th>Tarih</th><th>Profil</th><th>Kalem</th><th>Toplam</th><th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {gorunenListe.length === 0 ? (
                <tr>
                  <td colSpan={6}><div className="archive-empty"><strong>Belge bulunamadı</strong><span>Filtreleri değiştirerek veya entegratörden çekerek yeniden deneyin.</span></div></td>
                </tr>
              ) : (
                gorunenListe.map((g) => (
                  <tr
                    key={g.id}
                    className="row-link"
                    tabIndex={0}
                    aria-label={`${g.belgeNo} belgesini aç`}
                    onClick={() => void detayAc(g.id)}
                    onKeyDown={(olay) => { if (olay.key === "Enter" || olay.key === " ") { olay.preventDefault(); void detayAc(g.id); } }}
                  >
                    <td><strong>{g.belgeNo}</strong><small>{g.gonderenUnvan}</small><small className="mono">{g.gonderenVkn}</small></td>
                    <td><strong>{g.tarih}</strong><small>Belge tarihi</small></td>
                    <td>{profilRozet(g.profilId)}</td>
                    <td><strong>{g.satirSayisi}</strong><small>ürün kalemi</small></td>
                    <td><strong className="archive-amount">{g.genelToplam ? para(g.genelToplam, g.dovizCinsi) : "—"}</strong><small>fatura toplamı</small></td>
                    <td><div className="archive-status">{durumRozet(g.durum)}{g.yanit&&<b>{g.yanit === "kabul" ? "KABUL" : "RET"}</b>}{g.durum === "beklemede" && (g.denetimUyari ?? 0) > 0 && <Badge variant="warning">{g.denetimUyari} UYARI</Badge>}</div>{!g.okunabilir&&<small className="muted">XML okunamadı</small>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </TableWrap>
          {sonrakiImlec && (
            <div style={{ padding: "1rem", textAlign: "center" }}>
              <Button type="button" onClick={() => void listeYukle(sonrakiImlec)} disabled={listeYukleniyor}>
                {listeYukleniyor ? "Belgeler yükleniyor…" : "Daha fazla belge yükle"}
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  /* ─── Görünüm: onay & eşleştirme ───────────────────────────────────────── */

  const islenebilir = detay.durum === "beklemede";
  // EBLG-115: engel ya da toleransı aşan fark varsa belge işlenmez.
  const kapiKapali = (detay.engeller?.length ?? 0) > 0 || detay.tutarDenetimi?.gecerli === false || Boolean(detay.cariUyarisi);
  const faturaAdi = detay.faturaTipi === "satis_iade" ? "satış iade faturası" : "alış faturası";

  return (
    <div className="incoming-detail">
      <PageHeader
        title={`Gelen e-Fatura ${detay.belgeNo}`}
        subtitle={`${detay.gonderenUnvan} · VKN ${detay.gonderenVkn} · ${detay.tarih}`}
        actions={
          <>
            <Button
              onClick={() => {
                acikBelge.current = null;
                setDetay(null);
                setHata("");
                setBasari("");
              }}
            >
              ← Gelen Kutusu
            </Button>
          </>
        }
      />

      <EylemCubugu etiket="Gelen belge eylemleri">
        {detay.faturaId && (
          <ButtonLabel as="a" variant="primary" size="sm" href={`/panel/fatura/yeni?ac=${detay.faturaId}&yon=alis`}>
            🧾 Alış faturasını aç
          </ButtonLabel>
        )}
        <Button size="sm" type="button" onClick={() => void pdfAc(detay.id)}>📄 PDF</Button>
        <div className="row-tight incoming-detail__badges">
          {durumRozet(detay.durum)}
          {profilRozet(detay.profilId)}
          {detay.yanit && (
            <Badge variant={detay.yanit === "kabul" ? "success" : "danger"}>
              YANIT: {detay.yanit === "kabul" ? "KABUL" : "RET"}
            </Badge>
          )}
        </div>
      </EylemCubugu>

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <StatGrid>
        <Stat label="Matrah" value={para(detay.belgeToplamlari.matrah, detay.dovizCinsi)} />
        <Stat label="KDV" value={para(detay.belgeToplamlari.kdv, detay.dovizCinsi)} />
        <Stat
          label="İskonto"
          value={para(detay.belgeToplamlari.iskontoToplami, detay.dovizCinsi)}
        />
        <Stat
          label="Genel Toplam"
          value={para(detay.belgeToplamlari.genelToplam, detay.dovizCinsi)}
          tone="accent"
        />
      </StatGrid>

      {/* EBLG-45: gelen belgede akış terstir — belge bize ulaşır, yanıtı biz veririz. */}
      <EbelgeAdimSeridi akis={{ tur: "gelen_efatura", durum: detay.durum }} />

      <Card
        style={{
          marginTop: "1.25rem",
          ...(!detay.cari
            ? { borderLeft: "4px solid #f59e0b", backgroundColor: "#fffbeb" }
            : {}),
        }}
      >
        <div className="card__title" style={!detay.cari ? { color: "#b45309" } : undefined}>
          {!detay.cari ? "⚠️ Yeni Tedarikçi Uyarısı — Cari Hesap Bulunamadı" : "Cari Hesap"}
        </div>
        {detay.cari ? (
          <>
          <p style={{ margin: 0 }}>
            <code className="mono">{detay.cari.kod}</code> — {detay.cari.unvan}
            {detay.cari.karaListe && (
              <>
                {" "}
                <Badge variant="danger">KARA LİSTE</Badge>
              </>
            )}
          </p>
          {detay.cariUyarisi && detay.durum === "beklemede" && <div style={{ marginTop: "0.6rem" }}><Alert tone="warning">{detay.cariUyarisi}</Alert></div>}
          </>
        ) : (
          <div>
            <p style={{ fontSize: "0.875rem", margin: "4px 0 12px", color: "#92400e" }}>
              Gönderen firma <strong>{detay.gonderenUnvan}</strong> (VKN:{" "}
              <code className="mono">{detay.gonderenVkn}</code>) sisteminizde cari hesap
              olarak kayıtlı değil. Bu faturayı işlediğinizde bu firma için otomatik yeni bir{" "}
              <strong>Tedarikçi Cari Hesabı</strong> açılacaktır.
            </p>
            {detay.durum === "beklemede" && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  color: "#78350f",
                }}
              >
                <input
                  type="checkbox"
                  checked={yeniCariOnay}
                  onChange={(e) => setYeniCariOnay(e.target.checked)}
                />
                <span>Bu firma için yeni tedarikçi cari hesabı açılmasını onaylıyorum.</span>
              </label>
            )}
          </div>
        )}
      </Card>

      {detay.yanitGerekiyor && !detay.yanit && (
        <Card style={{ marginTop: "1.25rem" }}>
          <div className="card__title">Ticari Fatura Yanıtı (EBLG-06)</div>
          <p className="muted" style={{ fontSize: "0.875rem", marginTop: 0 }}>
            Bu bir <strong>ticari fatura</strong>; 8 gün içinde kabul veya ret yanıtı
            gönderilmelidir. Ret, belgeyi faturaya işlenemez hale getirir.
          </p>
          <div className="row-tight">
            <Button
              variant="primary"
              onClick={() => void yanitGonder("kabul")}
              disabled={islemde !== null}
            >
              {islemde === "yanit-kabul" ? "Gönderiliyor..." : "✔ Kabul Et"}
            </Button>
            <Button variant="danger" onClick={() => setRetAcik(!retAcik)} disabled={islemde !== null}>
              ✖ Reddet
            </Button>
          </div>
          {retAcik && (
            <div style={{ marginTop: "1rem" }}>
              <Field label="Ret Gerekçesi *">
                <Input
                  value={retGerekce}
                  onChange={(e) => setRetGerekce(e.target.value)}
                  placeholder="Örn. Sipariş edilmeyen ürün faturalanmış"
                />
              </Field>
              <Button
                variant="danger"
                onClick={() => void yanitGonder("ret")}
                disabled={islemde !== null || retGerekce.trim() === ""}
              >
                {islemde === "yanit-ret" ? "Gönderiliyor..." : "Ret Yanıtını Gönder"}
              </Button>
            </div>
          )}
        </Card>
      )}

      {detay.yanit === "ret" && detay.yanitGerekce && (
        <Card style={{ marginTop: "1.25rem" }}>
          <div className="card__title">Ret Gerekçesi</div>
          <p style={{ margin: 0 }}>{detay.yanitGerekce}</p>
        </Card>
      )}

      {detay.faturaTipi !== "satis_iade" && <GelenFiyatAnalizi belgeId={detay.id}
        eslesmeler={detay.satirlar.flatMap((s) => {
          const e = eslesme[s.siraNo];
          return e && (!e.varyantlar?.length || e.varyantId) ? [{ siraNo: s.siraNo, stokId: e.id, varyantId: e.varyantId ?? null }] : [];
        })} />}

      {islenebilir && denetim && (
        <div style={{ marginTop: "1.25rem" }}>
          <OnDenetimPaneli
            bulgular={denetim.bulgular}
            susturulan={denetim.susturulan}
            metin={GELEN_DENETIM_METINLERI}
            onSustur={denetim.cariId ? (kod) => void denetimSustur(kod) : undefined}
            onRetGerekcesine={detay.yanitGerekiyor && !detay.yanit ? retGerekcesineEkle : undefined}
            ai={aiDenetim ?? undefined}
            onYenidenSor={aiDenetim && aiDenetim !== "yukleniyor" ? () => void aiSor(detay.id, eslesme, true) : undefined}
          />
        </div>
      )}

      <Card style={{ marginTop: "1.25rem" }} pad={false}>
        <div style={{ padding: "1.25rem 1.25rem 0" }}>
          <div className="card__title">Satır Eşleştirme</div>
          <p className="muted" style={{ fontSize: "0.875rem" }}>
            Her belge kalemi bir stok kartına bağlanmalıdır — fatura
            kesinleştirilirken satır başına stok hareketi yazılır. Sistem barkod,
            tedarikçi ürün kodu ve ada göre otomatik eşleştirme dener; kalanları siz
            seçin ya da yeni kart açın.
          </p>
        </div>

        <TableWrap>
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th>Belge Kalemi</th>
              <th className="num">Miktar</th>
              <th className="num">Birim Fiyat</th>
              <th className="num">İsk.</th>
              <th className="num">KDV</th>
              <th className="num">Matrah</th>
              <th style={{ minWidth: 260 }}>Stok Kartı</th>
            </tr>
          </thead>
          <tbody>
            {detay.satirlar.map((s) => {
              const secili = eslesme[s.siraNo] ?? null;
              return (
                <tr key={s.siraNo}>
                  <td className="mono">{s.siraNo}</td>
                  <td>
                    <div>{s.ad}</div>
                    <div className="muted mono" style={{ fontSize: "0.78rem" }}>
                      {[
                        s.saticiUrunKodu && `satıcı: ${s.saticiUrunKodu}`,
                        s.barkod && `barkod: ${s.barkod}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="num">
                    {adet(s.miktar)} {s.birim}
                  </td>
                  <td className="num">{para(s.birimFiyat, detay.dovizCinsi)}</td>
                  <td className="num">
                    {Number(s.iskontoOrani) > 0 ? `%${s.iskontoOrani}` : "—"}
                  </td>
                  <td className="num">%{s.kdvOrani}</td>
                  <td className="num">{para(s.matrah, detay.dovizCinsi)}</td>
                  <td>
                    {secili ? (
                      <div className="row-tight" style={{ flexWrap: "wrap" }}>
                        <span>
                          <code className="mono">{secili.kod}</code> {secili.ad}
                        </span>
                        {s.eslesmeKaynagi && secili.id === s.onerilenStokId && (
                          <Badge variant="info">
                            oto: {ESLESME_ETIKETI[s.eslesmeKaynagi]}
                          </Badge>
                        )}
                        {secili.anaBirim !== s.birim && (
                          <Badge variant="warning">birim: {secili.anaBirim}</Badge>
                        )}
                        {islenebilir && (
                          <Button size="sm" onClick={() => seciciAc(s.siraNo, s)}>
                            Değiştir
                          </Button>
                        )}
                        {(secili.varyantlar?.length ?? 0) > 0 && (
                          <Select
                            aria-label={`${s.siraNo}. satır varyantı`}
                            value={secili.varyantId ?? ""}
                            disabled={!islenebilir}
                            onChange={(e) => {
                              const varyantId = e.target.value || undefined;
                              setEslesme((x) => ({ ...x, [s.siraNo]: { ...secili, varyantId } }));
                            }}
                          >
                            <option value="">Varyant seçin</option>
                            {secili.varyantlar!.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.ad} · {v.kod}
                              </option>
                            ))}
                          </Select>
                        )}
                        {islenebilir && (secili.varyantlar?.length ?? 0) > 0 && !secili.varyantId && (
                          <small className="field-error">Bu ürünün varyantları var; satırın varyantını seçin.</small>
                        )}
                      </div>
                    ) : (
                      <div className="row-tight">
                        <Badge variant="danger">EŞLEŞMEDİ</Badge>
                        {islenebilir && (
                          <>
                            <Button size="sm" onClick={() => seciciAc(s.siraNo, s)}>
                              Seç
                            </Button>
                            <Button size="sm" onClick={() => yeniKartAc(s)}>
                              ➕ Yeni Kart
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {seciciSira === s.siraNo && (
                      <div
                        style={{
                          marginTop: "0.75rem",
                          padding: "0.75rem",
                          border: "1px dashed var(--border-strong)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <SearchInput
                          value={seciciArama}
                          onChange={(e) => setSeciciArama(e.target.value)}
                          placeholder="Ad, kod veya barkod ile ara..."
                          autoFocus
                        />
                        <div style={{ maxHeight: 200, overflowY: "auto", marginTop: "0.5rem" }}>
                          {seciciSonuc.length === 0 ? (
                            <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                              Sonuç yok.
                            </p>
                          ) : (
                            seciciSonuc.flatMap((k) => [
                              <button
                                key={k.id}
                                type="button"
                                className="btn btn--ghost btn--block btn--sm"
                                style={{ justifyContent: "flex-start", marginBottom: "0.25rem" }}
                                onClick={() => {
                                  // Satır adındaki varyant ("Ürün — 150x45 / Mavi") kartta varsa o seçilir.
                                  const varyantAd = varyantliAdAyir(s.ad)?.varyantAd;
                                  const varyantId = varyantAd ? k.varyantlar?.find((v) => varyantAdiEsit(v.ad, varyantAd))?.id : undefined;
                                  setEslesme((e) => ({ ...e, [s.siraNo]: { ...k, varyantId } }));
                                  setSeciciSira(null);
                                }}
                              >
                                <code className="mono">{k.kod}</code>&nbsp;{k.ad}
                                {(k.varyantlar?.length ?? 0) > 0 && <span className="muted">&nbsp;· {k.varyantlar!.length} varyant</span>}
                              </button>,
                              // Varyant doğrudan da seçilebilir; satır o varyantla eşleşir.
                              ...(k.varyantlar ?? []).map((v) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  className="btn btn--ghost btn--block btn--sm"
                                  style={{ justifyContent: "flex-start", marginBottom: "0.25rem", paddingLeft: "1.5rem" }}
                                  onClick={() => {
                                    setEslesme((e) => ({ ...e, [s.siraNo]: { ...k, varyantId: v.id } }));
                                    setSeciciSira(null);
                                  }}
                                >
                                  ↳&nbsp;<code className="mono">{v.kod}</code>&nbsp;{v.ad}
                                </button>
                              )),
                            ])
                          )}
                        </div>
                        <Button size="sm" onClick={() => setSeciciSira(null)}>
                          Kapat
                        </Button>
                      </div>
                    )}

                    {yeniKartSira === s.siraNo && (
                      <div
                        style={{
                          marginTop: "0.75rem",
                          padding: "0.75rem",
                          border: "1px dashed var(--border-strong)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                          <div style={{ flex: 1, minWidth: 120 }}>
                            <Field label="Stok Tipi *">
                              <Select value={yeniTip} onChange={(e) => setYeniTip(e.target.value as "urun" | "sarf" | "hizmet")}>
                                <option value="urun">📦 Stoklanabilir Ürün</option>
                                <option value="sarf">🛠 Sarf Malzemesi</option>
                                <option value="hizmet">⚙️ Hizmet</option>
                              </Select>
                            </Field>
                          </div>
                          <div style={{ flex: 1, minWidth: 120 }}>
                            <Field label="Kod *">
                              <Input value={yeniKod} onChange={(e) => setYeniKod(e.target.value)} />
                            </Field>
                          </div>
                          <div style={{ flex: 2, minWidth: 170 }}>
                            <Field label="Ad *">
                              <Input value={yeniAd} onChange={(e) => setYeniAd(e.target.value)} />
                            </Field>
                          </div>
                          <div style={{ flex: 1, minWidth: 110 }}>
                            <Field label="Ana Birim *">
                              <BirimSecimi value={yeniBirim} onChange={setYeniBirim} required />
                            </Field>
                          </div>
                          <div style={{ flex: 1, minWidth: 90 }}>
                            <Field label="KDV %">
                              <KdvOraniSecimi value={yeniKdv} onDegis={setYeniKdv} tablo={kartKodTablosu} />
                            </Field>
                          </div>
                        </div>
                        <p className="muted" style={{ fontSize: "0.8rem" }}>
                          Alış fiyatı belgeden ({para(s.birimFiyat, detay.dovizCinsi)}) alınır
                          {detay.cari && s.saticiUrunKodu
                            ? "; tedarikçi ürün kodu karta bağlanır ki bir dahaki fatura otomatik eşleşsin."
                            : "."}
                        </p>
                        <div className="row-tight">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void yeniKartKaydet(s)}
                            disabled={
                              islemde !== null || yeniKod.trim() === "" || yeniAd.trim().length < 2
                            }
                          >
                            {islemde === "yeni-kart" ? "Açılıyor..." : "Kartı Aç ve Bağla"}
                          </Button>
                          <Button size="sm" onClick={() => setYeniKartSira(null)}>
                            Vazgeç
                          </Button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>

        {islenebilir && detay.faturaTipi === "satis_iade" && (
          <div style={{ padding: "0.8rem 1.25rem 0" }}>
            <Alert tone="warning">
              Bu belge müşterinin iade faturası: <strong>satış iadesi</strong> olarak işlenir (stok girer, cari alacak azalır).
              Belge numarası korunur, bizim serimizden numara almaz.
            </Alert>
          </div>
        )}
        {islenebilir && (detay.engeller?.length ?? 0) > 0 && (
          <div style={{ padding: "0.8rem 1.25rem 0" }}>
            <Alert tone="error">
              <strong>Belge faturaya işlenemez:</strong>
              <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
                {detay.engeller!.map((e) => <li key={e}>{e}</li>)}
              </ul>
              Belgeyi reddedin ya da faturayı elle girin.
            </Alert>
          </div>
        )}
        {islenebilir && detay.tutarDenetimi && (
          <div style={{ padding: "0.8rem 1.25rem 0" }}>
            <strong style={{ fontSize: "0.85rem" }}>Belge ile oluşacak fatura</strong>
            <TableWrap>
                <thead>
                  <tr><th>Tutar</th><th className="num">Belge</th><th className="num">Sistem</th><th className="num">Fark</th></tr>
                </thead>
                <tbody>
                  {detay.tutarDenetimi.satirlar.map((f) => {
                    const asti = detay.tutarDenetimi!.asanlar.some((a) => a.alan === f.alan);
                    return (
                      <tr key={f.alan} className={asti ? "is-negative" : undefined}>
                        <td>{f.ad}</td>
                        <td className="num">{para(f.belge, detay.dovizCinsi)}</td>
                        <td className="num">{para(f.sistem, detay.dovizCinsi)}</td>
                        <td className="num">{f.fark === 0 ? "—" : `${f.fark > 0 ? "+" : ""}${para(f.fark, detay.dovizCinsi)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
            </TableWrap>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              {detay.tutarDenetimi.gecerli
                ? `Tolerans ${para(detay.tutarDenetimi.tolerans, detay.dovizCinsi)}; kuruş farkı varsa faturanın notuna yazılır.`
                : `Fark toleransı (${para(detay.tutarDenetimi.tolerans, detay.dovizCinsi)}) aşıyor; belge işlenemez. Belgeyi reddedin ya da faturayı elle girin.`}
            </span>
            {(detay.tutarDenetimi.aciklamalar?.length ?? 0) > 0 && (
              <ul className="muted" style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem", fontSize: "0.8rem" }}>
                {detay.tutarDenetimi.aciklamalar!.map((a) => <li key={a}>{a}</li>)}
              </ul>
            )}
          </div>
        )}
        {(detay.irsaliyeEslesmesi?.length ?? 0) > 0 && detay.durum === "beklemede" && (
          <div style={{ padding: "0.8rem 1.25rem 0" }}>
            <strong style={{ fontSize: "0.85rem" }}>Faturada adı geçen irsaliyeler</strong>
            <ul className="muted" style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
              {detay.irsaliyeEslesmesi!.map((i) => (
                <li key={i.no}>
                  <strong>{i.no}</strong>{i.irsaliyeNo ? ` (${i.irsaliyeNo})` : ""} — {IRSALIYE_ESLESME_METNI[i.durum]}
                </li>
              ))}
            </ul>
          </div>
        )}
        {irsaliyeSonucu.length > 0 && (
          <div style={{ padding: "0.8rem 1.25rem 0" }}>
            <Alert tone={irsaliyeSonucu.some((m) => !m.includes("faturaya bağlandı")) ? "warning" : "success"}>
              {irsaliyeSonucu.map((m, i) => <div key={i}>{m}</div>)}
            </Alert>
          </div>
        )}
        {islenebilir && denetimUyarilari.length > 0 && (
          <div className="on-denetim stack" style={{ margin: "0.8rem 1.25rem 0" }}>
            <label>
              <input type="checkbox" checked={denetimOnay} onChange={(e) => setDenetimOnay(e.target.checked)} />{" "}
              Gelen alış denetimindeki {denetimUyarilari.length} uyarıyı gördüm, yine de faturaya işle
            </label>
            <Field label="Gerekçe (isteğe bağlı)">
              <Input value={denetimGerekce} maxLength={300} placeholder="Ör. fiyat artışı tedarikçiyle teyit edildi" onChange={(e) => setDenetimGerekce(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="between" style={{ padding: "1rem 1.25rem" }}>
          <span className="muted" style={{ fontSize: "0.9rem" }}>
            {detay.durum === "islendi"
              ? `Bu belge taslak ${faturaAdi}na işlendi. Hatalı eşleştirme varsa taslağı iptal edip yeniden eşleyebilirsiniz.`
              : detay.durum === "reddedildi"
                ? "Reddedilen belge faturaya işlenemez."
                : eksikSatirlar.length === 0
                  ? `${detay.satirlar.length} satırın tamamı eşleşti.`
                  : `${eksikSatirlar.length} satır hâlâ eşleşmedi.`}
          </span>
          {detay.durum === "islendi" ? (
            <Button
              variant="danger"
              onClick={() => void taslakIptalEt()}
              disabled={islemde !== null}
            >
              {islemde === "taslak-iptal"
                ? "İptal Ediliyor..."
                : "↩ Taslağı İptal Et ve Yeniden Eşleştir"}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void faturayaIsle()}
              disabled={!islenebilir || kapiKapali || eksikSatirlar.length > 0 || islemde !== null || (denetimUyarilari.length > 0 && !denetimOnay)}
            >
              {islemde === "onayla" ? "İşleniyor..." : "Faturaya İşle"}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
