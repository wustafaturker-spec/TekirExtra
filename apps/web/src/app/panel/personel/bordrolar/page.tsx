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

  const yukle = useCallback(async () => {
    try {
      setYukleniyor(true); setHata(null);
      setBordrolar(await api<Bordro[]>(`/personel/bordrolar?yil=${donem.yil}&ay=${donem.ay}`));
    } catch (e) { setHata(e instanceof Error ? e.message : "Bordrolar alınamadı"); }
    finally { setYukleniyor(false); }
  }, [donem.ay, donem.yil]);
  useEffect(() => { void yukle(); }, [yukle]);

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
      <div className="flex gap-2">
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
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {yukleniyor ? <p className="p-10 text-center text-sm text-slate-500">Bordrolar yükleniyor…</p> : bordrolar.length === 0 ? <div className="p-10 text-center"><p className="font-semibold text-slate-800">Bu dönem için bordro yok</p><p className="mt-1 text-sm text-slate-500">Personel listesinden aylık tahakkuk oluşturabilirsiniz.</p></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Personel</th><th className="px-5 py-3">Dönem</th><th className="px-5 py-3">Ödenecek</th><th className="px-5 py-3">Durum</th><th className="px-5 py-3 text-right">İşlem</th></tr></thead><tbody className="divide-y divide-slate-100">{bordrolar.map((b) => <tr key={b.id} className="hover:bg-slate-50/70"><td className="px-5 py-4"><Link href={`/panel/personel/${b.personel.id}`} className="font-semibold text-slate-900 hover:text-orange-700">{b.personel.ad} {b.personel.soyad}</Link><p className="font-mono text-xs text-slate-400">{b.personel.personelNo}</p></td><td className="px-5 py-4">{String(b.donemAy).padStart(2, "0")}/{b.donemYil}</td><td className="px-5 py-4 font-semibold text-slate-900">{para(b.odenecekTutar)}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${durumlar[b.durum].sinif}`}>{durumlar[b.durum].etiket}</span>{b.retNedeni && <p className="mt-1 max-w-52 text-xs text-red-600">{b.retNedeni}</p>}</td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><Link href={`/panel/personel/bordrolar/${b.id}`} className="rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white">İncele</Link>{b.durum === "hesaplandi" && <Eylem disabled={islenen === b.id} onClick={() => void gecis(b, "onaya-gonder")}>Onaya gönder</Eylem>}{b.durum === "onay_bekliyor" && <Eylem disabled={islenen === b.id} onClick={() => void gecis(b, "onayla")}>Onayla</Eylem>}</div></td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}

function Kart({ baslik, deger }: { baslik: string; deger: string }) { return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{baslik}</p><p className="mt-2 text-xl font-bold text-slate-900">{deger}</p></article>; }
function Eylem({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">{children}</button>; }
