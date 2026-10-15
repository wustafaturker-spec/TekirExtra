"use client";

/**
 * Komut paleti (⌘K / Ctrl+K).
 *
 * 90'ı aşkın rotası olan bir uygulamada menüyü büyütmek çözüm değildir;
 * kullanıcının aklındaki sözcükle hedefe gitmesi gerekir. Palet iki kaynağı
 * birlikte arar:
 *
 *  - Sayfalar: `lib/menu` listesi, rolün görebildikleriyle sınırlı.
 *  - Kayıtlar: cari, stok ve fatura uçlarında sunucu tarafı arama.
 *
 * Kayıt araması yazarken tetiklendiği için geciktirilir (debounce) ve her yeni
 * tuşta önceki istek iptal edilir; yavaş yanıtın hızlı yanıtın üstüne yazması
 * böylece engellenir.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { metinNormalize, paraBicimle } from "@tekirextra/shared";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { api } from "@/lib/api";
import { TUM_SAYFALAR, type MenuOge } from "@/lib/menu";
import { rolMenuYoluGorebilir } from "@/lib/rol-yetkileri";
import { ebelgeYoluGorunur } from "@/lib/ebelge-yollari";
import type { EbelgeUygulamalari } from "@tekirextra/shared";

interface PaletSonucu {
  anahtar: string;
  baslik: string;
  aciklama?: string;
  grup: "Finansal Zekâ ve CLI" | "Sayfalar" | "Cari hesaplar" | "Stok kartları" | "Faturalar";
  href: string;
  ikon?: MenuOge["ikon"];
}

interface CariKaydi { id: string; kod: string; unvan: string }
interface StokKaydi { id: string; kod: string; ad: string; anaBirim?: string | null }
interface FaturaKaydi { id: string; no: string | null; tip: string; genelToplam: string; cari?: { unvan: string } | null }

const KAYIT_ARAMA_GECIKMESI = 220;
const EN_FAZLA_SAYFA = 7;

function sayfaSonuclari(rol: string | null, sorgu: string, ebelgeUygulamalari: EbelgeUygulamalari | null): PaletSonucu[] {
  // EBLG-77: menüde gizlenen e-belge ekranı palette de çıkmamalı.
  const gorunur = TUM_SAYFALAR.filter((sayfa) => rolMenuYoluGorebilir(rol, sayfa.href) && ebelgeYoluGorunur(ebelgeUygulamalari, sayfa.href));
  if (!sorgu) {
    return gorunur.slice(0, EN_FAZLA_SAYFA).map((sayfa) => ({
      anahtar: `sayfa:${sayfa.href}`, baslik: sayfa.baslik, grup: "Sayfalar", href: sayfa.href, ikon: sayfa.ikon,
    }));
  }
  const aranan = metinNormalize(sorgu);
  return gorunur
    .map((sayfa) => {
      const baslik = metinNormalize(sayfa.baslik);
      const esanlamli = (sayfa.esanlamlilar ?? []).map(metinNormalize);
      // Baştan eşleşme, içinde geçmeden önce gelir; eşanlamlı en sonda.
      const puan = baslik.startsWith(aranan) ? 0 : baslik.includes(aranan) ? 1 : esanlamli.some((e) => e.includes(aranan)) ? 2 : -1;
      return { sayfa, puan };
    })
    .filter(({ puan }) => puan >= 0)
    .sort((a, b) => a.puan - b.puan)
    .slice(0, EN_FAZLA_SAYFA)
    .map(({ sayfa }) => ({
      anahtar: `sayfa:${sayfa.href}`, baslik: sayfa.baslik, grup: "Sayfalar", href: sayfa.href, ikon: sayfa.ikon,
    }));
}

function aiKomutSonuclari(sorgu: string): PaletSonucu[] {
  const s = sorgu.trim().toLowerCase();
  if (!s) return [];
  const komutlar: PaletSonucu[] = [];

  if (s.startsWith("tekir") || s === "cli" || s === "terminal" || s === "yardim" || s === "help") {
    komutlar.push({
      anahtar: "ai:cli-help",
      baslik: "tekir yardim — Güvenli CLI Komut Rehberi",
      aciklama: "Yetkili muhasebe sorgulama ve analiz komutları",
      grup: "Finansal Zekâ ve CLI",
      href: "/panel/ai?cmd=tekir+yardim",
    });
    komutlar.push({
      anahtar: "ai:cli-cari",
      baslik: "tekir cari list — Vadesi Geçen Alacakları Listele",
      aciklama: "Müşteri ödeme gecikmelerini konsolda göster",
      grup: "Finansal Zekâ ve CLI",
      href: "/panel/ai?cmd=tekir+cari+list",
    });
  }

  if (s.includes("risk") || s.includes("otonom") || s.includes("kasa") || s.includes("zeka") || s.includes("nakit")) {
    komutlar.push({
      anahtar: "ai:otonom-risk",
      baslik: "⚡ Otonom Finansal Risk ve Nakit Radarı",
      aciklama: "Kural 6 deterministik kasa açığı ve riskli cari projeksiyonu",
      grup: "Finansal Zekâ ve CLI",
      href: "/panel/nakit-akisi",
    });
  }

  return komutlar;
}

export function KomutPaleti({
  rol,
  ebelgeUygulamalari = null,
  acik,
  setAcik,
}: {
  rol: string | null;
  /** EBLG-77: kapalı e-belge uygulamasının sayfaları listelenmez. */
  ebelgeUygulamalari?: EbelgeUygulamalari | null;
  acik: boolean;
  setAcik: (acik: boolean | ((onceki: boolean) => boolean)) => void;
}) {
  const router = useRouter();
  const [sorgu, setSorgu] = useState("");
  const [kayitlar, setKayitlar] = useState<PaletSonucu[]>([]);
  const [araniyor, setAraniyor] = useState(false);
  const [aktifIndex, setAktifIndex] = useState(0);
  const girdiRef = useRef<HTMLInputElement>(null);
  const listeRef = useRef<HTMLUListElement>(null);
  const tetikleyiciRef = useRef<HTMLElement | null>(null);

  const sonuclar = useMemo(
    () => [
      ...aiKomutSonuclari(sorgu),
      ...sayfaSonuclari(rol, sorgu.trim(), ebelgeUygulamalari),
      ...kayitlar,
    ],
    [rol, sorgu, kayitlar, ebelgeUygulamalari],
  );

  const kapat = useCallback(() => {
    setAcik(false);
    setSorgu("");
    setKayitlar([]);
    setAktifIndex(0);
  }, [setAcik]);

  // ⌘K / Ctrl+K her yerden açar. Kullanıcı bir metin alanındayken de çalışır;
  // paletin amacı zaten "elini klavyeden kaldırmadan" gezinmektir.
  useEffect(() => {
    const yakala = (olay: KeyboardEvent) => {
      if ((olay.metaKey || olay.ctrlKey) && olay.key.toLowerCase() === "k") {
        olay.preventDefault();
        setAcik((onceki) => {
          if (!onceki) tetikleyiciRef.current = document.activeElement as HTMLElement | null;
          return !onceki;
        });
      }
    };
    window.addEventListener("keydown", yakala);
    return () => window.removeEventListener("keydown", yakala);
  }, [setAcik]);

  useEffect(() => {
    if (!acik) {
      if (tetikleyiciRef.current?.isConnected) tetikleyiciRef.current.focus();
      return;
    }
    const odak = window.requestAnimationFrame(() => girdiRef.current?.focus());
    return () => window.cancelAnimationFrame(odak);
  }, [acik]);

  // Kayıt araması: en az 2 karakter, geciktirilmiş, sonuç yarışını önleyen.
  useEffect(() => {
    const aranan = sorgu.trim();
    if (!acik || aranan.length < 2) { setKayitlar([]); setAraniyor(false); return; }
    let iptal = false;
    setAraniyor(true);
    const zamanlayici = window.setTimeout(async () => {
      const parametre = encodeURIComponent(aranan);
      const izinli = (yol: string) => rolMenuYoluGorebilir(rol, yol);
      const [cariler, stoklar, faturalar] = await Promise.all([
        izinli("/panel/cari") ? api<{ kayitlar: CariKaydi[] }>(`/cari?arama=${parametre}&adet=5`).catch(() => null) : null,
        izinli("/panel/stok") ? api<{ kayitlar: StokKaydi[] }>(`/stok?arama=${parametre}&adet=5`).catch(() => null) : null,
        izinli("/panel/fatura?yon=satis") ? api<{ kayitlar: FaturaKaydi[] }>(`/fatura?arama=${parametre}&adet=5`).catch(() => null) : null,
      ]);
      if (iptal) return;
      setKayitlar([
        ...(cariler?.kayitlar ?? []).map((cari) => ({
          anahtar: `cari:${cari.id}`, baslik: cari.unvan, aciklama: cari.kod,
          grup: "Cari hesaplar" as const, href: `/panel/cari/${cari.id}`,
        })),
        ...(stoklar?.kayitlar ?? []).map((stok) => ({
          anahtar: `stok:${stok.id}`, baslik: stok.ad, aciklama: [stok.kod, stok.anaBirim].filter(Boolean).join(" · "),
          grup: "Stok kartları" as const, href: `/panel/stok/${stok.id}`,
        })),
        ...(faturalar?.kayitlar ?? []).map((fatura) => ({
          anahtar: `fatura:${fatura.id}`, baslik: fatura.no || "Numarasız fatura",
          aciklama: [fatura.cari?.unvan, paraBicimle(fatura.genelToplam)].filter(Boolean).join(" · "),
          grup: "Faturalar" as const,
          // Faturanın ayrı detay rotası yok; liste sayfası `faturaId` ile tek
          // kayda odaklanır, `arama` ise kaydın ilk sayfada gelmesini sağlar.
          href: `/panel/fatura?yon=${["alis", "alis_iade"].includes(fatura.tip) ? "alis" : "satis"}&faturaId=${fatura.id}&arama=${encodeURIComponent(fatura.no ?? aranan)}`,
        })),
      ]);
      setAraniyor(false);
    }, KAYIT_ARAMA_GECIKMESI);
    return () => { iptal = true; window.clearTimeout(zamanlayici); };
  }, [acik, sorgu, rol]);

  useEffect(() => { setAktifIndex(0); }, [sorgu]);
  useEffect(() => {
    listeRef.current?.querySelector<HTMLElement>('[data-aktif="true"]')?.scrollIntoView({ block: "nearest" });
  }, [aktifIndex, sonuclar.length]);

  function git(sonuc: PaletSonucu | undefined) {
    if (!sonuc) return;
    kapat();
    router.push(sonuc.href);
  }

  function klavye(olay: React.KeyboardEvent) {
    if (olay.key === "Escape") { olay.preventDefault(); kapat(); return; }
    if (olay.key === "ArrowDown") {
      olay.preventDefault();
      setAktifIndex((i) => (sonuclar.length ? (i + 1) % sonuclar.length : 0));
    } else if (olay.key === "ArrowUp") {
      olay.preventDefault();
      setAktifIndex((i) => (sonuclar.length ? (i - 1 + sonuclar.length) % sonuclar.length : 0));
    } else if (olay.key === "Enter") {
      olay.preventDefault();
      git(sonuclar[aktifIndex]);
    }
  }

  if (!acik) return null;

  let oncekiGrup = "";
  return (
    <div className="palet-perde" onMouseDown={(olay) => { if (olay.target === olay.currentTarget) kapat(); }}>
      <div aria-label="Komut paleti" aria-modal="true" className="palet" role="dialog">
        <div className="palet__girdi">
          <Search aria-hidden="true" size={17} strokeWidth={1.9} />
          <input
            aria-activedescendant={sonuclar[aktifIndex] ? `palet-${aktifIndex}` : undefined}
            aria-autocomplete="list"
            aria-controls="palet-sonuclari"
            aria-expanded="true"
            autoComplete="off"
            onChange={(olay) => setSorgu(olay.target.value)}
            onKeyDown={klavye}
            placeholder="Sayfa, cari, stok veya fatura arayın…"
            ref={girdiRef}
            role="combobox"
            spellCheck={false}
            value={sorgu}
          />
          <kbd className="palet__kbd">esc</kbd>
        </div>

        <ul className="palet__liste" id="palet-sonuclari" ref={listeRef} role="listbox">
          {sonuclar.length === 0 && (
            <li className="palet__bos" role="presentation">
              {araniyor ? "Aranıyor…" : sorgu.trim().length === 1 ? "Aramak için en az iki karakter yazın." : "Eşleşen sayfa veya kayıt bulunamadı."}
            </li>
          )}
          {sonuclar.map((sonuc, index) => {
            const grupBasligi = sonuc.grup !== oncekiGrup ? sonuc.grup : null;
            oncekiGrup = sonuc.grup;
            const Ikon = sonuc.ikon ?? ArrowRight;
            return (
              <li key={sonuc.anahtar} role="presentation">
                {grupBasligi && <p className="palet__grup">{grupBasligi}</p>}
                <button
                  aria-selected={index === aktifIndex}
                  className="palet__oge"
                  data-aktif={index === aktifIndex}
                  id={`palet-${index}`}
                  onClick={() => git(sonuc)}
                  onMouseMove={() => setAktifIndex(index)}
                  role="option"
                  type="button"
                >
                  <Ikon aria-hidden="true" className="palet__oge-ikon" size={16} strokeWidth={1.9} />
                  <span className="palet__oge-metin">
                    <strong>{sonuc.baslik}</strong>
                    {sonuc.aciklama && <small>{sonuc.aciklama}</small>}
                  </span>
                  {index === aktifIndex && <CornerDownLeft aria-hidden="true" size={14} strokeWidth={1.9} />}
                </button>
              </li>
            );
          })}
        </ul>

        <footer className="palet__alt">
          <span><kbd className="palet__kbd">↑</kbd><kbd className="palet__kbd">↓</kbd> gezin</span>
          <span><kbd className="palet__kbd">↵</kbd> aç</span>
          {araniyor && <span className="palet__durum">Kayıtlar aranıyor…</span>}
        </footer>
      </div>
    </div>
  );
}
