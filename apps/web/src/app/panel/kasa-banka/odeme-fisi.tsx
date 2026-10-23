"use client";

/**
 * Tahsilat / ödeme fişi (KSB-02/07).
 *
 * Fiş bir cariye ve isteğe bağlı olarak o carinin açık bir faturasına bağlanır.
 * Faturaya bağlanınca ödeme faturanın dövizindeki karşılığıyla mahsup edilir:
 * kalanı aşan kısım carinin avansı olarak bakiyede kalır. Hesap ile fatura
 * farklı dövizdeyse karşılık işlem günü TCMB kuruyla önerilir; banka farklı
 * bir kur uyguladıysa kullanıcı kuru düzeltir.
 */
import { hareketKurTipi } from "@tekirextra/shared";
import { useEffect, useId, useMemo, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { AramaSecici } from "@/components/arama-secici";
import { CariBakiye } from "@/components/cari-bakiye";
import { Alert, Badge, Button, Field, Input, Para, Segmented, Select, Tarih } from "@/components/ui";

export interface FisHesabi {
  id: string;
  tur: "kasa" | "banka";
  ad: string;
  dovizCinsi: string;
  bakiye: string;
  aktif: boolean;
}

interface AcikFatura {
  id: string;
  no: string | null;
  tarih: string;
  vadeTarihi: string | null;
  dovizCinsi: string;
  kur: string;
  genelToplam: string;
  odenen: string;
  kalan: string;
}

interface KurYaniti {
  kurTarihi: string;
  oncekiIsGunuKullanildi: boolean;
  kurlar: Record<string, number>;
}

interface KayitYaniti {
  makbuzNo: string | null;
  faturaKapama: { dovizCinsi: string; karsilik: string; mahsup: string; avans: string } | null;
  /** KSB-16: birden çok faturaya dağıtımda her faturaya düşen tutar. */
  faturaKapamalari?: { faturaId: string; no: string | null; tutar: string }[];
}

export type FisTipi = "tahsilat" | "tediye";

export interface FisBaslangici {
  tip?: FisTipi;
  /** `kasa:<id>` ya da `banka:<id>` */
  hesapAnahtari?: string;
  tarih?: string;
  cariId?: string;
  faturaId?: string | null;
  tutar?: string;
  aciklama?: string;
  /** KSB-08: düzeltilen fiş; kayıtta eskisi geri alınır, yenisi aynı işlemde yazılır. */
  duzeltilenId?: string;
}

const bugun = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const yuvarla = (sayi: number, basamak = 2) => Math.round(sayi * 10 ** basamak) / 10 ** basamak;
const sayi = (metin: string) => {
  const n = Number(metin.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Hesap ile fatura farklı dövizdeyse kullanıcıya hangi kurun sorulacağı.
 * Taraflardan biri TL ise kur her zaman "1 döviz = x TL" biçiminde gösterilir;
 * iki taraf da dövizse "1 hesap dövizi = x fatura dövizi".
 */
function kurTanimi(hesapDovizi: string, faturaDovizi: string) {
  if (hesapDovizi === faturaDovizi) return null;
  if (hesapDovizi === "TRY") return { etiket: `${faturaDovizi}/TRY`, birim: "TRY", tlKuru: faturaDovizi };
  if (faturaDovizi === "TRY") return { etiket: `${hesapDovizi}/TRY`, birim: "TRY", tlKuru: hesapDovizi };
  return { etiket: `${hesapDovizi}/${faturaDovizi}`, birim: faturaDovizi, tlKuru: null };
}

/** TCMB kurlarından önerilen kur (kurTanimi'ndaki yönde). */
function onerilenKur(hesapDovizi: string, faturaDovizi: string, kurlar: Record<string, number> | undefined): number | null {
  if (!kurlar) return null;
  const tl = (doviz: string) => (doviz === "TRY" ? 1 : kurlar[doviz]);
  const tanim = kurTanimi(hesapDovizi, faturaDovizi);
  if (!tanim) return null;
  if (tanim.tlKuru) return tl(tanim.tlKuru) ?? null;
  const h = tl(hesapDovizi);
  const f = tl(faturaDovizi);
  return h && f ? h / f : null;
}

/** Ödemenin fatura dövizindeki karşılığı ve TL değeri. */
function kapamaHesapla(girdi: {
  tutar: number;
  hesapDovizi: string;
  fatura: AcikFatura;
  kur: number;
  kurlar?: Record<string, number>;
}) {
  const { tutar, hesapDovizi, fatura, kur } = girdi;
  let karsilik = tutar;
  let tutarTry = hesapDovizi === "TRY" ? tutar : tutar * (girdi.kurlar?.[hesapDovizi] ?? 0);
  if (hesapDovizi !== fatura.dovizCinsi && kur > 0) {
    if (hesapDovizi === "TRY") karsilik = tutar / kur;
    else if (fatura.dovizCinsi === "TRY") { karsilik = tutar * kur; tutarTry = karsilik; }
    else karsilik = tutar * kur;
  }
  karsilik = yuvarla(karsilik);
  const kalan = sayi(fatura.kalan);
  const mahsup = Math.min(karsilik, kalan);
  const avans = yuvarla(karsilik - mahsup);
  const sonrakiKalan = yuvarla(kalan - mahsup);
  const kurFarki = fatura.dovizCinsi === "TRY" || karsilik <= 0 || !tutarTry
    ? 0
    : yuvarla(tutarTry * (mahsup / karsilik) - mahsup * sayi(fatura.kur));
  return { karsilik, mahsup: yuvarla(mahsup), avans, sonrakiKalan, kurFarki };
}

function gecikmeGunu(vade: string | null): number {
  if (!vade) return 0;
  const fark = Date.parse(`${bugun()}T00:00:00Z`) - Date.parse(`${vade}T00:00:00Z`);
  return Math.max(0, Math.floor(fark / 86_400_000));
}

export function OdemeFisi({
  hesaplar,
  cariler,
  baslangic,
  onKapat,
  onKaydedildi,
}: {
  hesaplar: FisHesabi[];
  cariler: Array<{ id: string; unvan: string }>;
  baslangic: FisBaslangici;
  onKapat: () => void;
  onKaydedildi: (mesaj: string) => void;
}) {
  const [tip, setTip] = useState<FisTipi>(baslangic.tip ?? "tahsilat");
  // Tutar kutusu "Kalanı yaz" düğmesiyle sarılı; Field etiketi kendiliğinden bağlayamaz.
  const tutarId = useId();
  const [hesapAnahtari, setHesapAnahtari] = useState(baslangic.hesapAnahtari ?? "");
  const [tarih, setTarih] = useState(baslangic.tarih ?? bugun());
  const [duzeltmeNedeni, setDuzeltmeNedeni] = useState("");
  const duzeltme = Boolean(baslangic.duzeltilenId);
  const [tutar, setTutar] = useState(baslangic.tutar ?? "");
  const [cariId, setCariId] = useState(baslangic.cariId ?? "");
  const [aciklama, setAciklama] = useState(baslangic.aciklama ?? "");
  const [faturaId, setFaturaId] = useState<string | null>(baslangic.faturaId ?? null);
  const [faturalar, setFaturalar] = useState<AcikFatura[] | null>(null);
  /** KSB-16: birden çok faturaya dağıtım; anahtar fatura, değer o faturaya yazılan tutar. */
  const [coklu, setCoklu] = useState(false);
  const [dagitim, setDagitim] = useState<Record<string, string>>({});
  const [faturaHatasi, setFaturaHatasi] = useState("");
  const [kurYaniti, setKurYaniti] = useState<KurYaniti | null>(null);
  const [kurHatasi, setKurHatasi] = useState("");
  const [kurMetni, setKurMetni] = useState("");
  const [kurElle, setKurElle] = useState(false);
  // Faturadan gelindiyse tutar, hesap seçilince kalanın hesap dövizindeki karşılığıyla dolar.
  const [kalaniOtomatikYaz, setKalaniOtomatikYaz] = useState(Boolean(baslangic.faturaId && !baslangic.tutar));
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [hata, setHata] = useState("");
  const [eksiBakiyeUyarisi, setEksiBakiyeUyarisi] = useState<string | null>(null);

  const aktifHesaplar = hesaplar.filter((h) => h.aktif);
  const hesap = aktifHesaplar.find((h) => `${h.tur}:${h.id}` === hesapAnahtari);
  const fatura = faturalar?.find((f) => f.id === faturaId) ?? null;
  const caprazDoviz = Boolean(hesap && fatura && hesap.dovizCinsi !== fatura.dovizCinsi);
  const tanim = hesap && fatura ? kurTanimi(hesap.dovizCinsi, fatura.dovizCinsi) : null;
  const dovizliHesap = Boolean(hesap && hesap.dovizCinsi !== "TRY");

  // Carinin bu yöndeki açık faturaları; URL'den gelen fatura da buradan seçilir.
  useEffect(() => {
    setDagitim({});
    if (!cariId) { setFaturalar(null); setFaturaId(null); setCoklu(false); return; }
    let iptal = false;
    setFaturalar(null);
    setFaturaHatasi("");
    const haric = baslangic.duzeltilenId ? `&haricHareketId=${baslangic.duzeltilenId}` : "";
    api<AcikFatura[]>(`/kasa-banka/acik-faturalar?cariId=${cariId}&tip=${tip}${haric}`)
      .then((liste) => {
        if (iptal) return;
        setFaturalar(liste);
        setFaturaId((onceki) => (onceki && liste.some((f) => f.id === onceki) ? onceki : null));
      })
      .catch((e) => { if (!iptal) { setFaturalar([]); setFaturaHatasi(e instanceof Error ? e.message : "Açık faturalar yüklenemedi"); } });
    return () => { iptal = true; };
  }, [cariId, tip, baslangic.duzeltilenId]);

  // DVZ-09: işlem günü TCMB kuru; tahsilat döviz alış, tediye döviz satış (sunucunun varsayılanıyla aynı kural).
  const kurGerekli = caprazDoviz || dovizliHesap;
  useEffect(() => {
    if (!kurGerekli || !tarih) { setKurYaniti(null); return; }
    let iptal = false;
    setKurHatasi("");
    api<KurYaniti>(`/doviz-kurlari?tarih=${tarih}&tip=${hareketKurTipi(tip)}`)
      .then((y) => { if (!iptal) setKurYaniti(y); })
      .catch((e) => { if (!iptal) { setKurYaniti(null); setKurHatasi(e instanceof Error ? e.message : "Kur alınamadı"); } });
    return () => { iptal = true; };
  }, [kurGerekli, tarih, tip]);

  const tcmbKuru = hesap && fatura ? onerilenKur(hesap.dovizCinsi, fatura.dovizCinsi, kurYaniti?.kurlar) : null;
  useEffect(() => {
    if (!kurElle) setKurMetni(tcmbKuru ? String(yuvarla(tcmbKuru, 4)) : "");
  }, [tcmbKuru, kurElle]);

  const kapama = useMemo(() => {
    if (!hesap || !fatura || !(sayi(tutar) > 0)) return null;
    if (caprazDoviz && !(sayi(kurMetni) > 0)) return null;
    return kapamaHesapla({ tutar: sayi(tutar), hesapDovizi: hesap.dovizCinsi, fatura, kur: sayi(kurMetni), kurlar: kurYaniti?.kurlar });
  }, [hesap, fatura, tutar, caprazDoviz, kurMetni, kurYaniti]);

  /** Faturanın kalanını hesabın dövizine çevirip tutara yazar. */
  function kalaniDoldur() {
    if (!fatura || !hesap) return;
    const kalan = sayi(fatura.kalan);
    const kur = sayi(kurMetni);
    let deger = kalan;
    if (caprazDoviz && kur > 0) {
      if (hesap.dovizCinsi === "TRY") deger = kalan * kur;
      else deger = kalan / kur;
    }
    setTutar(yuvarla(deger).toFixed(2));
  }

  useEffect(() => {
    if (!kalaniOtomatikYaz || !hesap || !fatura) return;
    if (caprazDoviz && !(sayi(kurMetni) > 0)) return;
    kalaniDoldur();
    setKalaniOtomatikYaz(false);
    // kalaniDoldur yalnız aşağıdaki değerlere bağlı; her çizimde yeniden tanımlanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kalaniOtomatikYaz, hesap, fatura, caprazDoviz, kurMetni]);

  // Çoklu dağıtımda tutar hesabın dövizindedir; farklı dövizli faturada karşılığı sunucu
  // fiş tarihinin kuruyla hesaplar (KSB-20) ve kalanı aşarsa reddeder.
  const dagitilabilir = (f: AcikFatura) => Boolean(hesap);
  const ayniDoviz = (f: AcikFatura) => Boolean(hesap && f.dovizCinsi === hesap.dovizCinsi);
  const secilenler = coklu ? (faturalar ?? []).filter((f) => sayi(dagitim[f.id] ?? "") > 0 && dagitilabilir(f)) : [];
  const dagitilan = yuvarla(secilenler.reduce((t, f) => t + sayi(dagitim[f.id]), 0));
  const asanFatura = secilenler.find((f) => ayniDoviz(f) && sayi(dagitim[f.id]) > sayi(f.kalan) + 0.0001);
  const dagitimGecerli = !coklu || (secilenler.length > 0 && !asanFatura && dagitilan <= sayi(tutar) + 0.0001);

  /** Ödeme tutarını vadesi en erken faturadan başlayarak seçili olmayanlar dahil dağıtır. */
  function vadeyeGoreDoldur() {
    let kalan = sayi(tutar);
    const yeni: Record<string, string> = {};
    for (const f of [...(faturalar ?? [])].filter(ayniDoviz).sort((a, b) => (a.vadeTarihi ?? a.tarih).localeCompare(b.vadeTarihi ?? b.tarih))) {
      if (kalan <= 0) break;
      const pay = yuvarla(Math.min(kalan, sayi(f.kalan)));
      if (pay > 0) { yeni[f.id] = pay.toFixed(2); kalan = yuvarla(kalan - pay); }
    }
    setDagitim(yeni);
  }

  function cokluSec() {
    setCoklu(true);
    setFaturaId(null);
  }

  function faturaSec(id: string | null) {
    setCoklu(false);
    setFaturaId(id);
    const secilen = faturalar?.find((f) => f.id === id);
    if (secilen && !aciklama) setAciklama(`${secilen.no ?? "Fatura"} ${tip === "tahsilat" ? "tahsilatı" : "ödemesi"}`);
  }

  /** `onayli`: kullanıcı eksi bakiye uyarısını gördü ve yine de kaydetmek istiyor (P1-9). */
  async function kaydet(e?: React.FormEvent, onayli = false) {
    e?.preventDefault();
    if (!hesap) return;
    setKaydediliyor(true);
    setHata("");
    setEksiBakiyeUyarisi(null);
    try {
      const capraz = caprazDoviz && kapama;
      const fis = {
        kasaId: hesap.tur === "kasa" ? hesap.id : null,
        bankaHesapId: hesap.tur === "banka" ? hesap.id : null,
        tip,
        tutar,
        dovizCinsi: hesap.dovizCinsi,
        tarih,
        aciklama: aciklama || null,
        cariId: cariId || null,
        faturaId: coklu ? null : fatura?.id ?? null,
        ...(coklu ? { faturalar: secilenler.map((f) => ({ faturaId: f.id, tutar: sayi(dagitim[f.id]).toFixed(2) })) } : {}),
        ...(capraz ? { faturaKarsiligi: kapama.karsilik.toFixed(2) } : {}),
        // Dövizli hesaptan TL faturaya: girilen kur hareketin kendi kurudur.
        ...(capraz && fatura?.dovizCinsi === "TRY" ? { kur: sayi(kurMetni).toFixed(6) } : {}),
        ...(onayli ? { eksiBakiyeOnay: true } : {}),
      };
      const yanit = duzeltme
        ? (await api<{ hareket: KayitYaniti }>(`/kasa-banka/hareketler/${baslangic.duzeltilenId}/duzelt`, {
            method: "POST",
            body: JSON.stringify({ neden: duzeltmeNedeni, yeni: fis }),
          })).hareket
        : await api<KayitYaniti>("/kasa-banka/hareketler", { method: "POST", body: JSON.stringify(fis) });
      const islemAdi = duzeltme ? "Fiş düzeltildi" : tip === "tahsilat" ? "Tahsilat kaydedildi" : "Ödeme kaydedildi";
      const k = yanit.faturaKapama;
      const ayrinti = k && fatura
        ? ` ${fatura.no ?? "Faturaya"} ${Number(k.mahsup).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${k.dovizCinsi} mahsup edildi${Number(k.avans) > 0 ? `; ${Number(k.avans).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${k.dovizCinsi} carinin avansı olarak kaldı` : ""}.`
        : "";
      const makbuz = yanit.makbuzNo ? ` Makbuz no: ${yanit.makbuzNo}.` : "";
      const cokluAyrinti = yanit.faturaKapamalari?.length
        ? ` ${yanit.faturaKapamalari.map((k) => `${k.no ?? "Fatura"} ${Number(k.tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`).join(", ")} kapatıldı.`
        : "";
      onKaydedildi(`${islemAdi}.${makbuz}${ayrinti}${cokluAyrinti}`);
    } catch (err) {
      if (err instanceof ApiHata && err.durum === 409 && !onayli && /eksi bakiye/i.test(err.message)) setEksiBakiyeUyarisi(err.message);
      else setHata(err instanceof Error ? err.message : "Fiş kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  // Düzeltmede eski fiş geri alınacağı için onun bakiyeye etkisi önce düşülür.
  const eskiEtki = duzeltme && hesap && `${hesap.tur}:${hesap.id}` === baslangic.hesapAnahtari
    ? (baslangic.tip === "tediye" ? -1 : 1) * sayi(baslangic.tutar ?? "0")
    : 0;
  const tahminiBakiye = hesap ? sayi(hesap.bakiye) - eskiEtki + (tip === "tahsilat" ? 1 : -1) * sayi(tutar) : 0;
  const kaydedilebilir = Boolean(hesap && sayi(tutar) > 0 && tarih && (!fatura || kapama) && dagitimGecerli && (!duzeltme || duzeltmeNedeni.trim().length >= 3));

  return (
    <form className="payment-slip" onSubmit={kaydet}>
      {duzeltme && (
        <div className="payment-slip__correction">
          <Alert tone="warning">
            Düzeltme kaydedilince eski fiş geri alınır (dönemi açıksa silinir, kapalıysa ters kaydı atılır) ve bu form yeni fiş olarak
            aynı işlemde yazılır. Fatura mahsubu ve cari bakiyesi yeniden hesaplanır.
          </Alert>
          <Field label="Düzeltme gerekçesi">
            <Input required minLength={3} maxLength={300} value={duzeltmeNedeni} onChange={(e) => setDuzeltmeNedeni(e.target.value)} placeholder="Ör. Tutar yanlış girilmişti" />
          </Field>
        </div>
      )}
      <div className="payment-slip__type">
        <Segmented
          ariaLabel="İşlem tipi"
          items={[
            { deger: "tahsilat", baslik: "Tahsilat (para girişi)" },
            { deger: "tediye", baslik: "Ödeme (para çıkışı)" },
          ]}
          value={tip}
          onChange={(t) => { setTip(t); setFaturaId(null); setCoklu(false); }}
        />
      </div>

      <section className="payment-slip__section" aria-labelledby="fis-islem">
        <h3 id="fis-islem">İşlem bilgileri</h3>
        <div className="treasury-form-grid">
          <Field label="Kasa / banka hesabı">
            <Select autoFocus required value={hesapAnahtari} onChange={(e) => { setHesapAnahtari(e.target.value); setKurElle(false); }}>
              <option value="">Hesap seçin</option>
              {aktifHesaplar.map((h) => (
                <option key={`${h.tur}:${h.id}`} value={`${h.tur}:${h.id}`}>
                  {h.ad} · {h.dovizCinsi}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tarih">
            <Input required type="date" value={tarih} onChange={(e) => { setTarih(e.target.value); setKurElle(false); }} />
          </Field>
          <Field label={`Tutar${hesap ? ` (${hesap.dovizCinsi})` : ""}`} htmlFor={tutarId}>
            <div className="payment-slip__amount">
              <Input id={tutarId} required inputMode="decimal" type="number" min="0.01" step="0.01" value={tutar} onChange={(e) => setTutar(e.target.value)} placeholder="0,00" />
              {fatura && hesap && (
                <Button type="button" onClick={kalaniDoldur} disabled={caprazDoviz && !(sayi(kurMetni) > 0)}>
                  Kalanı yaz
                </Button>
              )}
            </div>
          </Field>
          <Field label="Açıklama">
            <Input value={aciklama} maxLength={500} onChange={(e) => setAciklama(e.target.value)} placeholder="Ör. Eylül tahsilatı, havale" />
          </Field>
        </div>
        {hesap && (
          <p className="payment-slip__hint">
            Hesap bakiyesi <Para deger={hesap.bakiye} dovizCinsi={hesap.dovizCinsi} /> → işlemden sonra{" "}
            <Para deger={tahminiBakiye} dovizCinsi={hesap.dovizCinsi} isaretle={tahminiBakiye < 0} />
            {dovizliHesap && !caprazDoviz && <> · TL karşılığı işlem günü TCMB kuruyla hesaplanır.</>}
          </p>
        )}
      </section>

      <section className="payment-slip__section" aria-labelledby="fis-cari">
        <h3 id="fis-cari">Karşı taraf</h3>
        <Field label="Cari hesap">
          <AramaSecici
            ariaLabel="Cari hesap"
            deger={cariId}
            onChange={(id) => { setCariId(id); setFaturaId(null); }}
            placeholder="Cari ara… (boş bırakılırsa yalnız kasa/banka hareketi olur)"
            secenekler={cariler.map((c) => ({ deger: c.id, baslik: c.unvan }))}
          />
        </Field>
        <CariBakiye cariId={cariId} />
      </section>

      {cariId && (
        <section className="payment-slip__section" aria-labelledby="fis-fatura">
          <h3 id="fis-fatura">Fatura kapama <small>isteğe bağlı</small></h3>
          {faturaHatasi && <Alert tone="error">{faturaHatasi}</Alert>}
          {faturalar === null ? (
            <p className="payment-slip__hint">Açık faturalar yükleniyor…</p>
          ) : (
            <div className="invoice-picker" role="radiogroup" aria-label="Kapatılacak fatura">
              <label className={`invoice-picker__row${faturaId === null && !coklu ? " is-selected" : ""}`}>
                <input type="radio" name="fatura" checked={faturaId === null && !coklu} onChange={() => faturaSec(null)} />
                <span className="invoice-picker__main">
                  <strong>Faturaya bağlama</strong>
                  <small>Açık faturalara vade sırasıyla kendiliğinden dağılır; artanı avans kalır</small>
                </span>
              </label>
              {faturalar.length > 1 && (
                <label className={`invoice-picker__row${coklu ? " is-selected" : ""}`}>
                  <input type="radio" name="fatura" checked={coklu} onChange={cokluSec} />
                  <span className="invoice-picker__main">
                    <strong>Birden çok faturaya dağıt</strong>
                    <small>Faturaları işaretleyip her birine düşecek tutarı yazın; artan vadeye göre dağılır</small>
                  </span>
                </label>
              )}
              {faturalar.length === 0 && (
                <p className="invoice-picker__empty">
                  Bu carinin {tip === "tahsilat" ? "tahsil edilecek" : "ödenecek"} açık faturası yok.
                </p>
              )}
              {faturalar.map((f) => {
                const gecikme = gecikmeGunu(f.vadeTarihi);
                return (
                  <label key={f.id} className={`invoice-picker__row${(coklu ? sayi(dagitim[f.id] ?? "") > 0 : faturaId === f.id) ? " is-selected" : ""}`}>
                    {coklu ? (
                      <input
                        type="checkbox"
                        aria-label={`${f.no ?? "Numarasız fatura"} faturasına dağıt`}
                        disabled={!dagitilabilir(f)}
                        checked={sayi(dagitim[f.id] ?? "") > 0}
                        onChange={(e) => setDagitim((d) => ({ ...d, [f.id]: e.target.checked && ayniDoviz(f) ? f.kalan : "" }))}
                      />
                    ) : (
                      <input type="radio" name="fatura" checked={faturaId === f.id} onChange={() => faturaSec(f.id)} />
                    )}
                    <span className="invoice-picker__main">
                      <strong>{f.no ?? "Numarasız fatura"}</strong>
                      <small>
                        <Tarih deger={f.tarih} />
                        {f.vadeTarihi && <> · vade <Tarih deger={f.vadeTarihi} /></>}
                        {Number(f.odenen) > 0 && <> · toplam <Para deger={f.genelToplam} dovizCinsi={f.dovizCinsi} /></>}
                      </small>
                    </span>
                    <span className="invoice-picker__badges">
                      {gecikme > 0 && <Badge variant="danger">{gecikme} gün gecikti</Badge>}
                      {Number(f.odenen) > 0 && <Badge variant="info">Kısmi ödendi</Badge>}
                      {hesap && f.dovizCinsi !== hesap.dovizCinsi && <Badge variant="warning">{f.dovizCinsi}</Badge>}
                    </span>
                    <span className="invoice-picker__amount">
                      <small>Kalan</small>
                      <Para deger={f.kalan} dovizCinsi={f.dovizCinsi} />
                      {coklu && dagitilabilir(f) && (
                        <Input
                          aria-label={`${f.no ?? "Numarasız fatura"} için tutar`}
                          inputMode="decimal"
                          type="number"
                          min="0"
                          step="0.01"
                          value={dagitim[f.id] ?? ""}
                          onChange={(e) => setDagitim((d) => ({ ...d, [f.id]: e.target.value }))}
                          placeholder={ayniDoviz(f) ? "Tutar" : `Tutar (${hesap?.dovizCinsi})`}
                        />
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {coklu && hesap && (
            <div className="settlement" aria-live="polite">
              <dl className="settlement__rows">
                <div><dt>Ödeme tutarı</dt><dd><Para deger={sayi(tutar)} dovizCinsi={hesap.dovizCinsi} /></dd></div>
                <div className="is-strong"><dt>Seçilen faturalara</dt><dd><Para deger={dagitilan} dovizCinsi={hesap.dovizCinsi} /></dd></div>
                <div><dt>Artan (vadeye göre dağılır)</dt><dd><Para deger={Math.max(0, yuvarla(sayi(tutar) - dagitilan))} dovizCinsi={hesap.dovizCinsi} /></dd></div>
              </dl>
              <div>
                <Button type="button" size="sm" onClick={vadeyeGoreDoldur} disabled={!(sayi(tutar) > 0)}>Vadeye göre doldur</Button>
              </div>
              {asanFatura && <Alert tone="error">{asanFatura.no ?? "Numarasız fatura"} için yazılan tutar kalanı aşıyor.</Alert>}
              {dagitilan > sayi(tutar) + 0.0001 && <Alert tone="error">Faturalara dağıtılan tutar ödeme tutarını aşıyor.</Alert>}
              {(faturalar ?? []).some((f) => !ayniDoviz(f)) && (
                <small className="payment-slip__hint">Farklı dövizli faturaya yazılan tutar hesabın dövizindedir; karşılığı fiş tarihinin kuruyla hesaplanır. Bankanın uyguladığı karşılığı girmek için fişi faturasız kaydedip ayrıntısından &quot;Faturalara bağla&quot;yı kullanın.</small>
              )}
            </div>
          )}

          {fatura && hesap && (
            <div className="settlement" aria-live="polite">
              {caprazDoviz && tanim && (
                <div className="settlement__rate">
                  <Field label={`Kur (${tanim.etiket})`}>
                    <Input
                      required
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="any"
                      value={kurMetni}
                      onChange={(e) => { setKurMetni(e.target.value); setKurElle(true); }}
                    />
                  </Field>
                  <div className="settlement__rate-note">
                    {kurElle ? (
                      <>
                        <Badge variant="warning">Elle girildi</Badge>
                        {tcmbKuru && (
                          <button type="button" className="link-button" onClick={() => setKurElle(false)}>
                            TCMB kuruna dön ({yuvarla(tcmbKuru, 4).toLocaleString("tr-TR")})
                          </button>
                        )}
                      </>
                    ) : kurYaniti ? (
                      <Badge variant="info">
                        TCMB satış · <Tarih deger={kurYaniti.kurTarihi} />
                        {kurYaniti.oncekiIsGunuKullanildi ? " (önceki iş günü)" : ""}
                      </Badge>
                    ) : null}
                    <small>Banka farklı bir kur uyguladıysa dekonttaki kuru yazın.</small>
                  </div>
                  {kurHatasi && <Alert tone="warning">{kurHatasi}</Alert>}
                </div>
              )}

              <dl className="settlement__rows">
                <div>
                  <dt>Fatura kalanı</dt>
                  <dd><Para deger={fatura.kalan} dovizCinsi={fatura.dovizCinsi} /></dd>
                </div>
                {caprazDoviz && (
                  <div>
                    <dt>Ödemenin {fatura.dovizCinsi} karşılığı</dt>
                    <dd><Para deger={kapama?.karsilik ?? null} dovizCinsi={fatura.dovizCinsi} bosDeger="—" /></dd>
                  </div>
                )}
                <div className="is-strong">
                  <dt>Faturaya mahsup</dt>
                  <dd><Para deger={kapama?.mahsup ?? null} dovizCinsi={fatura.dovizCinsi} bosDeger="—" /></dd>
                </div>
                <div>
                  <dt>İşlemden sonra kalan</dt>
                  <dd>
                    {kapama ? (
                      <>
                        <Para deger={kapama.sonrakiKalan} dovizCinsi={fatura.dovizCinsi} />{" "}
                        {kapama.sonrakiKalan === 0
                          ? <Badge variant="success">Kapanır</Badge>
                          : <Badge variant="warning">Kısmi</Badge>}
                      </>
                    ) : "—"}
                  </dd>
                </div>
                {kapama && kapama.kurFarki !== 0 && (
                  <div className="is-muted">
                    <dt>Kur farkı (bilgi)</dt>
                    <dd>
                      <Para deger={kapama.kurFarki} dovizCinsi="TRY" isaretle />
                      <small>
                        {(tip === "tahsilat") === (kapama.kurFarki > 0) ? " lehe" : " aleyhe"} · fatura kuru{" "}
                        {Number(fatura.kur).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}
                      </small>
                    </dd>
                  </div>
                )}
              </dl>

              {kapama && kapama.avans > 0 && (
                <Alert tone="warning">
                  Ödeme faturanın kalanını <Para deger={kapama.avans} dovizCinsi={fatura.dovizCinsi} /> aşıyor. Fatura
                  kapanır, aşan tutar carinin {tip === "tahsilat" ? "avansı (alacağı)" : "bize olan avansı"} olarak
                  bakiyede kalır ve sonraki faturalara mahsup edilebilir.
                </Alert>
              )}
            </div>
          )}
        </section>
      )}

      {hata && <Alert tone="error">{hata}</Alert>}
      {eksiBakiyeUyarisi && (
        <div className="treasury-confirm" role="alertdialog" aria-label="Eksi bakiye uyarısı">
          <Alert tone="warning"><span><strong>Hesap eksi bakiyeye düşüyor.</strong> {eksiBakiyeUyarisi}</span></Alert>
          <div>
            <Button type="button" size="sm" onClick={() => setEksiBakiyeUyarisi(null)}>Vazgeç</Button>
            <Button type="button" size="sm" variant="primary" disabled={kaydediliyor} onClick={() => void kaydet(undefined, true)}>Yine de kaydet</Button>
          </div>
        </div>
      )}

      <footer>
        <Button type="button" onClick={onKapat} disabled={kaydediliyor}>Vazgeç</Button>
        <Button type="submit" variant="primary" disabled={kaydediliyor || !kaydedilebilir}>
          {kaydediliyor ? "Kaydediliyor…" : duzeltme ? "Düzeltmeyi kaydet" : tip === "tahsilat" ? "Tahsilatı kaydet" : "Ödemeyi kaydet"}
        </Button>
      </footer>
    </form>
  );
}
