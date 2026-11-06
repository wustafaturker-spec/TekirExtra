"use client";

import { useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";

interface Kayit { kod: string; ilKodu: string; il: string; ilce: string; ad: string; aktif: boolean }
const BOS: Omit<Kayit, "aktif"> = { kod: "", ilKodu: "", il: "", ilce: "", ad: "" };

export default function VergiDaireleriSayfasi() {
  const kaynak = usePlatformVerisi<Kayit[]>("/platform/vergi-daireleri");
  const [form, setForm] = useState(BOS);
  const [csv, setCsv] = useState("");
  const [arama, setArama] = useState("");
  const [hata, setHata] = useState("");
  const [mesaj, setMesaj] = useState("");
  const [islem, setIslem] = useState(false);
  const gorunenler = (kaynak.veri ?? []).filter((k) => `${k.kod} ${k.ilKodu} ${k.il} ${k.ilce} ${k.ad}`.toLocaleLowerCase("tr-TR").includes(arama.trim().toLocaleLowerCase("tr-TR")));
  async function kaydet(e: React.FormEvent) {
    e.preventDefault(); setIslem(true); setHata(""); setMesaj("");
    try { await platformApi("/platform/vergi-daireleri", { method: "POST", body: JSON.stringify(form) }); setForm(BOS); setMesaj("Vergi dairesi kaydedildi."); kaynak.yenile(); }
    catch (x) { setHata(x instanceof Error ? x.message : "Kayıt yapılamadı."); } finally { setIslem(false); }
  }
  async function iceAktar() {
    setIslem(true); setHata(""); setMesaj("");
    try {
      const satirlar = csv.split(/\r?\n/).filter((x) => x.trim()).map((satir) => {
        const [ilKodu, il, ilce, kod, ad] = satir.split(";").map((x) => x.trim());
        return { ilKodu, il, ilce, kod, ad };
      });
      const sonuc = await platformApi<{ kaydedilen: number }>("/platform/vergi-daireleri/ice-aktar", { method: "POST", body: JSON.stringify(satirlar) });
      setMesaj(`${sonuc.kaydedilen} vergi dairesi içe aktarıldı.`); setCsv(""); kaynak.yenile();
    } catch (x) { setHata(x instanceof Error ? x.message : "İçe aktarma yapılamadı."); } finally { setIslem(false); }
  }
  async function etkinlik(k: Kayit) {
    try { await platformApi(`/platform/vergi-daireleri/${encodeURIComponent(k.kod)}`, { method: "PATCH", body: JSON.stringify({ aktif: !k.aktif }) }); kaynak.yenile(); }
    catch (x) { setHata(x instanceof Error ? x.message : "Durum değiştirilemedi."); }
  }
  return <>
    <PageHeader title="Vergi dairesi sözlüğü" subtitle="GİB listesini yönetin. Kod; il kodu; il; ilçe; vergi dairesi adı sırasıyla noktalı virgül ayrılmış CSV içe aktarabilirsiniz." />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{mesaj}</Alert>
    <Card title="Toplu içe aktarma">
      <p className="subtle">Başlık satırı olmadan, her satıra <code>ilKodu;il;ilçe;daireKodu;daireAdı</code> yazın. Kodlar mevcutsa kayıtları günceller.</p>
      <textarea className="input" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="Vergi dairesi CSV içeriği" />
      <Button disabled={islem || !csv.trim()} onClick={() => void iceAktar()}>İçe aktar</Button>
    </Card>
    <Card title="Tek kayıt ekle veya düzenle">
      <form className="stack" onSubmit={(e) => void kaydet(e)}><div className="platform-firma-summary">
        <Field label="Daire kodu"><Input required pattern="\d{5}" maxLength={5} inputMode="numeric" value={form.kod} onChange={(e) => setForm({ ...form, kod: e.target.value.replace(/\D/g, "").slice(0, 5) })} /></Field>
        <Field label="İl kodu (2 hane)"><Input required pattern="\d{2}" maxLength={2} value={form.ilKodu} onChange={(e) => setForm({ ...form, ilKodu: e.target.value })} /></Field>
        <Field label="İl"><Input required value={form.il} onChange={(e) => setForm({ ...form, il: e.target.value })} /></Field>
        <Field label="İlçe"><Input required value={form.ilce} onChange={(e) => setForm({ ...form, ilce: e.target.value })} /></Field>
        <Field label="Vergi dairesi"><Input required value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} /></Field>
      </div><Button variant="primary" type="submit" disabled={islem}>Kaydet</Button></form>
    </Card>
    <Card title={`Kayıtlı vergi daireleri (${kaynak.veri?.length ?? 0})`}>
      {kaynak.yukleniyor && <p role="status">Yükleniyor…</p>}{kaynak.hata && <Alert tone="error">{kaynak.hata} <Button onClick={kaynak.yenile}>Yenile</Button></Alert>}
      <Field label="Kod, il, ilçe veya daire adıyla ara"><Input value={arama} onChange={(e) => setArama(e.target.value)} /></Field>
      <p className="subtle">{gorunenler.length} / {kaynak.veri?.length ?? 0} kayıt</p>
      <div className="table-wrap"><table><thead><tr><th>Kod</th><th>İl</th><th>İlçe</th><th>Vergi dairesi</th><th>Durum</th><th /></tr></thead><tbody>{gorunenler.map((k) => <tr key={k.kod}><td>{k.kod}</td><td>{k.il}</td><td>{k.ilce}</td><td>{k.ad}</td><td>{k.aktif ? "Etkin" : "Pasif"}</td><td><div className="platform-row-actions"><Button onClick={() => setForm({ kod: k.kod, ilKodu: k.ilKodu, il: k.il, ilce: k.ilce, ad: k.ad })}>Düzenle</Button><Button onClick={() => void etkinlik(k)}>{k.aktif ? "Pasifleştir" : "Etkinleştir"}</Button></div></td></tr>)}</tbody></table></div>
    </Card>
  </>;
}
