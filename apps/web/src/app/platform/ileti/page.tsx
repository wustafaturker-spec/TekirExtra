"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";
import { GonderimTavanlari } from "./tavanlar";
import { IletiSablonEditoru } from "@/components/ileti-sablon-editoru";

/** ILT-03/08: platformun e-posta ayarı ve gönderim kaydı. Parola sunucudan hiç dönmez. */
type Durum = "kuyrukta" | "gonderildi" | "basarisiz" | "belirsiz" | "suresi_doldu";
interface Ayar { yapilandirildi: boolean; parolaKayitli: boolean; host: string; port: number; guvenlik: "yok" | "starttls" | "ssl"; kullaniciAdi: string; gondericiAdi: string; gondericiEposta: string; yanitAdresi: string }
interface Kayit { id: string; tur: string; alicilar: string; konu: string; durum: Durum; deneme: number; hata: string | null; createdAt: string; gonderildiAt: string | null }
interface FirmaSayisi { tenantId: string; firma: string; sistemToplam: number; sistemHata: number; epostaToplam: number; epostaHata: number; smsToplam: number; smsHata: number }
interface Kayitlar { satirlar: Kayit[]; toplam: number; sayfa: number; sayfaBoyutu: number }

const DURUM: Record<Durum, { ad: string; rozet: "info" | "success" | "danger" | "warning" }> = {
  kuyrukta: { ad: "Kuyrukta", rozet: "info" }, gonderildi: { ad: "Gönderildi", rozet: "success" }, basarisiz: { ad: "Başarısız", rozet: "danger" }, belirsiz: { ad: "Belirsiz", rozet: "warning" }, suresi_doldu: { ad: "Süresi doldu", rozet: "warning" },
};
const TUR: Record<string, string> = { platform_davet: "Platform daveti", mevzuat_hatirlatma: "Mevzuat hatırlatması", abonelik_hatirlatma: "Abonelik hatırlatması", abonelik_ozeti: "Tahsilat özeti", abonelik_odeme: "Abonelik ödemesi", sistem_alarmi: "Sistem alarmı", test: "Test", dogrulama: "E-posta doğrulama", parola_sifirlama: "Parola sıfırlama", kullanici_davet: "Kullanıcı daveti", eposta_degisimi: "E-posta değişimi", rapor_duraklatildi: "Rapor duraklatma haberi", sms_kod_telefon_dogrula: "SMS: telefon doğrulama", sms_kod_parola_sifirla: "SMS: parola sıfırlama", sms_kod_giris: "SMS: giriş kodu" };

export default function PlatformIletiSayfasi() {
  const [ayar, setAyar] = useState<Ayar | null>(null);
  const [parola, setParola] = useState("");
  const [testAlici, setTestAlici] = useState("");
  const [sms, setSms] = useState<{ yapilandirildi: boolean; kullaniciAdi: string; gondericiAdi: string } | null>(null);
  const [smsParola, setSmsParola] = useState("");
  const [testTelefon, setTestTelefon] = useState("");
  const [liste, setListe] = useState<Kayitlar | null>(null);
  const [durum, setDurum] = useState<"" | Durum>("");
  const [sayfa, setSayfa] = useState(1);
  const [firmalar, setFirmalar] = useState<FirmaSayisi[] | null>(null);
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState(""); const [islem, setIslem] = useState(false);

  const kayitlariYukle = useCallback(async () => {
    try { setListe(await platformApi<Kayitlar>(`/platform/ileti/kayitlar?${new URLSearchParams({ sayfa: String(sayfa), ...(durum ? { durum } : {}) })}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Kayıtlar yüklenemedi."); }
  }, [durum, sayfa]);
  useEffect(() => { void platformApi<Ayar>("/platform/ileti/ayar").then(setAyar).catch((e: unknown) => setHata(e instanceof Error ? e.message : "Ayar yüklenemedi.")); }, []);
  useEffect(() => { void kayitlariYukle(); }, [kayitlariYukle]);
  useEffect(() => { void platformApi<NonNullable<typeof sms>>("/platform/ileti/sms-ayar").then(setSms).catch(() => undefined); }, []);

  useEffect(() => { void platformApi<FirmaSayisi[]>("/platform/ileti/firma-sayilari").then(setFirmalar).catch(() => undefined); }, []);

  const alan = <K extends keyof Ayar>(k: K, v: Ayar[K]) => setAyar((o) => (o ? { ...o, [k]: v } : o));
  async function calis(is: () => Promise<void>) {
    setIslem(true); setHata(""); setBilgi("");
    try { await is(); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem başarısız."); } finally { setIslem(false); }
  }
  const kaydet = (e: FormEvent) => {
    e.preventDefault();
    if (!ayar) return;
    void calis(async () => {
      const { yapilandirildi: _y, parolaKayitli: _p, ...govde } = ayar;
      setAyar(await platformApi<Ayar>("/platform/ileti/ayar", { method: "PUT", body: JSON.stringify({ ...govde, parola: parola || undefined }) }));
      setParola(""); setBilgi("Ayarlar kaydedildi.");
    });
  };
  const test = () => void calis(async () => {
    const r = await platformApi<{ basarili: boolean; mesaj: string }>("/platform/ileti/test", { method: "POST", body: JSON.stringify({ alici: testAlici }) });
    if (r.basarili) setBilgi(r.mesaj); else setHata(`Test başarısız: ${r.mesaj}`);
    await kayitlariYukle();
  });
  const smsKaydet = (e: FormEvent) => {
    e.preventDefault();
    if (!sms) return;
    void calis(async () => {
      setSms(await platformApi<NonNullable<typeof sms>>("/platform/ileti/sms-ayar", { method: "PUT", body: JSON.stringify({ kullaniciAdi: sms.kullaniciAdi, gondericiAdi: sms.gondericiAdi, parola: smsParola || undefined }) }));
      setSmsParola(""); setBilgi("SMS hesabı kaydedildi.");
    });
  };
  const smsTest = () => void calis(async () => {
    const r = await platformApi<{ basarili: boolean; mesaj: string }>("/platform/ileti/sms-test", { method: "POST", body: JSON.stringify({ telefon: testTelefon }) });
    if (r.basarili) setBilgi(r.mesaj); else setHata(`Test başarısız: ${r.mesaj}`);
    await kayitlariYukle();
  });
  const yeniden = (k: Kayit) => void calis(async () => {
    await platformApi(`/platform/ileti/kayitlar/${k.id}/yeniden`, { method: "POST" });
    setBilgi("İleti yeniden kuyruğa alındı."); await kayitlariYukle();
  });
  const sayfaSayisi = liste ? Math.max(1, Math.ceil(liste.toplam / liste.sayfaBoyutu)) : 1;

  return <div className="platform-editor">
    <PageHeader title="E-posta ve SMS" subtitle="Kayıt, parola, davet ve alarm iletileri bu hesaptan gönderilir." />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{bilgi}</Alert>
    {ayar && !ayar.yapilandirildi && <Alert tone="warning">Platform e-posta hesabı girilmedi. İletiler sunucu ortam ayarındaki adrese gidiyor; orası kapalıysa gönderilemez.</Alert>}

    <Card title="SMTP hesabı">
      {!ayar ? <p className="muted" role="status">Yükleniyor…</p> : <form className="form-grid" onSubmit={kaydet}>
        <Field label="Sunucu"><Input required value={ayar.host} maxLength={255} placeholder="smtp.saglayici.com" onChange={(e) => alan("host", e.target.value)} /></Field>
        <Field label="Port"><Select value={ayar.port} onChange={(e) => alan("port", Number(e.target.value))}>{[587, 465, 2525, 25].map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
        <Field label="Güvenlik"><Select value={ayar.guvenlik} onChange={(e) => alan("guvenlik", e.target.value as Ayar["guvenlik"])}><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="yok">Yok</option></Select></Field>
        <Field label="Kullanıcı adı"><Input value={ayar.kullaniciAdi} autoComplete="off" onChange={(e) => alan("kullaniciAdi", e.target.value)} /></Field>
        <Field label="Parola"><Input type="password" value={parola} autoComplete="new-password" placeholder={ayar.parolaKayitli ? "Kayıtlı; değiştirmek için yazın" : ""} onChange={(e) => setParola(e.target.value)} /></Field>
        <Field label="Gönderici adı"><Input required value={ayar.gondericiAdi} maxLength={120} onChange={(e) => alan("gondericiAdi", e.target.value)} /></Field>
        <Field label="Gönderici e-postası"><Input required type="email" value={ayar.gondericiEposta} onChange={(e) => alan("gondericiEposta", e.target.value)} /></Field>
        <Field label="Yanıt adresi (isteğe bağlı)"><Input type="email" value={ayar.yanitAdresi} onChange={(e) => alan("yanitAdresi", e.target.value)} /></Field>
        <div><Button type="submit" variant="primary" disabled={islem}>Kaydet</Button></div>
      </form>}
      <div className="row-tight" style={{ marginTop: "1.2rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="Test adresi"><Input type="email" value={testAlici} onChange={(e) => setTestAlici(e.target.value)} placeholder="siz@alanadiniz.com" /></Field>
        <Button disabled={islem || !testAlici} onClick={test}>Test e-postası gönder</Button>
      </div>
      <p className="platform-field-help">Test, kaydedilmiş ayarları kullanır; önce kaydedin.</p>
    </Card>

    <Card title="Sistem SMS hesabı (Netgsm)">
      <p className="muted">Yalnız giriş ve parola kodları için kullanılır. Firmaların müşteri SMS'leri kendi hesaplarından gider.</p>
      {sms && <form className="form-grid" onSubmit={smsKaydet}>
        <Field label="Kullanıcı adı"><Input required value={sms.kullaniciAdi} autoComplete="off" onChange={(e) => setSms({ ...sms, kullaniciAdi: e.target.value })} /></Field>
        <Field label="Parola"><Input type="password" value={smsParola} autoComplete="new-password" placeholder={sms.yapilandirildi ? "Kayıtlı; değiştirmek için yazın" : ""} onChange={(e) => setSmsParola(e.target.value)} /></Field>
        <Field label="Onaylı SMS başlığı"><Input required maxLength={20} value={sms.gondericiAdi} onChange={(e) => setSms({ ...sms, gondericiAdi: e.target.value })} /></Field>
        <div><Button type="submit" variant="primary" disabled={islem}>Kaydet</Button></div>
      </form>}
      <div className="row-tight" style={{ marginTop: "1.2rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="Test numarası"><Input type="tel" value={testTelefon} onChange={(e) => setTestTelefon(e.target.value)} placeholder="05XX XXX XX XX" /></Field>
        <Button disabled={islem || !testTelefon || !sms?.yapilandirildi} onClick={smsTest}>Test SMS'i gönder</Button>
      </div>
    </Card>

    <GonderimTavanlari />

    <IletiSablonEditoru baslik="Sistem iletisi şablonları" istek={platformApi} taban="/platform/ileti/sablonlar" />

    <Card title="Firma başına gönderim (son 30 gün)" pad={false}>
      <p className="muted" style={{ padding: "0.8rem 1.25rem 0" }}>Yalnız sayılar gösterilir; firmaların müşterilerine gönderdiği iletilerin alıcısı ve konusu burada görünmez. Hata sayısı başarısız ve belirsiz gönderimleri kapsar.</p>
      <TableWrap className="platform-responsive-table"><table className="table">
        <thead><tr><th>Firma</th><th>Sistem iletisi</th><th>Sistem hatası</th><th>Firma e-postası</th><th>E-posta hatası</th><th>SMS</th><th>SMS hatası</th></tr></thead>
        <tbody>
          {firmalar?.map((f) => <tr key={f.tenantId}>
            <td data-label="Firma">{f.firma}</td>
            <td data-label="Sistem iletisi">{f.sistemToplam}</td>
            <td data-label="Sistem hatası">{f.sistemHata}</td>
            <td data-label="Firma e-postası">{f.epostaToplam}</td>
            <td data-label="E-posta hatası">{f.epostaHata}</td>
            <td data-label="SMS">{f.smsToplam}</td>
            <td data-label="SMS hatası">{f.smsHata}</td>
          </tr>)}
          {firmalar && !firmalar.length && <tr><td colSpan={7} className="muted">Son 30 günde gönderim yok.</td></tr>}
        </tbody>
      </table></TableWrap>
    </Card>

    <Card title="Gönderim kaydı" pad={false} actions={<Select aria-label="Durum" value={durum} onChange={(e) => { setDurum(e.target.value as "" | Durum); setSayfa(1); }}><option value="">Tümü</option>{(Object.keys(DURUM) as Durum[]).map((d) => <option key={d} value={d}>{DURUM[d].ad}</option>)}</Select>}>
      <TableWrap className="platform-responsive-table"><table className="table">
        <thead><tr><th>Zaman</th><th>Tür</th><th>Alıcı</th><th>Konu</th><th>Durum</th><th>Deneme</th><th>Hata</th><th /></tr></thead>
        <tbody>
          {liste?.satirlar.map((k) => <tr key={k.id}>
            <td data-label="Zaman">{new Date(k.createdAt).toLocaleString("tr-TR")}</td>
            <td data-label="Tür">{TUR[k.tur] ?? k.tur}</td>
            <td data-label="Alıcı" style={{ overflowWrap: "anywhere" }}>{k.alicilar}</td>
            <td data-label="Konu">{k.konu}</td>
            <td data-label="Durum"><Badge variant={DURUM[k.durum].rozet}>{DURUM[k.durum].ad}</Badge></td>
            <td data-label="Deneme">{k.deneme}</td>
            <td data-label="Hata" className="muted" style={{ overflowWrap: "anywhere" }}>{k.hata ?? ""}</td>
            <td data-label="İşlem">{k.durum === "basarisiz" && <Button size="sm" disabled={islem} onClick={() => yeniden(k)}>Yeniden gönder</Button>}</td>
          </tr>)}
          {liste && !liste.satirlar.length && <tr><td colSpan={8} className="muted">Kayıt yok.</td></tr>}
        </tbody>
      </table></TableWrap>
      {sayfaSayisi > 1 && <div className="row-tight" style={{ padding: "0.8rem 1.25rem" }}><Button size="sm" disabled={sayfa <= 1} onClick={() => setSayfa((s) => s - 1)}>Önceki</Button><span className="muted">{sayfa} / {sayfaSayisi}</span><Button size="sm" disabled={sayfa >= sayfaSayisi} onClick={() => setSayfa((s) => s + 1)}>Sonraki</Button></div>}
    </Card>
  </div>;
}
