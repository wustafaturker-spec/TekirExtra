"use client";

import { useCallback, useEffect, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";

type Tur = "teminat_mektubu" | "ipotek" | "dbs" | "nakit" | "kefalet" | "diger";
type Durum = "gecerli" | "baslamadi" | "suresi_doldu" | "iade_edildi";

interface Teminat {
  id: string;
  tur: Tur;
  turAdi: string;
  tutar: string;
  dovizCinsi: string;
  tutarTry: string | null;
  banka: string | null;
  belgeNo: string | null;
  aciklama: string | null;
  baslangicTarihi: string | null;
  bitisTarihi: string | null;
  iadeTarihi: string | null;
  durum: Durum;
  kalanGun: number | null;
  yaklasiyor: boolean;
}

const TURLER: [Tur, string, string, string][] = [
  // tür, ad, banka alanı etiketi, belge no etiketi
  ["teminat_mektubu", "Teminat mektubu", "Banka", "Mektup no"],
  ["ipotek", "İpotek", "Lehine / tapu müdürlüğü", "Tapu bilgisi (ada/parsel, derece)"],
  ["dbs", "DBS limiti", "Banka", "DBS sözleşme no"],
  ["nakit", "Nakit teminat", "Yatırıldığı hesap", "Dekont no"],
  ["kefalet", "Kefalet", "Kefil", "Kefaletname no"],
  ["diger", "Diğer", "Veren", "Belge no"],
];
const DURUM: Record<Durum, { ad: string; variant: "success" | "neutral" | "danger" | "info" }> = {
  gecerli: { ad: "Geçerli", variant: "success" },
  baslamadi: { ad: "Başlamadı", variant: "info" },
  suresi_doldu: { ad: "Süresi doldu", variant: "danger" },
  iade_edildi: { ad: "İade edildi", variant: "neutral" },
};
const BOS = { tur: "teminat_mektubu" as Tur, tutar: "", dovizCinsi: "TRY", banka: "", belgeNo: "", baslangicTarihi: bugunTR(), bitisTarihi: "", aciklama: "" };
const para = (t: string | number, d = "TRY") => `${Number(t).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${d === "TRY" ? "TL" : d}`;
const gun = (t: string) => t.split("-").reverse().join(".");

/**
 * CARI-39: carinin aldığımız teminatları. Geçerli olanlar (iade edilmemiş,
 * başlamış, süresi dolmamış) güncel kurla risk limitine eklenir.
 */
export function TeminatlarPaneli({ cariId, onDegisti, onMesaj }: {
  cariId: string;
  onDegisti: () => void;
  onMesaj: (m: { hata?: string; basari?: string }) => void;
}) {
  const [veri, setVeri] = useState<{ satirlar: Teminat[]; gecerliToplamTry: string } | null>(null);
  const [form, setForm] = useState<typeof BOS | null>(null);
  const [duzenlenen, setDuzenlenen] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  const yukle = useCallback(async () => {
    try { setVeri(await api(`/cari/${cariId}/teminatlar`)); }
    catch (h) { onMesaj({ hata: h instanceof Error ? h.message : "Teminatlar yüklenemedi" }); }
  }, [cariId, onMesaj]);
  useEffect(() => { void yukle(); }, [yukle]);

  async function islem(fn: () => Promise<unknown>, basari: string) {
    setIslemde(true);
    try { await fn(); onMesaj({ basari }); await yukle(); onDegisti(); return true; }
    catch (h) { onMesaj({ hata: h instanceof Error ? h.message : "İşlem başarısız" }); return false; }
    finally { setIslemde(false); }
  }

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const govde = JSON.stringify({ ...form, tutar: form.tutar.replace(",", "."), baslangicTarihi: form.baslangicTarihi || null, bitisTarihi: form.bitisTarihi || null });
    const tamam = await islem(
      () => api(duzenlenen ? `/cari/${cariId}/teminatlar/${duzenlenen}` : `/cari/${cariId}/teminatlar`, { method: duzenlenen ? "PATCH" : "POST", body: govde }),
      duzenlenen ? "Teminat güncellendi." : "Teminat eklendi; geçerliyse risk limitine eklendi.",
    );
    if (tamam) { setForm(null); setDuzenlenen(null); }
  }

  function duzenle(t: Teminat) {
    setDuzenlenen(t.id);
    setForm({ tur: t.tur, tutar: t.tutar, dovizCinsi: t.dovizCinsi, banka: t.banka ?? "", belgeNo: t.belgeNo ?? "", baslangicTarihi: t.baslangicTarihi ?? "", bitisTarihi: t.bitisTarihi ?? "", aciklama: t.aciklama ?? "" });
  }

  const turBilgisi = TURLER.find(([t]) => t === form?.tur) ?? TURLER[0];

  return (
    <div className="cari-teminat">
      <div className="cari-teminat__bas">
        <span>Geçerli teminat toplamı <strong>{veri ? para(veri.gecerliToplamTry) : "…"}</strong> <small className="muted">(güncel kurla; risk limitine eklenir)</small></span>
        {!form && <Button size="sm" onClick={() => { setDuzenlenen(null); setForm({ ...BOS }); }}>+ Teminat ekle</Button>}
      </div>

      {form && (
        <form className="cari-kart-form" onSubmit={kaydet}>
          <Field label="Tür"><Select value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value as Tur })}>{TURLER.map(([t, ad]) => <option key={t} value={t}>{ad}</option>)}</Select></Field>
          <Field label="Tutar"><Input required inputMode="decimal" value={form.tutar} onChange={(e) => setForm({ ...form, tutar: e.target.value })} /></Field>
          <Field label="Döviz"><Select value={form.dovizCinsi} onChange={(e) => setForm({ ...form, dovizCinsi: e.target.value })}><DovizSecenekleri /></Select></Field>
          <Field label={turBilgisi[2]}><Input maxLength={200} value={form.banka} onChange={(e) => setForm({ ...form, banka: e.target.value })} /></Field>
          <Field label={turBilgisi[3]}><Input maxLength={200} value={form.belgeNo} onChange={(e) => setForm({ ...form, belgeNo: e.target.value })} /></Field>
          <Field label="Başlangıç"><Input type="date" value={form.baslangicTarihi} onChange={(e) => setForm({ ...form, baslangicTarihi: e.target.value })} /></Field>
          <Field label="Bitiş (boşsa süresiz)"><Input type="date" value={form.bitisTarihi} min={form.baslangicTarihi || undefined} onChange={(e) => setForm({ ...form, bitisTarihi: e.target.value })} /></Field>
          <Field label="Açıklama"><Input maxLength={1000} value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} /></Field>
          <div className="cari-kart-form__alt">
            <Button type="button" size="sm" onClick={() => { setForm(null); setDuzenlenen(null); }}>Vazgeç</Button>
            <Button type="submit" size="sm" variant="primary" disabled={islemde}>{duzenlenen ? "Güncelle" : "Kaydet"}</Button>
          </div>
        </form>
      )}

      {veri && veri.satirlar.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Tür</th><th>Veren / belge</th><th className="num">Tutar</th><th>Geçerlilik</th><th>Durum</th><th /></tr></thead>
            <tbody>
              {veri.satirlar.map((t) => (
                <tr key={t.id}>
                  <td>{t.turAdi}{t.aciklama && <div className="subtle">{t.aciklama}</div>}</td>
                  <td>{t.banka ?? "—"}{t.belgeNo && <div className="subtle">{t.belgeNo}</div>}</td>
                  <td className="num">{para(t.tutar, t.dovizCinsi)}{t.dovizCinsi !== "TRY" && <div className="subtle">{t.tutarTry ? `≈ ${para(t.tutarTry)}` : "güncel kur yok"}</div>}</td>
                  <td>{t.baslangicTarihi ? gun(t.baslangicTarihi) : "—"} → {t.bitisTarihi ? gun(t.bitisTarihi) : "süresiz"}{t.iadeTarihi && <div className="subtle">İade: {gun(t.iadeTarihi)}</div>}</td>
                  <td>
                    <Badge variant={DURUM[t.durum].variant}>{DURUM[t.durum].ad}</Badge>
                    {t.yaklasiyor && <div><Badge variant="info">{t.kalanGun === 0 ? "bugün bitiyor" : `${t.kalanGun} gün kaldı`}</Badge></div>}
                  </td>
                  <td className="cari-teminat__eylem">
                    {t.durum !== "iade_edildi" && <Button size="sm" disabled={islemde} onClick={() => duzenle(t)}>Düzenle</Button>}
                    {t.durum !== "iade_edildi" && <Button size="sm" disabled={islemde} onClick={() => { const tarih = window.prompt("İade tarihi (YYYY-AA-GG)", bugunTR()); if (tarih) void islem(() => api(`/cari/${cariId}/teminatlar/${t.id}/iade`, { method: "POST", body: JSON.stringify({ iadeTarihi: tarih }) }), "Teminat iade edildi; artık riske eklenmiyor."); }}>İade et</Button>}
                    <Button size="sm" variant="danger" disabled={islemde} onClick={() => { if (window.confirm("Yanlış girilen teminat kaydı silinsin mi? (İade için 'İade et' kullanın.)")) void islem(() => api(`/cari/${cariId}/teminatlar/${t.id}`, { method: "DELETE" }), "Teminat kaydı silindi."); }}>Sil</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : veri && !form && <p className="subtle">Teminat kaydı yok.</p>}
    </div>
  );
}
