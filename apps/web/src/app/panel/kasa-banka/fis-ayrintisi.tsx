"use client";

/**
 * Kasa/banka fişinin ayrıntısı ve eylemleri (KSB-08).
 *
 * Defter satırına tıklanınca açılır. Elle girilmiş tahsilat/tediye ve virman
 * buradan düzeltilir ya da geri alınır; başka modülün ürettiği fiş (masraf,
 * POS, çek, kredi kartı…) yalnız görüntülenir ve kaynağı söylenir. Geri alma
 * gerekçe ister: açık dönemde fiş silinir, kapalı dönemde bugün tarihli ters
 * kayıt atılır.
 *
 * P1-9: hesabın ilk hareketi olan cari'siz tahsilat/ödeme fişi "Açılış fişine
 * çevir" ile açılış bakiyesine dönüştürülür; açılış fişinin kendisi hesap
 * ekstresi ekranından değiştirilir.
 */
import { useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { GeriAlmaFormu, type GeriAlmaYontemi } from "@/components/geri-alma-formu";
import { FaturaBaglamaPenceresi } from "@/components/fatura-baglama";
import { Alert, Badge, Button, ButtonLabel, EylemCubugu, Field, Para, Tarih } from "@/components/ui";

export interface DefterHareketi {
  id: string;
  tarih: string;
  tip: string;
  tutar: string;
  dovizCinsi: string;
  kur: string;
  tutarTry: string;
  aciklama: string | null;
  kaynakTur: string;
  kaynakRef: string | null;
  karsiHareketId: string | null;
  makbuzNo: string | null;
  kasa?: { id: string; ad: string } | null;
  bankaHesap?: { id: string; ad: string; bankaAdi: string } | null;
  posHesap?: { id: string; ad: string } | null;
  cari?: { id: string; unvan: string } | null;
  fatura?: { id: string; no: string | null } | null;
}

const TIP_ADI: Record<string, string> = {
  tahsilat: "Tahsilat",
  tediye: "Ödeme (tediye)",
  virman_gelis: "Virman girişi",
  virman_gidis: "Virman çıkışı",
};

/** Fişi üreten modül; buradan geri alınamayanlar için yönlendirme metni. */
const KAYNAK_ADI: Record<string, string> = {
  manuel: "Elle girilen fiş",
  acilis: "Açılış (devir) fişi",
  doviz_islem: "Döviz alım/satımı",
  fatura_kapama: "Fatura kapama fişi",
  ters_kayit: "Ters kayıt",
  masraf: "Masraflar",
  pos_tahsilat: "POS tahsilatı",
  pos_mutabakat: "POS mutabakatı (Banka Ekstresi)",
  cek_senet: "Çek & Senetler",
  kredi_karti_ekstre: "Kredi Kartları",
  faturasiz_gelir: "Faaliyet Dışı Gelirler",
  pazaryeri_kesinti: "Pazaryeri Kesintileri",
  pazaryeri_stopaj: "Pazaryeri Kesintileri (stopaj)",
  personel_maas: "Personel & İK (maaş)",
  personel_maas_iptal: "Personel & İK (maaş iptali)",
  personel_avans: "Personel & İK (avans)",
};

interface DovizIslemi {
  cikanTutar: string; cikanDoviz: string; cikanKur: string; cikanTry: string;
  girenTutar: string; girenDoviz: string; girenKur: string; girenTry: string;
  farkTry: string; bankaMasrafId: string | null;
}

const virmanMi = (h: DefterHareketi) => h.tip === "virman_gelis" || h.tip === "virman_gidis";
const hesapAdi = (h: DefterHareketi) => h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "—";
const hesapAnahtari = (h: DefterHareketi) => (h.kasa ? `kasa:${h.kasa.id}` : h.bankaHesap ? `banka:${h.bankaHesap.id}` : null);

/** KSB-13: tam listeye bakmadan sunucudan gelen bağlam (`/hareketler/:id/baglam`). */
interface FisBaglami {
  karsi: DefterHareketi | null;
  ters: { id: string; tarih: string } | null;
  asil: { id: string; tarih: string; tip: string } | null;
  acilisaCevrilebilir: boolean;
}

export function FisAyrintisi({
  hareket,
  onDuzelt,
  onGeriAlindi,
}: {
  hareket: DefterHareketi;
  onDuzelt: (h: DefterHareketi, karsi: DefterHareketi | null) => void;
  onGeriAlindi: (mesaj: string) => void;
}) {
  const [geriAlAcik, setGeriAlAcik] = useState(false);
  const [cevirAcik, setCevirAcik] = useState(false);
  const [cevirNedeni, setCevirNedeni] = useState("");
  const [cevirHata, setCevirHata] = useState("");
  const [cevriliyor, setCevriliyor] = useState(false);
  // P1-2a: döviz alım/satımı bacağı ise işlemin kurları ve kambiyo farkı.
  const dovizIslemId = hareket.kaynakTur === "doviz_islem" ? hareket.kaynakRef : null;
  const [dovizIslem, setDovizIslem] = useState<DovizIslemi | null>(null);
  const [dovizGeriAlAcik, setDovizGeriAlAcik] = useState(false);
  const [dovizNedeni, setDovizNedeni] = useState("");
  useEffect(() => {
    if (!dovizIslemId) return;
    let iptal = false;
    api<DovizIslemi>(`/kasa-banka/doviz-islemleri/${dovizIslemId}`).then((d) => { if (!iptal) setDovizIslem(d); }).catch(() => undefined);
    return () => { iptal = true; };
  }, [dovizIslemId]);

  async function dovizIsleminiGeriAl(e: React.FormEvent) {
    e.preventDefault();
    setCevriliyor(true);
    setCevirHata("");
    try {
      await api(`/kasa-banka/doviz-islemleri/${dovizIslemId}/geri-al`, { method: "POST", body: JSON.stringify({ neden: dovizNedeni }) });
      onGeriAlindi("Döviz alım/satımı geri alındı; iki bacak, kambiyo kaydı ve banka masrafı silindi.");
    } catch (err) {
      setCevirHata(err instanceof Error ? err.message : "Döviz işlemi geri alınamadı");
    } finally {
      setCevriliyor(false);
    }
  }

  const [baglam, setBaglam] = useState<FisBaglami | null>(null);
  const [baglamHata, setBaglamHata] = useState("");
  useEffect(() => {
    let iptal = false;
    setBaglam(null);
    setBaglamHata("");
    api<FisBaglami>(`/kasa-banka/hareketler/${hareket.id}/baglam`)
      .then((b) => { if (!iptal) setBaglam(b); })
      .catch((err) => { if (!iptal) setBaglamHata(err instanceof Error ? err.message : "Fişin bağlantıları okunamadı"); });
    return () => { iptal = true; };
  }, [hareket.id]);

  const karsi = baglam?.karsi ?? null;
  const ters = baglam?.ters ?? null;
  const asil = baglam?.asil ?? null;
  const elleGirilen = hareket.kaynakTur === "manuel" || hareket.kaynakTur === "fatura_kapama";
  // Bağlam gelmeden eylem düğmeleri gösterilmez; geri alınmış fiş yeniden değiştirilmesin.
  const degistirilebilir = elleGirilen && baglam !== null && !ters;
  const acilis = hareket.kaynakTur === "acilis";
  const hesap = hesapAnahtari(hareket);
  // Sunucu da aynı koşulları denetler; burada yalnız düğmenin gösterilip gösterilmeyeceği belirlenir.
  const acilisaCevrilebilir = baglam?.acilisaCevrilebilir ?? false;
  // KSB-19: faturasız girilen (ya da artanı kalan) cari tahsilat/ödemesi sonradan faturalara bağlanır.
  const [baglamaAcik, setBaglamaAcik] = useState(false);
  const faturayaBaglanabilir = (hareket.tip === "tahsilat" || hareket.tip === "tediye") && Boolean(hareket.cari) && !hareket.fatura
    && hareket.kaynakTur !== "ters_kayit" && !acilis && baglam !== null && !ters;

  async function acilisaCevir(e: React.FormEvent) {
    e.preventDefault();
    setCevriliyor(true);
    setCevirHata("");
    try {
      await api(`/kasa-banka/hareketler/${hareket.id}/acilisa-cevir`, { method: "POST", body: JSON.stringify({ neden: cevirNedeni }) });
      onGeriAlindi(`Fiş ${hesapAdi(hareket)} hesabının açılış fişine çevrildi; bakiye değişmedi, artık tahsilat/ödeme sayılmıyor.${hareket.makbuzNo ? ` ${hareket.makbuzNo} makbuz numarası yandı.` : ""}`);
    } catch (err) {
      setCevirHata(err instanceof Error ? err.message : "Fiş açılışa çevrilemedi");
    } finally {
      setCevriliyor(false);
    }
  }

  return (
    <div className="slip-detail">
      {baglamaAcik && <FaturaBaglamaPenceresi hareketId={hareket.id} onKapat={() => setBaglamaAcik(false)} onBitti={(m) => { setBaglamaAcik(false); onGeriAlindi(m); }} />}
      <EylemCubugu etiket="Fiş eylemleri">
        {hareket.makbuzNo && (
          <Button size="sm" onClick={() => void apiDosyaIndir(`/kasa-banka/hareketler/${hareket.id}/makbuz`, `makbuz-${hareket.makbuzNo}.pdf`)}>
            Makbuz PDF
          </Button>
        )}
        {dovizIslemId && <Button size="sm" variant="danger" onClick={() => setDovizGeriAlAcik(true)} disabled={dovizGeriAlAcik}>Döviz işlemini geri al</Button>}
        {acilis && hesap && <ButtonLabel as="a" size="sm" href={`/panel/kasa-banka/hesap-ekstresi?hesap=${hesap}`}>Açılışı değiştir</ButtonLabel>}
        {acilisaCevrilebilir && (
          <Button size="sm" onClick={() => { setCevirAcik(true); setGeriAlAcik(false); }} disabled={cevirAcik}>Açılış fişine çevir</Button>
        )}
        {faturayaBaglanabilir && <Button size="sm" onClick={() => setBaglamaAcik(true)}>Faturalara bağla</Button>}
        {degistirilebilir && (
          <>
            <Button size="sm" onClick={() => onDuzelt(hareket, karsi)} disabled={geriAlAcik || cevirAcik}>Düzelt</Button>
            <Button size="sm" variant="danger" onClick={() => setGeriAlAcik(true)} disabled={geriAlAcik || cevirAcik}>Geri al</Button>
          </>
        )}
      </EylemCubugu>

      <div className="slip-detail__hero">
        <div>
          {acilis
            ? <Badge variant="info">Açılış bakiyesi{hareket.tip === "tediye" ? " (eksi)" : ""}</Badge>
            : <Badge variant={hareket.tip === "tahsilat" || hareket.tip === "virman_gelis" ? "success" : "danger"}>{TIP_ADI[hareket.tip] ?? hareket.tip}</Badge>}
          {hareket.kaynakTur === "ters_kayit" && <Badge variant="warning">Ters kayıt</Badge>}
          {ters && <Badge variant="neutral">Geri alındı</Badge>}
        </div>
        <strong>
          <Para deger={hareket.tutar} dovizCinsi={hareket.dovizCinsi} />
        </strong>
        {hareket.dovizCinsi !== "TRY" && (
          <small>
            <Para deger={hareket.tutarTry} dovizCinsi="TRY" /> · kur {Number(hareket.kur).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}
          </small>
        )}
      </div>

      <dl className="slip-detail__facts">
        {hareket.makbuzNo && <div><dt>Makbuz no</dt><dd className="mono">{hareket.makbuzNo}</dd></div>}
        <div><dt>Tarih</dt><dd><Tarih deger={hareket.tarih} /></dd></div>
        <div><dt>Hesap</dt><dd>{hesapAdi(hareket)}</dd></div>
        {virmanMi(hareket) && karsi && (
          <div><dt>{hareket.tip === "virman_gidis" ? "Hedef hesap" : "Kaynak hesap"}</dt><dd>{hesapAdi(karsi)}</dd></div>
        )}
        <div><dt>Cari</dt><dd>{hareket.cari?.unvan ?? "—"}</dd></div>
        <div><dt>Fatura</dt><dd>{hareket.fatura ? hareket.fatura.no ?? "Numarasız fatura" : "—"}</dd></div>
        <div><dt>Açıklama</dt><dd>{hareket.aciklama || "—"}</dd></div>
        <div><dt>Kaynak</dt><dd>{KAYNAK_ADI[hareket.kaynakTur] ?? hareket.kaynakTur.replaceAll("_", " ")}</dd></div>
      </dl>

      {baglamHata && <Alert tone="error">{baglamHata}</Alert>}
      {ters && (
        <Alert tone="warning">
          Bu fiş <Tarih deger={ters.tarih} /> tarihli ters kayıtla geri alındı; iki kayıt birbirini sıfırlar.
        </Alert>
      )}
      {asil && (
        <Alert tone="warning">
          Bu kayıt <Tarih deger={asil.tarih} /> tarihli {TIP_ADI[asil.tip]?.toLocaleLowerCase("tr-TR") ?? "fişin"} ters kaydıdır; asıl fiş kapalı dönemde olduğu için silinmedi.
        </Alert>
      )}
      {dovizIslem && (
        <dl className="slip-detail__facts">
          <div><dt>Çıkan</dt><dd><Para deger={dovizIslem.cikanTutar} dovizCinsi={dovizIslem.cikanDoviz} />{dovizIslem.cikanDoviz !== "TRY" && <small> · TCMB alış {Number(dovizIslem.cikanKur).toLocaleString("tr-TR", { maximumFractionDigits: 4 })} → <Para deger={dovizIslem.cikanTry} dovizCinsi="TRY" /></small>}</dd></div>
          <div><dt>Giren</dt><dd><Para deger={dovizIslem.girenTutar} dovizCinsi={dovizIslem.girenDoviz} />{dovizIslem.girenDoviz !== "TRY" && <small> · TCMB alış {Number(dovizIslem.girenKur).toLocaleString("tr-TR", { maximumFractionDigits: 4 })} → <Para deger={dovizIslem.girenTry} dovizCinsi="TRY" /></small>}</dd></div>
          <div><dt>Kambiyo {Number(dovizIslem.farkTry) < 0 ? "zararı" : "kârı"}</dt><dd><Para deger={Math.abs(Number(dovizIslem.farkTry))} dovizCinsi="TRY" />{dovizIslem.bankaMasrafId ? " · banka masrafı ayrıca yazıldı" : ""}</dd></div>
        </dl>
      )}
      {dovizGeriAlAcik && (
        <form className="undo-form" onSubmit={dovizIsleminiGeriAl}>
          <h3>Döviz işlemini geri al</h3>
          <p>İki bacak, kambiyo kârı/zararı kaydı ve varsa banka masrafı birlikte silinir; görüntüsü denetim izine yazılır. Mali dönemi kapalıysa geri alınmaz. Bacaklardan biri banka ekstresine bağlıysa önce o eşleşme geri alınmalıdır.</p>
          <Field label="Gerekçe">
            <textarea autoFocus className="input" required minLength={3} maxLength={300} rows={2} value={dovizNedeni} onChange={(e) => setDovizNedeni(e.target.value)} placeholder="Ör. Tutar yanlış girilmişti" />
          </Field>
          {cevirHata && <Alert tone="error">{cevirHata}</Alert>}
          <footer>
            <Button type="button" onClick={() => setDovizGeriAlAcik(false)} disabled={cevriliyor}>Vazgeç</Button>
            <Button type="submit" variant="danger" disabled={cevriliyor || dovizNedeni.trim().length < 3}>{cevriliyor ? "Geri alınıyor…" : "Geri al"}</Button>
          </footer>
        </form>
      )}
      {acilis && (
        <p className="slip-detail__note">
          Açılış fişi hesabın dönem başı bakiyesidir: bakiyeye girer, tahsilat/ödeme sayılmaz ve makbuz numarası almaz. Tutarını ya da
          tarihini hesap ekstresi ekranındaki <strong>Açılış bakiyesi</strong> bölümünden değiştirebilirsiniz.
        </p>
      )}
      {!elleGirilen && !acilis && !dovizIslemId && hareket.kaynakTur !== "ters_kayit" && (
        <p className="slip-detail__note">
          Bu kayıt <strong>{KAYNAK_ADI[hareket.kaynakTur] ?? "başka bir modül"}</strong> tarafından oluşturuldu. Düzeltme ve geri alma o ekrandan yapılır.
        </p>
      )}

      {cevirAcik && (
        <form className="undo-form" onSubmit={acilisaCevir}>
          <h3>Açılış fişine çevir</h3>
          <p>
            Bu fiş {hesapAdi(hareket)} hesabının açılış (devir) bakiyesi olarak işaretlenir. Hesap bakiyesi değişmez; fiş günlük
            tahsilat raporundan ve makbuz serisinden çıkar.{hareket.makbuzNo ? ` ${hareket.makbuzNo} numarası yanar, yeniden verilmez.` : ""}
          </p>
          <Field label="Gerekçe">
            <textarea autoFocus className="input" required minLength={3} maxLength={300} rows={2} value={cevirNedeni} onChange={(e) => setCevirNedeni(e.target.value)} placeholder="Ör. Hesap açılış bakiyesi tahsilat olarak girilmişti" />
          </Field>
          {cevirHata && <Alert tone="error">{cevirHata}</Alert>}
          <footer>
            <Button type="button" onClick={() => setCevirAcik(false)} disabled={cevriliyor}>Vazgeç</Button>
            <Button type="submit" variant="primary" disabled={cevriliyor || cevirNedeni.trim().length < 3}>{cevriliyor ? "Çevriliyor…" : "Açılışa çevir"}</Button>
          </footer>
        </form>
      )}

      {geriAlAcik && (
        <GeriAlmaFormu<{ yontem: GeriAlmaYontemi }>
          baslik="Fişi geri al"
          uc={`/kasa-banka/hareketler/${hareket.id}/geri-al`}
          aciklama={<>
            {hareket.fatura && "Faturanın kalanı yeniden açılır."}
            {virmanMi(hareket) && " Virmanın iki bacağı birlikte geri alınır."}
          </>}
          onVazgec={() => setGeriAlAcik(false)}
          onTamam={(sonuc) => onGeriAlindi(sonuc.yontem === "silindi"
            ? `Fiş geri alındı ve silindi${virmanMi(hareket) ? " (virmanın iki bacağı birlikte)" : ""}; cari ve fatura bakiyeleri güncellendi.${hareket.makbuzNo ? ` ${hareket.makbuzNo} makbuz numarası yandı, yeniden kullanılmaz.` : ""}`
            : "Fişin dönemi kapalı olduğu için bugün tarihli ters kayıt atıldı; asıl kayıt değişmedi.")}
        />
      )}
    </div>
  );
}
