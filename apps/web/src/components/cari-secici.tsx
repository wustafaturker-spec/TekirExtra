"use client";

import { useEffect, useRef } from "react";
import { AramaSecici } from "@/components/arama-secici";

export interface CariSecenegi {
  id: string;
  unvan: string;
  kod?: string | null;
  vknTckn?: string | null;
}

/**
 * Cari seçim alanı: açılır liste yerine ünvan, cari kodu ya da VKN ile aranır.
 * `required` verilirse cari seçilmeden form gönderilemez (tarayıcı doğrulaması).
 */
export function CariSecici({
  cariler,
  deger,
  onChange,
  ariaLabel = "Cari hesap",
  placeholder = "Ünvan, cari kodu veya VKN ile ara",
  required = false,
  ek,
}: {
  cariler: CariSecenegi[];
  deger: string;
  onChange: (cariId: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  required?: boolean;
  /** Seçeneğin altında görünecek ek bilgi (ör. "e-posta eksik"). */
  ek?: (cari: CariSecenegi) => string | null | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !deger ? "Cari seçin." : "");
  }, [required, deger]);

  return (
    <AramaSecici
      ariaLabel={ariaLabel}
      bosMesaj="Eşleşen cari bulunamadı."
      deger={deger}
      inputRef={inputRef}
      kullanimAnahtari="tekir_son_cariler"
      onChange={onChange}
      placeholder={placeholder}
      secenekler={cariler.map((c) => ({
        deger: c.id,
        baslik: c.unvan,
        aciklama: [c.kod, c.vknTckn, ek?.(c)].filter(Boolean).join(" · ") || undefined,
        aramaMetni: [c.kod, c.vknTckn].filter(Boolean).join(" "),
      }))}
    />
  );
}
