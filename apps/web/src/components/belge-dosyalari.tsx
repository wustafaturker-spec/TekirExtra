"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { api, apiDosyaBlob, apiDosyaIndir } from "@/lib/api";

const MAKS_BOYUT = 10 * 1024 * 1024;

export function BelgeDosyalari({ dosyalar, onChange }: { dosyalar: File[]; onChange: (dosyalar: File[]) => void }) {
  const [onizleme, setOnizleme] = useState<{ dosya: File; url: string } | null>(null);
  useEffect(() => () => { if (onizleme) URL.revokeObjectURL(onizleme.url); }, [onizleme]);
  function secildi(liste: FileList | null) {
    if (!liste) return;
    const yeniler = Array.from(liste).filter((dosya) => dosya.size <= MAKS_BOYUT);
    onChange([...dosyalar, ...yeniler].filter((dosya, index, tumu) =>
      tumu.findIndex((aday) => aday.name === dosya.name && aday.size === dosya.size) === index,
    ));
  }

  return (
    <div className="document-attachments">
      <div className="document-attachments__head">
        <div><h4 className="document-editor__section-title">Belge ekleri</h4><small>Fiş, sözleşme, tarama veya destekleyici dosyaları ekleyebilirsiniz.</small></div>
        <Field label="Dosya seç">
          <Input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.xml,.txt,.csv" onChange={(e) => { secildi(e.target.files); e.currentTarget.value = ""; }} />
        </Field>
      </div>
      {dosyalar.length > 0 && <div className="document-attachments__list">
        {dosyalar.map((dosya, index) => <div className="document-attachment" key={`${dosya.name}-${dosya.size}`}>
          <span aria-hidden="true">📎</span>
          <div><strong>{dosya.name}</strong><small>{(dosya.size / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB</small></div>
          <div className="row-tight"><Button size="sm" type="button" onClick={() => setOnizleme({ dosya, url: URL.createObjectURL(dosya) })}>Görüntüle</Button><Button aria-label={`${dosya.name} dosyasını kaldır`} size="sm" type="button" onClick={() => onChange(dosyalar.filter((_, i) => i !== index))}>Kaldır</Button></div>
        </div>)}
      </div>}
      <small className="muted">Her dosya en fazla 10 MB olabilir. Birden fazla dosya seçebilirsiniz.</small>
      {onizleme && <BelgeOnizleme dosyaAdi={onizleme.dosya.name} mimeTip={onizleme.dosya.type} url={onizleme.url} blob={onizleme.dosya} onKapat={() => setOnizleme(null)} />}
    </div>
  );
}

export interface KayitliEk { id: string; dosyaAdi: string; mimeTip: string; boyut: number; createdAt: string }

export function KayitliEkSatiri({ ek, onSil }: { ek: KayitliEk; onSil: (ek: KayitliEk) => void }) {
  const [onizleme, setOnizleme] = useState<{ url: string; blob: Blob } | null>(null);
  const [hata, setHata] = useState("");
  useEffect(() => () => { if (onizleme) URL.revokeObjectURL(onizleme.url); }, [onizleme]);
  async function goruntule() {
    setHata("");
    try { const blob = await apiDosyaBlob(`/ekler/${ek.id}/indir`); setOnizleme({ blob, url: URL.createObjectURL(blob) }); }
    catch (e) { setHata(e instanceof Error ? e.message : "Dosya görüntülenemedi"); }
  }
  return <><div className="document-attachment"><span aria-hidden="true">📎</span><div><strong>{ek.dosyaAdi}</strong><small>{(ek.boyut / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB · {new Date(ek.createdAt).toLocaleDateString("tr-TR")}{hata ? ` · ${hata}` : ""}</small></div><div className="row-tight"><Button size="sm" onClick={() => void goruntule()}>Görüntüle</Button><Button size="sm" onClick={() => void apiDosyaIndir(`/ekler/${ek.id}/indir`, ek.dosyaAdi)}>İndir</Button><Button variant="danger" size="sm" onClick={() => onSil(ek)}>Sil</Button></div></div>{onizleme && <BelgeOnizleme dosyaAdi={ek.dosyaAdi} mimeTip={ek.mimeTip} url={onizleme.url} blob={onizleme.blob} onKapat={() => setOnizleme(null)} onIndir={() => void apiDosyaIndir(`/ekler/${ek.id}/indir`, ek.dosyaAdi)} />}</>;
}

function BelgeOnizleme({ dosyaAdi, mimeTip, url, blob, onKapat, onIndir }: { dosyaAdi: string; mimeTip: string; url: string; blob: Blob; onKapat: () => void; onIndir?: () => void }) {
  const [metin, setMetin] = useState("");
  const metinMi = mimeTip.startsWith("text/") || mimeTip.includes("xml") || /\.(xml|txt|csv)$/i.test(dosyaAdi);
  const gorselMi = mimeTip.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(dosyaAdi);
  const pdfMi = mimeTip === "application/pdf" || /\.pdf$/i.test(dosyaAdi);
  useEffect(() => { if (metinMi) void blob.text().then((icerik) => setMetin(icerik.slice(0, 500_000))); }, [blob, metinMi]);
  useEffect(() => { const kapat = (e: KeyboardEvent) => { if (e.key === "Escape") onKapat(); }; window.addEventListener("keydown", kapat); return () => window.removeEventListener("keydown", kapat); }, [onKapat]);
  return <div className="document-preview-layer" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onKapat(); }}><section aria-label={`${dosyaAdi} önizlemesi`} aria-modal="true" className="document-preview" role="dialog"><header><div><strong>{dosyaAdi}</strong><small>{mimeTip || "Dosya"} · {(blob.size / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB</small></div><div>{onIndir && <Button size="sm" onClick={onIndir}>İndir</Button>}<Button aria-label="Önizlemeyi kapat" size="sm" onClick={onKapat}>Kapat</Button></div></header><div className="document-preview__body">{gorselMi ? <img alt={dosyaAdi} src={url} /> : pdfMi ? <iframe src={`${url}#view=FitH`} title={dosyaAdi} /> : metinMi ? <pre>{metin || "İçerik yükleniyor…"}</pre> : <div className="document-preview__unsupported"><span aria-hidden="true">DOC</span><strong>Bu dosya türü tarayıcıda önizlenemiyor</strong><p>Word ve Excel belgelerini incelemek için dosyayı indirin.</p>{onIndir && <Button variant="primary" onClick={onIndir}>Dosyayı indir</Button>}</div>}</div></section></div>;
}

export async function belgeDosyalariniYukle(sahipTur: "fatura" | "belge" | "masraf" | "kira_sozlesme" | "personel" | "satin_alma_teklif", sahipId: string, dosyalar: File[]) {
  for (const dosya of dosyalar) {
    const govde = new FormData();
    govde.append("dosya", dosya);
    await api(`/ekler?sahipTur=${sahipTur}&sahipId=${sahipId}`, { method: "POST", body: govde });
  }
}
