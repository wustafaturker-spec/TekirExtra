"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiHata } from "@/lib/api";

type BordroDurum = "hesaplandi" | "onay_bekliyor" | "onaylandi" | "kismen_odendi" | "reddedildi" | "odendi" | "iptal";
interface Bordro {
  id: string;
  donemYil: number;
  donemAy: number;
  odenecekTutar: string;
  durum: BordroDurum;
  retNedeni?: string | null;
  personel: { id: string; personelNo: string; ad: string; soyad: string };
}

const durumlar: Record<BordroDurum, { etiket: string; sinif: string }> = {
  hesaplandi: { etiket: "Hesaplandı", sinif: "bg-blue-100 text-blue-800" },
  onay_bekliyor: { etiket: "Onay bekliyor", sinif: "bg-amber-100 text-amber-800" },
  onaylandi: { etiket: "Onaylandı", sinif: "bg-violet-100 text-violet-800" },
  kismen_odendi: { etiket: "Kısmen ödendi", sinif: "bg-cyan-100 text-cyan-800" },
  reddedildi: { etiket: "Reddedildi", sinif: "bg-red-100 text-red-800" },
  odendi: { etiket: "Ödendi", sinif: "bg-emerald-100 text-emerald-800" },
  iptal: { etiket: "İptal", sinif: "bg-slate-100 text-slate-700" },
};
const para = (deger: number | string) => Number(deger).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

export default function BordroCalismaAlani() {
  const simdi = new Date();
  const [donem, setDonem] = useState({ yil: simdi.getFullYear(), ay: simdi.getMonth() + 1 });
  const [bordrolar, setBordrolar] = useState<Bordro[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [islenen, setIslenen] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  /** PRS-16: seçili bordrolara toplu onaya gönder / onayla / öde. */
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [topluSonuc, setTopluSonuc] = useState<string | null>(null);
  const [odemeFormu, setOdemeFormu] = useState<{ kaynak: string; tarih: string } | null>(null);
  const [hesaplar, setHesaplar] = useState<{ id: string; ad: string; tur: "kasa" | "banka" }[]>([]);

  const yukle = useCallback(async () => {
    try {
      setYukleniyor(true); setHata(null);
      setBordrolar(await api<Bordro[]>(`/personel/bordrolar?yil=${donem.yil}&ay=${donem.ay}`));
    } catch (e) { setHata(e instanceof Error ? e.message : "Bordrolar alınamadı"); }
    finally { setYukleniyor(false); }
  }, [donem.ay, donem.yil]);
  useEffect(() => { void yukle(); setSecili(new Set()); }, [yukle]);

  const toplu = async (islem: "onaya_gonder" | "onayla" | "ode", ek: Record<string, unknown> = {}) => {
    const adlar = { onaya_gonder: "onaya gönderilecek", onayla: "onaylanacak", ode: "kalan tutarı ödenecek" };
    if (!window.confirm(`${secili.size} bordro ${adlar[islem]}. Devam edilsin mi?`)) return;
    try {
      setIslenen("toplu"); setHata(null); setTopluSonuc(null);
      const r = await api<{ islenen: number; atlananlar: { personel: string; mesaj: string }[] }>("/personel/bordrolar/toplu", { method: "POST", body: JSON.stringify({ islem, bordroIdler: [...secili], ...ek }) });
      setTopluSonuc(`${r.islenen} bordro işlendi.${r.atlananlar.length ? ` İşlenmeyen: ${r.atlananlar.map((a) => `${a.personel} (${a.mesaj})`).join("; ")}` : ""}`);
      setSecili(new Set()); setOdemeFormu(null); await yukle();
    } catch (e) { setHata(e instanceof ApiHata ? e.message : "Toplu işlem yapılamadı"); }
    finally { setIslenen(null); }
  };
  const odemeAc = async () => {
    try {
      const [k, b] = await Promise.all([api<{ id: string; ad: string; aktif: boolean; dovizCinsi: string }[]>("/kasa-banka/kasalar"), api<{ id: string; ad: string; aktif: boolean; dovizCinsi: string }[]>("/kasa-banka/bankalar")]);
      setHesaplar([...k.filter((h) => h.aktif && h.dovizCinsi === "TRY").map((h) => ({ id: h.id, ad: h.ad, tur: "kasa" as const })), ...b.filter((h) => h.aktif && h.dovizCinsi === "TRY").map((h) => ({ id: h.id, ad: h.ad, tur: "banka" as const }))]);
      setOdemeFormu({ kaynak: "", tarih: new Date().toISOString().slice(0, 10) });
    } catch (e) { setHata(e instanceof Error ? e.message : "Hesaplar alınamadı"); }
  };

  const ozet = useMemo(() => ({
    toplam: bordrolar.reduce((t, b) => t + Number(b.odenecekTutar), 0),
    bekleyen: bordrolar.filter((b) => b.durum === "onay_bekliyor").length,
    onayli: bordrolar.filter((b) => b.durum === "onaylandi").reduce((t, b) => t + Number(b.odenecekTutar), 0),
    odenen: bordrolar.filter((b) => b.durum === "odendi").reduce((t, b) => t + Number(b.odenecekTutar), 0),
  }), [bordrolar]);

  const gecis = async (bordro: Bordro, eylem: "onaya-gonder" | "onayla") => {
    try {
      setIslenen(bordro.id); setHata(null);
      await api(`/personel/bordrolar/${bordro.id}/${eylem}`, { method: "POST" });
      await yukle();
    } catch (e) { setHata(e instanceof ApiHata ? e.message : "Bordro işlemi tamamlanamadı"); }
    finally { setIslenen(null); }
  };

  return <main className="hr-subpage hr-subpage--payroll">
    <div><Link href="/panel/personel" className="text-sm font-medium text-slate-500 hover:text-orange-700">← Personel listesine dön</Link></div>
    <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">İnsan Kaynakları</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Bordro çalışma alanı</h1><p className="mt-1 text-sm text-slate-500">Tahakkukları kontrol edin, onaya gönderin ve görev ayrılığıyla yönetin.</p></div>
      <div className="flex gap-2 items-end">
        <button
          type="button"
          onClick={async () => {
            try {
              const res = await api<{ dosyaAdi: string; dosyaIcerigi: string }>(`/personel/bordrolar/banka-dosyasi?yil=${donem.yil}&ay=${donem.ay}`);
              const blob = new Blob([res.dosyaIcerigi], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.setAttribute("download", res.dosyaAdi);
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            } catch (err) {
              alert(err instanceof Error ? err.message : "Banka maaş dosyası indirilemedi. Onaylanmış bordro bulunduğundan emin olun.");
            }
          }}
          className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
        >
          🏦 Banka Maaş Havale Dosyası (.CSV)
        </button>
        <button
          type="button"
          onClick={async () => {
            // PRS-10: dönemin onaylı bordrolarının ücret hesap pusulaları personele e-postayla.
            if (!window.confirm(`${donem.ay}/${donem.yil} onaylı bordrolarının pusulaları personelin kart e-postasına gönderilecek. Devam edilsin mi?`)) return;
            try {
              const res = await api<{ gonderilen: number; atlananlar: { personel: string; mesaj: string }[] }>("/personel/pusulalar/toplu-eposta", { method: "POST", body: JSON.stringify({ yil: donem.yil, ay: donem.ay }) });
              alert(`${res.gonderilen} pusula gönderildi.${res.atlananlar.length ? `\nGönderilmeyen:\n${res.atlananlar.map((a) => `• ${a.personel}: ${a.mesaj}`).join("\n")}` : ""}`);
            } catch (err) {
              alert(err instanceof Error ? err.message : "Pusulalar gönderilemedi");
            }
          }}
          className="rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          ✉️ Pusulaları e-postala
        </button>
        <label className="text-xs font-semibold text-slate-500">Yıl<input type="number" min={2020} max={2100} value={donem.yil} onChange={(e) => setDonem({ ...donem, yil: Number(e.target.value) })} className="mt-1 block w-28 rounded-lg border bg-white px-3 py-2 text-sm text-slate-900" /></label>
        <label className="text-xs font-semibold text-slate-500">Ay<select value={donem.ay} onChange={(e) => setDonem({ ...donem, ay: Number(e.target.value) })} className="mt-1 block rounded-lg border bg-white px-3 py-2 text-sm text-slate-900">{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Intl.DateTimeFormat("tr-TR", { month: "long" }).format(new Date(2026, i, 1))}</option>)}</select></label>
      </div>
    </header>
    {hata && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{hata}</div>}
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Kart baslik="Dönem toplamı" deger={para(ozet.toplam)} />
      <Kart baslik="Onay bekleyen" deger={String(ozet.bekleyen)} />
      <Kart baslik="Ödemeye hazır" deger={para(ozet.onayli)} />
      <Kart baslik="Ödenen" deger={para(ozet.odenen)} />
    </section>
    {topluSonuc && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{topluSonuc}</div>}
    {secili.size > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white px-4 py-3 text-sm shadow-sm"><strong>{secili.size} bordro seçili</strong><Eylem disabled={islenen === "toplu"} onClick={() => void toplu("onaya_gonder")}>Onaya gönder</Eylem><Eylem disabled={islenen === "toplu"} onClick={() => void toplu("onayla")}>Onayla</Eylem><Eylem disabled={islenen === "toplu"} onClick={() => void odemeAc()}>Öde</Eylem><button type="button" onClick={() => setSecili(new Set())} className="text-xs font-semibold text-slate-500">Seçimi temizle</button>
      {odemeFormu && <form className="flex w-full flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const [tur, id] = odemeFormu.kaynak.split(":"); void toplu("ode", { [tur === "kasa" ? "kasaId" : "bankaHesapId"]: id, odemeTarihi: odemeFormu.tarih }); }}><label className="text-xs font-semibold text-slate-500">Ödeme hesabı<select required value={odemeFormu.kaynak} onChange={(e) => setOdemeFormu({ ...odemeFormu, kaynak: e.target.value })} className="mt-1 block rounded-lg border px-3 py-2 text-sm"><option value="">Seçin</option>{hesaplar.map((h) => <option key={h.id} value={`${h.tur}:${h.id}`}>{h.tur === "kasa" ? "Kasa" : "Banka"} · {h.ad}</option>)}</select></label><label className="text-xs font-semibold text-slate-500">Ödeme tarihi<input required type="date" value={odemeFormu.tarih} onChange={(e) => setOdemeFormu({ ...odemeFormu, tarih: e.target.value })} className="mt-1 block rounded-lg border px-3 py-2 text-sm" /></label><Eylem disabled={islenen === "toplu"}>Kalan tutarları öde</Eylem></form>}
    </div>}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {yukleniyor ? <p className="p-10 text-center text-sm text-slate-500">Bordrolar yükleniyor…</p> : bordrolar.length === 0 ? <div className="p-10 text-center"><p className="font-semibold text-slate-800">Bu dönem için bordro yok</p><p className="mt-1 text-sm text-slate-500">Personel listesinden aylık tahakkuk oluşturabilirsiniz.</p></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3"><input type="checkbox" aria-label="Tümünü seç" checked={bordrolar.length > 0 && bordrolar.every((b) => secili.has(b.id))} onChange={(e) => setSecili(new Set(e.target.checked ? bordrolar.map((b) => b.id) : []))} /></th><th className="px-5 py-3">Personel</th><th className="px-5 py-3">Dönem</th><th className="px-5 py-3">Ödenecek</th><th className="px-5 py-3">Durum</th><th className="px-5 py-3 text-right">İşlem</th></tr></thead><tbody className="divide-y divide-slate-100">{bordrolar.map((b) => <tr key={b.id} className="hover:bg-slate-50/70"><td className="px-5 py-4"><input type="checkbox" aria-label={`${b.personel.ad} ${b.personel.soyad} seç`} checked={secili.has(b.id)} onChange={(e) => { const y = new Set(secili); if (e.target.checked) y.add(b.id); else y.delete(b.id); setSecili(y); }} /></td><td className="px-5 py-4"><Link href={`/panel/personel/${b.personel.id}`} className="font-semibold text-slate-900 hover:text-orange-700">{b.personel.ad} {b.personel.soyad}</Link><p className="font-mono text-xs text-slate-400">{b.personel.personelNo}</p></td><td className="px-5 py-4">{String(b.donemAy).padStart(2, "0")}/{b.donemYil}</td><td className="px-5 py-4 font-semibold text-slate-900">{para(b.odenecekTutar)}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${durumlar[b.durum].sinif}`}>{durumlar[b.durum].etiket}</span>{b.retNedeni && <p className="mt-1 max-w-52 text-xs text-red-600">{b.retNedeni}</p>}</td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><Link href={`/panel/personel/bordrolar/${b.id}`} className="rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white">İncele</Link>{b.durum === "hesaplandi" && <Eylem disabled={islenen === b.id} onClick={() => void gecis(b, "onaya-gonder")}>Onaya gönder</Eylem>}{b.durum === "onay_bekliyor" && <Eylem disabled={islenen === b.id} onClick={() => void gecis(b, "onayla")}>Onayla</Eylem>}</div></td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}

function Kart({ baslik, deger }: { baslik: string; deger: string }) { return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{baslik}</p><p className="mt-2 text-xl font-bold text-slate-900">{deger}</p></article>; }
function Eylem({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">{children}</button>; }
