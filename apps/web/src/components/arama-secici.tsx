"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface AramaSecenegi {
  deger: string;
  baslik: string;
  aciklama?: string;
  aramaMetni?: string;
}

function normalize(metin: string): string {
  return metin
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function AramaSecici({
  deger,
  onChange,
  secenekler,
  placeholder = "Arayın ve seçin",
  bosMesaj = "Eşleşen kayıt bulunamadı.",
  ariaLabel,
}: {
  deger: string;
  onChange: (deger: string) => void;
  secenekler: AramaSecenegi[];
  placeholder?: string;
  bosMesaj?: string;
  ariaLabel: string;
}) {
  const listeId = useId();
  const kokRef = useRef<HTMLDivElement>(null);
  const secili = secenekler.find((secenek) => secenek.deger === deger);
  const [acik, setAcik] = useState(false);
  const [arama, setArama] = useState("");
  const [aktifIndex, setAktifIndex] = useState(0);

  const gorunenler = useMemo(() => {
    const sorgu = normalize(arama);
    if (!sorgu) return secenekler.slice(0, 50);
    return secenekler
      .filter((secenek) =>
        normalize(
          [secenek.baslik, secenek.aciklama, secenek.aramaMetni]
            .filter(Boolean)
            .join(" "),
        ).includes(sorgu),
      )
      .slice(0, 50);
  }, [arama, secenekler]);

  useEffect(() => {
    function disTiklama(event: MouseEvent) {
      if (!kokRef.current?.contains(event.target as Node)) setAcik(false);
    }
    document.addEventListener("mousedown", disTiklama);
    return () => document.removeEventListener("mousedown", disTiklama);
  }, []);

  function sec(secenek: AramaSecenegi) {
    onChange(secenek.deger);
    setArama("");
    setAcik(false);
    setAktifIndex(0);
  }

  function tus(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAcik(true);
      setAktifIndex((eski) => Math.min(eski + 1, gorunenler.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAktifIndex((eski) => Math.max(eski - 1, 0));
    } else if (event.key === "Enter" && acik && gorunenler[aktifIndex]) {
      event.preventDefault();
      sec(gorunenler[aktifIndex]);
    } else if (event.key === "Escape") {
      setAcik(false);
    }
  }

  return (
    <div className="combobox" ref={kokRef}>
      <div className={`combobox__control${acik ? " is-open" : ""}`}>
        <span className="combobox__search" aria-hidden="true">⌕</span>
        <input
          aria-autocomplete="list"
          aria-controls={listeId}
          aria-expanded={acik}
          aria-label={ariaLabel}
          className="combobox__input"
          onChange={(event) => {
            setArama(event.target.value);
            setAktifIndex(0);
            setAcik(true);
          }}
          onClick={() => setAcik(true)}
          onFocus={() => setAcik(true)}
          onKeyDown={tus}
          placeholder={secili ? secili.baslik : placeholder}
          role="combobox"
          value={arama}
        />
        {deger && (
          <button
            aria-label="Seçimi temizle"
            className="combobox__clear"
            onClick={() => {
              onChange("");
              setArama("");
            }}
            type="button"
          >
            ×
          </button>
        )}
        <span className="combobox__chevron" aria-hidden="true">⌄</span>
      </div>

      {secili && !acik && secili.aciklama && (
        <span className="combobox__selected-meta">{secili.aciklama}</span>
      )}

      {acik && (
        <div className="combobox__menu" id={listeId} role="listbox">
          {gorunenler.length === 0 ? (
            <div className="combobox__empty">{bosMesaj}</div>
          ) : (
            gorunenler.map((secenek, index) => (
              <button
                aria-selected={secenek.deger === deger}
                className={`combobox__option${index === aktifIndex ? " is-active" : ""}`}
                key={secenek.deger}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setAktifIndex(index)}
                onClick={() => sec(secenek)}
                role="option"
                type="button"
              >
                <span>{secenek.baslik}</span>
                {secenek.aciklama && <small>{secenek.aciklama}</small>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
