"use client";

/**
 * EBLG-84: irsaliyeye özel teslimat adresi. İhracatta malın Türkiye'den
 * çıkacağı gümrük kapısıdır ve zorunludur; yurt içinde isteğe bağlıdır ve
 * doluysa carinin sevk adresinin önüne geçer. İrsaliye formu ile taşıma
 * bilgisi paneli aynı alanları kullanır.
 */
import { useEffect, useRef, useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";

export interface TeslimatAdresi {
  teslimatAdres: string;
  teslimatIl: string;
  teslimatIlce: string;
  teslimatPostaKodu: string;
}

export const BOS_TESLIMAT_ADRESI: TeslimatAdresi = { teslimatAdres: "", teslimatIl: "", teslimatIlce: "", teslimatPostaKodu: "" };

/** Adres listesinde "yeni adres gir" seçeneğinin değeri. */
const YENI_ADRES = "__yeni__";

interface CariAdres { id: string; tip: string; baslik: string; adres: string; il: string | null; ilce: string | null; postaKodu: string | null; ulke: string | null }

/** Sunucuya giden gövde: boş alanlar `null` olur. */
export function teslimatAdresiGovdesi(d: TeslimatAdresi) {
  return {
    teslimatAdres: d.teslimatAdres.trim() || null,
    teslimatIl: d.teslimatIl.trim() || null,
    teslimatIlce: d.teslimatIlce.trim() || null,
    teslimatPostaKodu: d.teslimatPostaKodu.trim() || null,
  };
}

/** Kısmen doldurulmuş adres gönderimde geçersizdir; kullanıcı önceden uyarılır. */
export function teslimatAdresiEksik(d: TeslimatAdresi): boolean {
  const dolu = [d.teslimatAdres, d.teslimatIl, d.teslimatIlce, d.teslimatPostaKodu].map((x) => Boolean(x.trim()));
  return dolu.some(Boolean) && !dolu.every(Boolean);
}

/**
 * FTR-30: faturada teslim yeri için adres, il ve ilçe yeter (posta kodu
 * isteğe bağlı); e-İrsaliye dördünü de ister.
 */
export function faturaTeslimYeriEksik(d: TeslimatAdresi): boolean {
  const dolu = [d.teslimatAdres, d.teslimatIl, d.teslimatIlce, d.teslimatPostaKodu].some((x) => x.trim());
  return dolu && !(d.teslimatAdres.trim() && d.teslimatIl.trim() && d.teslimatIlce.trim());
}

export function TeslimatAdresiAlanlari({ deger, onChange, cariId, kullanim = "irsaliye", disabled }: {
  deger: TeslimatAdresi;
  onChange: (deger: TeslimatAdresi) => void;
  /** Verilirse carinin Türkiye'deki adreslerinden doldurma seçeneği çıkar. */
  cariId?: string | null;
  /** FTR-30: faturada ipuçları ve eksik adres kuralı farklıdır. */
  kullanim?: "irsaliye" | "fatura";
  disabled?: boolean;
}) {
  const fatura = kullanim === "fatura";
  const [adresler, setAdresler] = useState<CariAdres[]>([]);
  useEffect(() => {
    if (!cariId) { setAdresler([]); return; }
    // Adresler gelmezse alanlar elle doldurulabilir; hata sessizce yutulur.
    void api<{ adresler?: CariAdres[] }>(`/cari/${cariId}`)
      .then((c) => setAdresler((c.adresler ?? []).filter((a) => !a.ulke || a.ulke === "TR")))
      .catch(() => setAdresler([]));
  }, [cariId]);

  const adresRef = useRef<HTMLInputElement>(null);
  const alan = (anahtar: keyof TeslimatAdresi) => (e: { target: { value: string } }) => onChange({ ...deger, [anahtar]: e.target.value });
  return (
    <>
      {adresler.length > 0 && (
        <Field label="Adres Seç">
          <Select value="" disabled={disabled} onChange={(e) => {
            // Yeni adres: alanlar boşalır, imleç adrese geçer; kayıtlı adres seçilirse alanlara yazılır.
            if (e.target.value === YENI_ADRES) {
              onChange(BOS_TESLIMAT_ADRESI);
              requestAnimationFrame(() => adresRef.current?.focus());
              return;
            }
            const a = adresler.find((x) => x.id === e.target.value);
            if (a) onChange({ teslimatAdres: a.adres, teslimatIl: a.il ?? "", teslimatIlce: a.ilce ?? "", teslimatPostaKodu: a.postaKodu ?? "" });
          }}>
            <option value="">Carinin adresinden seçin…</option>
            {/* Seçince alanlara adres metni yazılır; listede de başlığın yanında o görünür. */}
            {adresler.map((a) => <option key={a.id} value={a.id}>{a.baslik}: {[a.adres, [a.ilce, a.il].filter(Boolean).join(" / ")].filter(Boolean).join(", ")}</option>)}
            <option value={YENI_ADRES}>+ Yeni adres gir</option>
          </Select>
        </Field>
      )}
      <Field label="Teslimat Adresi">
        <Input ref={adresRef} aria-label="Teslimat adresi" value={deger.teslimatAdres} maxLength={500} placeholder={fatura ? "Malın teslim edildiği adres" : "İhracatta gümrük kapısı"} disabled={disabled} onChange={alan("teslimatAdres")} />
        <small className="muted">{fatura
          ? "e-İrsaliyeden faturalanınca irsaliyedeki teslim yeri gelir. Boşsa belgeye teslim yeri yazılmaz (alıcı adresine teslim)."
          : "Boşsa carinin sevk adresi yazılır. Yurt dışı alıcıda zorunludur: malın Türkiye'den çıkacağı gümrük kapısı."}</small>
      </Field>
      <Field label="Teslimat İli">
        <Input aria-label="Teslimat ili" value={deger.teslimatIl} maxLength={60} disabled={disabled} onChange={alan("teslimatIl")} />
      </Field>
      <Field label="Teslimat İlçesi">
        <Input aria-label="Teslimat ilçesi" value={deger.teslimatIlce} maxLength={60} disabled={disabled} onChange={alan("teslimatIlce")} />
      </Field>
      <Field label="Teslimat Posta Kodu">
        <Input aria-label="Teslimat posta kodu" value={deger.teslimatPostaKodu} maxLength={10} disabled={disabled} onChange={alan("teslimatPostaKodu")} />
        {fatura
          ? faturaTeslimYeriEksik(deger) && <small className="muted">Adres, il ve ilçe birlikte girilmeli.</small>
          : teslimatAdresiEksik(deger) && <small className="muted">Adres, il, ilçe ve posta kodunun dördü de dolu olmalı; eksik adresle e-İrsaliye gönderilemez.</small>}
      </Field>
    </>
  );
}
