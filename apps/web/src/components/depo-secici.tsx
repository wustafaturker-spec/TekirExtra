"use client";

import { Field, Select } from "@/components/ui";
import { useDepolar } from "@/lib/depolar";

/**
 * Depo seçim kutusu (STK-07). Firmada tek depo varsa hiç çizilmez — bu
 * durumda sunucu boş depoyu varsayılan depoya çözer, ekranlar sadeleşir.
 */
export function DepoSecici({
  deger,
  onChange,
  label = "Depo",
  tumuEtiketi,
  className,
}: {
  deger: string;
  onChange: (v: string) => void;
  label?: string;
  /** Verilirse "tümü" seçeneği eklenir (filtre kullanımı için) */
  tumuEtiketi?: string;
  className?: string;
}) {
  const { depolar, cokluDepo } = useDepolar();
  if (!cokluDepo) return null;

  return (
    <Field label={label} className={className}>
      <Select value={deger} onChange={(e) => onChange(e.target.value)}>
        {tumuEtiketi ? (
          <option value="">{tumuEtiketi}</option>
        ) : (
          <option value="">Varsayılan depo</option>
        )}
        {depolar.map((d) => (
          <option key={d.id} value={d.id}>
            {d.ad}
            {d.varsayilan ? " (varsayılan)" : ""}
          </option>
        ))}
      </Select>
    </Field>
  );
}
