"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader } from "@/components/ui";

interface SetKaydi {
  id: string; ad: string; surum: number; yururlukBaslangic: string; yururlukBitis?: string | null; durum: "taslak" | "aktif" | "arsiv"; kaynakNotu?: string | null;
  parametreler: { asgariUcretBrut: number; sgkTavan: number; sgkIsciOrani: number; issizlikIsciOrani: number; sgkIsverenOrani: number; issizlikIsverenOrani: number; sgkTesvikAzamiOrani?: number; yemekGelirVergisiGunlukIstisna?: number; yemekSgkGunlukIstisna?: number; damgaVergisiOrani: number; gelirVergisiDilimleri: { ustSinir: number | null; oran: number }[] };
}
interface ResmiSet { kod: string; ad: string; yururlukBaslangic: string; yururlukBitis: string | null; kaynakNotu: string; yuklu: { id: string; durum: string; surum: number } | null }

/** Elle set istisnadır (PRS-11 resmî setleri tercih edilir); varsayılanlar 2026 değerleri. */
const ilk = { ad: "", yururlukBaslangic: `${new Date().getFullYear()}-01-01`, yururlukBitis: "", kaynakNotu: "", asgariUcretBrut: "33030", sgkTavan: "297270", sgkIsciOrani: "14", issizlikIsciOrani: "1", sgkIsverenOrani: "21.75", issizlikIsverenOrani: "2", sgkTesvikAzamiOrani: "5", yemekGelirVergisiGunlukIstisna: "300", yemekSgkGunlukIstisna: "300", engellilikDerece1: "12000", engellilikDerece2: "7000", engellilikDerece3: "3000", damgaVergisiOrani: "0.759", dilimler: "190000:15\n400000:20\n1500000:27\n5300000:35\n:40" };
type Form = typeof ilk;

const SAYI_ALANLARI: [string, keyof Form][] = [
  ["Asgari ücret brüt", "asgariUcretBrut"], ["SGK tavanı", "sgkTavan"], ["SGK işçi oranı %", "sgkIsciOrani"], ["İşsizlik işçi oranı %", "issizlikIsciOrani"],
  ["SGK işveren oranı %", "sgkIsverenOrani"], ["İşsizlik işveren oranı %", "issizlikIsverenOrani"], ["Damga vergisi oranı %", "damgaVergisiOrani"], ["Azami SGK teşvik oranı %", "sgkTesvikAzamiOrani"],
  ["1. derece engellilik indirimi", "engellilikDerece1"], ["2. derece engellilik indirimi", "engellilikDerece2"], ["3. derece engellilik indirimi", "engellilikDerece3"],
];
const DURUM: Record<SetKaydi["durum"], [string, "success" | "warning" | "neutral"]> = { aktif: ["Etkin", "success"], taslak: ["Taslak", "warning"], arsiv: ["Arşiv", "neutral"] };
const gun = (v: string) => new Date(v).toLocaleDateString("tr-TR", { timeZone: "UTC" });

/** Bordro SGK ve vergi hesabının parametre setleri: resmî setler + istisnai elle taslak. */
export default function MevzuatSayfasi() {
  const [setler, setSetler] = useState<SetKaydi[]>([]);
  const [resmiler, setResmiler] = useState<ResmiSet[]>([]);
  const [form, setForm] = useState(ilk);
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState("");

  const yukle = useCallback(async () => {
    try { setSetler(await api<SetKaydi[]>("/personel/mevzuat")); setResmiler(await api<ResmiSet[]>("/personel/mevzuat/resmi")); }
    catch (e) { setHata(e instanceof Error ? e.message : "Setler alınamadı"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault(); setIslemde("yeni");
    try {
      const gelirVergisiDilimleri = form.dilimler.split("\n").filter(Boolean).map((s) => { const [a, o] = s.split(":"); return { ustSinir: a ? Number(a) : null, oran: Number(o) }; });
      await api("/personel/mevzuat", {
        method: "POST",
        body: JSON.stringify({
          ad: form.ad, yururlukBaslangic: form.yururlukBaslangic, yururlukBitis: form.yururlukBitis || null, kaynakNotu: form.kaynakNotu,
          parametreler: {
            asgariUcretBrut: Number(form.asgariUcretBrut), sgkTavan: Number(form.sgkTavan), sgkIsciOrani: Number(form.sgkIsciOrani), issizlikIsciOrani: Number(form.issizlikIsciOrani),
            sgkIsverenOrani: Number(form.sgkIsverenOrani), issizlikIsverenOrani: Number(form.issizlikIsverenOrani), sgkTesvikAzamiOrani: Number(form.sgkTesvikAzamiOrani),
            yemekGelirVergisiGunlukIstisna: Number(form.yemekGelirVergisiGunlukIstisna), yemekSgkGunlukIstisna: Number(form.yemekSgkGunlukIstisna),
            engellilikIndirimi: { derece1: Number(form.engellilikDerece1), derece2: Number(form.engellilikDerece2), derece3: Number(form.engellilikDerece3) },
            damgaVergisiOrani: Number(form.damgaVergisiOrani), gelirVergisiDilimleri,
          },
        }),
      });
      setForm(ilk); await yukle();
    } catch (err) { setHata(err instanceof Error ? err.message : "Set kaydedilemedi"); }
    finally { setIslemde(""); }
  }

  async function resmiYukle(r: ResmiSet) {
    if (!window.confirm(`${r.ad} yüklenip etkinleştirilecek. Devam edilsin mi?`)) return;
    setIslemde(r.kod); setHata("");
    try { await api(`/personel/mevzuat/resmi/${r.kod}/yukle`, { method: "POST", body: "{}" }); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Resmî set yüklenemedi"); }
    finally { setIslemde(""); }
  }

  async function calistir(id: string, islem: string) {
    setIslemde(id);
    try { await api(`/personel/mevzuat/${id}/${islem}`, { method: "POST" }); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı"); }
    finally { setIslemde(""); }
  }

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel/bordrolar">← Bordro çalışma alanına dön</Link>
      <PageHeader
        title="Mevzuat parametre setleri"
        subtitle="Brüt ve net anlaşılan ücretlerin SGK ve vergi hesabı bu parametrelerle yapılır. Resmî setleri yüklemeniz yeterlidir; elle set yalnız istisnai durumlar içindir."
        actions={<Link className="btn btn--ghost" href="/panel/personel/mevzuat/kabul">Kabul senaryoları</Link>}
      />
      <Alert tone="error">{hata}</Alert>

      <Card title="Resmî setler">
        <p className="muted" style={{ marginTop: "-0.5rem" }}>Sistemle gelir; kaynakları doğrulanmış ve kabul senaryolarıyla sınanmıştır. Yüklenen set doğrudan etkin olur.</p>
        <ul className="list-plain">
          {resmiler.map((r) => (
            <li key={r.kod} className="card card--pad">
              <div className="between">
                <div><strong>{r.ad}</strong><div className="subtle">{gun(r.yururlukBaslangic)} – {r.yururlukBitis ? gun(r.yururlukBitis) : "…"}</div></div>
                {r.yuklu
                  ? <Badge variant="success">Yüklü · v{r.yuklu.surum} · {r.yuklu.durum === "aktif" ? "etkin" : r.yuklu.durum}</Badge>
                  : <Button size="sm" variant="primary" disabled={islemde === r.kod} onClick={() => void resmiYukle(r)}>Yükle ve etkinleştir</Button>}
              </div>
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.78rem" }}>{r.kaynakNotu}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="split">
        <Card title="Yeni taslak set">
          <form className="stack" onSubmit={kaydet}>
            <Field label="Set adı"><Input required minLength={3} value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} /></Field>
            <div className="form-grid form-grid--2">
              <Field label="Yürürlük başlangıcı"><Input required type="date" value={form.yururlukBaslangic} onChange={(e) => setForm({ ...form, yururlukBaslangic: e.target.value })} /></Field>
              <Field label="Yürürlük bitişi"><Input type="date" value={form.yururlukBitis} onChange={(e) => setForm({ ...form, yururlukBitis: e.target.value })} /></Field>
              {SAYI_ALANLARI.map(([b, k]) => <Field key={k} label={b}><Input required type="number" min="0" step="0.001" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>)}
            </div>
            <Field label="Gelir vergisi dilimleri">
              <textarea className="textarea mono" required rows={5} value={form.dilimler} onChange={(e) => setForm({ ...form, dilimler: e.target.value })} />
              <small className="muted">Her satır: üst sınır:oran. Son sınırsız dilim için “:oran”.</small>
            </Field>
            <Field label="Kaynak ve doğrulama notu"><textarea className="textarea" required minLength={10} rows={3} value={form.kaynakNotu} onChange={(e) => setForm({ ...form, kaynakNotu: e.target.value })} /></Field>
            <Button block type="submit" variant="primary" disabled={islemde === "yeni"}>Taslağı oluştur</Button>
          </form>
        </Card>
        <div className="stack">
          {!setler.length && <Card><p className="muted" style={{ margin: 0 }}>Henüz mevzuat seti yok.</p></Card>}
          {setler.map((x) => (
            <Card key={x.id} title={<><small className="subtle mono">Sürüm {x.surum}</small><div>{x.ad}</div></>} actions={<Badge variant={DURUM[x.durum][1]}>{DURUM[x.durum][0]}</Badge>}>
              <p className="muted" style={{ marginTop: "-0.5rem" }}>{gun(x.yururlukBaslangic)} – {x.yururlukBitis ? gun(x.yururlukBitis) : "Süresiz"}</p>
              <dl className="kv">
                <dt>Asgari brüt</dt><dd>{x.parametreler.asgariUcretBrut.toLocaleString("tr-TR")}</dd>
                <dt>SGK tavan</dt><dd>{x.parametreler.sgkTavan.toLocaleString("tr-TR")}</dd>
                <dt>Vergi dilimi</dt><dd>{x.parametreler.gelirVergisiDilimleri.length}</dd>
              </dl>
              {x.kaynakNotu && <p className="muted" style={{ fontSize: "0.78rem" }}>{x.kaynakNotu}</p>}
              {x.durum !== "arsiv" && (
                <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                  {x.durum === "taslak" && <Button size="sm" variant="primary" disabled={islemde === x.id} onClick={() => void calistir(x.id, "aktiflestir")}>Etkinleştir</Button>}
                  <Button size="sm" disabled={islemde === x.id} onClick={() => void calistir(x.id, "arsivle")}>Arşivle</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
