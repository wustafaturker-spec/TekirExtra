"use client";

/**
 * EBLG-84: irsaliyeye özel teslimat adresi. İhracatta malın Türkiye'den
 * çıkacağı gümrük kapısıdır ve zorunludur; yurt içinde isteğe bağlıdır ve
 * doluysa carinin sevk adresinin önüne geçer. İrsaliye formu ile taşıma
 * bilgisi paneli aynı alanları kullanır.
 */
import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";

export interface TeslimatAdresi {
  teslimatAdres: string;
  teslimatIl: string;
  teslimatIlce: string;
  teslimatPostaKodu: string;
}

export const BOS_TESLIMAT_ADRESI: TeslimatAdresi = { teslimatAdres: "", teslimatIl: "", teslimatIlce: "", teslimatPostaKodu: "" };

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

export function TeslimatAdresiAlanlari({ deger, onChange, cariId }: {
  deger: TeslimatAdresi;
  onChange: (deger: TeslimatAdresi) => void;
  /** Verilirse carinin Türkiye'deki adreslerinden doldurma seçeneği çıkar. */
  cariId?: string | null;
}) {
  const [adresler, setAdresler] = useState<CariAdres[]>([]);
  useEffect(() => {
    if (!cariId) { setAdresler([]); return; }
    // Adresler gelmezse alanlar elle doldurulabilir; hata sessizce yutulur.
    void api<{ adresler?: CariAdres[] }>(`/cari/${cariId}`)
      .then((c) => setAdresler((c.adresler ?? []).filter((a) => !a.ulke || a.ulke === "TR")))
      .catch(() => setAdresler([]));
  }, [cariId]);

  const alan = (anahtar: keyof TeslimatAdresi) => (e: { target: { value: string } }) => onChange({ ...deger, [anahtar]: e.target.value });
  return (
    <>
      {adresler.length > 0 && (
        <Field label="Carinin Adresinden Doldur">
          <Select value="" onChange={(e) => {
            const a = adresler.find((x) => x.id === e.target.value);
            if (a) onChange({ teslimatAdres: a.adres, teslimatIl: a.il ?? "", teslimatIlce: a.ilce ?? "", teslimatPostaKodu: a.postaKodu ?? "" });
          }}>
            <option value="">Seçin — alanlara yazılır</option>
            {adresler.map((a) => <option key={a.id} value={a.id}>{a.baslik} — {[a.ilce, a.il].filter(Boolean).join(" / ")}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Teslimat Adresi">
        <Input aria-label="Teslimat adresi" value={deger.teslimatAdres} maxLength={500} placeholder="İhracatta gümrük kapısı" onChange={alan("teslimatAdres")} />
        <small className="muted">Boşsa carinin sevk adresi yazılır. Yurt dışı alıcıda zorunludur: malın Türkiye'den çıkacağı gümrük kapısı.</small>
      </Field>
      <Field label="Teslimat İli">
        <Input aria-label="Teslimat ili" value={deger.teslimatIl} maxLength={60} onChange={alan("teslimatIl")} />
      </Field>
      <Field label="Teslimat İlçesi">
        <Input aria-label="Teslimat ilçesi" value={deger.teslimatIlce} maxLength={60} onChange={alan("teslimatIlce")} />
      </Field>
      <Field label="Teslimat Posta Kodu">
        <Input aria-label="Teslimat posta kodu" value={deger.teslimatPostaKodu} maxLength={10} onChange={alan("teslimatPostaKodu")} />
        {teslimatAdresiEksik(deger) && <small className="muted">Adres, il, ilçe ve posta kodunun dördü de dolu olmalı; eksik adresle e-İrsaliye gönderilemez.</small>}
      </Field>
    </>
  );
}
