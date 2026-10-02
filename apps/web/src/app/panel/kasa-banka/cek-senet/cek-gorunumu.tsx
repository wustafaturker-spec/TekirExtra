"use client";

/**
 * Çek/senet ön ve arka yüz görüntüsü (KSB-11). Küçük resme tıklanınca büyük
 * görünüm açılır: yakınlaştırma, döndürme ve sürükleyerek gezinme. Telefonda
 * "Yükle" doğrudan kamerayı açar. PDF yüklenmişse yeni sekmede açılır.
 */
import { useEffect, useRef, useState } from "react";
import { api, apiDosyaBlob } from "@/lib/api";
import { Button } from "@/components/ui";

type Yuz = "on" | "arka";
const YUZ_ADI: Record<Yuz, string> = { on: "Ön yüz", arka: "Arka yüz" };

/** Ekin içeriğini nesne adresi olarak yükler; bileşen kalkınca adresi bırakır. */
export function useEkAdresi(ekId: string | null | undefined) {
  const [adres, setAdres] = useState<{ url: string; tip: string } | null>(null);
  useEffect(() => {
    if (!ekId) { setAdres(null); return; }
    let iptal = false;
    let url = "";
    void apiDosyaBlob(`/ekler/${ekId}/indir`).then((blob) => {
      if (iptal) return;
      url = URL.createObjectURL(blob);
      setAdres({ url, tip: blob.type });
    }).catch(() => setAdres(null));
    return () => { iptal = true; if (url) URL.revokeObjectURL(url); };
  }, [ekId]);
  return adres;
}

export function CekGorunumu({ cekId, onYuzEkId, arkaYuzEkId, duzenlenebilir = true, onDegisti }: {
  cekId: string;
  onYuzEkId: string | null;
  arkaYuzEkId: string | null;
  duzenlenebilir?: boolean;
  onDegisti?: () => void;
}) {
  const [buyuk, setBuyuk] = useState<Yuz | null>(null);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState<Yuz | null>(null);
  const on = useEkAdresi(onYuzEkId);
  const arka = useEkAdresi(arkaYuzEkId);
  const adresler = { on, arka };

  async function yukle(yuz: Yuz, dosya: File) {
    setHata("");
    setYukleniyor(yuz);
    try {
      const fd = new FormData();
      fd.append("dosya", dosya);
      await api(`/kasa-banka/cek-senet/${cekId}/gorunum/${yuz}`, { method: "POST", body: fd });
      onDegisti?.();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Görüntü yüklenemedi");
    } finally {
      setYukleniyor(null);
    }
  }

  async function sil(yuz: Yuz) {
    setHata("");
    try {
      await api(`/kasa-banka/cek-senet/${cekId}/gorunum/${yuz}`, { method: "DELETE" });
      onDegisti?.();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Görüntü silinemedi");
    }
  }

  return (
    <div className="cheque-images">
      {(["on", "arka"] as const).map((yuz) => {
        const adres = adresler[yuz];
        const ekVar = yuz === "on" ? onYuzEkId : arkaYuzEkId;
        return (
          <figure key={yuz} className={`cheque-image${ekVar ? "" : " is-empty"}`}>
            {ekVar ? (
              adres ? (
                adres.tip === "application/pdf"
                  ? <button type="button" className="cheque-image__pdf" onClick={() => window.open(adres.url, "_blank")}>PDF<small>Açmak için tıklayın</small></button>
                  : <button type="button" className="cheque-image__thumb" onClick={() => setBuyuk(yuz)} aria-label={`${YUZ_ADI[yuz]} görüntüsünü büyüt`}><img src={adres.url} alt={YUZ_ADI[yuz]} /></button>
              ) : <div className="cheque-image__loading">Yükleniyor…</div>
            ) : (
              <label className="cheque-image__drop">
                <span>{yukleniyor === yuz ? "Yükleniyor…" : duzenlenebilir ? "+ Görüntü ekle" : "Görüntü yok"}</span>
                <small>{duzenlenebilir ? "Fotoğraf çek ya da dosya seç (JPG, PNG, PDF)" : ""}</small>
                {duzenlenebilir && <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" disabled={Boolean(yukleniyor)} onChange={(e) => { const f = e.target.files?.[0]; if (f) void yukle(yuz, f); e.target.value = ""; }} />}
              </label>
            )}
            <figcaption>
              <span>{YUZ_ADI[yuz]}</span>
              {ekVar && duzenlenebilir && (
                <span className="row-tight">
                  <label className="cheque-image__link">Değiştir<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) void yukle(yuz, f); e.target.value = ""; }} /></label>
                  <button type="button" className="cheque-image__link is-danger" onClick={() => void sil(yuz)}>Sil</button>
                </span>
              )}
            </figcaption>
          </figure>
        );
      })}
      {hata && <p className="cheque-images__error">{hata}</p>}
      {buyuk && adresler[buyuk] && (
        <BuyukGorunum
          baslik={YUZ_ADI[buyuk]}
          url={adresler[buyuk]!.url}
          digerYuz={adresler[buyuk === "on" ? "arka" : "on"] && adresler[buyuk === "on" ? "arka" : "on"]!.tip !== "application/pdf" ? (buyuk === "on" ? "arka" : "on") : null}
          onYuzDegistir={(y) => setBuyuk(y)}
          onKapat={() => setBuyuk(null)}
        />
      )}
    </div>
  );
}

/** Tam ekran görüntüleyici: tekerlek/düğmelerle yakınlaştır, sürükleyerek gez, döndür. */
function BuyukGorunum({ baslik, url, digerYuz, onYuzDegistir, onKapat }: { baslik: string; url: string; digerYuz: Yuz | null; onYuzDegistir: (y: Yuz) => void; onKapat: () => void }) {
  const [olcek, setOlcek] = useState(1);
  const [aci, setAci] = useState(0);
  const [konum, setKonum] = useState({ x: 0, y: 0 });
  const surukle = useRef<{ x: number; y: number; kx: number; ky: number } | null>(null);

  useEffect(() => { setOlcek(1); setAci(0); setKonum({ x: 0, y: 0 }); }, [url]);
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.key === "Escape") onKapat();
      if (e.key === "+" || e.key === "=") setOlcek((o) => Math.min(6, o * 1.25));
      if (e.key === "-") setOlcek((o) => Math.max(0.5, o / 1.25));
    };
    window.addEventListener("keydown", tus);
    return () => window.removeEventListener("keydown", tus);
  }, [onKapat]);

  return (
    <div className="cheque-viewer" role="dialog" aria-label={`${baslik} büyük görünüm`} onMouseDown={(e) => { if (e.target === e.currentTarget) onKapat(); }}>
      <div className="cheque-viewer__bar">
        <strong>{baslik}</strong>
        <div className="row-tight">
          {digerYuz && <Button size="sm" onClick={() => onYuzDegistir(digerYuz)}>{YUZ_ADI[digerYuz]} →</Button>}
          <Button size="sm" onClick={() => setOlcek((o) => Math.max(0.5, o / 1.25))} aria-label="Uzaklaştır">−</Button>
          <span className="cheque-viewer__zoom">%{Math.round(olcek * 100)}</span>
          <Button size="sm" onClick={() => setOlcek((o) => Math.min(6, o * 1.25))} aria-label="Yakınlaştır">+</Button>
          <Button size="sm" onClick={() => setAci((a) => (a + 90) % 360)}>Döndür</Button>
          <Button size="sm" onClick={() => { setOlcek(1); setAci(0); setKonum({ x: 0, y: 0 }); }}>Sığdır</Button>
          <a className="btn btn--ghost btn--sm" href={url} download={`${baslik}.jpg`}>İndir</a>
          <Button size="sm" variant="primary" onClick={onKapat}>Kapat</Button>
        </div>
      </div>
      <div
        className="cheque-viewer__stage"
        onWheel={(e) => setOlcek((o) => Math.min(6, Math.max(0.5, o * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); surukle.current = { x: e.clientX, y: e.clientY, kx: konum.x, ky: konum.y }; }}
        onPointerMove={(e) => { const s = surukle.current; if (s) setKonum({ x: s.kx + e.clientX - s.x, y: s.ky + e.clientY - s.y }); }}
        onPointerUp={() => { surukle.current = null; }}
        onDoubleClick={() => setOlcek((o) => (o > 1 ? 1 : 2.5))}
      >
        <img src={url} alt={baslik} draggable={false} style={{ transform: `translate(${konum.x}px, ${konum.y}px) scale(${olcek}) rotate(${aci}deg)` }} />
      </div>
      <p className="cheque-viewer__hint">Tekerlekle ya da +/− ile yakınlaştırın, sürükleyerek gezinin, çift tıklayarak 2,5 kat büyütün. Esc ile kapatın.</p>
    </div>
  );
}
