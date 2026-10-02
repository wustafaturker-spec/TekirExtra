"use client";

/**
 * Kasa/banka fişinin ayrıntısı ve eylemleri (KSB-08).
 *
 * Defter satırına tıklanınca açılır. Elle girilmiş tahsilat/tediye ve virman
 * buradan düzeltilir ya da geri alınır; başka modülün ürettiği fiş (masraf,
 * POS, çek, kredi kartı…) yalnız görüntülenir ve kaynağı söylenir. Geri alma
 * gerekçe ister: açık dönemde fiş silinir, kapalı dönemde bugün tarihli ters
 * kayıt atılır.
 */
import { useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Badge, Button, EylemCubugu, Field, Para, Tarih } from "@/components/ui";

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
  fatura_kapama: "Fatura kapama fişi",
  ters_kayit: "Ters kayıt",
  masraf: "Masraflar",
  pos_tahsilat: "POS tahsilatı",
  pos_mutabakat: "POS mutabakatı (Banka Ekstresi)",
  cek_senet: "Çek & Senetler",
  kredi_karti_ekstre: "Kredi Kartları",
  faturasiz_gelir: "Faaliyet Dışı Gelirler",
  pazaryeri_kesinti: "Pazaryeri Kesintileri",
  personel_maas: "Personel & İK (maaş)",
  personel_maas_iptal: "Personel & İK (maaş iptali)",
  personel_avans: "Personel & İK (avans)",
};

const virmanMi = (h: DefterHareketi) => h.tip === "virman_gelis" || h.tip === "virman_gidis";
const hesapAdi = (h: DefterHareketi) => h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "—";

export function FisAyrintisi({
  hareket,
  hareketler,
  onDuzelt,
  onGeriAlindi,
}: {
  hareket: DefterHareketi;
  hareketler: DefterHareketi[];
  onDuzelt: (h: DefterHareketi) => void;
  onGeriAlindi: (mesaj: string) => void;
}) {
  const [geriAlAcik, setGeriAlAcik] = useState(false);
  const [neden, setNeden] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState("");

  const karsi = hareket.karsiHareketId ? hareketler.find((h) => h.id === hareket.karsiHareketId) ?? null : null;
  const ters = hareketler.find((h) => h.kaynakTur === "ters_kayit" && (h.kaynakRef === hareket.id || (karsi && h.kaynakRef === karsi.id)));
  const asil = hareket.kaynakTur === "ters_kayit" ? hareketler.find((h) => h.id === hareket.kaynakRef) ?? null : null;
  const elleGirilen = hareket.kaynakTur === "manuel" || hareket.kaynakTur === "fatura_kapama";
  const degistirilebilir = elleGirilen && !ters;
  const makbuzlu = hareket.tip === "tahsilat" || hareket.tip === "tediye";

  async function geriAl(e: React.FormEvent) {
    e.preventDefault();
    setIsleniyor(true);
    setHata("");
    try {
      const sonuc = await api<{ yontem: "silindi" | "ters_kayit" }>(`/kasa-banka/hareketler/${hareket.id}/geri-al`, {
        method: "POST",
        body: JSON.stringify({ neden }),
      });
      onGeriAlindi(sonuc.yontem === "silindi"
        ? `Fiş geri alındı ve silindi${virmanMi(hareket) ? " (virmanın iki bacağı birlikte)" : ""}; cari ve fatura bakiyeleri güncellendi.`
        : "Fişin dönemi kapalı olduğu için bugün tarihli ters kayıt atıldı; asıl kayıt değişmedi.");
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Fiş geri alınamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  return (
    <div className="slip-detail">
      <EylemCubugu etiket="Fiş eylemleri">
        {makbuzlu && (
          <Button size="sm" onClick={() => void apiDosyaIndir(`/kasa-banka/hareketler/${hareket.id}/makbuz`, `${hareket.tip}-makbuzu.pdf`)}>
            Makbuz PDF
          </Button>
        )}
        {degistirilebilir && (
          <>
            <Button size="sm" onClick={() => onDuzelt(hareket)} disabled={isleniyor}>Düzelt</Button>
            <Button size="sm" variant="danger" onClick={() => setGeriAlAcik(true)} disabled={geriAlAcik || isleniyor}>Geri al</Button>
          </>
        )}
      </EylemCubugu>

      <div className="slip-detail__hero">
        <div>
          <Badge variant={hareket.tip === "tahsilat" || hareket.tip === "virman_gelis" ? "success" : "danger"}>{TIP_ADI[hareket.tip] ?? hareket.tip}</Badge>
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
      {!elleGirilen && hareket.kaynakTur !== "ters_kayit" && (
        <p className="slip-detail__note">
          Bu kayıt <strong>{KAYNAK_ADI[hareket.kaynakTur] ?? "başka bir modül"}</strong> tarafından oluşturuldu. Düzeltme ve geri alma o ekrandan yapılır.
        </p>
      )}

      {geriAlAcik && (
        <form className="slip-detail__undo" onSubmit={geriAl}>
          <h3>Fişi geri al</h3>
          <p>
            Açık dönemdeki fiş, cari hareketiyle birlikte silinir ve görüntüsü denetim izine yazılır. Dönemi kapanmışsa kayıt
            değişmez; bugün tarihli ters kayıt atılır.
            {hareket.fatura && " Faturanın kalanı yeniden açılır."}
            {virmanMi(hareket) && " Virmanın iki bacağı birlikte geri alınır."}
          </p>
          <Field label="Gerekçe">
            <textarea
              autoFocus
              className="input"
              required
              minLength={3}
              maxLength={300}
              rows={2}
              value={neden}
              onChange={(e) => setNeden(e.target.value)}
              placeholder="Ör. Mükerrer giriş, yanlış cari seçildi"
            />
          </Field>
          {hata && <Alert tone="error">{hata}</Alert>}
          <footer>
            <Button type="button" onClick={() => { setGeriAlAcik(false); setHata(""); }} disabled={isleniyor}>Vazgeç</Button>
            <Button type="submit" variant="danger" disabled={isleniyor || neden.trim().length < 3}>
              {isleniyor ? "Geri alınıyor…" : "Fişi geri al"}
            </Button>
          </footer>
        </form>
      )}
    </div>
  );
}
