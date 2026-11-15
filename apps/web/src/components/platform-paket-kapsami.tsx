"use client";
import { useId } from "react";
import { PAKET_MODUL_KODLARI, PAKET_MODUL_ADLARI, PAKET_MODUL_BAGIMLILIKLARI, PAKET_KOTA_KODLARI, PAKET_KOTA_TANIMLARI, PAKET_OZELLIK_KODLARI, PAKET_OZELLIKLERI, type PaketKapsamSozlesmesi } from "@tekirextra/shared";
import { Field, Input, TableWrap } from "@/components/ui";

/**
 * Yeni kapsam bütün modüller ve sınırsız kotayla başlar. 0 "hiç kayıt yok"
 * demektir; yalnız plan özelliği seçmek için kapsamı açan yönetici farkında
 * olmadan firmaları kilitlemesin (2026-11-15: kurumsal v3 bu yüzden atanamadı).
 */
export function bosPaketKapsami(): PaketKapsamSozlesmesi {
  return { semaSurumu: 1, moduller: [...PAKET_MODUL_KODLARI], kotalar: {
    kullanici: { sinir: null, uyariYuzdesi: 80 }, cari: { sinir: null, uyariYuzdesi: 80 }, stok: { sinir: null, uyariYuzdesi: 80 }, aylikFatura: { sinir: null, uyariYuzdesi: 80 },
  } };
}
export function PlatformPaketKapsamEditoru({ etkin, onEtkin, deger, onDegis, mesgul, hata }: {
  etkin: boolean; onEtkin: (v: boolean) => void; deger: PaketKapsamSozlesmesi; onDegis: (g: PaketKapsamSozlesmesi) => void; mesgul: boolean; hata: string;
}) {
  const kimlik = useId();
  return <fieldset className="stack" disabled={mesgul}><legend>Erişim ve kota sözleşmesi</legend>
    <label><input type="checkbox" checked={etkin} onChange={(e) => onEtkin(e.target.checked)} /> Bu sürüme modül ve kota sözleşmesi ekle</label>
    <p className="subtle">Katalog tanımıdır. Yayınlamak mevcut abonelerin erişimini veya limitlerini değiştirmez. Aboneliğe uygulamak ayrı modül, kota ve fiyat önizlemesi ile açık kapsam onayı gerektirir.</p>
    {etkin && <>
      <fieldset className="stack"><legend>Paket modülleri</legend>
        <p>Hesap ve abonelik ayarlarına erişim korunur. Açıklayıcı özellik metinleri erişim kuralı yerine geçmez.</p>
        {PAKET_MODUL_KODLARI.map((kod) => <label key={kod}><input type="checkbox" checked={deger.moduller.includes(kod)} onChange={(e) => onDegis({ ...deger, moduller: e.target.checked ? [...deger.moduller, kod] : deger.moduller.filter((k) => k !== kod) })} /> {PAKET_MODUL_ADLARI[kod]}
          {(PAKET_MODUL_BAGIMLILIKLARI[kod]?.length ?? 0) > 0 && <small> · Gereken: {PAKET_MODUL_BAGIMLILIKLARI[kod]!.map((k) => PAKET_MODUL_ADLARI[k]).join(", ")}</small>}</label>)}
      </fieldset>
      <p>0 yeni kayıt hakkı olmadığını, Sınırsız ise sayısal sınır olmadığını belirtir. Yeni sözleşmede sınırları gözden geçirin; otomatik bir eski plan kotası seçilmez.</p>
      {PAKET_KOTA_KODLARI.map((kod) => {
        const q = deger.kotalar[kod], tanim = PAKET_KOTA_TANIMLARI[kod];
        const degistir = (yeni: Partial<typeof q>) => onDegis({ ...deger, kotalar: { ...deger.kotalar, [kod]: { ...q, ...yeni } } });
        return <fieldset className="stack" key={kod}><legend>{tanim.ad}</legend><p className="subtle">{tanim.aciklama} Birim: {tanim.birim} · Dönem: {tanim.donem === "anlik" ? "Anlık" : "Türkiye takvim ayı"}.</p>
          <label><input type="checkbox" checked={q.sinir === null} onChange={(e) => degistir({ sinir: e.target.checked ? null : 0 })} /> {tanim.ad} · Sınırsız</label>
          <Field label={`${tanim.ad} sınırı`} htmlFor={`${kimlik}-${kod}`}><Input id={`${kimlik}-${kod}`} required={q.sinir !== null} disabled={q.sinir === null} type="number" min={0} max={2147483647} step={1} value={q.sinir !== null && Number.isFinite(q.sinir) ? q.sinir : ""} onChange={(e) => degistir({ sinir: e.target.value === "" ? NaN : Number(e.target.value) })} /></Field>
          <Field label={`${tanim.ad} uyarı eşiği (%)`} htmlFor={`${kimlik}-${kod}-uyari`}><Input id={`${kimlik}-${kod}-uyari`} required type="number" min={1} max={99} step={1} value={Number.isFinite(q.uyariYuzdesi) ? q.uyariYuzdesi : ""} onChange={(e) => degistir({ uyariYuzdesi: e.target.value === "" ? NaN : Number(e.target.value) })} /></Field>
        </fieldset>;
      })}
      <DepolamaKotaEditoru deger={deger.depolama} onDegis={(depolama) => onDegis({ ...deger, depolama })} />
      <fieldset className="stack"><legend>Plan özellikleri</legend>
        <p className="subtle">Seçilmedikçe kapalıdır.</p>
        {PAKET_OZELLIK_KODLARI.map((kod) => { const t = PAKET_OZELLIKLERI[kod]; return <label key={kod}><input type="checkbox" checked={deger.ozellikler?.[kod] === true} onChange={(e) => {
          const ozellikler = { ...deger.ozellikler, [kod]: e.target.checked || undefined };
          onDegis({ ...deger, ozellikler: Object.values(ozellikler).some(Boolean) ? ozellikler : undefined });
        }} /> {t.ad}<small> · {t.aciklama} Gereken: {PAKET_MODUL_ADLARI[t.gerekenModul]}</small></label>; })}
      </fieldset>
    </>}
    {hata && <p role="alert">{hata}</p>}
  </fieldset>;
}

export function PlatformPaketKapsami({ kapsam }: { kapsam?: PaketKapsamSozlesmesi | null }) {
  if (!kapsam) return <p>Bu sürümde erişim ve kota sözleşmesi tanımlı değil.</p>;
  return <div className="stack"><h3>Modül ve kota sözleşmesi</h3>
    <p>Seçili modüller: {kapsam.moduller.map((k) => PAKET_MODUL_ADLARI[k]).join(", ")}. Hesap ve abonelik ayarları korunur.</p>
    <TableWrap><thead><tr><th>Kota</th><th>Sınır</th><th>Birim / dönem</th><th>Uyarı eşiği</th></tr></thead><tbody>{PAKET_KOTA_KODLARI.map((kod) => {
      const q = kapsam.kotalar[kod], t = PAKET_KOTA_TANIMLARI[kod];
      return <tr key={kod}><td>{t.ad}<br /><small>{t.aciklama}</small></td><td>{q.sinir === null ? "Sınırsız" : q.sinir.toLocaleString("tr-TR")}</td><td>{t.birim} · {t.donem === "anlik" ? "Anlık" : "Türkiye takvim ayı"}</td><td>%{q.uyariYuzdesi}</td></tr>;
    })}</tbody></TableWrap>
    {PAKET_OZELLIK_KODLARI.some((k) => kapsam.ozellikler?.[k]) && <p>Plan özellikleri: {PAKET_OZELLIK_KODLARI.filter((k) => kapsam.ozellikler?.[k]).map((k) => PAKET_OZELLIKLERI[k].ad).join(", ")}.</p>}
    {kapsam.depolama && <p>Depolama sınırı: {kapsam.depolama.sinirBayt === null ? "Sınırsız" : `${kapsam.depolama.sinirBayt} bayt`} · Uyarı eşiği: %{kapsam.depolama.uyariYuzdesi}. Kayıtlı ekler ve devam eden yüklemeler birlikte sayılır.</p>}
    <p className="subtle">Bu tanım mevcut aboneliklere uygulanmaz. Bu sürüm yalnız açık kapsam onayıyla modül, kota ve fiyatları birlikte değiştirir.</p>
  </div>;
}

export function DepolamaKotaEditoru({ deger, onDegis }: { deger: PaketKapsamSozlesmesi["depolama"]; onDegis: (v: PaketKapsamSozlesmesi["depolama"]) => void }) {
  return <fieldset className="stack"><legend>Ek dosyası depolaması</legend>
    <label><input type="checkbox" checked={deger !== undefined} onChange={(e) => onDegis(e.target.checked ? { sinirBayt: "0", uyariYuzdesi: 80 } : undefined)} /> Depolama sınırı tanımla</label>
    <p>Kayıtlı ekler ve açık yükleme rezervasyonları bayt olarak sayılır; dönemsel sıfırlama veya ek ücret yoktur. Tanım kaldırılırsa sayısal sınır uygulanmaz.</p>
    {deger && <><label><input type="checkbox" checked={deger.sinirBayt === null} onChange={(e) => onDegis({ ...deger, sinirBayt: e.target.checked ? null : "0" })} /> Depolama · Sınırsız</label>
      <Field label="Depolama sınırı (bayt)"><Input inputMode="numeric" pattern="[0-9]+" required={deger.sinirBayt !== null} disabled={deger.sinirBayt === null} value={deger.sinirBayt ?? ""} onChange={(e) => onDegis({ ...deger, sinirBayt: e.target.value })} /></Field>
      <Field label="Depolama uyarı eşiği (%)"><Input type="number" min={1} max={99} step={1} required value={Number.isFinite(deger.uyariYuzdesi) ? deger.uyariYuzdesi : ""} onChange={(e) => onDegis({ ...deger, uyariYuzdesi: e.target.value === "" ? NaN : Number(e.target.value) })} /></Field>
    </>}
  </fieldset>;
}
