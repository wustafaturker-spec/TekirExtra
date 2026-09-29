"use client";

/**
 * FTR-32: müşteri tarafında ilgili kişi. Carinin kişilerinden seçilir ya da
 * elle yazılır; seçilen kişinin adı ve görevi alanlara kopyalanır, belge
 * karta bağlanmaz. Teklif/sipariş/irsaliye formu ile fatura formu kullanır.
 */
import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";

export interface IlgiliKisiDegeri {
  ilgiliKisi: string;
  ilgiliKisiGorevi: string;
}

export const BOS_ILGILI_KISI: IlgiliKisiDegeri = { ilgiliKisi: "", ilgiliKisiGorevi: "" };

interface CariKisi { id: string; adSoyad: string; gorev: string | null }

/** Sunucuya giden gövde: adsız görev gönderilmez. */
export function ilgiliKisiGovdesi(d: IlgiliKisiDegeri) {
  const ad = d.ilgiliKisi.trim();
  return { ilgiliKisi: ad || null, ilgiliKisiGorevi: ad ? d.ilgiliKisiGorevi.trim() || null : null };
}

export function IlgiliKisiAlanlari({ deger, onChange, cariId, disabled }: {
  deger: IlgiliKisiDegeri;
  onChange: (deger: IlgiliKisiDegeri) => void;
  cariId?: string | null;
  disabled?: boolean;
}) {
  const [kisiler, setKisiler] = useState<CariKisi[]>([]);
  useEffect(() => {
    if (!cariId) { setKisiler([]); return; }
    let aktif = true;
    // Kişiler gelmezse alanlar elle doldurulabilir; hata sessizce yutulur.
    void api<{ kisiler?: CariKisi[] }>(`/cari/${cariId}`)
      .then((c) => { if (aktif) setKisiler(c.kisiler ?? []); })
      .catch(() => { if (aktif) setKisiler([]); });
    return () => { aktif = false; };
  }, [cariId]);

  return (
    <>
      <Field label="İlgili Kişi">
        {kisiler.length > 0 && (
          <Select aria-label="Carinin kişilerinden seç" value="" disabled={disabled} onChange={(e) => {
            const k = kisiler.find((x) => x.id === e.target.value);
            if (k) onChange({ ilgiliKisi: k.adSoyad, ilgiliKisiGorevi: k.gorev ?? "" });
          }}>
            <option value="">Carinin kişilerinden seçin…</option>
            {kisiler.map((k) => <option key={k.id} value={k.id}>{k.adSoyad}{k.gorev ? ` — ${k.gorev}` : ""}</option>)}
          </Select>
        )}
        <Input aria-label="İlgili kişi adı soyadı" value={deger.ilgiliKisi} maxLength={120} placeholder="Ad Soyad (opsiyonel)" disabled={disabled} onChange={(e) => onChange({ ...deger, ilgiliKisi: e.target.value })} />
      </Field>
      <Field label="İlgili Kişinin Görevi">
        <Input aria-label="İlgili kişinin görevi" value={deger.ilgiliKisiGorevi} maxLength={120} placeholder="Örn. Satınalma Müdürü" disabled={disabled || !deger.ilgiliKisi.trim()} onChange={(e) => onChange({ ...deger, ilgiliKisiGorevi: e.target.value })} />
      </Field>
    </>
  );
}
