"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { BelgeDosyalari } from "@/components/belge-dosyalari";

interface PersonelBelgesi {
  id: string; ekId: string; tur: string; aciklama?: string | null; belgeTarihi?: string | null;
  gecerlilikTarihi?: string | null; createdAt: string;
  ek: { dosyaAdi: string; mimeTip: string; boyut: number };
}

const TUR_ADLARI: Record<string, string> = {
  kimlik: "Kimlik", is_sozlesmesi: "İş sözleşmesi", diploma: "Diploma", sertifika: "Sertifika",
  saglik_raporu: "Sağlık raporu", adli_sicil: "Adli sicil", ikametgah: "İkametgâh",
  askerlik: "Askerlik belgesi", sgk_bildirgesi: "SGK bildirgesi", diger: "Diğer",
};
const gun = (v?: string | null) => v ? new Date(v).toLocaleDateString("tr-TR", { timeZone: "UTC" }) : "—";

export function PersonelBelgeleri({ personelId }: { personelId: string }) {
  const [belgeler, setBelgeler] = useState<PersonelBelgesi[]>([]);
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [form, setForm] = useState({ tur: "is_sozlesmesi", aciklama: "", belgeTarihi: "", gecerlilikTarihi: "" });
  const [islemde, setIslemde] = useState(false); const [hata, setHata] = useState("");
  const yukle = useCallback(async () => { try { setBelgeler(await api<PersonelBelgesi[]>(`/personel/${personelId}/belgeler`)); } catch (e) { setHata(e instanceof Error ? e.message : "Belgeler alınamadı"); } }, [personelId]);
  useEffect(() => { void yukle(); }, [yukle]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault(); if (!dosyalar[0]) return;
    setIslemde(true); setHata("");
    try {
      const govde = new FormData(); govde.append("dosya", dosyalar[0]);
      Object.entries(form).forEach(([k, v]) => { if (v) govde.append(k, v); });
      await api(`/personel/${personelId}/belgeler`, { method: "POST", body: govde });
      setDosyalar([]); setForm({ ...form, aciklama: "", belgeTarihi: "", gecerlilikTarihi: "" }); await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Belge yüklenemedi"); } finally { setIslemde(false); }
  }
  async function sil(b: PersonelBelgesi) {
    if (!confirm(`${b.ek.dosyaAdi} silinsin mi?`)) return;
    try { await api(`/personel/${personelId}/belgeler/${b.id}`, { method: "DELETE" }); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Belge silinemedi"); }
  }

  return <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-6 py-5"><h2 className="font-bold text-slate-900">Özlük belgeleri</h2><p className="mt-1 text-sm text-slate-500">Personel evraklarını sınıflandırın ve süre sonlarını izleyin.</p></div>
    {hata && <div role="alert" className="m-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{hata}</div>}
    <form onSubmit={kaydet} className="grid gap-4 border-b bg-slate-50/60 p-5 lg:grid-cols-4">
      <label className="text-xs font-semibold text-slate-600">Belge türü<select value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm">{Object.entries(TUR_ADLARI).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Belge tarihi<input type="date" value={form.belgeTarihi} onChange={(e) => setForm({ ...form, belgeTarihi: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
      <label className="text-xs font-semibold text-slate-600">Geçerlilik sonu<input type="date" value={form.gecerlilikTarihi} min={form.belgeTarihi || undefined} onChange={(e) => setForm({ ...form, gecerlilikTarihi: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
      <label className="text-xs font-semibold text-slate-600">Açıklama<input maxLength={500} value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></label>
      <div className="lg:col-span-4"><BelgeDosyalari dosyalar={dosyalar} onChange={(d) => setDosyalar(d.slice(0, 1))} /><button disabled={!dosyalar.length || islemde} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{islemde ? "Yükleniyor…" : "Belgeyi özlük dosyasına ekle"}</button></div>
    </form>
    <div className="divide-y">{belgeler.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Henüz özlük belgesi eklenmemiş.</p> : belgeler.map((b) => { const kalan = b.gecerlilikTarihi ? Math.ceil((new Date(b.gecerlilikTarihi).getTime() - Date.now()) / 86400000) : null; return <article key={b.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between"><div><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-900">{b.ek.dosyaAdi}</strong><span className="rounded-full bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700">{TUR_ADLARI[b.tur]}</span>{kalan !== null && kalan <= 30 && <span className={`rounded-full px-2 py-1 text-xs font-semibold ${kalan < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{kalan < 0 ? "Süresi doldu" : `${kalan} gün kaldı`}</span>}</div><p className="mt-1 text-xs text-slate-500">Belge: {gun(b.belgeTarihi)} · Geçerlilik: {gun(b.gecerlilikTarihi)} · {(b.ek.boyut / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB</p>{b.aciklama && <p className="mt-1 text-sm text-slate-600">{b.aciklama}</p>}</div><div className="flex gap-2"><button onClick={() => void apiDosyaIndir(`/ekler/${b.ekId}/indir`, b.ek.dosyaAdi)} className="rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700">İndir</button><button onClick={() => void sil(b)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700">Sil</button></div></article>; })}</div>
  </section>;
}
