"use client";

import { OGRENIM_DURUMLARI, SGK_BELGE_TURLERI } from "@tekirextra/shared";
import { Field, Input, Select } from "@/components/ui";

/** PRS-23: SGK bildirge ve MUHSGK için personel kartı alanları (form durumu metin). */
export interface SgkAlanlari { sgkBelgeTuru: string; meslekKodu: string; ogrenimDurumu: string; mezuniyetYili: string; mezuniyetBolumu: string; eskiHukumlu: boolean; tesvikKanunNo: string }

export const BOS_SGK_ALANLARI: SgkAlanlari = { sgkBelgeTuru: "1", meslekKodu: "", ogrenimDurumu: "", mezuniyetYili: "", mezuniyetBolumu: "", eskiHukumlu: false, tesvikKanunNo: "" };

export const sgkAlanlariKaydindan = (p: { sgkBelgeTuru?: string | null; meslekKodu?: string | null; ogrenimDurumu?: number | null; mezuniyetYili?: number | null; mezuniyetBolumu?: string | null; eskiHukumlu?: boolean | null; tesvikKanunNo?: string | null }): SgkAlanlari => ({
  sgkBelgeTuru: p.sgkBelgeTuru ?? "1", meslekKodu: p.meslekKodu ?? "", ogrenimDurumu: p.ogrenimDurumu == null ? "" : String(p.ogrenimDurumu),
  mezuniyetYili: p.mezuniyetYili ? String(p.mezuniyetYili) : "", mezuniyetBolumu: p.mezuniyetBolumu ?? "", eskiHukumlu: Boolean(p.eskiHukumlu), tesvikKanunNo: p.tesvikKanunNo ?? "",
});

/** API gövdesi: boş alan null olur. */
export const sgkAlanlariGovdesi = (a: SgkAlanlari) => ({
  sgkBelgeTuru: Number(a.sgkBelgeTuru) || 1, meslekKodu: a.meslekKodu.trim() || null, ogrenimDurumu: a.ogrenimDurumu === "" ? null : Number(a.ogrenimDurumu),
  mezuniyetYili: a.mezuniyetYili ? Number(a.mezuniyetYili) : null, mezuniyetBolumu: a.mezuniyetBolumu.trim() || null, eskiHukumlu: a.eskiHukumlu, tesvikKanunNo: a.tesvikKanunNo.trim() || null,
});

export function PersonelSgkAlanlari({ deger, onChange }: { deger: SgkAlanlari; onChange: (d: SgkAlanlari) => void }) {
  const hazir = deger.sgkBelgeTuru in SGK_BELGE_TURLERI;
  const degistir = (ek: Partial<SgkAlanlari>) => onChange({ ...deger, ...ek });
  return (
    <fieldset className="form-section">
      <legend>SGK bildirge bilgileri</legend>
      <div className="form-grid form-grid--2">
        <Field label="SGK belge türü">
          <Select value={hazir ? deger.sgkBelgeTuru : "diger"} onChange={(e) => degistir({ sgkBelgeTuru: e.target.value === "diger" ? "" : e.target.value })}>
            {Object.entries(SGK_BELGE_TURLERI).map(([kod, ad]) => <option key={kod} value={kod}>{kod} — {ad}</option>)}
            <option value="diger">Diğer kod…</option>
          </Select>
          {!hazir && <Input required type="number" min={1} max={92} placeholder="Belge türü kodu (1–92)" value={deger.sgkBelgeTuru} onChange={(e) => degistir({ sgkBelgeTuru: e.target.value })} />}
        </Field>
        <Field label="Meslek kodu (İŞKUR)"><Input placeholder="Örn. 2411.01" pattern="\d{4}\.\d{2}" title="NNNN.NN biçiminde" value={deger.meslekKodu} onChange={(e) => degistir({ meslekKodu: e.target.value })} /><small className="muted">e-Bildirge'de kayıtlı meslek koduyla aynı olmalı.</small></Field>
        <Field label="Öğrenim durumu">
          <Select value={deger.ogrenimDurumu} onChange={(e) => degistir({ ogrenimDurumu: e.target.value })}>
            <option value="">Girilmedi</option>
            {OGRENIM_DURUMLARI.map((ad, kod) => <option key={kod} value={kod}>{kod} — {ad}</option>)}
          </Select>
        </Field>
        <Field label="Teşvik kanun no"><Input inputMode="numeric" maxLength={5} pattern="\d{5}" title="5 hane" placeholder="Boşsa teşvik oranına göre 05510 / 00000" value={deger.tesvikKanunNo} onChange={(e) => degistir({ tesvikKanunNo: e.target.value })} /></Field>
        <Field label="Mezuniyet yılı"><Input type="number" min={1900} max={2100} value={deger.mezuniyetYili} onChange={(e) => degistir({ mezuniyetYili: e.target.value })} /></Field>
        <Field label="Mezuniyet bölümü"><Input maxLength={100} value={deger.mezuniyetBolumu} onChange={(e) => degistir({ mezuniyetBolumu: e.target.value })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={deger.eskiHukumlu} onChange={(e) => degistir({ eskiHukumlu: e.target.checked })} /><span>Eski hükümlü</span></label>
    </fieldset>
  );
}
