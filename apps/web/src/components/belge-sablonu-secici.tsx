"use client";

/**
 * Belge şablonu seçimi ve önizlemesi (FTR-22/23/24).
 *
 * Şablon ve vurgu rengi basılan tüm belgelere ve alıcının gördüğü e-Fatura
 * görünümüne işlediği için seçim körlemesine yapılmamalı: önizleme, sunucudaki
 * **gerçek PDF üretecinden** gelir — ekranda ayrı bir taklit düzen çizilmez.
 * Kaydetmeden önce denenebilsin diye önizleme henüz kaydedilmemiş seçimi de
 * gösterir.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiDosyaBlob } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";

export type BelgeSablonu = "standart" | "modern" | "klasik";

const SABLONLAR: { deger: BelgeSablonu; ad: string; aciklama: string }[] = [
  { deger: "standart", ad: "Standart", aciklama: "Renkli üst şerit, koyu tablo başlığı — bugünkü düzen" },
  { deger: "modern", ad: "Modern", aciklama: "Geniş logo alanı, renkli tablo başlığı, ferah satırlar" },
  { deger: "klasik", ad: "Klasik", aciklama: "Çerçeveli, sık ve serif — yazıcı dostu" },
];

/** Hazır renkler; kullanıcı yine de kendi rengini girebilir. */
const PALET = ["#6d28d9", "#0f766e", "#b91c1c", "#1d4ed8", "#c2410c", "#111827"];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function BelgeSablonuSecici({ sablon, renk, onDegis }: {
  sablon: BelgeSablonu;
  renk: string;
  onDegis: (alan: "faturaSablonu" | "vurguRengi", deger: string) => void;
}) {
  const [onizleme, setOnizleme] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const adresRef = useRef<string | null>(null);

  const gecerliRenk = HEX.test(renk) ? renk : "#6d28d9";

  const onizlemeYukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const blob = await apiDosyaBlob(`/fatura/sablon-onizleme?sablon=${sablon}&renk=${encodeURIComponent(gecerliRenk)}`);
      if (adresRef.current) URL.revokeObjectURL(adresRef.current);
      adresRef.current = URL.createObjectURL(blob);
      setOnizleme(adresRef.current);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Önizleme üretilemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [sablon, gecerliRenk]);

  // Seçim değişince önizleme kendiliğinden tazelenir; hızlı tıklamada
  // sunucuyu her tuşta yormasın diye kısa bir bekleme vardır.
  useEffect(() => {
    const zamanlayici = setTimeout(() => void onizlemeYukle(), 400);
    return () => clearTimeout(zamanlayici);
  }, [onizlemeYukle]);

  useEffect(() => () => { if (adresRef.current) URL.revokeObjectURL(adresRef.current); }, []);

  return (
    <div className="stack" style={{ gridColumn: "1 / -1" }}>
      <div>
        <strong style={{ fontSize: "0.9rem" }}>Belge şablonu</strong>
        <p className="subtle" style={{ fontSize: "0.75rem", margin: "0.15rem 0 0" }}>
          Fatura, teklif, sipariş, irsaliye ve makbuz çıktılarının yerleşimi.
        </p>
      </div>
      <div className="sablon-secim">
        {SABLONLAR.map((s) => (
          <button
            aria-pressed={sablon === s.deger}
            className={`sablon-kart${sablon === s.deger ? " is-secili" : ""}`}
            key={s.deger}
            onClick={() => onDegis("faturaSablonu", s.deger)}
            type="button"
          >
            <span className={`sablon-kart__gorsel sablon-kart__gorsel--${s.deger}`} style={{ ["--vurgu" as string]: gecerliRenk }} aria-hidden="true">
              <i /><b /><b /><b />
            </span>
            <strong>{s.ad}</strong>
            <small>{s.aciklama}</small>
          </button>
        ))}
      </div>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <Field label="Vurgu rengi">
          <input
            aria-label="Vurgu rengi"
            className="input"
            onChange={(e) => onDegis("vurguRengi", e.target.value)}
            style={{ height: 40, padding: 3 }}
            type="color"
            value={gecerliRenk}
          />
        </Field>
        <Field label="Renk kodu">
          <Input
            aria-label="Renk kodu"
            maxLength={7}
            onChange={(e) => onDegis("vurguRengi", e.target.value)}
            placeholder="#6d28d9"
            value={renk}
          />
        </Field>
        <div className="sablon-palet" role="group" aria-label="Hazır renkler">
          {PALET.map((p) => (
            <button
              aria-label={`Renk ${p}`}
              aria-pressed={gecerliRenk === p}
              className={`sablon-palet__renk${gecerliRenk === p ? " is-secili" : ""}`}
              key={p}
              onClick={() => onDegis("vurguRengi", p)}
              style={{ background: p }}
              type="button"
            />
          ))}
        </div>
        <Button size="sm" type="button" disabled={yukleniyor} onClick={() => void onizlemeYukle()}>
          {yukleniyor ? "Hazırlanıyor…" : "↻ Önizlemeyi yenile"}
        </Button>
      </div>

      {!HEX.test(renk) && <Alert tone="warning">Renk kodu #rrggbb biçiminde olmalı; önizlemede varsayılan renk gösteriliyor.</Alert>}
      {hata && <Alert tone="error">{hata}</Alert>}

      <div className="sablon-onizleme">
        {onizleme ? (
          // PDF'i gömülü gösteremeyen tarayıcıda çerçeve boş kalır; altındaki
          // bağlantı o durumda da önizlemeyi açar.
          <iframe src={`${onizleme}#toolbar=0&view=FitH`} title="Şablon önizlemesi" />
        ) : (
          <p className="muted">Önizleme hazırlanıyor…</p>
        )}
      </div>
      {onizleme && (
        <a className="btn btn--ghost btn--sm" href={onizleme} rel="noreferrer" target="_blank" style={{ justifySelf: "start" }}>
          ↗ Önizlemeyi yeni sekmede aç
        </a>
      )}
      <p className="subtle" style={{ fontSize: "0.75rem", margin: 0 }}>
        Şablon ve renk basılan tüm belgelere işler; kestiğiniz e-Faturanın alıcısı da belgeyi bu tasarımla görür.
        Logo, Ayarlar &gt; Firma ekranından yüklenir. Değişiklik yalnız bundan sonra basılan ve kesilen belgeleri etkiler.
      </p>
    </div>
  );
}
