"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";

export interface AramaSecenegi {
  deger: string;
  baslik: string;
  aciklama?: string;
  aramaMetni?: string;
}

interface KullanimKaydi {
  deger: string;
  sayac: number;
  sonKullanim: number;
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
  ariaDescribedBy,
  ariaInvalid,
  inputRef,
  onSecim,
  yeniKayit,
  kullanimAnahtari,
}: {
  deger: string;
  onChange: (deger: string) => void;
  secenekler: AramaSecenegi[];
  placeholder?: string;
  bosMesaj?: string;
  ariaLabel: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onSecim?: (deger: string) => void;
  yeniKayit?: { etiket: string; onClick: () => void };
  kullanimAnahtari?: string;
}) {
  const listeId = useId();
  const kokRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuKonumu, setMenuKonumu] = useState<React.CSSProperties | null>(null);
  const secili = secenekler.find((secenek) => secenek.deger === deger);
  const [acik, setAcik] = useState(false);
  const [arama, setArama] = useState("");
  const [aktifIndex, setAktifIndex] = useState(0);
  const [kullanim, setKullanim] = useState<KullanimKaydi[]>([]);

  useEffect(() => {
    if (!kullanimAnahtari) return;
    try {
      const kayitlar = JSON.parse(localStorage.getItem(kullanimAnahtari) ?? "[]") as KullanimKaydi[];
      setKullanim(Array.isArray(kayitlar) ? kayitlar : []);
    } catch {
      setKullanim([]);
    }
  }, [kullanimAnahtari]);

  const gorunenler = useMemo(() => {
    const sorgu = normalize(arama);
    if (!sorgu) {
      const puanlar = new Map(kullanim.map((kayit) => [kayit.deger, kayit]));
      return [...secenekler]
        .sort((a, b) => {
          const aKayit = puanlar.get(a.deger);
          const bKayit = puanlar.get(b.deger);
          if (!aKayit && !bKayit) return 0;
          if (!aKayit) return 1;
          if (!bKayit) return -1;
          return bKayit.sayac - aKayit.sayac || bKayit.sonKullanim - aKayit.sonKullanim;
        })
        .slice(0, 50);
    }
    return secenekler
      .filter((secenek) =>
        normalize(
          [secenek.baslik, secenek.aciklama, secenek.aramaMetni]
            .filter(Boolean)
            .join(" "),
        ).includes(sorgu),
      )
      .slice(0, 50);
  }, [arama, kullanim, secenekler]);

  useEffect(() => {
    function disTiklama(event: MouseEvent) {
      if (!kokRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setAcik(false);
    }
    document.addEventListener("mousedown", disTiklama);
    return () => document.removeEventListener("mousedown", disTiklama);
  }, []);

  useLayoutEffect(() => {
    if (!acik) return;
    function konumlandir() {
      const kontrol = kokRef.current?.querySelector(".combobox__control");
      if (!kontrol) return;
      const rect = kontrol.getBoundingClientRect();
      const bosluk = 4;
      const alttakiAlan = window.innerHeight - rect.bottom - bosluk;
      const usttekiAlan = rect.top - bosluk;
      const yukariAc = alttakiAlan < 180 && usttekiAlan > alttakiAlan;
      setMenuKonumu({
        position: "fixed",
        left: rect.left,
        right: "auto",
        top: yukariAc ? "auto" : rect.bottom + bosluk,
        bottom: yukariAc ? window.innerHeight - rect.top + bosluk : "auto",
        width: rect.width,
        minWidth: "auto",
        maxHeight: Math.min(280, Math.max(80, yukariAc ? usttekiAlan : alttakiAlan)),
        zIndex: 1200,
      });
    }
    konumlandir();
    window.addEventListener("resize", konumlandir);
    window.addEventListener("scroll", konumlandir, true);
    return () => {
      window.removeEventListener("resize", konumlandir);
      window.removeEventListener("scroll", konumlandir, true);
    };
  }, [acik]);

  function sec(secenek: AramaSecenegi) {
    if (kullanimAnahtari) {
      const mevcut = kullanim.find((kayit) => kayit.deger === secenek.deger);
      const yeniKayitlar = [
        { deger: secenek.deger, sayac: (mevcut?.sayac ?? 0) + 1, sonKullanim: Date.now() },
        ...kullanim.filter((kayit) => kayit.deger !== secenek.deger),
      ].slice(0, 25);
      setKullanim(yeniKayitlar);
      localStorage.setItem(kullanimAnahtari, JSON.stringify(yeniKayitlar));
    }
    onChange(secenek.deger);
    onSecim?.(secenek.deger);
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
      <div className={`combobox__control${acik ? " is-open" : ""}${ariaInvalid ? " is-invalid" : ""}`}>
        <span className="combobox__search" aria-hidden="true">⌕</span>
        <input
          aria-autocomplete="list"
          aria-controls={listeId}
          aria-expanded={acik}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || undefined}
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
          ref={inputRef}
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

      {acik && menuKonumu && createPortal(
        <div className="combobox__menu" id={listeId} role="listbox" ref={menuRef} style={menuKonumu}>
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
          {yeniKayit && (
            <button
              className="combobox__create"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setAcik(false);
                yeniKayit.onClick();
              }}
              type="button"
            >
              + {yeniKayit.etiket}
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
