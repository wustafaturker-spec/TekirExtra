"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { api, ApiHata } from "@/lib/api";
import stil from "./ai-metin-alani.module.css";

/**
 * AI-115: yapay zekâ destekli metin alanı. Yazmaya 700 ms ara verilince (imleç sondayken) gri
 * devam önerisi gösterilir: Tab kabul eder, Esc kapatır. Seçili metinde "Yeniden yaz" menüsü.
 * Özellik kullanılamıyorsa (kişisel tercih, firma/platform kapatması, yurt dışı onayı yok, sınır)
 * bileşen sessizce düz alan olarak çalışır. Kayıt kullanıcı kaydedince oluşur; öneri kaydetmez.
 */
export type MetinAlani = "fatura_aciklama" | "fatura_not" | "belge_aciklama" | "tahsilat_hatirlatma" | "eposta_govdesi" | "mutabakat_mektubu" | "crm_notu" | "masraf_aciklama";
type Kip = "resmi" | "kisa" | "nazik" | "yazim" | "ingilizce";
const KIPLER: Array<[Kip, string]> = [["resmi", "Daha resmî"], ["kisa", "Daha kısa"], ["nazik", "Daha nazik"], ["yazim", "Yazımı düzelt"], ["ingilizce", "İngilizceye çevir"]];
const BEKLEME_MS = 700;

let durumSozu: Promise<boolean> | null = null;
let duraklatildiSon = 0;
/** Oturum boyunca bir kez sorulur; kişisel tercih değişince sıfırlanır. */
export function metinDurumunuSifirla() { durumSozu = null; duraklatildiSon = 0; }
function kullanilabilir(): Promise<boolean> {
  if (Date.now() < duraklatildiSon) return Promise.resolve(false);
  durumSozu ??= api<{ kullanilabilir: boolean }>("/ai/metin/durum").then((d) => d.kullanilabilir).catch(() => false);
  return durumSozu;
}
/** 429'da bir dakika, diğer kapatmalarda oturum boyunca düz alan. */
function duraklat(h: unknown) {
  if (h instanceof ApiHata && h.durum === 429) duraklatildiSon = Date.now() + 60_000;
  else if (h instanceof ApiHata && [403, 409, 503].includes(h.durum)) durumSozu = Promise.resolve(false);
}
const yeniAnahtar = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const gonder = <T,>(yol: string, govde: unknown, sinyal?: AbortSignal) =>
  api<T>(yol, { method: "POST", body: JSON.stringify(govde), signal: sinyal, headers: { "Idempotency-Key": yeniAnahtar() } });

type Ortak = { alan: MetinAlani; value: string; onDegis: (deger: string) => void; kayit?: { tur: string; id: string } };
type Ozellikler = Ortak & (
  | ({ tekSatir?: false } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">)
  | ({ tekSatir: true } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">)
);

const KOPYALANAN = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "textIndent",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing"] as const;

export function AiMetinAlani(ozellikler: Ozellikler) {
  const { alan, value, onDegis, kayit, tekSatir, onKeyDown, onSelect, onBlur, ...kalan } = ozellikler as Ortak & { tekSatir?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>;
  const alanRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const katmanRef = useRef<HTMLDivElement>(null);
  const [acik, setAcik] = useState(false);
  const [oneri, setOneri] = useState("");
  const [katmanStili, setKatmanStili] = useState<CSSProperties>({});
  const [secim, setSecim] = useState<{ bas: number; son: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [yaziliyor, setYaziliyor] = useState(false);
  const [hata, setHata] = useState("");
  const zamanlayici = useRef<ReturnType<typeof setTimeout>>(undefined);
  const istek = useRef<AbortController | null>(null);
  const ipucuId = useId();

  useEffect(() => { let canli = true; void kullanilabilir().then((k) => { if (canli) setAcik(k); }); return () => { canli = false; }; }, []);
  useEffect(() => () => { clearTimeout(zamanlayici.current); istek.current?.abort(); }, []);

  // Gri öneri alanın üstünde, aynı yazı ölçüleriyle çizilir.
  useLayoutEffect(() => {
    const el = alanRef.current;
    if (!el || !oneri) return;
    const cs = getComputedStyle(el);
    setKatmanStili({ ...Object.fromEntries(KOPYALANAN.map((k) => [k, cs[k]])), width: el.offsetWidth, height: el.offsetHeight, whiteSpace: tekSatir ? "pre" : "pre-wrap" });
    if (katmanRef.current) { katmanRef.current.scrollTop = el.scrollTop; katmanRef.current.scrollLeft = el.scrollLeft; }
  }, [oneri, value, tekSatir]);

  function oneriIste(metin: string) {
    clearTimeout(zamanlayici.current);
    istek.current?.abort();
    setOneri("");
    const el = alanRef.current;
    if (!acik || !el || metin.trim().length < 3 || el.selectionStart !== metin.length || (kalan.maxLength && metin.length >= kalan.maxLength)) return;
    zamanlayici.current = setTimeout(() => {
      const k = new AbortController();
      istek.current = k;
      gonder<{ oneri: string | null }>("/ai/metin/oneri", { alan, metin, ...(kayit ? { kayit } : {}) }, k.signal)
        .then((r) => {
          if (k.signal.aborted || alanRef.current?.value !== metin || !r.oneri) return;
          const sigan = kalan.maxLength ? r.oneri.slice(0, Math.max(0, kalan.maxLength - metin.length)) : r.oneri;
          setOneri(sigan);
        })
        .catch((h: unknown) => { duraklat(h); if (durumSozu) void durumSozu.then(setAcik); });
    }, BEKLEME_MS);
  }

  function kabulEt() {
    if (!oneri) return;
    onDegis(value + oneri);
    setOneri("");
  }

  function tus(e: KeyboardEvent<HTMLTextAreaElement & HTMLInputElement>) {
    if (oneri && e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); kabulEt(); return; }
    if (oneri && e.key === "Escape") { e.preventDefault(); setOneri(""); return; }
    if (menu && e.key === "Escape") { e.preventDefault(); setMenu(false); return; }
    onKeyDown?.(e);
  }

  function secimGuncelle() {
    const el = alanRef.current;
    if (!el || el.selectionStart === null || el.selectionEnd === null) return;
    const [bas, son] = [el.selectionStart, el.selectionEnd];
    setSecim(acik && son - bas >= 3 ? { bas, son } : null);
    if (son - bas < 3) setMenu(false);
  }

  async function yenidenYaz(kip: Kip) {
    if (!secim) return;
    setYaziliyor(true); setHata("");
    try {
      const r = await gonder<{ metin: string }>("/ai/metin/yeniden-yaz", { alan, metin: value.slice(secim.bas, secim.son), kip, ...(kayit ? { kayit } : {}) });
      const yeni = value.slice(0, secim.bas) + r.metin + value.slice(secim.son);
      onDegis(kalan.maxLength ? yeni.slice(0, kalan.maxLength) : yeni);
      setMenu(false); setSecim(null);
    } catch (h) {
      duraklat(h);
      setHata(h instanceof Error ? h.message : "Yeniden yazılamadı.");
    } finally {
      setYaziliyor(false);
    }
  }

  const ortakOzellikler = {
    ...kalan,
    ref: alanRef,
    value,
    "aria-describedby": [kalan["aria-describedby"], oneri ? ipucuId : null].filter(Boolean).join(" ") || undefined,
    onChange: (e: { target: { value: string } }) => { onDegis(e.target.value); oneriIste(e.target.value); },
    onKeyDown: tus,
    onSelect: (e: never) => { secimGuncelle(); (onSelect as ((x: never) => void) | undefined)?.(e); },
    onBlur: (e: never) => { setOneri(""); (onBlur as ((x: never) => void) | undefined)?.(e); },
    onScroll: () => { if (katmanRef.current && alanRef.current) { katmanRef.current.scrollTop = alanRef.current.scrollTop; katmanRef.current.scrollLeft = alanRef.current.scrollLeft; } },
  };

  return (
    <div className={stil.kap}>
      {tekSatir ? <input {...(ortakOzellikler as InputHTMLAttributes<HTMLInputElement>)} /> : <textarea {...(ortakOzellikler as TextareaHTMLAttributes<HTMLTextAreaElement>)} />}
      {oneri && (
        <div ref={katmanRef} className={stil.katman} style={katmanStili} aria-hidden="true">
          <span className={stil.yazilan}>{value}</span><span className={stil.oneri}>{oneri}</span>
        </div>
      )}
      <span id={ipucuId} className={stil.gizli} aria-live="polite">{oneri ? `Öneri: ${oneri}. Eklemek için Tab, kapatmak için Esc.` : ""}</span>
      {secim && (
        <div className={stil.yenidenYaz}>
          <button type="button" className={stil.dugme} aria-haspopup="true" aria-expanded={menu} disabled={yaziliyor} onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu((m) => !m)}>
            {yaziliyor ? "Yazılıyor…" : "✨ Yeniden yaz"}
          </button>
          {menu && (
            <div className={stil.menu} role="group" aria-label="Seçili metni yeniden yaz">
              {KIPLER.map(([kip, ad]) => <button key={kip} type="button" className={stil.menuOge} disabled={yaziliyor} onMouseDown={(e) => e.preventDefault()} onClick={() => void yenidenYaz(kip)}>{ad}</button>)}
            </div>
          )}
          {hata && <span className={stil.hata} role="alert">{hata}</span>}
        </div>
      )}
    </div>
  );
}
