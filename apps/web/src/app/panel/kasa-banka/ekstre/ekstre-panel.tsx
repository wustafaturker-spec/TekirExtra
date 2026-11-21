"use client";

/**
 * Ekstre satırı eşleştirme paneli (KSB-06).
 *
 * Seçilen satırın önerileri tek istekle gelir (`/oneriler`). Kullanıcı eşleme
 * türünü seçer; panel türün gerektirdiği bilgiyi ister, sonucu özetler ve
 * onaylatır. Kayıtlı kural uyarsa öneri hazır gelir; "benzer satırlar için
 * kural kaydet" ile yeni kural öğretilir.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { AramaSecici } from "@/components/arama-secici";
import { Alert, Badge, Button, Field, Input, Para, Segmented, Select, Tarih } from "@/components/ui";
import { KdvOraniSecimi, useKodTablosu } from "@/components/kdv-orani-secimi";

export type EslesmeTuru = "cari" | "mevcut_fis" | "masraf" | "gelir" | "virman" | "cek" | "kredi_karti" | "pos" | "odeme_talimati" | "doviz_islem" | "kredi";

export interface EkstreSatiri {
  id: string;
  bankaHesap: { id: string; ad: string; dovizCinsi: string };
  tarih: string;
  tutar: string;
  yon: "tahsilat" | "tediye";
  aciklama: string;
  dekontNo: string | null;
  karsiIban: string | null;
  karsiUnvan: string | null;
  bakiye: string | null;
  durum: "beklemede" | "eslesti" | "yoksayildi";
  eslesmeTuru: EslesmeTuru | null;
  eslesmeSkoru?: number | null;
  eslesmeKaniti?: unknown;
  hareketler: Array<{ id: string; tip: string; tutar: string; dovizCinsi: string; kaynakTur: string; aciklama: string | null; cari: { unvan: string } | null; fatura: { no: string | null } | null; hesap: string | null; kategori: string | null }>;
  kuralOnerisi: Kural | null;
}

interface Kural {
  id: string;
  anahtar: string;
  eslesmeTuru: EslesmeTuru;
  cariId: string | null;
  masrafKategoriId: string | null;
  gelirKategoriId: string | null;
  hedefKasaId: string | null;
  hedefBankaHesapId: string | null;
}

interface AcikFatura { id: string; no: string | null; tarih: string; vadeTarihi: string | null; dovizCinsi: string; kalan: string; genelToplam: string; tamEslesme?: boolean; referans?: "ettn" | "fatura_no" | null }

interface Oneriler {
  kural: Kural | null;
  onerilenCari: { id: string; kod: string; unvan: string } | null;
  cariEslesmeKaynagi: "aciklama" | "iban" | "vkn" | "unvan" | "kural" | "ettn" | "fatura_no" | "tutar" | "oneri_motoru" | "yapay_zeka" | null;
  /** AI-19: yapay zekâ önerisinin gerekçesi. */
  cariGerekcesi?: string;
  /** KSB-45: önerilen caride tutarın nasıl tuttuğu ve hazır dağıtım. */
  tutarEslesmesi?: { tur: "tek_fatura" | "ardisik_faturalar" | "bakiye"; dagitim: Array<{ faturaId: string; tutar: string }>; aciklama: string } | null;
  faturalar: AcikFatura[];
  mevcutFisler: Array<{ id: string; tip: string; tarih: string; tutar: string; aciklama: string | null; tamEslesme: boolean; cari: { unvan: string } | null; fatura: { no: string | null } | null }>;
  cekler: Array<{ id: string; tur: string; portfoyNo: string; cekNo: string | null; vadeTarihi: string; tutar: string; durum: string; borclu: string; banka: string | null; tamEslesme: boolean; cari: { unvan: string } | null }>;
  kartlar: Array<{ id: string; ad: string; bankaAdi: string; sonDortHane: string; borc: string }>;
  virmanHesaplari: Array<{ tur: "kasa" | "banka"; id: string; ad: string; bankaAdi?: string }>;
  dovizHesaplari: Array<{ tur: "kasa" | "banka"; id: string; ad: string; dovizCinsi: string }>;
  masrafKategorileri: Array<{ id: string; ad: string; varsayilanKdvOrani: string | null }>;
  gelirKategorileri: Array<{ id: string; ad: string }>;
  /** ENT-07: aynı tutarda bankaya gönderilmiş/onaylı ödeme talimatları. */
  odemeTalimatlari: Array<{ id: string; no: string | null; aliciUnvan: string; tutar: string; odemeTarihi: string; durum: string; aciklama: string; aciklamadaGeciyor: boolean }>;
  /** KRD-04: bu hesaba bağlı aktif krediler; girişte yalnız rotatif. */
  krediler: Array<{ id: string; ad: string; tur: "taksitli" | "spot" | "rotatif"; siradakiTaksit: { id: string; sira: number; vadeTarihi: string; anapara: string; faiz: string; bsmv: string; kkdf: string; toplam: string; tutarTutuyor: boolean } | null }>;
  /** P-05: Açıklanabilir eşleştirme güven skoru ve kanıt dökümü */
  eslesmeSkoru?: number;
  eslesmeKaniti?: {
    skor: number;
    oneriTuru: "otomatik" | "oneri" | "belirsiz";
    aciklama: string;
    sinyaller: Array<{ tur: string; puan: number; baslik: string; detay: string; deger?: string }>;
    alternatifAdaylar?: Array<{ cariId: string; kod: string; unvan: string; skor: number; gerekce: string }>;
  };
  alternatifAdaylar?: Array<{ cariId: string; kod: string; unvan: string; skor: number; gerekce: string }>;
}

export interface PosHesabi { id: string; ad: string; dovizCinsi: string; bakiye: string; aktif: boolean }

export const ESLESME_ADI: Record<EslesmeTuru, string> = {
  cari: "Cari / fatura",
  mevcut_fis: "Mevcut fiş",
  masraf: "Masraf",
  gelir: "Faaliyet dışı gelir",
  virman: "Virman",
  cek: "Çek / senet",
  kredi_karti: "Kredi kartı ödemesi",
  pos: "POS mutabakatı",
  odeme_talimati: "Ödeme talimatı",
  kredi: "Banka kredisi",
  doviz_islem: "Döviz alım/satımı",
};

const KAYNAK_ADI: Record<string, string> = { aciklama: "Açıklamadaki firma adı", iban: "IBAN eşleşti", vkn: "VKN eşleşti", unvan: "Unvan eşleşti", kural: "Kayıtlı kural", ettn: "ETTN eşleşti", fatura_no: "Fatura no eşleşti", tutar: "Tutar tek faturayı tutuyor", oneri_motoru: "Öneri motoru (kanıtlara bakın)", yapay_zeka: "Yapay zekâ önerisi — kontrol edin" };
const yuvarla = (n: number) => Math.round(n * 100) / 100;

/**
 * Açıklamadan kural metni önerisi: rakam içermeyen, bitişik ilk kelime dizisi
 * (en çok üç kelime). Kural bitişik metin aradığı için arada atlanan kelime
 * olmamalı: "DENEME-KSB06 EFT ÜCRETİ 02.10" → "EFT ÜCRETİ".
 */
function kuralMetniOner(aciklama: string): string {
  const kelimeler = aciklama.toLocaleUpperCase("tr-TR").split(/\s+/);
  const dizi: string[] = [];
  for (const k of kelimeler) {
    const temiz = /\d/.test(k) || k.replace(/[^\p{L}]/gu, "").length < 2 ? null : k;
    if (temiz) dizi.push(temiz);
    else if (dizi.length) break;
    if (dizi.length === 3) break;
  }
  return dizi.join(" ");
}

export function EslestirmePaneli({
  satir,
  cariler,
  posHesaplari,
  onDegisti,
  panelRef,
}: {
  satir: EkstreSatiri;
  cariler: Array<{ id: string; unvan: string; kod?: string }>;
  posHesaplari: PosHesabi[];
  onDegisti: (mesaj: string) => void;
  panelRef: React.Ref<HTMLElement>;
}) {
  const giris = satir.yon === "tahsilat";
  const mutlak = Math.abs(Number(satir.tutar));
  const doviz = satir.bankaHesap.dovizCinsi;

  const [oneriler, setOneriler] = useState<Oneriler | null>(null);
  const [tur, setTur] = useState<EslesmeTuru>("cari");
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [geriAlOnay, setGeriAlOnay] = useState(false);

  // Türlere göre girdiler
  const [cariId, setCariId] = useState("");
  const [faturalar, setFaturalar] = useState<AcikFatura[]>([]);
  const [dagitim, setDagitim] = useState<Record<string, string>>({});
  const [fisler, setFisler] = useState<Set<string>>(new Set());
  const [kategoriId, setKategoriId] = useState("");
  const [kdvOrani, setKdvOrani] = useState("0");
  // MVZ-11: masraf olarak eşleştirmede KDV oranı ekstre satırı tarihindeki merkezi listeden.
  const kodTablosu = useKodTablosu(satir.tarih);
  const [aciklama, setAciklama] = useState("");
  const [karsiHesap, setKarsiHesap] = useState("");
  const [cekId, setCekId] = useState("");
  const [kartId, setKartId] = useState("");
  const [talimatId, setTalimatId] = useState("");
  // KRD-04: kredi eşleşmesi; taksitte plan tutarları gelir, banka farklı tahsil ettiyse düzeltilir.
  const [krediId, setKrediId] = useState("");
  const [krediIslem, setKrediIslem] = useState<"taksit" | "kullanim" | "geri_odeme" | "faiz">("taksit");
  const [krediTutar, setKrediTutar] = useState({ anapara: "", faiz: "0", bsmv: "0", kkdf: "0" });
  const [posHesapId, setPosHesapId] = useState("");
  const [brutTutar, setBrutTutar] = useState("");
  const [karsiTutar, setKarsiTutar] = useState("");
  const [kuralKaydet, setKuralKaydet] = useState(false);
  const [kuralMetni, setKuralMetni] = useState("");
  const [kuralTumHesaplar, setKuralTumHesaplar] = useState(false);
  const [uygulananKural, setUygulananKural] = useState<string | null>(null);

  const turler: EslesmeTuru[] = giris
    ? ["cari", "mevcut_fis", "gelir", "virman", ...(oneriler?.dovizHesaplari.length ? ["doviz_islem" as const] : []), "cek", ...(posHesaplari.some((p) => p.aktif && p.dovizCinsi === doviz) ? ["pos" as const] : [])]
    : ["cari", "mevcut_fis", "masraf", "virman", ...(oneriler?.dovizHesaplari.length ? ["doviz_islem" as const] : []), "cek", "kredi_karti", "odeme_talimati"];
  if (oneriler?.krediler?.length) turler.push("kredi");

  function krediSec(id: string, islem?: typeof krediIslem) {
    const k = oneriler?.krediler.find((x) => x.id === id);
    setKrediId(id);
    if (!k) return;
    const yeniIslem = islem ?? (k.tur === "rotatif" ? (giris ? "kullanim" : "geri_odeme") : "taksit");
    setKrediIslem(yeniIslem);
    const t = k.siradakiTaksit;
    setKrediTutar(yeniIslem === "taksit" && t ? { anapara: t.anapara, faiz: t.faiz, bsmv: t.bsmv, kkdf: t.kkdf } : yeniIslem === "faiz" ? { anapara: "0", faiz: String(mutlak), bsmv: "0", kkdf: "0" } : { anapara: String(mutlak), faiz: "0", bsmv: "0", kkdf: "0" });
  }
  const krediToplami = yuvarla(krediIslem === "kullanim" ? Number(krediTutar.anapara) || 0 : (["anapara", "faiz", "bsmv", "kkdf"] as const).reduce((t, k) => t + (Number(krediTutar[k]) || 0), 0));

  // Satır değişince her şey sıfırlanır ve öneriler yeniden alınır.
  useEffect(() => {
    setOneriler(null);
    setHata("");
    setGeriAlOnay(false);
    setDagitim({});
    setFisler(new Set());
    setAciklama("");
    setKuralKaydet(false);
    setKuralMetni(kuralMetniOner(satir.aciklama));
    setKuralTumHesaplar(false);
    setUygulananKural(null);
    setBrutTutar(String(mutlak));
    if (satir.durum !== "beklemede") return;
    let iptal = false;
    api<Oneriler>(`/kasa-banka/ekstre/satirlar/${satir.id}/oneriler`)
      .then((o) => {
        if (iptal) return;
        setOneriler(o);
        setCariId(o.onerilenCari?.id ?? "");
        setFaturalar(o.faturalar);
        setDagitim(Object.fromEntries((o.tutarEslesmesi?.dagitim ?? []).map((d) => [d.faturaId, d.tutar])));
        // Bankadan gelen çıkışların çoğu banka masrafıdır; o kategori varsa öne alınır.
        const bankaMasrafi = o.masrafKategorileri.find((k) => k.ad.toLocaleLowerCase("tr-TR").includes("banka"));
        setKategoriId((giris ? o.gelirKategorileri[0]?.id : (bankaMasrafi ?? o.masrafKategorileri[0])?.id) ?? "");
        setKarsiHesap(""); setKarsiTutar("");
        setCekId(o.cekler.find((c) => c.tamEslesme)?.id ?? "");
        setKartId(o.kartlar[0]?.id ?? "");
        // ENT-07: açıklamada numarası geçen talimat en güçlü öneridir.
        const talimat = o.odemeTalimatlari.find((t) => t.aciklamadaGeciyor) ?? (o.odemeTalimatlari.length === 1 ? o.odemeTalimatlari[0] : undefined);
        setTalimatId(talimat?.id ?? "");
        // Öneri sırası: açıklamada geçen talimat > kural > birebir tutan mevcut fiş > birebir tutan çek > cari.
        const tekFis = o.mevcutFisler.filter((f) => f.tamEslesme);
        if (talimat?.aciklamadaGeciyor) setTur("odeme_talimati");
        else if (o.kural) kuraliUygula(o.kural);
        else if (tekFis.length === 1) { setTur("mevcut_fis"); setFisler(new Set([tekFis[0].id])); }
        else if (o.cekler.some((c) => c.tamEslesme)) setTur("cek");
        else setTur("cari");
      })
      .catch((e) => !iptal && setHata(e instanceof Error ? e.message : "Öneriler alınamadı"));
    return () => { iptal = true; };
    // Satır kimliği değişince çalışır; diğer bağımlılıklar satırdan türer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satir.id, satir.durum]);

  // Elle seçilen carinin açık faturaları (önerilen carininki zaten geldi).
  useEffect(() => {
    if (!oneriler || !cariId) { setFaturalar([]); return; }
    if (cariId === oneriler.onerilenCari?.id) { setFaturalar(oneriler.faturalar); return; }
    let iptal = false;
    api<AcikFatura[]>(`/kasa-banka/acik-faturalar?cariId=${cariId}&tip=${satir.yon}`)
      .then((f) => !iptal && setFaturalar(f))
      .catch(() => !iptal && setFaturalar([]));
    setDagitim({});
    return () => { iptal = true; };
  }, [cariId, oneriler, satir.yon]);

  function kuraliUygula(k: Kural) {
    setTur(k.eslesmeTuru);
    setUygulananKural(k.id);
    if (k.cariId) setCariId(k.cariId);
    if (k.masrafKategoriId) setKategoriId(k.masrafKategoriId);
    if (k.gelirKategoriId) setKategoriId(k.gelirKategoriId);
    if (k.hedefKasaId) setKarsiHesap(`kasa:${k.hedefKasaId}`);
    if (k.hedefBankaHesapId) setKarsiHesap(`banka:${k.hedefBankaHesapId}`);
  }

  /** En eski vadeden başlayarak aynı dövizdeki faturalara dağıtır. */
  function otomatikDagit() {
    let kalan = mutlak;
    const yeni: Record<string, string> = {};
    for (const f of faturalar) {
      if (kalan <= 0 || f.dovizCinsi !== doviz) continue;
      const pay = Math.min(kalan, Number(f.kalan));
      yeni[f.id] = pay.toFixed(2);
      kalan = yuvarla(kalan - pay);
    }
    setDagitim(yeni);
  }

  const dagitilan = useMemo(() => yuvarla(Object.values(dagitim).reduce((t, v) => t + (Number(v) || 0), 0)), [dagitim]);
  const avans = yuvarla(mutlak - dagitilan);
  const seciliFisToplami = useMemo(
    () => yuvarla((oneriler?.mevcutFisler ?? []).filter((f) => fisler.has(f.id)).reduce((t, f) => t + Number(f.tutar), 0)),
    [oneriler, fisler],
  );
  const komisyon = yuvarla((Number(brutTutar) || 0) - mutlak);
  const kuralDestekli = ["cari", "masraf", "gelir", "virman"].includes(tur);

  const gecerli = (() => {
    switch (tur) {
      case "cari": return Boolean(cariId) && dagitilan <= mutlak;
      case "mevcut_fis": return fisler.size > 0 && seciliFisToplami === yuvarla(mutlak);
      case "masraf": case "gelir": return Boolean(kategoriId);
      case "virman": return Boolean(karsiHesap);
      case "cek": return Boolean(cekId);
      case "kredi_karti": return Boolean(kartId);
      case "odeme_talimati": return Boolean(talimatId);
      case "pos": return Boolean(posHesapId) && komisyon >= 0;
      case "doviz_islem": return Boolean(karsiHesap) && Number(karsiTutar) > 0;
      case "kredi": return Boolean(krediId) && krediToplami === yuvarla(mutlak);
    }
  })() && (!kuralKaydet || kuralMetni.trim().length >= 3);

  async function eslestir() {
    setIsleniyor(true);
    setHata("");
    try {
      if (tur === "pos") {
        await api("/kasa-banka/pos-hesaplari/bankaya-aktar", {
          method: "POST",
          body: JSON.stringify({ posHesapId, bankaHesapId: satir.bankaHesap.id, ekstreSatirId: satir.id, brutTutar: Number(brutTutar).toFixed(2), komisyonTutar: komisyon.toFixed(2), tarih: satir.tarih }),
        });
        onDegisti(`POS sağlayıcı ödemesi mutabık hâle getirildi; ${komisyon.toFixed(2)} ${doviz} komisyon masrafa işlendi.`);
        return;
      }
      const [hesapTuru, hesapId] = karsiHesap.split(":");
      const ortak = { kuralId: uygulananKural, kural: kuralDestekli && kuralKaydet ? { anahtar: kuralMetni, tumHesaplar: kuralTumHesaplar } : null };
      const govde = {
        cari: { tur, cariId, dagitim: Object.entries(dagitim).filter(([, v]) => Number(v) > 0).map(([faturaId, v]) => ({ faturaId, tutar: Number(v).toFixed(2) })) },
        mevcut_fis: { tur, hareketIdleri: [...fisler] },
        masraf: { tur, kategoriId, kdvOrani, aciklama: aciklama || null },
        gelir: { tur, kategoriId, aciklama: aciklama || null },
        virman: { tur, karsiKasaId: hesapTuru === "kasa" ? hesapId : null, karsiBankaHesapId: hesapTuru === "banka" ? hesapId : null, aciklama: aciklama || null },
        cek: { tur, cekSenetId: cekId },
        kredi_karti: { tur, krediKartiId: kartId },
        odeme_talimati: { tur, talimatId },
        doviz_islem: { tur, karsiKasaId: hesapTuru === "kasa" ? hesapId : null, karsiBankaHesapId: hesapTuru === "banka" ? hesapId : null, karsiTutar: Number(karsiTutar).toFixed(2), aciklama: aciklama || null },
        kredi: {
          tur, krediId, islem: krediIslem,
          taksitId: krediIslem === "taksit" ? oneriler?.krediler.find((k) => k.id === krediId)?.siradakiTaksit?.id ?? null : null,
          ...Object.fromEntries((["anapara", "faiz", "bsmv", "kkdf"] as const).map((k) => [k, (Number(krediTutar[k]) || 0).toFixed(2)])),
        },
      }[tur];
      await api(`/kasa-banka/ekstre/satirlar/${satir.id}/eslestir`, { method: "POST", body: JSON.stringify({ ...govde, ...ortak }) });
      onDegisti(`Satır ${ESLESME_ADI[tur].toLocaleLowerCase("tr-TR")} olarak işlendi.${kuralDestekli && kuralKaydet ? " Kural kaydedildi; benzer satırlarda öneri hazır gelecek." : ""}`);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Eşleştirilemedi");
    } finally {
      setIsleniyor(false);
    }
  }

  async function satirIslemi(islem: "yoksay" | "geri-al") {
    setIsleniyor(true);
    setHata("");
    try {
      await api(`/kasa-banka/ekstre/satirlar/${satir.id}/${islem}`, { method: "POST" });
      onDegisti(islem === "yoksay"
        ? "Satır yoksayıldı; banka bakiyesine yansımaz ve mutabakatta 'yoksayılan' olarak görünür."
        : satir.durum === "yoksayildi" ? "Satır yeniden onaya alındı." : "Eşleşme geri alındı; satır yeniden onay bekliyor.");
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İşlem yapılamadı");
    } finally {
      setIsleniyor(false);
      setGeriAlOnay(false);
    }
  }

  const ust = (
    <header className="match-panel__head">
      <div>
        <span>{satir.bankaHesap.ad} · <Tarih deger={satir.tarih} />{satir.dekontNo ? ` · ${satir.dekontNo}` : ""}</span>
        <strong className={giris ? "is-in" : "is-out"}>{giris ? "+" : "−"}<Para deger={mutlak} dovizCinsi={doviz} /></strong>
      </div>
      <p>{satir.aciklama}</p>
      {(satir.karsiUnvan || satir.karsiIban) && <small>{[satir.karsiUnvan, satir.karsiIban].filter(Boolean).join(" · ")}</small>}
    </header>
  );

  if (satir.durum !== "beklemede") {
    return (
      <aside className="match-panel" ref={panelRef} tabIndex={-1} aria-label="Ekstre eşleştirme">
        {ust}
        <div className="match-panel__body">
          {satir.durum === "yoksayildi" ? (
            <Alert tone="warning">Bu satır yoksayıldı; banka bakiyesine yansımıyor.</Alert>
          ) : (
            <>
              <div className="match-panel__result">
                <Badge variant="success">{satir.eslesmeTuru ? ESLESME_ADI[satir.eslesmeTuru] : "Eşleşti"}</Badge>
                {satir.hareketler.map((h) => (
                  <div key={h.id}>
                    <strong><Para deger={h.tutar} dovizCinsi={h.dovizCinsi} /></strong>
                    <small>{[h.cari?.unvan, h.fatura?.no ? `Fatura ${h.fatura.no}` : null, h.kategori, h.hesap && h.tip.startsWith("virman") ? h.hesap : null].filter(Boolean).join(" · ") || h.aciklama}</small>
                  </div>
                ))}
              </div>
              <p className="match-panel__note">
                {satir.eslesmeTuru === "mevcut_fis"
                  ? "Geri almak yalnız bağı çözer; elle girilmiş fiş yerinde kalır."
                  : "Geri almak bu eşleştirmenin ürettiği fiş, cari hareketi ve masraf/gelir kaydını siler."}
              </p>
            </>
          )}
          {hata && <Alert tone="error">{hata}</Alert>}
        </div>
        <footer className="match-panel__foot">
          {geriAlOnay ? (
            <>
              <span>Emin misiniz?</span>
              <Button onClick={() => setGeriAlOnay(false)} disabled={isleniyor}>Vazgeç</Button>
              <Button variant="danger" onClick={() => void satirIslemi("geri-al")} disabled={isleniyor}>{isleniyor ? "Geri alınıyor…" : "Evet, geri al"}</Button>
            </>
          ) : (
            <Button variant={satir.durum === "yoksayildi" ? "primary" : "danger"} onClick={() => (satir.durum === "yoksayildi" ? void satirIslemi("geri-al") : setGeriAlOnay(true))} disabled={isleniyor}>
              {satir.durum === "yoksayildi" ? "Yeniden onaya al" : "Eşleşmeyi geri al"}
            </Button>
          )}
        </footer>
      </aside>
    );
  }

  return (
    <aside className="match-panel" ref={panelRef} tabIndex={-1} aria-label="Ekstre eşleştirme">
      {ust}
      <div className="match-panel__body">
        {!oneriler && !hata && <p className="match-panel__note">Öneriler hazırlanıyor…</p>}
        {oneriler?.kural && (
          <div className="match-panel__rule">
            <span>Kayıtlı kural: <strong>“{oneriler.kural.anahtar}”</strong> → {ESLESME_ADI[oneriler.kural.eslesmeTuru]}</span>
            {uygulananKural === oneriler.kural.id ? <Badge variant="success">Uygulandı</Badge> : <Button size="sm" onClick={() => kuraliUygula(oneriler.kural!)}>Uygula</Button>}
          </div>
        )}

        {oneriler && (
          <>
            {oneriler.eslesmeKaniti && (
              <div
                style={{
                  padding: "0.875rem",
                  marginBottom: "1rem",
                  borderRadius: "8px",
                  background: "var(--surface-muted, #f8fafc)",
                  border: "1px solid var(--border-color, #e2e8f0)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <Badge variant={oneriler.eslesmeKaniti.skor >= 90 ? "success" : oneriler.eslesmeKaniti.skor >= 70 ? "warning" : "neutral"}>
                      %{oneriler.eslesmeKaniti.skor} Güven Skoru
                    </Badge>
                    <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                      {oneriler.eslesmeKaniti.oneriTuru === "otomatik" ? "Güçlü Eşleşme Adayı" : oneriler.eslesmeKaniti.oneriTuru === "oneri" ? "Öneri Bekliyor" : "İnceleme Gerekli"}
                    </span>
                  </div>
                  {oneriler.eslesmeKaniti.skor >= 85 && (
                    <Button size="sm" variant="primary" disabled={isleniyor || !gecerli} onClick={eslestir}>
                      Öneriyi Onayla (%{oneriler.eslesmeKaniti.skor})
                    </Button>
                  )}
                </div>

                {oneriler.eslesmeKaniti.sinyaller && oneriler.eslesmeKaniti.sinyaller.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginTop: "0.5rem" }}>
                    {oneriler.eslesmeKaniti.sinyaller.map((s, idx) => (
                      <span
                        key={idx}
                        title={s.detay}
                        style={{
                          fontSize: "0.75rem",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "4px",
                          background: "var(--surface-raised, #ffffff)",
                          border: "1px solid var(--border-color, #e2e8f0)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.25rem",
                        }}
                      >
                        <span>{s.tur === "fatura_no" || s.tur === "ettn" ? "🧾" : s.tur === "vkn_tckn" ? "🏢" : s.tur === "iban" ? "🏦" : s.tur === "tutar" ? "🎯" : s.tur === "kural" ? "⚡" : s.tur === "talimat" ? "📋" : "✍️"}</span>
                        <strong>{s.baslik}</strong>
                        <span style={{ opacity: 0.65 }}>+{s.puan}</span>
                      </span>
                    ))}
                  </div>
                )}

                {oneriler.alternatifAdaylar && oneriler.alternatifAdaylar.length >= 2 && (
                  <div style={{ marginTop: "0.75rem", padding: "0.5rem", borderRadius: "6px", background: "var(--surface-raised, #ffffff)", border: "1px dashed var(--warning-border, #f59e0b)" }}>
                    <small style={{ display: "block", color: "var(--warning-text, #b45309)", fontWeight: 600, marginBottom: "0.375rem" }}>
                      ⚠️ Birden Fazla Yakın Aday Tespit Edildi — Tercih Ettiğiniz Cariyi Seçin:
                    </small>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {oneriler.alternatifAdaylar.map((a) => (
                        <Button
                          key={a.cariId}
                          size="sm"
                          variant={cariId === a.cariId ? "primary" : "ghost"}
                          onClick={() => {
                            setCariId(a.cariId);
                            setTur("cari");
                          }}
                        >
                          {a.unvan} (%{a.skor})
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="match-panel__types">
              <Segmented ariaLabel="Eşleme türü" items={turler.map((t) => ({ deger: t, baslik: ESLESME_ADI[t] }))} value={tur} onChange={(t) => { setTur(t); setHata(""); }} />
            </div>

            {tur === "cari" && (
              <div className="match-panel__section">
                <Field label="Cari hesap">
                  <AramaSecici ariaLabel="Cari hesap" deger={cariId} onChange={(id) => { setCariId(id); setDagitim({}); }} placeholder="Cari ara…" secenekler={cariler.map((c) => ({ deger: c.id, baslik: c.unvan }))} />
                </Field>
                {oneriler.onerilenCari && cariId === oneriler.onerilenCari.id && oneriler.cariEslesmeKaynagi && (
                  <>
                    <Badge variant={oneriler.cariEslesmeKaynagi === "yapay_zeka" || oneriler.cariEslesmeKaynagi === "oneri_motoru" ? "warning" : "info"}>{KAYNAK_ADI[oneriler.cariEslesmeKaynagi]}</Badge>
                    {oneriler.cariGerekcesi && <small className="muted">{oneriler.cariGerekcesi}</small>}
                    {oneriler.tutarEslesmesi && <small>Tutar: {oneriler.tutarEslesmesi.aciklama}{oneriler.tutarEslesmesi.dagitim.length ? "; dağıtım hazırlandı" : ""}.</small>}
                  </>
                )}
                {cariId && (
                  <>
                    <div className="between">
                      <strong className="match-panel__label">Açık faturalar</strong>
                      {faturalar.some((f) => f.dovizCinsi === doviz) && <Button size="sm" onClick={otomatikDagit}>En eski vadeden dağıt</Button>}
                    </div>
                    {faturalar.length === 0 ? (
                      <p className="match-panel__note">Bu carinin {giris ? "tahsil edilecek" : "ödenecek"} açık faturası yok; tutar cari bakiyesine işlenir.</p>
                    ) : (
                      <div className="allocation">
                        {faturalar.map((f) => {
                          const secili = dagitim[f.id] !== undefined;
                          return (
                            <div key={f.id} className={`allocation__row${secili ? " is-selected" : ""}`}>
                              <label>
                                <input type="checkbox" checked={secili} onChange={(e) => setDagitim((d) => {
                                  const y = { ...d };
                                  if (e.target.checked) y[f.id] = (f.dovizCinsi === doviz ? Math.min(Number(f.kalan), Math.max(avans, 0)) : Math.max(avans, 0)).toFixed(2);
                                  else delete y[f.id];
                                  return y;
                                })} />
                                <span>
                                  <strong>{f.no ?? "Numarasız"}</strong>
                                  <small>{f.vadeTarihi ? <>vade <Tarih deger={f.vadeTarihi} /></> : <Tarih deger={f.tarih} />} · kalan <Para deger={f.kalan} dovizCinsi={f.dovizCinsi} />{f.tamEslesme ? " · tutar birebir" : ""}{f.referans === "ettn" ? " · açıklamada ETTN'i geçiyor" : f.referans === "fatura_no" ? " · açıklamada numarası geçiyor" : ""}</small>
                                </span>
                              </label>
                              {secili && (
                                <Input aria-label={`${f.no ?? "Fatura"} tutarı`} inputMode="decimal" type="number" min="0.01" step="0.01" value={dagitim[f.id]} onChange={(e) => setDagitim((d) => ({ ...d, [f.id]: e.target.value }))} />
                              )}
                              {secili && f.dovizCinsi !== doviz && <small className="allocation__fx">Fatura {f.dovizCinsi}; tutar {doviz} girilir, karşılığı işlem günü kuruyla hesaplanır.</small>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <dl className="match-panel__sum">
                      <div><dt>Satır tutarı</dt><dd><Para deger={mutlak} dovizCinsi={doviz} /></dd></div>
                      <div><dt>Faturalara</dt><dd><Para deger={dagitilan} dovizCinsi={doviz} /></dd></div>
                      <div className={avans < 0 ? "is-error" : ""}><dt>{avans < 0 ? "Fazla dağıtılan" : giris ? "Cariye avans / bakiye" : "Tedarikçiye avans / bakiye"}</dt><dd><Para deger={Math.abs(avans)} dovizCinsi={doviz} /></dd></div>
                    </dl>
                  </>
                )}
              </div>
            )}

            {tur === "mevcut_fis" && (
              <div className="match-panel__section">
                <p className="match-panel__note">Bu hesaba ±7 gün içinde elle girilmiş, henüz ekstreye bağlanmamış fişler. Toplam satır tutarına eşit olmalı; yeni kayıt üretilmez.</p>
                {oneriler.mevcutFisler.length === 0 ? (
                  <Alert tone="warning">Uygun fiş bulunamadı.</Alert>
                ) : (
                  <div className="allocation">
                    {oneriler.mevcutFisler.map((f) => (
                      <label key={f.id} className={`allocation__row${fisler.has(f.id) ? " is-selected" : ""}`}>
                        <span className="allocation__pick">
                          <input type="checkbox" checked={fisler.has(f.id)} onChange={(e) => setFisler((s) => { const y = new Set(s); if (e.target.checked) y.add(f.id); else y.delete(f.id); return y; })} />
                          <span>
                            <strong><Para deger={f.tutar} dovizCinsi={doviz} />{f.tamEslesme && <Badge variant="success">Birebir</Badge>}</strong>
                            <small><Tarih deger={f.tarih} /> · {[f.cari?.unvan, f.fatura?.no ? `Fatura ${f.fatura.no}` : null, f.tip.startsWith("virman") ? "Virman" : null, f.aciklama].filter(Boolean).join(" · ")}</small>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <dl className="match-panel__sum">
                  <div><dt>Seçilen fişler</dt><dd><Para deger={seciliFisToplami} dovizCinsi={doviz} /></dd></div>
                  <div className={seciliFisToplami !== yuvarla(mutlak) && fisler.size ? "is-error" : ""}><dt>Fark</dt><dd><Para deger={yuvarla(mutlak - seciliFisToplami)} dovizCinsi={doviz} /></dd></div>
                </dl>
              </div>
            )}

            {(tur === "masraf" || tur === "gelir") && (
              <div className="match-panel__section">
                <div className="treasury-form-grid">
                  <Field label={tur === "masraf" ? "Masraf kategorisi" : "Gelir kategorisi"}>
                    <Select value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>
                      <option value="">Seçin…</option>
                      {(tur === "masraf" ? oneriler.masrafKategorileri : oneriler.gelirKategorileri).map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}
                    </Select>
                  </Field>
                  {tur === "masraf" && (
                    <Field label="KDV oranı">
                      <KdvOraniSecimi tablo={kodTablosu} value={kdvOrani} onDegis={setKdvOrani} />
                    </Field>
                  )}
                </div>
                <Field label="Açıklama">
                  <Input value={aciklama} maxLength={500} onChange={(e) => setAciklama(e.target.value)} placeholder={satir.aciklama} />
                </Field>
                <p className="match-panel__note">
                  {tur === "masraf"
                    ? "Banka masrafı ve BSMV için KDV %0 seçin. Kayıt Masraflar'da ödenmiş olarak görünür; gider raporuna ve bütçeye girer."
                    : "Kayıt Faaliyet Dışı Gelirler'de görünür ve gelir-gider raporuna girer."}
                </p>
              </div>
            )}

            {tur === "virman" && (
              <div className="match-panel__section">
                <Field label={giris ? "Paranın geldiği hesap" : "Paranın gittiği hesap"}>
                  <Select value={karsiHesap} onChange={(e) => setKarsiHesap(e.target.value)}>
                    <option value="">Seçin…</option>
                    {oneriler.virmanHesaplari.map((h) => <option key={`${h.tur}:${h.id}`} value={`${h.tur}:${h.id}`}>{h.tur === "kasa" ? "Kasa · " : "Banka · "}{h.ad}</option>)}
                  </Select>
                </Field>
                <Field label="Açıklama">
                  <Input value={aciklama} maxLength={500} onChange={(e) => setAciklama(e.target.value)} placeholder={satir.aciklama} />
                </Field>
                <p className="match-panel__note">Virmanın iki bacağı oluşur. Karşı hesabın ekstresi yüklendiğinde oradaki satır bu virmana “Mevcut fiş” olarak bağlanır; ikinci kez virman üretilmez.</p>
              </div>
            )}

            {tur === "doviz_islem" && (() => {
              const karsi = oneriler.dovizHesaplari.find((h) => `${h.tur}:${h.id}` === karsiHesap);
              const k = Number(karsiTutar);
              // Bilgi: TL'li tarafa göre 1 döviz kaç TL; iki döviz arasında çapraz kur.
              const kur = karsi && k > 0 ? (karsi.dovizCinsi === "TRY" ? k / mutlak : doviz === "TRY" ? mutlak / k : giris ? mutlak / k : k / mutlak) : null;
              const kurMetni = karsi && kur ? (karsi.dovizCinsi === "TRY" ? `1 ${doviz} = ${kur.toLocaleString("tr-TR", { maximumFractionDigits: 4 })} TL` : doviz === "TRY" ? `1 ${karsi.dovizCinsi} = ${kur.toLocaleString("tr-TR", { maximumFractionDigits: 4 })} TL` : giris ? `1 ${karsi.dovizCinsi} = ${kur.toLocaleString("tr-TR", { maximumFractionDigits: 4 })} ${doviz}` : `1 ${doviz} = ${kur.toLocaleString("tr-TR", { maximumFractionDigits: 4 })} ${karsi.dovizCinsi}`) : null;
              return (
                <div className="match-panel__section">
                  <Field label={giris ? "Bozdurulan / satılan hesap" : "Alınan dövizin girdiği hesap"}>
                    <Select value={karsiHesap} onChange={(e) => setKarsiHesap(e.target.value)}>
                      <option value="">Seçin…</option>
                      {oneriler.dovizHesaplari.map((h) => <option key={`${h.tur}:${h.id}`} value={`${h.tur}:${h.id}`}>{h.tur === "kasa" ? "Kasa · " : "Banka · "}{h.ad} · {h.dovizCinsi}</option>)}
                    </Select>
                  </Field>
                  <Field label={karsi ? `${giris ? "Karşı hesaptan çıkan" : "Karşı hesaba giren"} tutar (${karsi.dovizCinsi})` : "Karşı tutar"}>
                    <Input type="number" inputMode="decimal" min="0.01" step="any" value={karsiTutar} onChange={(e) => setKarsiTutar(e.target.value)} />
                  </Field>
                  <Field label="Açıklama">
                    <Input value={aciklama} maxLength={500} onChange={(e) => setAciklama(e.target.value)} placeholder={satir.aciklama} />
                  </Field>
                  <p className="match-panel__note">
                    {kurMetni ? <>Banka kuru: <strong>{kurMetni}</strong>. </> : null}
                    İki bacak birlikte yazılır; döviz bacağı işlem günü TCMB alış kuruyla değerlenir, fark kambiyo kârı ya da zararı olarak kaydedilir. Karşı hesabın ekstresindeki satır “Mevcut fiş” ile bağlanır.
                  </p>
                </div>
              );
            })()}

            {tur === "cek" && (
              <div className="match-panel__section">
                {oneriler.cekler.length === 0 ? (
                  <Alert tone="warning">{giris ? "Portföyde ya da tahsilde alınan çek/senet yok." : "Ödenmeyi bekleyen verilen çek/senet yok."}</Alert>
                ) : (
                  <div className="allocation" role="radiogroup" aria-label="Çek / senet">
                    {oneriler.cekler.map((c) => (
                      <label key={c.id} className={`allocation__row${cekId === c.id ? " is-selected" : ""}`}>
                        <span className="allocation__pick">
                          <input type="radio" name="cek" checked={cekId === c.id} onChange={() => setCekId(c.id)} />
                          <span>
                            <strong>{c.tur === "cek" ? "Çek" : "Senet"} {c.cekNo ?? c.portfoyNo} · <Para deger={c.tutar} dovizCinsi={doviz} />{c.tamEslesme && <Badge variant="success">Birebir</Badge>}</strong>
                            <small>vade <Tarih deger={c.vadeTarihi} /> · {c.cari?.unvan ?? c.borclu}{c.banka ? ` · ${c.banka}` : ""}</small>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="match-panel__note">{giris ? "Çek tahsil edildi olarak kapanır; tahsilat fişi bu satıra bağlanır." : "Verilen çek ödendi olarak kapanır; ödeme fişi bu satıra bağlanır."} Tutar satırla birebir aynı olmalı.</p>
              </div>
            )}

            {tur === "kredi_karti" && (
              <div className="match-panel__section">
                {oneriler.kartlar.length === 0 ? <Alert tone="warning">Bu dövizde aktif kredi kartı yok.</Alert> : (
                  <Field label="Ödenen kart">
                    <Select value={kartId} onChange={(e) => setKartId(e.target.value)}>
                      {oneriler.kartlar.map((k) => <option key={k.id} value={k.id}>{k.ad} •••• {k.sonDortHane} · borç {Number(k.borc).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {doviz}</option>)}
                    </Select>
                  </Field>
                )}
                <p className="match-panel__note">Kart ekstre ödemesi olarak kaydedilir; kart borcundan düşer.</p>
              </div>
            )}

            {tur === "kredi" && (() => {
              const kredi = oneriler.krediler.find((k) => k.id === krediId);
              const tutarAlani = (k: "anapara" | "faiz" | "bsmv" | "kkdf", etiket: string) => (
                <Field label={etiket}><Input type="number" inputMode="decimal" min="0" step="any" value={krediTutar[k]} onChange={(e) => setKrediTutar({ ...krediTutar, [k]: e.target.value })} /></Field>
              );
              return (
                <div className="match-panel__section">
                  <Field label="Kredi">
                    <Select value={krediId} onChange={(e) => krediSec(e.target.value)}>
                      <option value="">Seçin…</option>
                      {oneriler.krediler.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.ad}{k.siradakiTaksit ? ` · ${k.siradakiTaksit.sira}. taksit ${Number(k.siradakiTaksit.toplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}${k.siradakiTaksit.tutarTutuyor ? " ✓" : ""}` : k.tur === "rotatif" ? " · rotatif" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {kredi?.tur === "rotatif" && !giris && (
                    <Field label="İşlem">
                      <Select value={krediIslem} onChange={(e) => krediSec(krediId, e.target.value as typeof krediIslem)}>
                        <option value="geri_odeme">Anapara geri ödemesi</option>
                        <option value="faiz">Faiz tahsili</option>
                      </Select>
                    </Field>
                  )}
                  {kredi && (
                    <div className="kredi-form__alanlar">
                      {krediIslem !== "faiz" && tutarAlani("anapara", "Anapara")}
                      {(krediIslem === "taksit" || krediIslem === "faiz") && <>{tutarAlani("faiz", "Faiz")}{tutarAlani("bsmv", "BSMV")}{tutarAlani("kkdf", "KKDF")}</>}
                    </div>
                  )}
                  {kredi && krediToplami !== yuvarla(mutlak) && (
                    <Alert tone="warning">Tutarlar toplamı {krediToplami.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {doviz}, ekstre satırı {mutlak.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {doviz}; bankanın tahsil ettiğine göre düzeltin.</Alert>
                  )}
                  <p className="match-panel__note">Kredi işlemi bu satıra bağlı oluşur; faiz ve vergiler Finansman Giderleri'ne yazılır. Geri almak için eşleşmeyi buradan geri alın.</p>
                </div>
              );
            })()}

            {tur === "odeme_talimati" && (
              <div className="match-panel__section">
                {oneriler.odemeTalimatlari.length === 0 ? (
                  <Alert tone="warning">Bu hesaptan {mutlak.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {doviz} tutarında bankaya gönderilmiş ödeme talimatı yok.</Alert>
                ) : (
                  <div className="allocation" role="radiogroup" aria-label="Ödeme talimatı">
                    {[...oneriler.odemeTalimatlari].sort((a, b) => Number(b.aciklamadaGeciyor) - Number(a.aciklamadaGeciyor)).map((t) => (
                      <label key={t.id} className={`allocation__row${talimatId === t.id ? " is-selected" : ""}`}>
                        <span className="allocation__pick">
                          <input type="radio" name="talimat" checked={talimatId === t.id} onChange={() => setTalimatId(t.id)} />
                          <span>
                            <strong>{t.no ?? "Talimat"} · {t.aliciUnvan} {t.aciklamadaGeciyor && <Badge variant="success">Açıklamada geçiyor</Badge>}</strong>
                            <small>{t.aciklama} · ödeme {t.odemeTarihi.split("-").reverse().join(".")} · {t.durum === "gonderildi" ? "bankaya gönderildi" : "onaylı"}</small>
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="match-panel__note">Talimat gerçekleşti sayılır; bağlı faturalara tediye fişi yazılır, artanı carinin bakiyesine işlenir.</p>
              </div>
            )}

            {tur === "pos" && (
              <div className="match-panel__section">
                <div className="treasury-form-grid">
                  <Field label="POS hesabı">
                    <Select value={posHesapId} onChange={(e) => setPosHesapId(e.target.value)}>
                      <option value="">Seçin…</option>
                      {posHesaplari.filter((p) => p.aktif && p.dovizCinsi === doviz).map((p) => <option key={p.id} value={p.id}>{p.ad} · bakiye {Number(p.bakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</option>)}
                    </Select>
                  </Field>
                  <Field label={`Brüt tahsilat (${doviz})`}>
                    <Input inputMode="decimal" type="number" min="0.01" step="0.01" value={brutTutar} onChange={(e) => setBrutTutar(e.target.value)} />
                  </Field>
                </div>
                <dl className="match-panel__sum">
                  <div><dt>Bankaya geçen (net)</dt><dd><Para deger={mutlak} dovizCinsi={doviz} /></dd></div>
                  <div className={komisyon < 0 ? "is-error" : ""}><dt>Komisyon / kesinti</dt><dd><Para deger={komisyon} dovizCinsi={doviz} /></dd></div>
                </dl>
              </div>
            )}

            {kuralDestekli && (
              <div className="match-panel__learn">
                <label className="checkbox">
                  <input type="checkbox" checked={kuralKaydet} onChange={(e) => setKuralKaydet(e.target.checked)} />
                  Benzer satırlar için kural kaydet
                </label>
                {kuralKaydet && (
                  <div className="treasury-form-grid">
                    <Field label="Açıklamada geçen metin">
                      <Input value={kuralMetni} maxLength={120} onChange={(e) => setKuralMetni(e.target.value)} />
                    </Field>
                    <label className="checkbox">
                      <input type="checkbox" checked={kuralTumHesaplar} onChange={(e) => setKuralTumHesaplar(e.target.checked)} />
                      Bütün banka hesaplarında geçerli
                    </label>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {hata && <Alert tone="error">{hata}</Alert>}
      </div>
      <footer className="match-panel__foot">
        <Button onClick={() => void satirIslemi("yoksay")} disabled={isleniyor}>Yoksay</Button>
        <Button variant="primary" onClick={() => void eslestir()} disabled={isleniyor || !oneriler || !gecerli}>
          {isleniyor ? "İşleniyor…" : "Eşleştir"}
        </Button>
      </footer>
    </aside>
  );
}
