"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Badge, Button, Field, Input, Select, TableWrap } from "@/components/ui";

interface Aday {
  id: string; no: string | null; tip: string; taraf: "satis" | "alis";
  tarih: string; vadeTarihi: string | null; dovizCinsi: string; genelToplam: string; acik: string; mahsupEdilebilir: string;
}
interface Mahsup {
  id: string; tarih: string; dovizCinsi: string; tutar: string; aciklama: string | null; otomatik: boolean; olusturan: string | null; geriAlindi: boolean;
  faturalar: { id: string; no: string | null; tip: string; dovizCinsi: string; tutar: string }[];
}
interface Durum { otomatikMahsup: boolean; adaylar: Aday[]; mahsuplar: Mahsup[] }
/** Seçili satır: fatura dövizinde tutar, farklı dövizde mahsup dövizinde karşılık. */
interface Secim { tutar: string; karsilik: string }

const TIP_ADI: Record<string, string> = { satis: "Satış", alis: "Alış", satis_iade: "Satış iadesi", alis_iade: "Alış iadesi" };
const para = (s: string | number) => Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const yuvarla = (n: number) => Math.round(n * 100) / 100;
const gun = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("tr-TR");
const bugun = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/**
 * KSB-25: alış–satış faturası mahsubu. Aynı carinin satış tarafı (satış,
 * alış iadesi) ile alış tarafı (alış, satış iadesi) eşit tutarla kapatılır;
 * cari bakiyesi değişmez.
 */
export function MahsupPaneli({ cariId, rol, onMesaj }: { cariId: string; rol: string | null; onMesaj: (m: { hata?: string; basari?: string }) => void }) {
  const yazabilir = rol === "yonetici" || rol === "muhasebe";
  const [durum, setDurum] = useState<Durum | null>(null);
  const [doviz, setDoviz] = useState("TRY");
  const [secim, setSecim] = useState<Record<string, Secim>>({});
  const [tarih, setTarih] = useState(bugun());
  const [aciklama, setAciklama] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(async () => {
    const d = await api<Durum>(`/cari/${cariId}/mahsup`);
    setDurum(d);
    setSecim({});
    const dovizler = [...new Set(d.adaylar.map((a) => a.dovizCinsi))];
    setDoviz((o) => (dovizler.includes(o) || !dovizler.length ? o : dovizler[0]));
  }, [cariId]);
  useEffect(() => { void yukle().catch((e) => onMesaj({ hata: e instanceof Error ? e.message : "Mahsup bilgisi yüklenemedi" })); }, [yukle, onMesaj]);

  const dovizler = useMemo(() => [...new Set([...(durum?.adaylar ?? []).map((a) => a.dovizCinsi), "TRY"])].sort((a, b) => (a === "TRY" ? -1 : b === "TRY" ? 1 : a.localeCompare(b))), [durum]);
  // Mahsup dövizindeki faturalar önce; farklı dövizliler karşılık girilerek eklenebilir.
  const taraf = (t: "satis" | "alis") => (durum?.adaylar ?? []).filter((a) => a.taraf === t)
    .sort((a, b) => Number(a.dovizCinsi !== doviz) - Number(b.dovizCinsi !== doviz) || (a.vadeTarihi ?? a.tarih).localeCompare(b.vadeTarihi ?? b.tarih));
  const karsilikToplam = (t: "satis" | "alis") => taraf(t).reduce((s, a) => {
    const x = secim[a.id];
    if (!x) return s;
    return s + (a.dovizCinsi === doviz ? Number(x.tutar) || 0 : Number(x.karsilik) || 0);
  }, 0);
  const satisToplam = yuvarla(karsilikToplam("satis"));
  const alisToplam = yuvarla(karsilikToplam("alis"));
  const hazir = satisToplam > 0 && satisToplam === alisToplam;

  function vadeyeGoreDoldur() {
    // Yalnız mahsup dövizindeki faturalar; açık tutarın küçüğü kadar, vade sırasıyla.
    const ayni = (t: "satis" | "alis") => taraf(t).filter((a) => a.dovizCinsi === doviz);
    const acikToplam = (l: Aday[]) => l.reduce((s, a) => s + Number(a.acik), 0);
    const tutar = yuvarla(Math.min(acikToplam(ayni("satis")), acikToplam(ayni("alis"))));
    if (tutar <= 0) { onMesaj({ hata: `${doviz} cinsinden iki tarafta da açık fatura yok` }); return; }
    const yeni: Record<string, Secim> = {};
    for (const t of ["satis", "alis"] as const) {
      let kalan = tutar;
      for (const a of ayni(t)) {
        if (kalan <= 0) break;
        const x = yuvarla(Math.min(kalan, Number(a.acik)));
        if (x <= 0) continue;
        yeni[a.id] = { tutar: x.toFixed(2), karsilik: "" };
        kalan = yuvarla(kalan - x);
      }
    }
    setSecim(yeni);
  }

  function degistir(a: Aday, alan: keyof Secim | "secili", deger: string | boolean) {
    setSecim((o) => {
      const y = { ...o };
      if (alan === "secili") {
        if (deger) y[a.id] = { tutar: a.acik !== "0.00" ? a.acik : a.mahsupEdilebilir, karsilik: "" };
        else delete y[a.id];
      } else if (y[a.id]) y[a.id] = { ...y[a.id], [alan]: String(deger) };
      return y;
    });
  }

  async function kaydet() {
    setIsleniyor(true);
    try {
      const satirlar = Object.entries(secim).map(([faturaId, s]) => {
        const a = durum!.adaylar.find((x) => x.id === faturaId)!;
        return { faturaId, tutar: Number(s.tutar).toFixed(2), ...(a.dovizCinsi !== doviz ? { karsilik: Number(s.karsilik).toFixed(2) } : {}) };
      });
      const r = await api<{ mesaj: string }>(`/cari/${cariId}/mahsup`, { method: "POST", body: JSON.stringify({ tarih, dovizCinsi: doviz, aciklama: aciklama.trim() || null, satirlar }) });
      onMesaj({ basari: r.mesaj });
      setAciklama("");
      await yukle();
    } catch (e) {
      onMesaj({ hata: e instanceof Error ? e.message : "Mahsup kaydedilemedi" });
    } finally {
      setIsleniyor(false);
    }
  }

  async function islem(is: () => Promise<{ mesaj: string }>) {
    setIsleniyor(true);
    try { onMesaj({ basari: (await is()).mesaj }); await yukle(); } catch (e) { onMesaj({ hata: e instanceof Error ? e.message : "İşlem başarısız" }); } finally { setIsleniyor(false); }
  }

  if (!durum) return <p className="subtle">Yükleniyor…</p>;

  const liste = (t: "satis" | "alis") => {
    const satirlar = taraf(t);
    return (
      <div className="stack" style={{ gap: "0.4rem", minWidth: 0 }}>
        <h4 style={{ margin: 0, fontSize: "0.95rem" }}>{t === "satis" ? "Satış tarafı (alacaklarımız)" : "Alış tarafı (borçlarımız)"} — {para(t === "satis" ? satisToplam : alisToplam)} {doviz}</h4>
        {satirlar.length ? (
          <TableWrap>
            <table className="table">
              <thead><tr><th /><th>Belge</th><th>Vade</th><th className="num">Açık</th><th className="num">Mahsup</th></tr></thead>
              <tbody>
                {satirlar.map((a) => {
                  const s = secim[a.id];
                  const capraz = a.dovizCinsi !== doviz;
                  return (
                    <tr key={a.id}>
                      <td><input type="checkbox" aria-label={`${a.no ?? "Fatura"} mahsuba ekle`} disabled={!yazabilir} checked={Boolean(s)} onChange={(e) => degistir(a, "secili", e.target.checked)} /></td>
                      <td>{a.no ?? "—"} <small className="muted">{TIP_ADI[a.tip] ?? a.tip}</small></td>
                      <td className="subtle" style={{ whiteSpace: "nowrap" }}>{gun(a.vadeTarihi ?? a.tarih)}</td>
                      <td className="num">{para(a.acik)} {a.dovizCinsi}{a.acik !== a.mahsupEdilebilir && <div className="subtle" style={{ fontSize: "0.75rem" }}>en çok {para(a.mahsupEdilebilir)}</div>}</td>
                      <td className="num" style={{ width: 140 }}>
                        {s ? (
                          <div className="stack" style={{ gap: 4 }}>
                            <Input aria-label={`${a.no ?? "Fatura"} mahsup tutarı`} inputMode="decimal" value={s.tutar} onChange={(e) => degistir(a, "tutar", e.target.value.replace(",", "."))} />
                            {capraz && <Input aria-label={`${a.no ?? "Fatura"} ${doviz} karşılığı`} placeholder={`${doviz} karşılığı`} inputMode="decimal" value={s.karsilik} onChange={(e) => degistir(a, "karsilik", e.target.value.replace(",", "."))} />}
                          </div>
                        ) : <span className="subtle">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : <p className="subtle" style={{ margin: 0 }}>Bu tarafta açık fatura yok.</p>}
      </div>
    );
  };

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
        Aynı carinin satış faturaları (ve size kesilen alış iadeleri) ile alış faturaları (ve satış iadeleri) eşit tutarla birbirine karşı kapatılır.
        Cari bakiyesi değişmez; faturalar ödenmiş sayılır ve vadesi geçen alacaklardan düşer.
      </p>
      <label className="check-row">
        <input type="checkbox" disabled={!yazabilir || isleniyor} checked={durum.otomatikMahsup}
          onChange={(e) => void islem(() => api<{ mesaj: string }>(`/cari/${cariId}/otomatik-mahsup`, { method: "PUT", body: JSON.stringify({ acik: e.target.checked }) }))} />{" "}
        Alış ve satış faturalarını otomatik mahsup et <small className="muted">(ödemelerden sonra kalan açık faturalar vade sırasıyla, aynı dövizde)</small>
      </label>

      {yazabilir && (
        <>
          <div className="row-tight" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="Mahsup dövizi"><Select value={doviz} onChange={(e) => { setDoviz(e.target.value); setSecim({}); }}>{dovizler.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
            <Field label="Mahsup tarihi"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} /></Field>
            <Field label="Açıklama (isteğe bağlı)"><Input maxLength={500} value={aciklama} onChange={(e) => setAciklama(e.target.value)} /></Field>
            <Button onClick={vadeyeGoreDoldur} disabled={isleniyor}>Vadeye göre doldur</Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 520px), 1fr))", gap: "1rem" }}>
            {liste("satis")}
            {liste("alis")}
          </div>
          <div className="row-tight" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <span>Mahsup tutarı: <strong>{para(Math.min(satisToplam, alisToplam))} {doviz}</strong>{!hazir && (satisToplam > 0 || alisToplam > 0) && <span className="subtle"> · iki taraf eşit olmalı ({para(satisToplam)} / {para(alisToplam)})</span>}</span>
            <Button variant="primary" disabled={!hazir || isleniyor} onClick={() => void kaydet()}>{isleniyor ? "Kaydediliyor…" : "Mahsup et"}</Button>
          </div>
        </>
      )}

      <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Mahsup geçmişi</h4>
      {durum.mahsuplar.length ? (
        <TableWrap>
          <table className="table">
            <thead><tr><th>Tarih</th><th className="num">Tutar</th><th>Faturalar</th><th>Durum</th><th /></tr></thead>
            <tbody>
              {durum.mahsuplar.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{gun(m.tarih)}</td>
                  <td className="num">{para(m.tutar)} {m.dovizCinsi}</td>
                  <td style={{ fontSize: "0.85rem" }}>{m.faturalar.map((f) => `${f.no ?? "—"} (${para(f.tutar)} ${f.dovizCinsi})`).join(", ")}{m.aciklama ? <div className="subtle">{m.aciklama}</div> : null}</td>
                  <td>{m.geriAlindi ? <Badge variant="neutral">Geri alındı</Badge> : m.otomatik ? <Badge variant="info">Otomatik</Badge> : <Badge variant="success">Elle{m.olusturan ? ` · ${m.olusturan}` : ""}</Badge>}</td>
                  <td>
                    <div className="row-tight" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <Button size="sm" onClick={() => void apiDosyaIndir(`/cari-mahsuplari/${m.id}/pdf`, `mahsup-${m.tarih}.pdf`)}>PDF</Button>
                      {yazabilir && !m.geriAlindi && <Button size="sm" disabled={isleniyor} onClick={() => void islem(() => api(`/cari-mahsuplari/${m.id}/eposta`, { method: "POST", body: JSON.stringify({}) }))}>E-posta</Button>}
                      {yazabilir && !m.geriAlindi && <Button size="sm" variant="danger" disabled={isleniyor} onClick={() => void islem(() => api(`/cari-mahsuplari/${m.id}/geri-al`, { method: "POST" }))}>Geri al</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : <p className="subtle" style={{ margin: 0 }}>Henüz mahsup yok.</p>}
    </div>
  );
}
