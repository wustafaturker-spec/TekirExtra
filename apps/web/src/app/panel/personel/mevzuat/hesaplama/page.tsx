"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { tarihTR } from "@/lib/mevzuat-gorunum";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Para, Select, Stat, StatGrid, Table } from "@/components/ui";

interface HesapSonucu {
  mevzuat: { id: string; yururlukBaslangic: string; yururlukBitis: string | null };
  uyari: string;
  sonuc: Record<string, unknown>;
}

const simdi = new Date();
const ilk = { yil: String(simdi.getFullYear()), ay: String(simdi.getMonth() + 1), brutUcret: "", ucretDisiOdeme: "0", devredenSgkMatrahi: "0", devrinKalanAyi: "2", primGunu: "30", primeEsasKazanc: "", sgkTesvikOrani: "0", engellilikDerecesi: "", sahisSigortaPrimi: "0", hayatSigortaPrimi: "0", sendikaAidati: "0", oncekiKumulatifSigortaIndirimi: "0", oncekiKumulatifMatrah: "0", oncekiAsgariKumulatifMatrah: "0" };
type Form = typeof ilk;

const ETIKETLER: Record<string, string> = {
  brutUcret: "Brüt ücret", ucretDisiOdeme: "Prim / ikramiye brüt", sgkDevredenUygulanan: "Önceki aydan uygulanan SGK matrahı", sgkCariAyUcretDisiUygulanan: "Cari ayda SGK'ya tabi prim / ikramiye", sgkCariAyDevreden: "Sonraki aylara devreden SGK matrahı",
  primeEsasKazanc: "Prime esas kazanç", sgkIsci: "SGK çalışan payı", issizlikIsci: "İşsizlik çalışan payı", gelirVergisiMatrahiIndirimOncesi: "İndirim öncesi vergi matrahı", engellilikDerecesi: "Engellilik derecesi", engellilikIndirimi: "Engellilik indirimi",
  sahisSigortaPrimi: "Şahıs sigortası nakit kesintisi", hayatSigortaPrimi: "Hayat sigortası nakit kesintisi", toplamSigortaPrimi: "Toplam sigorta primi kesintisi", sahisSigortaIndirimi: "Şahıs/hayat sigortası matrah indirimi",
  sendikaAidati: "Sendika aidatı nakit kesintisi", sendikaAidatiIndirimi: "Sendika aidatı matrah indirimi", toplamGelirVergisiMatrahIndirimi: "Toplam matrah indirimi", yeniKumulatifSigortaIndirimi: "Kümülatif sigorta indirimi",
  gelirVergisiMatrahi: "Gelir vergisi matrahı", gelirVergisiBrut: "Hesaplanan gelir vergisi", asgariUcretGelirVergisiIstisnasi: "Gelir vergisi istisnası", gelirVergisi: "Kesilecek gelir vergisi",
  damgaVergisiBrut: "Hesaplanan damga vergisi", asgariUcretDamgaVergisiIstisnasi: "Damga vergisi istisnası", damgaVergisi: "Kesilecek damga vergisi", netUcret: "Net ücret",
  yeniKumulatifMatrah: "Yeni kümülatif matrah", yeniAsgariKumulatifMatrah: "Yeni asgari kümülatif matrah", isverenSgk: "Brüt SGK işveren payı", sgkTesvikOrani: "Uygulanan teşvik oranı",
  isverenSgkTesvikIndirimi: "SGK teşvik indirimi", isverenSgkNet: "Net SGK işveren payı", isverenIssizlik: "İşsizlik işveren payı", isverenMaliyeti: "Toplam işveren maliyeti",
};

/** Mevzuat Merkezi'ndeki dönem parametreleriyle brütten nete deneme hesabı ve ayrıntılı hesap izi. */
export default function BrutNetHesaplama() {
  const [form, setForm] = useState(ilk);
  const [veri, setVeri] = useState<HesapSonucu | null>(null);
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState(false);
  const alan = (k: keyof Form, v: string) => setForm({ ...form, [k]: v });

  async function hesapla(e: React.FormEvent) {
    e.preventDefault(); setIslemde(true); setHata("");
    try {
      setVeri(await api<HesapSonucu>("/personel/mevzuat/hesapla", {
        method: "POST",
        body: JSON.stringify({
          yil: Number(form.yil), ay: Number(form.ay), brutUcret: Number(form.brutUcret), ucretDisiOdeme: Number(form.ucretDisiOdeme),
          sgkMatrahDevirleri: Number(form.devredenSgkMatrahi) > 0 ? [{ tutar: Number(form.devredenSgkMatrahi), kalanAy: Number(form.devrinKalanAyi) }] : [],
          primGunu: Number(form.primGunu), ...(form.primeEsasKazanc ? { primeEsasKazanc: Number(form.primeEsasKazanc) } : {}),
          sgkTesvikOrani: Number(form.sgkTesvikOrani), ...(form.engellilikDerecesi ? { engellilikDerecesi: Number(form.engellilikDerecesi) } : {}),
          sahisSigortaPrimi: Number(form.sahisSigortaPrimi), hayatSigortaPrimi: Number(form.hayatSigortaPrimi), sendikaAidati: Number(form.sendikaAidati),
          oncekiKumulatifSigortaIndirimi: Number(form.oncekiKumulatifSigortaIndirimi), oncekiKumulatifMatrah: Number(form.oncekiKumulatifMatrah), oncekiAsgariKumulatifMatrah: Number(form.oncekiAsgariKumulatifMatrah),
        }),
      }));
    } catch (err) { setVeri(null); setHata(err instanceof Error ? err.message : "Hesaplama yapılamadı"); }
    finally { setIslemde(false); }
  }

  const tutar = (k: keyof Form, b: string, ek: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <Field label={b}><Input type="number" min="0" step="0.01" value={form[k]} onChange={(e) => alan(k, e.target.value)} {...ek} /></Field>
  );
  const satirlar = veri ? Object.keys(ETIKETLER).filter((k) => k in veri.sonuc && typeof veri.sonuc[k] !== "object").map((k) => [k, veri.sonuc[k]] as const) : [];

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel/mevzuat">← Bordro mevzuatına dön</Link>
      <PageHeader title="Brüt–net simülasyonu" subtitle="Dönemin Mevzuat Merkezi parametreleriyle hesaplama yapın ve tüm hesap izini inceleyin." />
      <Alert tone="error">{hata}</Alert>
      <div className="split">
        <Card title="Hesaplama girdileri">
          <form className="form-grid form-grid--2" onSubmit={hesapla}>
            <Field label="Yıl"><Input required type="number" min="2020" max="2100" value={form.yil} onChange={(e) => alan("yil", e.target.value)} /></Field>
            <Field label="Ay"><Select value={form.ay} onChange={(e) => alan("ay", e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</Select></Field>
            {tutar("brutUcret", "Brüt ücret", { required: true, min: "0.01" })}
            {tutar("ucretDisiOdeme", "Prim / ikramiye brüt")}
            {tutar("devredenSgkMatrahi", "Devreden SGK matrahı")}
            <Field label="Devrin kalan ayı"><Select value={form.devrinKalanAyi} onChange={(e) => alan("devrinKalanAyi", e.target.value)}><option value="2">2 ay</option><option value="1">Son ay</option></Select></Field>
            <Field label="Prim günü"><Input required type="number" min="1" max="30" value={form.primGunu} onChange={(e) => alan("primGunu", e.target.value)} /></Field>
            {tutar("primeEsasKazanc", "PEK (isteğe bağlı)", { min: "0.01", placeholder: "Otomatik" })}
            <Field label="SGK teşvik oranı %"><Input required type="number" min="0" max="100" step="0.001" value={form.sgkTesvikOrani} onChange={(e) => alan("sgkTesvikOrani", e.target.value)} title="Bordro parametrelerindeki azami teşvik puanını aşamaz" /></Field>
            <Field label="Engellilik indirimi"><Select value={form.engellilikDerecesi} onChange={(e) => alan("engellilikDerecesi", e.target.value)}><option value="">Uygulanmayacak</option><option value="1">1. derece</option><option value="2">2. derece</option><option value="3">3. derece</option></Select></Field>
            {tutar("sahisSigortaPrimi", "Şahıs sigortası primi")}
            {tutar("hayatSigortaPrimi", "Hayat sigortası primi")}
            {tutar("sendikaAidati", "Sendika aidatı")}
            {tutar("oncekiKumulatifSigortaIndirimi", "Önceki kümülatif sigorta indirimi")}
            {tutar("oncekiKumulatifMatrah", "Önceki kümülatif vergi matrahı", { required: true })}
            {tutar("oncekiAsgariKumulatifMatrah", "Önceki asgari kümülatif matrah", { required: true })}
            <p className="muted" style={{ fontSize: "0.78rem" }}>Teşvik oranı bordro parametrelerindeki azami puanı aşamaz.</p>
            <div><Button block type="submit" variant="primary" disabled={islemde}>{islemde ? "Hesaplanıyor…" : "Brütten nete hesapla"}</Button></div>
          </form>
        </Card>
        {!veri ? (
          <Card><p className="muted" style={{ margin: 0 }}>Dönem ve ücret bilgilerini girerek ayrıntılı hesap izini oluşturun.</p></Card>
        ) : (
          <div className="stack">
            <StatGrid>
              <Stat label="Net ücret" value={<Para deger={String(veri.sonuc.netUcret)} />} tone="accent" hint={`Parametreler ${tarihTR(veri.mevzuat.yururlukBaslangic)}${veri.mevzuat.yururlukBitis ? ` – ${tarihTR(veri.mevzuat.yururlukBitis)}` : "'den beri"}`} />
              <Stat label="Toplam işveren maliyeti" value={<Para deger={String(veri.sonuc.isverenMaliyeti)} />} />
            </StatGrid>
            <Card title="Hesap izi" pad={false}>
              <Table density="compact" className="table--fit">
                <tbody>
                  {satirlar.map(([k, v]) => (
                    <tr key={k}>
                      <td>{ETIKETLER[k]}</td>
                      <td className="num"><strong>{k === "engellilikDerecesi" ? (v === "0" ? "Uygulanmadı" : `${String(v)}. derece`) : k === "sgkTesvikOrani" ? `%${String(v)}` : <Para deger={String(v)} />}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <SgkDevirler devirler={veri.sonuc.sgkMatrahDevirleri} />
            <Alert tone="warning"><strong>Kontrol notu:</strong> {veri.uyari}</Alert>
          </div>
        )}
      </div>
    </div>
  );
}

function SgkDevirler({ devirler }: { devirler: unknown }) {
  if (!Array.isArray(devirler) || devirler.length === 0) return null;
  return (
    <Card title="Sonraki dönem SGK devirleri">
      <div className="row-tight">
        {devirler.map((d, i) => { const k = d as { tutar?: unknown; kalanAy?: unknown }; return <Badge key={i} variant="info"><Para deger={String(k.tutar)} /> · {String(k.kalanAy)} ay</Badge>; })}
      </div>
    </Card>
  );
}
