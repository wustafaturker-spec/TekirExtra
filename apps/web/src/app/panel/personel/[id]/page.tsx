"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { PersonelBelgeleri } from "@/components/personel-belgeleri";
import { bugunTR } from "@tekirextra/shared";

interface Bordro {
  id: string;
  donemYil: number;
  donemAy: number;
  odenecekTutar: string;
  odendi: boolean;
  odemeTarihi?: string | null;
}

interface Avans {
  id: string;
  tutar: string;
  tarih: string;
  aciklama?: string | null;
  odendi: boolean;
}

interface UcretKaydi { id: string; yururlukTarihi: string; tip: "net" | "brut"; tutar: string; neden?: string | null }

interface PersonelDetay {
  id: string;
  personelNo: string;
  ad: string;
  soyad: string;
  tckn?: string | null;
  eposta?: string | null;
  telefon?: string | null;
  departman?: string | null;
  unvan?: string | null;
  calismaTipi: string;
  girisTarihi: string;
  cikisTarihi?: string | null;
  ayrilisNedeni?: string | null;
  netMaas: string;
  brutMaas?: string | null;
  sgkTesvikOrani?: string;
  engellilikDerecesi?: number | null;
  dogumTarihi?: string | null;
  iban?: string | null;
  durum: "taslak" | "aktif" | "askida" | "uzun_sureli_izin" | "isten_ayrildi";
  cari?: { id: string; kod: string; unvan: string } | null;
  bordrolar: Bordro[];
  avanslar: Avans[];
  ucretler: UcretKaydi[];
}

const para = (deger: string) => Number(deger).toLocaleString("tr-TR", {
  style: "currency", currency: "TRY", minimumFractionDigits: 2,
});
const tarih = (deger?: string | null) => deger
  ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(deger))
  : "—";
const bugun = () => bugunTR();

export default function PersonelDetaySayfasi() {
  const { id } = useParams<{ id: string }>();
  const [personel, setPersonel] = useState<PersonelDetay | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [ayrilisAcik, setAyrilisAcik] = useState(false);
  const [yenidenAcik, setYenidenAcik] = useState(false);
  const [hassas, setHassas] = useState<{ tckn: string | null; iban: string | null } | null>(null);
  const [ayrilis, setAyrilis] = useState({ cikisTarihi: bugun(), ayrilisNedeni: "" });
  const [yeniGirisTarihi, setYeniGirisTarihi] = useState(bugun());
  const [duzenleme, setDuzenleme] = useState<DuzenlemeFormu | null>(null);
  /** PRS-06: yürürlük tarihli ücret değişikliği. */
  const [ucretFormu, setUcretFormu] = useState<{ yururlukTarihi: string; tip: "net" | "brut"; tutar: string; neden: string } | null>(null);

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      setPersonel(await api<PersonelDetay>(`/personel/${id}`));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Personel bilgileri alınamadı");
    } finally {
      setYukleniyor(false);
    }
  }, [id]);

  useEffect(() => { void yukle(); }, [yukle]);

  const istenCikar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsleniyor(true); setHata(null);
      await api(`/personel/${id}/isten-cikar`, { method: "POST", body: JSON.stringify(ayrilis) });
      setAyrilisAcik(false);
      await yukle();
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "İşten çıkış kaydedilemedi");
    } finally { setIsleniyor(false); }
  };

  const yenidenBaslat = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsleniyor(true); setHata(null);
      await api(`/personel/${id}/yeniden-baslat`, {
        method: "POST", body: JSON.stringify({ girisTarihi: yeniGirisTarihi }),
      });
      setYenidenAcik(false);
      await yukle();
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Personel yeniden başlatılamadı");
    } finally { setIsleniyor(false); }
  };

  /** P0-6: kart düzenleme. TCKN/IBAN maskeli geldiği için boş bırakılırsa değişmez. */
  const duzenlemeAc = () => {
    if (!personel) return;
    setDuzenleme({
      ad: personel.ad, soyad: personel.soyad, eposta: personel.eposta ?? "", telefon: personel.telefon ?? "",
      calismaTipi: personel.calismaTipi, girisTarihi: personel.girisTarihi.slice(0, 10),
      engellilikDerecesi: personel.engellilikDerecesi ? String(personel.engellilikDerecesi) : "",
      dogumTarihi: personel.dogumTarihi?.slice(0, 10) ?? "",
      sgkTesvikOrani: String(Number(personel.sgkTesvikOrani ?? 0)), tckn: "", iban: "", ibanKaldir: false,
    });
  };

  const duzenlemeKaydet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!duzenleme) return;
    try {
      setIsleniyor(true); setHata(null);
      const sayi = (v: string) => Number(v.replace(",", "."));
      await api(`/personel/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          ad: duzenleme.ad, soyad: duzenleme.soyad, eposta: duzenleme.eposta.trim() || null, telefon: duzenleme.telefon.trim() || null,
          calismaTipi: duzenleme.calismaTipi, girisTarihi: duzenleme.girisTarihi,
          engellilikDerecesi: duzenleme.engellilikDerecesi ? Number(duzenleme.engellilikDerecesi) : null,
          dogumTarihi: duzenleme.dogumTarihi || null,
          sgkTesvikOrani: sayi(duzenleme.sgkTesvikOrani || "0"),
          ...(duzenleme.tckn.trim() && { tckn: duzenleme.tckn.trim() }),
          ...(duzenleme.ibanKaldir ? { iban: null } : duzenleme.iban.trim() ? { iban: duzenleme.iban } : {}),
        }),
      });
      setDuzenleme(null); setHassas(null);
      await yukle();
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Personel bilgileri kaydedilemedi");
    } finally { setIsleniyor(false); }
  };

  /** PRS-04: carisi olmayan personel ödenemez; cari açılınca onaylı bordroların eksik tahakkuku yazılır. */
  const cariBagla = async () => {
    if (!window.confirm("Personele yeni bir cari hesap açılacak; onaylı bordroların eksik tahakkukları dönem sonu tarihiyle cariye yazılacak. Devam edilsin mi?")) return;
    try {
      setIsleniyor(true); setHata(null);
      await api(`/personel/${id}/cari-bagla`, { method: "POST", body: "{}" });
      await yukle();
    } catch (e) { setHata(e instanceof ApiHata ? e.message : "Cari bağlanamadı"); }
    finally { setIsleniyor(false); }
  };

  const ucretKaydet = async (e: React.FormEvent) => {
    e.preventDefault(); if (!ucretFormu) return;
    try {
      setIsleniyor(true); setHata(null);
      await api(`/personel/${id}/ucretler`, { method: "POST", body: JSON.stringify({ ...ucretFormu, tutar: Number(ucretFormu.tutar.replace(",", ".")), neden: ucretFormu.neden.trim() || null }) });
      setUcretFormu(null); await yukle();
    } catch (e) { setHata(e instanceof ApiHata ? e.message : "Ücret kaydedilemedi"); }
    finally { setIsleniyor(false); }
  };
  const ucretSil = async (u: UcretKaydi) => {
    if (!window.confirm(`${tarih(u.yururlukTarihi)} tarihli ücret kaydı silinsin mi?`)) return;
    try { setHata(null); await api(`/personel/${id}/ucretler/${u.id}`, { method: "DELETE" }); await yukle(); }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "Ücret kaydı silinemedi"); }
  };

  const hassasGoster = async () => {
    try { setHata(null); setHassas(await api(`/personel/${id}/hassas-veriler`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Hassas bilgiler görüntülenemedi"); }
  };

  if (yukleniyor) return <div className="mx-auto max-w-7xl p-6 text-sm text-slate-500">Personel bilgileri yükleniyor…</div>;

  return (
    <main className="hr-subpage hr-subpage--profile">
      <Link href="/panel/personel" className="inline-flex text-sm font-medium text-slate-500 hover:text-orange-700">← Personel listesine dön</Link>

      {hata && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{hata}</div>}

      {!personel ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">Personel kaydı görüntülenemedi.</section>
      ) : <>
        <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="h-2 bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-400" />
          <div className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-orange-100 text-xl font-bold text-orange-700" aria-hidden="true">
                {personel.ad.slice(0, 1)}{personel.soyad.slice(0, 1)}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-slate-900">{personel.ad} {personel.soyad}</h1>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${personel.durum === "aktif" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                    {personel.durum === "isten_ayrildi" ? "İşten ayrıldı" : "Aktif"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{personel.personelNo} · {personel.departman || "Departman belirtilmedi"} · {personel.unvan || "Unvan belirtilmedi"}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={duzenlemeAc} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Düzenle</button>
              {personel.durum === "isten_ayrildi" ? (
                <button onClick={() => setYenidenAcik(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Yeniden işe başlat</button>
              ) : (
                <button onClick={() => setAyrilisAcik(true)} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">İşten çıkış işlemi</button>
              )}
            </div>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {personel.brutMaas ? <OzetKart baslik="Brüt ücret" deger={para(personel.brutMaas)} alt="Brüt anlaşılan aylık ücret" /> : <OzetKart baslik="Net ücret" deger={para(personel.netMaas)} alt="Net anlaşılan; mevzuat seti varsa her ay brüte çevrilir" />}
          {Number(personel.sgkTesvikOrani) > 0 && <OzetKart baslik="SGK teşviki" deger={`%${Number(personel.sgkTesvikOrani).toLocaleString("tr-TR")}`} alt="Mevzuat azamisiyle sınırlandırılır" />}
          <OzetKart baslik="İşe giriş" deger={tarih(personel.girisTarihi)} alt={personel.calismaTipi.replaceAll("_", " ")} />
          <OzetKart baslik="Bordrolar" deger={String(personel.bordrolar.length)} alt={`${personel.bordrolar.filter((b) => !b.odendi).length} açık ödeme`} />
          <OzetKart baslik="Avans toplamı" deger={para(String(personel.avanslar.reduce((t, a) => t + Number(a.tutar), 0)))} alt={`${personel.avanslar.length} işlem`} />
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900">Özlük ve iletişim</h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <Bilgi baslik="E-posta" deger={personel.eposta || "—"} />
              <Bilgi baslik="Telefon" deger={personel.telefon || "—"} />
              <Bilgi baslik="TCKN" deger={hassas?.tckn || personel.tckn || "—"} />
              <Bilgi baslik="IBAN" deger={hassas?.iban || personel.iban || "—"} />
              <div><Bilgi baslik="Cari hesap" deger={personel.cari?.kod || "Bağlı değil — maaş ve avans ödenemez"} />{!personel.cari && <button type="button" disabled={isleniyor} onClick={() => void cariBagla()} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Cari aç ve bağla</button>}</div>
              <Bilgi baslik="Çıkış tarihi" deger={tarih(personel.cikisTarihi)} />
            </dl>
            <div className="mt-5 flex items-center gap-3 border-t pt-4"><button type="button" onClick={() => hassas ? setHassas(null) : void hassasGoster()} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{hassas ? "Hassas bilgileri gizle" : "Hassas bilgileri görüntüle"}</button><span className="text-xs text-slate-400">Görüntüleme işlemi denetim kaydına yazılır.</span></div>
            {personel.ayrilisNedeni && <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><strong>Ayrılış nedeni:</strong> {personel.ayrilisNedeni}</div>}
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-5"><h2 className="text-base font-bold text-slate-900">Son bordrolar</h2></div>
            {personel.bordrolar.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Henüz bordro tahakkuku bulunmuyor.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3">Dönem</th><th className="px-6 py-3">Tutar</th><th className="px-6 py-3">Durum</th><th className="px-6 py-3">Ödeme</th></tr></thead><tbody className="divide-y divide-slate-100">{personel.bordrolar.slice(0, 12).map((b) => <tr key={b.id}><td className="px-6 py-4 font-medium text-slate-900">{String(b.donemAy).padStart(2, "0")}/{b.donemYil}</td><td className="px-6 py-4">{para(b.odenecekTutar)}</td><td className="px-6 py-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${b.odendi ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{b.odendi ? "Ödendi" : "Ödeme bekliyor"}</span></td><td className="px-6 py-4 text-slate-500">{tarih(b.odemeTarihi)}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </div>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><h2 className="text-base font-bold text-slate-900">Ücret geçmişi</h2><button type="button" onClick={() => setUcretFormu({ yururlukTarihi: bugun(), tip: personel.brutMaas ? "brut" : "net", tutar: "", neden: "" })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Ücret değiştir</button></div>
          {(personel.ucretler ?? []).length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Ücret kaydı yok.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3">Yürürlük</th><th className="px-6 py-3">Tip</th><th className="px-6 py-3">Tutar</th><th className="px-6 py-3">Neden</th><th className="px-6 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{personel.ucretler.map((u) => <tr key={u.id}><td className="px-6 py-4 font-medium text-slate-900">{tarih(u.yururlukTarihi)}</td><td className="px-6 py-4">{u.tip === "net" ? "Net" : "Brüt"}</td><td className="px-6 py-4">{para(u.tutar)}</td><td className="px-6 py-4 text-slate-500">{u.neden || "—"}</td><td className="px-6 py-4 text-right">{personel.ucretler.length > 1 && <button type="button" onClick={() => void ucretSil(u)} className="text-xs font-semibold text-red-700">Sil</button>}</td></tr>)}</tbody></table></div>
          )}
        </section>
        <PersonelBelgeleri personelId={personel.id} />
      </>}

      {ayrilisAcik && personel && <IslemModal baslik="İşten çıkış işlemi" aciklama="Bu işlem personeli gelecek tahakkukların dışında bırakır." kapat={() => setAyrilisAcik(false)}>
        <form onSubmit={istenCikar} className="space-y-4">
          <Alan baslik="Çıkış tarihi"><input required type="date" value={ayrilis.cikisTarihi} onChange={(e) => setAyrilis({ ...ayrilis, cikisTarihi: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
          <Alan baslik="Ayrılış nedeni"><textarea required minLength={3} maxLength={500} rows={3} value={ayrilis.ayrilisNedeni} onChange={(e) => setAyrilis({ ...ayrilis, ayrilisNedeni: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
          <ModalEylemler isleniyor={isleniyor} kapat={() => setAyrilisAcik(false)} onay="İşten çıkışı kaydet" tehlikeli />
        </form>
      </IslemModal>}

      {duzenleme && personel && <IslemModal genis baslik="Personel bilgilerini düzenle" aciklama="Bağlı cari kartı da güncellenir. Ücret değişikliği için “Ücret değiştir”i kullanın." kapat={() => setDuzenleme(null)}>
        <form onSubmit={duzenlemeKaydet} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Alan baslik="Ad"><input required minLength={2} maxLength={50} value={duzenleme.ad} onChange={(e) => setDuzenleme({ ...duzenleme, ad: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
            <Alan baslik="Soyad"><input required minLength={2} maxLength={50} value={duzenleme.soyad} onChange={(e) => setDuzenleme({ ...duzenleme, soyad: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
            <Alan baslik="E-posta"><input type="email" value={duzenleme.eposta} onChange={(e) => setDuzenleme({ ...duzenleme, eposta: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
            <Alan baslik="Telefon"><input maxLength={30} value={duzenleme.telefon} onChange={(e) => setDuzenleme({ ...duzenleme, telefon: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
            <Alan baslik="Çalışma tipi"><select value={duzenleme.calismaTipi} onChange={(e) => setDuzenleme({ ...duzenleme, calismaTipi: e.target.value })} className="w-full rounded-lg border px-3 py-2"><option value="tam_zamanli">Tam zamanlı</option><option value="yari_zamanli">Yarı zamanlı</option><option value="sozlesmeli">Sözleşmeli</option></select></Alan>
            <Alan baslik="İşe giriş tarihi"><input required type="date" value={duzenleme.girisTarihi} onChange={(e) => setDuzenleme({ ...duzenleme, girisTarihi: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
            <Alan baslik="Doğum tarihi (yıllık izin yaş kuralı)"><input type="date" max={bugun()} value={duzenleme.dogumTarihi} onChange={(e) => setDuzenleme({ ...duzenleme, dogumTarihi: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
            <Alan baslik="Engellilik derecesi"><select value={duzenleme.engellilikDerecesi} onChange={(e) => setDuzenleme({ ...duzenleme, engellilikDerecesi: e.target.value })} className="w-full rounded-lg border px-3 py-2"><option value="">Yok</option><option value="1">1. derece</option><option value="2">2. derece</option><option value="3">3. derece</option></select></Alan>
            <Alan baslik="SGK teşvik oranı (%)"><input inputMode="decimal" value={duzenleme.sgkTesvikOrani} onChange={(e) => setDuzenleme({ ...duzenleme, sgkTesvikOrani: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
            <Alan baslik={`Yeni TCKN (şu an ${personel.tckn ?? "yok"})`}><input inputMode="numeric" maxLength={11} value={duzenleme.tckn} onChange={(e) => setDuzenleme({ ...duzenleme, tckn: e.target.value })} placeholder="Değişmeyecekse boş bırakın" className="w-full rounded-lg border px-3 py-2" /></Alan>
            <Alan baslik={`Yeni IBAN (şu an ${personel.iban ?? "yok"})`}><input disabled={duzenleme.ibanKaldir} value={duzenleme.iban} onChange={(e) => setDuzenleme({ ...duzenleme, iban: e.target.value })} placeholder="TR…" className="w-full rounded-lg border px-3 py-2" /></Alan>
          </div>
          {personel.iban && <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={duzenleme.ibanKaldir} onChange={(e) => setDuzenleme({ ...duzenleme, ibanKaldir: e.target.checked, iban: "" })} /> IBAN'ı kaldır</label>}
          <ModalEylemler isleniyor={isleniyor} kapat={() => setDuzenleme(null)} onay="Kaydet" />
        </form>
      </IslemModal>}

      {ucretFormu && personel && <IslemModal baslik="Ücret değiştir" aciklama="Değişiklik yürürlük tarihinden itibaren geçerli olur; ay içindeki değişiklik günlere bölünür. Onaylanmamış bordroları “Yeniden hesapla” ile güncelleyin." kapat={() => setUcretFormu(null)}>
        <form onSubmit={ucretKaydet} className="space-y-3">
          <Alan baslik="Yürürlük tarihi"><input required type="date" value={ucretFormu.yururlukTarihi} onChange={(e) => setUcretFormu({ ...ucretFormu, yururlukTarihi: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
          <Alan baslik="Ücret tipi"><select value={ucretFormu.tip} onChange={(e) => setUcretFormu({ ...ucretFormu, tip: e.target.value as "net" | "brut" })} className="w-full rounded-lg border px-3 py-2"><option value="net">Net anlaşıldı (mevzuat seti varsa brüte çevrilir)</option><option value="brut">Brüt anlaşıldı</option></select></Alan>
          <Alan baslik="Aylık tutar (TL)"><input required inputMode="decimal" value={ucretFormu.tutar} onChange={(e) => setUcretFormu({ ...ucretFormu, tutar: e.target.value })} className="w-full rounded-lg border px-3 py-2" /></Alan>
          <Alan baslik="Neden (isteğe bağlı)"><input maxLength={250} value={ucretFormu.neden} onChange={(e) => setUcretFormu({ ...ucretFormu, neden: e.target.value })} placeholder="Örn. Yıllık zam" className="w-full rounded-lg border px-3 py-2" /></Alan>
          <ModalEylemler isleniyor={isleniyor} kapat={() => setUcretFormu(null)} onay="Kaydet" />
        </form>
      </IslemModal>}

      {yenidenAcik && personel && <IslemModal baslik="Yeniden işe başlat" aciklama="Yeni istihdam başlangıç tarihini girin." kapat={() => setYenidenAcik(false)}>
        <form onSubmit={yenidenBaslat} className="space-y-4">
          <Alan baslik="Yeni işe giriş tarihi"><input required type="date" value={yeniGirisTarihi} onChange={(e) => setYeniGirisTarihi(e.target.value)} className="w-full rounded-lg border px-3 py-2" /></Alan>
          <ModalEylemler isleniyor={isleniyor} kapat={() => setYenidenAcik(false)} onay="Personeli aktifleştir" />
        </form>
      </IslemModal>}
    </main>
  );
}

interface DuzenlemeFormu {
  ad: string; soyad: string; eposta: string; telefon: string; calismaTipi: string; girisTarihi: string;
  engellilikDerecesi: string; dogumTarihi: string; sgkTesvikOrani: string; tckn: string; iban: string; ibanKaldir: boolean;
}

function OzetKart({ baslik, deger, alt }: { baslik: string; deger: string; alt: string }) { return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{baslik}</p><p className="mt-2 text-xl font-bold text-slate-900">{deger}</p><p className="mt-1 text-xs capitalize text-slate-500">{alt}</p></article>; }
function Bilgi({ baslik, deger }: { baslik: string; deger: string }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{baslik}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-800">{deger}</dd></div>; }
function Alan({ baslik, children }: { baslik: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">{baslik}</span>{children}</label>; }
function IslemModal({ baslik, aciklama, kapat, children, genis = false }: { baslik: string; aciklama: string; kapat: () => void; children: React.ReactNode; genis?: boolean }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={baslik} onMouseDown={(e) => { if (e.target === e.currentTarget) kapat(); }}><div className={`hr-modal${genis ? " hr-modal--genis" : ""} w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl`}><h2 className="text-xl font-bold text-slate-900">{baslik}</h2><p className="mb-5 mt-1 text-sm text-slate-500">{aciklama}</p>{children}</div></div>; }
function ModalEylemler({ isleniyor, kapat, onay, tehlikeli = false }: { isleniyor: boolean; kapat: () => void; onay: string; tehlikeli?: boolean }) { return <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={kapat} className="rounded-lg border px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Vazgeç</button><button disabled={isleniyor} type="submit" className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${tehlikeli ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>{isleniyor ? "İşleniyor…" : onay}</button></div>; }
