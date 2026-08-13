"use client";

import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

const MAKS_BOYUT = 10 * 1024 * 1024;

export function BelgeDosyalari({ dosyalar, onChange }: { dosyalar: File[]; onChange: (dosyalar: File[]) => void }) {
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
          <Button aria-label={`${dosya.name} dosyasını kaldır`} size="sm" type="button" onClick={() => onChange(dosyalar.filter((_, i) => i !== index))}>Kaldır</Button>
        </div>)}
      </div>}
      <small className="muted">Her dosya en fazla 10 MB olabilir. Birden fazla dosya seçebilirsiniz.</small>
    </div>
  );
}

export async function belgeDosyalariniYukle(sahipTur: "fatura" | "belge" | "masraf", sahipId: string, dosyalar: File[]) {
  for (const dosya of dosyalar) {
    const govde = new FormData();
    govde.append("dosya", dosya);
    await api(`/ekler?sahipTur=${sahipTur}&sahipId=${sahipId}`, { method: "POST", body: govde });
  }
}
