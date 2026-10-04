"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Button, ButtonLabel, Card, Input, PageHeader, Select, Table } from "@/components/ui";

interface Bildirim { id: string; primGunu: number; nakitYemekYardimi?: string; fiiliCalismaGunu?: number; sgkTesvikOrani?: string | null; sahisSigortaPrimi?: string; hayatSigortaPrimi?: string; sendikaAidati?: string; fazlaMesaiBrut?: string; primIkramiyeBrut?: string; eksikGunNedeni?: string | null; aciklama?: string | null }
interface Satir { id: string; personelNo: string; ad: string; soyad: string; durum: string; sgkTesvikOrani: string; istihdamGunu: number; ucretsizIzinGunu: number; onerilenPrimGunu: number; onerilenEksikGunNedeni: string | null; donemCalismalari: Bildirim[] }
type Form = { primGunu: string; sgkTesvikOrani: string; sahisSigortaPrimi: string; hayatSigortaPrimi: string; sendikaAidati: string; fazlaMesaiBrut: string; primIkramiyeBrut: string; nakitYemekYardimi: string; fiiliCalismaGunu: string; eksikGunNedeni: string; aciklama: string };

const DURUM_ADI: Record<string, string> = { isten_ayrildi: "İşten ayrıldı", askida: "Askıda", uzun_sureli_izin: "Uzun süreli izin" };
const NEDENLER: Record<string, string> = { istirahat: "İstirahat", ucretsiz_izin: "Ücretsiz izin", disiplin: "Disiplin", gozaltina_alinma: "Gözaltı/tutukluluk", kismi_istihdam: "Kısmi istihdam", puantaj: "Puantaj", diger: "Diğer" };
const TUTAR_ALANLARI: [keyof Form, string][] = [["fazlaMesaiBrut", "Fazla mesai brüt"], ["primIkramiyeBrut", "Prim / ikramiye brüt"], ["nakitYemekYardimi", "Nakit yemek yardımı"]];
const KESINTI_ALANLARI: [keyof Form, string][] = [["sahisSigortaPrimi", "Şahıs sigortası"], ["hayatSigortaPrimi", "Hayat sigortası"], ["sendikaAidati", "Sendika aidatı"]];

/** Tahakkuk öncesi puantaj: prim günü, değişken brüt kazançlar ve yasal indirimler. */
export default function CalismaGunleri() {
  const simdi = new Date();
  const [yil, setYil] = useState(simdi.getFullYear());
  const [ay, setAy] = useState(simdi.getMonth() + 1);
  const [satirlar, setSatirlar] = useState<Satir[]>([]);
  const [formlar, setFormlar] = useState<Record<string, Form>>({});
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState("");
  const [excelSonuc, setExcelSonuc] = useState("");

  const yukle = useCallback(async () => {
    try {
      setHata("");
      const s = await api<Satir[]>(`/personel/calisma-gunleri?yil=${yil}&ay=${ay}`);
      setSatirlar(s);
      setFormlar(Object.fromEntries(s.map((p) => {
        const v = p.donemCalismalari[0];
        return [p.id, {
          primGunu: String(v?.primGunu ?? p.onerilenPrimGunu), sgkTesvikOrani: String(v?.sgkTesvikOrani ?? p.sgkTesvikOrani ?? 0),
          sahisSigortaPrimi: String(v?.sahisSigortaPrimi ?? 0), hayatSigortaPrimi: String(v?.hayatSigortaPrimi ?? 0), sendikaAidati: String(v?.sendikaAidati ?? 0),
          fazlaMesaiBrut: String(v?.fazlaMesaiBrut ?? 0), primIkramiyeBrut: String(v?.primIkramiyeBrut ?? 0), nakitYemekYardimi: String(v?.nakitYemekYardimi ?? 0),
          fiiliCalismaGunu: String(v?.fiiliCalismaGunu ?? 0), eksikGunNedeni: v ? v.eksikGunNedeni ?? "" : p.onerilenEksikGunNedeni ?? "", aciklama: v?.aciklama ?? "",
        }];
      })));
    } catch (e) { setHata(e instanceof Error ? e.message : "Çalışma günleri alınamadı"); }
  }, [yil, ay]);
  useEffect(() => { void yukle(); }, [yukle]);

  async function kaydet(p: Satir) {
    const f = formlar[p.id]; setIslemde(p.id);
    try {
      await api("/personel/calisma-gunleri", {
        method: "POST",
        body: JSON.stringify({
          personelId: p.id, yil, ay, primGunu: Number(f.primGunu), sgkTesvikOrani: Number(f.sgkTesvikOrani),
          sahisSigortaPrimi: Number(f.sahisSigortaPrimi), hayatSigortaPrimi: Number(f.hayatSigortaPrimi), sendikaAidati: Number(f.sendikaAidati),
          fazlaMesaiBrut: Number(f.fazlaMesaiBrut), primIkramiyeBrut: Number(f.primIkramiyeBrut), nakitYemekYardimi: Number(f.nakitYemekYardimi), fiiliCalismaGunu: Number(f.fiiliCalismaGunu),
          eksikGunNedeni: Number(f.primGunu) < p.istihdamGunu ? f.eksikGunNedeni || null : null, aciklama: f.aciklama || null,
        }),
      });
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Bildirim kaydedilemedi"); }
    finally { setIslemde(""); }
  }
  const degistir = (id: string, k: keyof Form, v: string) => setFormlar({ ...formlar, [id]: { ...formlar[id], [k]: v } });

  /* PRS-16: Excel şablonu ve içe aktarma (her satır tekil kayıt kurallarından geçer). */
  async function excelYukle(dosya: File) {
    setIslemde("excel"); setHata(""); setExcelSonuc("");
    try {
      const govde = new FormData(); govde.set("dosya", dosya);
      const r = await api<{ kaydedilen: number; hatalar: { satir: number; personelNo: string; mesaj: string }[] }>(`/personel/calisma-gunleri/excel?yil=${yil}&ay=${ay}`, { method: "POST", body: govde });
      setExcelSonuc(`${r.kaydedilen} satır kaydedildi.${r.hatalar.length ? ` Hatalı: ${r.hatalar.map((h) => `satır ${h.satir} ${h.personelNo}: ${h.mesaj}`).join("; ")}` : ""}`);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Excel yüklenemedi"); }
    finally { setIslemde(""); }
  }

  const tutarHucresi = (p: Satir, f: Form, k: keyof Form, etiket: string) => <td key={k}><Input aria-label={etiket} type="number" min="0" step="0.01" value={f[k]} onChange={(e) => degistir(p.id, k, e.target.value)} style={{ width: "7.5rem" }} /></td>;

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel/bordrolar">← Bordrolara dön</Link>
      <PageHeader
        title="Aylık çalışma ve kazançlar"
        subtitle="Prim günü, değişken brüt kazançlar ve yasal indirimleri tahakkuk öncesinde doğrulayın."
        actions={<>
          <Input aria-label="Yıl" type="number" min="2020" max="2100" value={yil} onChange={(e) => setYil(Number(e.target.value))} style={{ width: "6rem" }} />
          <Select aria-label="Ay" value={ay} onChange={(e) => setAy(Number(e.target.value))} style={{ width: "auto" }}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}. ay</option>)}</Select>
          <Button onClick={() => void apiDosyaIndir(`/personel/calisma-gunleri/sablon?yil=${yil}&ay=${ay}`, `puantaj-${yil}-${String(ay).padStart(2, "0")}.xlsx`).catch((e) => setHata(e instanceof Error ? e.message : "Şablon indirilemedi"))}>Excel şablonu</Button>
          <ButtonLabel>{islemde === "excel" ? "Yükleniyor…" : "Excel'den yükle"}<input type="file" accept=".xlsx" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void excelYukle(f); }} /></ButtonLabel>
        </>}
      />
      <Alert tone="warning">{excelSonuc}</Alert>
      <Alert tone="error">{hata}</Alert>
      <Card pad={false}>
        <Table density="compact">
          <thead><tr><th>Personel</th><th>Prim günü</th><th>SGK teşvik %</th><th>Eksik gün nedeni</th>{TUTAR_ALANLARI.map(([, b]) => <th key={b}>{b}</th>)}<th>Fiilî çalışma günü</th>{KESINTI_ALANLARI.map(([, b]) => <th key={b}>{b}</th>)}<th>Açıklama</th><th /></tr></thead>
          <tbody>
            {satirlar.map((p) => {
              const f = formlar[p.id]; if (!f) return null;
              const eksik = Number(f.primGunu) < p.istihdamGunu;
              return (
                <tr key={p.id}>
                  <td style={{ minWidth: "11rem" }}>
                    <strong style={{ whiteSpace: "nowrap" }}>{p.ad} {p.soyad}</strong><div className="subtle mono">{p.personelNo}</div>
                    {p.istihdamGunu < 30 && <div className="muted" style={{ fontSize: "0.75rem" }}>İstihdam: {p.istihdamGunu} gün</div>}
                    {p.ucretsizIzinGunu > 0 && <div style={{ color: "var(--warning)", fontSize: "0.75rem" }} title="Onaylı ücretli olmayan izinden önerildi">Ücretsiz izin: {p.ucretsizIzinGunu} gün{p.donemCalismalari[0] ? "" : " (öneri)"}</div>}
                    {DURUM_ADI[p.durum] && <div style={{ color: "var(--warning)", fontSize: "0.75rem" }}>{DURUM_ADI[p.durum]}</div>}
                  </td>
                  <td><Input aria-label="Prim günü" type="number" min="0" max={p.istihdamGunu} value={f.primGunu} onChange={(e) => degistir(p.id, "primGunu", e.target.value)} style={{ width: "5rem" }} /></td>
                  <td><Input aria-label="SGK teşvik oranı" type="number" min="0" max="100" step="0.001" value={f.sgkTesvikOrani} onChange={(e) => degistir(p.id, "sgkTesvikOrani", e.target.value)} style={{ width: "6rem" }} /></td>
                  <td>
                    <Select aria-label="Eksik gün nedeni" required={eksik} disabled={!eksik} value={f.eksikGunNedeni} onChange={(e) => degistir(p.id, "eksikGunNedeni", e.target.value)} style={{ minWidth: "10rem" }}>
                      <option value="">{eksik ? "Neden seçin" : "Tam çalışma"}</option>
                      {Object.entries(NEDENLER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </td>
                  {TUTAR_ALANLARI.map(([k, b]) => tutarHucresi(p, f, k, b))}
                  <td><Input aria-label="Fiilî çalışma günü" type="number" min="0" max="31" value={f.fiiliCalismaGunu} onChange={(e) => degistir(p.id, "fiiliCalismaGunu", e.target.value)} title="Yemek yardımı istisnası fiilî çalışılan güne göre hesaplanır" style={{ width: "5rem" }} /></td>
                  {KESINTI_ALANLARI.map(([k, b]) => tutarHucresi(p, f, k, b))}
                  <td><Input aria-label="Açıklama" maxLength={500} value={f.aciklama} onChange={(e) => degistir(p.id, "aciklama", e.target.value)} style={{ minWidth: "12rem" }} /></td>
                  <td className="num"><Button size="sm" variant="primary" disabled={islemde === p.id || (eksik && !f.eksikGunNedeni)} onClick={() => void kaydet(p)}>Kaydet</Button></td>
                </tr>
              );
            })}
            {!satirlar.length && <tr><td className="muted" colSpan={13}>Bu dönemde istihdamı olan personel yok.</td></tr>}
          </tbody>
        </Table>
      </Card>
      <Alert tone="warning"><strong>Önemli:</strong> Tahakkuk oluşturulduktan sonra ilgili personelin dönem bildirimi değiştirilemez. Düzeltme için bordronun kontrollü iptal/revizyon akışı kullanılmalıdır.</Alert>
    </div>
  );
}
