"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Modal, Select, Tabs } from "@/components/ui";
import { belgeDosyalariniYukle } from "@/components/belge-dosyalari";
import { api } from "@/lib/api";
import { kirilimToplami, oranKirilimi, type KirilimSatiri } from "@/lib/fis-kirilim";
import { dataUrlOku, kucukDosya } from "@/lib/gorsel-kucult";

export interface FisAiDoldurVerisi {
  belgeTuru: "FIS" | "FATURA" | "E_ARSIV" | "E_FATURA" | "BILINMIYOR";
  belgeNo?: string | null;
  tarih?: string | null;
  saticiUnvan: string;
  saticiVknTckn?: string | null;
  saticiVergiDairesi?: string | null;
  paraBirimi: string;
  toplamKdv: number;
  toplamMatrah: number;
  genelToplam: number;
  kdvKirilimi: KirilimSatiri[];
  kalemler: { aciklama: string; miktar: number; birim: string; birimFiyat: number; toplamTutar: number; kdvOrani?: number | null }[];
  guvenSkoru: number;
}

interface TaramaYaniti {
  dogrulama: { gecerli: boolean; veri: FisAiDoldurVerisi; uyarilar: string[]; hatalar: string[] };
  eslesenCari: { id: string; unvan: string; kod: string } | null;
  onerilenMasrafKategorisi: string | null;
  ocrKayitId: string | null;
}

interface FisAiDoldurModalProps {
  acik: boolean;
  onKapat: () => void;
  kategoriler?: Array<{ id: string; ad: string; varsayilanKdvOrani?: string | null; ustId?: string | null }>;
  kasalar?: Array<{ id: string; ad: string; dovizCinsi: string }>;
  krediKartlari?: Array<{ id: string; ad: string; sonDortHane: string; dovizCinsi: string; aktif: boolean }>;
  /** Tek oranlı fiş: form doldurulur; kayıttan sonra `ocrKayitId` ile tarama kaydına bağlanır. */
  onVeriDoldur: (veri: { ocr: FisAiDoldurVerisi; dosya?: File; kategoriId?: string | null; odemeHesabi?: string | null; ocrKayitId?: string | null }) => void;
  /** AI-13: çok oranlı fişte oran başına taslaklar pencerede açıldı. */
  onTaslaklarAcildi?: (adet: number) => void;
}

const para = (n: number, d: string) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${d === "TRY" ? "TL" : d}`;
const bugun = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Kategori adından ya da satıcıdan basit eşleşme; yoksa ilk kategori. */
function kategoriSec(kategoriler: NonNullable<FisAiDoldurModalProps["kategoriler"]>, oneri: string | null, satici: string): string {
  const o = (oneri ?? "").toLocaleLowerCase("tr-TR"), s = satici.toLocaleLowerCase("tr-TR");
  const bulunan = kategoriler.find((k) => {
    const a = k.ad.toLocaleLowerCase("tr-TR");
    return (o && (a.includes(o) || o.includes(a)))
      || (o.includes("akaryakıt") && /akaryakıt|taşıt|araç/.test(a))
      || (o.includes("yemek") && /yemek|temsil|ağırlama/.test(a))
      || (o.includes("ulaşım") && /ulaşım|seyahat|yol/.test(a))
      || (o.includes("ofis") && /kırtasiye|ofis|büro/.test(a))
      || (s.includes("petrol") && a.includes("akaryakıt"))
      || (s.includes("taksi") && a.includes("ulaşım"));
  });
  return bulunan?.id ?? kategoriler[0]?.id ?? "";
}

/** AI-13: fişi okur; tek oranlıda formu doldurur, çok oranlıda oran başına ayrı masraf taslağı açar. */
export function FisAiDoldurModal({ acik, onKapat, kategoriler, kasalar, krediKartlari, onVeriDoldur, onTaslaklarAcildi }: FisAiDoldurModalProps) {
  const [dosya, setDosya] = useState<File | null>(null);
  const [onizleme, setOnizleme] = useState("");
  const [hamMetin, setHamMetin] = useState("");
  const [sekme, setSekme] = useState<"gorsel" | "metin">("gorsel");
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [sonuc, setSonuc] = useState<TaramaYaniti | null>(null);
  const [kategoriId, setKategoriId] = useState("");
  const [odemeHesabi, setOdemeHesabi] = useState("");

  if (!acik) return null;

  async function dosyaSec(f: File | undefined) {
    if (!f) return;
    setHata(""); setSonuc(null);
    const k = await kucukDosya(f);
    if (k.size > 6 * 1024 * 1024) { setHata("Dosya 6 MB'tan büyük; daha düşük çözünürlükte çekin ya da PDF'i küçültün."); return; }
    setDosya(k);
    setOnizleme(k.type.startsWith("image/") ? await dataUrlOku(k) : "");
  }

  async function tara() {
    setIsleniyor(true); setHata(""); setSonuc(null);
    try {
      const govde = sekme === "gorsel" && dosya
        ? { gorselBase64: await dataUrlOku(dosya), mimeType: dosya.type || "image/jpeg", belgeTipi: "fis_fatura" }
        : { hamMetin, belgeTipi: "fis_fatura" };
      const r = await api<TaramaYaniti>("/ai/ocr/tara", { method: "POST", body: JSON.stringify(govde) });
      if (!r.dogrulama.gecerli || r.dogrulama.hatalar.length) { setHata(r.dogrulama.hatalar.join(", ") || "Belge okunamadı."); return; }
      setSonuc(r);
      if (kategoriler?.length) setKategoriId(kategoriSec(kategoriler, r.onerilenMasrafKategorisi, r.dogrulama.veri.saticiUnvan ?? ""));
    } catch (e) { setHata(e instanceof Error ? e.message : "Fiş taranırken bir hata oluştu."); } finally { setIsleniyor(false); }
  }

  const ocr = sonuc?.dogrulama.veri;
  const oranlar = oranKirilimi(ocr?.kdvKirilimi);
  const cokOranli = oranlar.length > 1;
  const doviz = ocr?.paraBirimi || "TRY";

  function formaAktar() {
    if (!sonuc || !ocr) return;
    onVeriDoldur({ ocr, dosya: dosya ?? undefined, kategoriId: kategoriId || null, odemeHesabi: odemeHesabi || null, ocrKayitId: sonuc.ocrKayitId });
    onKapat();
  }

  async function taslaklariAc() {
    if (!sonuc || !ocr || !kategoriId) return;
    setIsleniyor(true); setHata("");
    try {
      const tarih = ocr.tarih || bugun();
      let kur = 1;
      if (doviz !== "TRY") {
        const k = await api<{ kurlar: Record<string, number> }>(`/doviz-kurlari?tarih=${tarih}&tip=satis`);
        if (!k.kurlar[doviz]) throw new Error(`${doviz} için ${tarih} kuru alınamadı; masrafı elle girin.`);
        kur = k.kurlar[doviz];
      }
      const ortak = {
        kategoriId, belgeTuru: ocr.belgeTuru === "FIS" ? "fis" : "fatura", belgeNo: ocr.belgeNo || null, tarih,
        cariId: sonuc.eslesenCari?.id ?? null, saticiUnvan: sonuc.eslesenCari ? null : ocr.saticiUnvan || "Perakende",
        vknTckn: ocr.saticiVknTckn || null, aciklama: ocr.kalemler.map((k) => k.aciklama).join(", ").slice(0, 200) || null, dovizCinsi: doviz, kur,
      };
      const olusan = await api<Array<{ id: string }>>("/masraflar/oranlara-gore", {
        method: "POST",
        body: JSON.stringify({ ortak, oranlar: oranlar.map((o) => ({ kdvOrani: o.oran, matrah: o.matrah, kdvTutari: o.kdvTutari })), ...(sonuc.ocrKayitId ? { ocrKayitId: sonuc.ocrKayitId } : {}) }),
      });
      // Görsel her taslağa eklenir; eklenemezse taslaklar yine geçerlidir.
      if (dosya) await Promise.all(olusan.map((m) => belgeDosyalariniYukle("masraf", m.id, [dosya]).catch(() => undefined)));
      onTaslaklarAcildi?.(olusan.length);
      onKapat();
    } catch (e) { setHata(e instanceof Error ? e.message : "Taslaklar açılamadı"); } finally { setIsleniyor(false); }
  }

  const okuyabilir = sekme === "gorsel" ? Boolean(dosya) : Boolean(hamMetin.trim());
  const eylemler = (
    <div className="row-tight" style={{ justifyContent: "flex-end" }}>
      <Button onClick={onKapat}>Vazgeç</Button>
      {!sonuc ? (
        <Button variant="primary" onClick={() => void tara()} disabled={isleniyor || !okuyabilir}>{isleniyor ? "Okunuyor…" : "Fişi oku"}</Button>
      ) : cokOranli ? (
        <Button variant="primary" onClick={() => void taslaklariAc()} disabled={isleniyor || !kategoriId}>{isleniyor ? "Açılıyor…" : `${oranlar.length} taslak aç`}</Button>
      ) : (
        <Button variant="primary" onClick={formaAktar}>Forma doldur</Button>
      )}
    </div>
  );

  return (
    <Modal baslik="Yapay zekâ ile fiş oku" aciklama="Fişin fotoğrafını ya da metnini verin; satıcı, tutar ve KDV çıkarılır, kaydetmeden önce kontrol edersiniz." onKapat={onKapat} altBilgi={eylemler}>
      <div className="ocr-pencere">
        <Tabs ariaLabel="Okuma kaynağı" items={[{ deger: "gorsel", baslik: "Fotoğraf / PDF" }, { deger: "metin", baslik: "Metin" }]} value={sekme} onChange={(s) => { setSekme(s); setSonuc(null); }} />
        {sekme === "gorsel" ? (
          <Field label="Fiş ya da belge">
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => void dosyaSec(e.target.files?.[0])} />
            <small className="muted">Fotoğraf tarayıcıda küçültülür; PDF olduğu gibi gönderilir.</small>
          </Field>
        ) : (
          <Field label="Fiş metni" htmlFor="ocr-fis-metni">
            <textarea id="ocr-fis-metni" className="textarea" rows={5} value={hamMetin} onChange={(e) => setHamMetin(e.target.value)} placeholder={"Örn.\nOPET PETROLCÜLÜK A.Ş.\nTarih: 12/10/2026 Fiş No: 0041\nKDV %20: 100,00\nTOPLAM: 600,00"} />
          </Field>
        )}
        {onizleme && sekme === "gorsel" && <img className="ocr-onizleme" src={onizleme} alt="Fiş önizlemesi" />}
        {dosya && !onizleme && sekme === "gorsel" && <small className="muted">{dosya.name} seçildi.</small>}

        {hata && <Alert tone="error">{hata}</Alert>}
        {sonuc && sonuc.dogrulama.uyarilar.length > 0 && <Alert tone="warning">{sonuc.dogrulama.uyarilar.join(" ")}</Alert>}

        {sonuc && ocr && (
          <>
            <dl className="ocr-ozet">
              <div><dt>Satıcı</dt><dd>{sonuc.eslesenCari ? `${sonuc.eslesenCari.unvan} (cari)` : ocr.saticiUnvan || "—"}</dd></div>
              <div><dt>Tarih</dt><dd>{ocr.tarih ? ocr.tarih.split("-").reverse().join(".") : "—"}</dd></div>
              <div><dt>Belge no</dt><dd>{ocr.belgeNo || "—"}</dd></div>
              <div><dt>VKN / TCKN</dt><dd>{ocr.saticiVknTckn || "—"}</dd></div>
              <div><dt>Toplam</dt><dd><strong>{para(ocr.genelToplam, doviz)}</strong></dd></div>
              <div><dt>Güven</dt><dd>%{Math.round(ocr.guvenSkoru * 100)}</dd></div>
            </dl>

            {oranlar.length > 0 && (
              <div className="table-wrap">
                <table className="table ocr-kirilim">
                  <caption>KDV kırılımı{cokOranli ? " — her oran ayrı masraf taslağı olur" : ""}</caption>
                  <thead><tr><th>Oran</th><th className="num">Matrah</th><th className="num">KDV</th><th className="num">Toplam</th></tr></thead>
                  <tbody>{oranlar.map((o) => <tr key={o.oran}><td>%{o.oran}</td><td className="num">{para(o.matrah, doviz)}</td><td className="num">{para(o.kdvTutari, doviz)}</td><td className="num">{para(o.matrah + o.kdvTutari, doviz)}</td></tr>)}</tbody>
                  {cokOranli && <tfoot><tr><th colSpan={3}>Kırılım toplamı</th><td className="num">{para(kirilimToplami(oranlar), doviz)}</td></tr></tfoot>}
                </table>
              </div>
            )}

            <div className="ocr-secimler">
              {kategoriler && kategoriler.length > 0 && (
                <Field label="Masraf kategorisi">
                  <Select value={kategoriId} onChange={(e) => setKategoriId(e.target.value)}>{kategoriler.map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}</Select>
                </Field>
              )}
              {!cokOranli && (
                <Field label="Ödeme">
                  <Select value={odemeHesabi} onChange={(e) => setOdemeHesabi(e.target.value)}>
                    <option value="">Sonra ödenecek</option>
                    {kasalar?.filter((k) => k.dovizCinsi === doviz).length ? <optgroup label="Kasalar">{kasalar.filter((k) => k.dovizCinsi === doviz).map((k) => <option key={k.id} value={`kasa:${k.id}`}>{k.ad} ({k.dovizCinsi})</option>)}</optgroup> : null}
                    {krediKartlari?.filter((c) => c.aktif && c.dovizCinsi === doviz).length ? <optgroup label="Şirket kartları">{krediKartlari.filter((c) => c.aktif && c.dovizCinsi === doviz).map((k) => <option key={k.id} value={`kart:${k.id}`}>{k.ad} · •••• {k.sonDortHane}</option>)}</optgroup> : null}
                  </Select>
                  <small className="muted">Seçilirse kayıtta onaylanıp ödenir.</small>
                </Field>
              )}
            </div>
            {cokOranli && <small className="muted">Taslaklar aynı belge no, satıcı ve tarihle açılır; görsel her birine eklenir. Onay ve ödeme listeden yapılır.</small>}
          </>
        )}
      </div>
    </Modal>
  );
}
