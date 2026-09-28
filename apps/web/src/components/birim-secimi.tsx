"use client";

import { BIRIMLER, birimKisaAdi } from "@tekirextra/shared";
import { Select } from "@/components/ui";

/**
 * Stok kartının birimi hazır listeden seçilir (STK-01). Listede olmayan eski
 * bir değer varsa kaybolmasın diye seçenek olarak korunur.
 */
export function BirimSecimi({ value, onChange, disabled, haric = [], ...rest }: {
  value: string;
  onChange: (birim: string) => void;
  disabled?: boolean;
  /** Seçilemeyecek birimler (ör. ek birim eklerken ana birim). */
  haric?: string[];
  "aria-label"?: string;
  required?: boolean;
}) {
  const secenekler = BIRIMLER.filter((b) => !haric.includes(b.ad));
  const listeDisi = value && !BIRIMLER.some((b) => b.ad === value);
  return (
    <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...rest}>
      {!value && <option value="">Birim seçin</option>}
      {listeDisi && <option value={value}>{value}</option>}
      {secenekler.map((b) => <option key={b.ad} value={b.ad}>{b.etiket}</option>)}
    </Select>
  );
}

/** Satırın seçebileceği birimleri taşıyan kart özeti (STK-10). */
export interface BirimliStok {
  anaBirim?: string;
  birimler?: { ad: string; katsayi: string }[];
}

/** Birimin ana birim karşılığı; tanımsız birim 1 sayılır (sunucu reddeder). */
export function birimKatsayisi(stok: BirimliStok | undefined, birim: string | undefined): number {
  if (!stok || !birim || birim === stok.anaBirim) return 1;
  return Number(stok.birimler?.find((b) => b.ad === birim)?.katsayi ?? 1) || 1;
}

/**
 * Belge satırının birimi: kartta ek birim varsa seçilir, yoksa ana birim
 * yazı olarak görünür. Birim değişince fiyat katsayıyla ölçeklenir (çağıran).
 */
export function SatirBirimi({ stok, value, onChange, disabled }: {
  stok: BirimliStok | undefined;
  value: string | undefined;
  onChange: (birim: string) => void;
  disabled?: boolean;
}) {
  if (!stok) return null;
  const ana = stok.anaBirim ?? "adet";
  const ekler = stok.birimler ?? [];
  const secili = value || ana;
  if (ekler.length === 0) return <span className="document-line-unit">{birimKisaAdi(secili)}</span>;
  return (
    <Select className="document-line-unit" aria-label="Birim" value={secili} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value={ana}>{birimKisaAdi(ana)}</option>
      {ekler.map((b) => <option key={b.ad} value={b.ad}>{birimKisaAdi(b.ad)} = {Number(b.katsayi).toLocaleString("tr-TR")} {birimKisaAdi(ana)}</option>)}
    </Select>
  );
}
