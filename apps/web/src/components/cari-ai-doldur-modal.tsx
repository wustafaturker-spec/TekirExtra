"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Modal, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { dataUrlOku, kucukDosya } from "@/lib/gorsel-kucult";

export interface CariAiDoldurVerisi {
  unvan: string;
  kisiTipi: "gercek" | "tuzel";
  ad?: string | null;
  soyad?: string | null;
  vknTckn?: string | null;
  vergiDairesi?: string | null;
  ticaretSicilNo?: string | null;
  eposta?: string | null;
  telefon?: string | null;
  faks?: string | null;
  webSitesi?: string | null;
  adres?: string | null;
  il?: string | null;
  ilce?: string | null;
  postaKodu?: string | null;
  iban?: string | null;
  sektor?: string | null;
  yetkiliKisi?: { adSoyad?: string | null; unvan?: string | null; telefon?: string | null; eposta?: string | null } | null;
}

interface CariTaramaYaniti {
  dogrulama: { gecerli: boolean; veri: CariAiDoldurVerisi; uyarilar: string[]; hatalar: string[] };
  mevcutCari: { id: string; unvan: string; kod: string } | null;
  ocrKayitId: string | null;
}

interface CariAiDoldurModalProps {
  acik: boolean;
  onKapat: () => void;
  /** AI-13: `ocrKayitId` cari kaydedilince tarama kaydına bağlanır. */
  onVeriDoldur: (veri: CariAiDoldurVerisi, ocrKayitId: string | null) => void;
}

/** AI-13: kartvizit görselinden ya da e-posta imzasından cari formunu doldurur. */
export function CariAiDoldurModal({ acik, onKapat, onVeriDoldur }: CariAiDoldurModalProps) {
  const [sekme, setSekme] = useState<"metin" | "gorsel">("metin");
  const [hamMetin, setHamMetin] = useState("");
  const [dosya, setDosya] = useState<File | null>(null);
  const [onizleme, setOnizleme] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [sonuc, setSonuc] = useState<CariTaramaYaniti | null>(null);

  if (!acik) return null;

  async function dosyaSec(f: File | undefined) {
    if (!f) return;
    setHata(""); setSonuc(null);
    const k = await kucukDosya(f);
    if (k.size > 6 * 1024 * 1024) { setHata("Görsel 6 MB'tan büyük; daha düşük çözünürlükte çekin."); return; }
    setDosya(k); setOnizleme(await dataUrlOku(k));
  }

  async function cikar() {
    setIsleniyor(true); setHata(""); setSonuc(null);
    try {
      const govde = sekme === "gorsel" && dosya
        ? { gorselBase64: await dataUrlOku(dosya), mimeType: dosya.type || "image/jpeg", belgeTipi: "cari_bilgisi" }
        : { hamMetin, belgeTipi: "cari_bilgisi" };
      const r = await api<CariTaramaYaniti>("/ai/cari/cikar", { method: "POST", body: JSON.stringify(govde) });
      if (!r.dogrulama.gecerli || r.dogrulama.hatalar.length) { setHata(r.dogrulama.hatalar.join(", ") || "Bilgi çıkarılamadı."); return; }
      setSonuc(r);
    } catch (e) { setHata(e instanceof Error ? e.message : "Yapay zekâ analizi sırasında bir hata oluştu."); } finally { setIsleniyor(false); }
  }

  const v = sonuc?.dogrulama.veri;
  const uyarilar = [...(sonuc?.dogrulama.uyarilar ?? []), ...(sonuc?.mevcutCari ? [`Bu VKN ya da e-postayla kayıtlı cari var: ${sonuc.mevcutCari.unvan} (${sonuc.mevcutCari.kod}).`] : [])];
  const okuyabilir = sekme === "gorsel" ? Boolean(dosya) : Boolean(hamMetin.trim());
  const eylemler = (
    <div className="row-tight" style={{ justifyContent: "flex-end" }}>
      <Button onClick={onKapat}>Vazgeç</Button>
      {!sonuc ? (
        <Button variant="primary" onClick={() => void cikar()} disabled={isleniyor || !okuyabilir}>{isleniyor ? "Çıkarılıyor…" : "Bilgileri çıkar"}</Button>
      ) : (
        <Button variant="primary" onClick={() => { if (v) { onVeriDoldur(v, sonuc.ocrKayitId); onKapat(); } }}>Forma doldur</Button>
      )}
    </div>
  );

  return (
    <Modal baslik="Yapay zekâ ile cari bilgisi" aciklama="E-posta imzasını ya da mesajı yapıştırın veya kartvizit görselini yükleyin; bilgiler kaydetmeden önce kontrol edilir." onKapat={onKapat} altBilgi={eylemler}>
      <div className="ocr-pencere">
        <Tabs ariaLabel="Okuma kaynağı" items={[{ deger: "metin", baslik: "Metin" }, { deger: "gorsel", baslik: "Kartvizit görseli" }]} value={sekme} onChange={(s) => { setSekme(s); setSonuc(null); }} />
        {sekme === "metin" ? (
          <Field label="E-posta imzası ya da iletişim metni" htmlFor="ocr-cari-metni">
            <textarea id="ocr-cari-metni" className="textarea" rows={6} value={hamMetin} onChange={(e) => setHamMetin(e.target.value)} placeholder={"Örn.\nKaya Endüstri Ltd. Şti.\nAhmet Kaya - Genel Müdür\nVKN: 1234567890 Kadıköy VD\nTel: 0216 444 0123"} />
          </Field>
        ) : (
          <Field label="Kartvizit görseli">
            <Input type="file" accept="image/*" onChange={(e) => void dosyaSec(e.target.files?.[0])} />
            <small className="muted">Görsel tarayıcıda küçültülür.</small>
          </Field>
        )}
        {onizleme && sekme === "gorsel" && <img className="ocr-onizleme" src={onizleme} alt="Kartvizit önizlemesi" />}
        {hata && <Alert tone="error">{hata}</Alert>}
        {uyarilar.length > 0 && <Alert tone="warning">{uyarilar.join(" ")}</Alert>}
        {v && (
          <dl className="ocr-ozet">
            <div><dt>Unvan</dt><dd>{v.unvan || "—"}</dd></div>
            <div><dt>Kişi tipi</dt><dd>{v.kisiTipi === "tuzel" ? "Tüzel" : "Gerçek"}</dd></div>
            <div><dt>VKN / TCKN</dt><dd>{v.vknTckn || "—"}</dd></div>
            <div><dt>Vergi dairesi</dt><dd>{v.vergiDairesi || "—"}</dd></div>
            <div><dt>E-posta</dt><dd>{v.eposta || "—"}</dd></div>
            <div><dt>Telefon</dt><dd>{v.telefon || "—"}</dd></div>
            <div><dt>Adres</dt><dd>{[v.adres, v.ilce, v.il].filter(Boolean).join(" ") || "—"}</dd></div>
            <div><dt>Yetkili</dt><dd>{v.yetkiliKisi?.adSoyad ? `${v.yetkiliKisi.adSoyad}${v.yetkiliKisi.unvan ? ` (${v.yetkiliKisi.unvan})` : ""}` : "—"}</dd></div>
          </dl>
        )}
      </div>
    </Modal>
  );
}
