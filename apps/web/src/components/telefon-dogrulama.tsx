"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input } from "@/components/ui";

/** ILT-12: doğrulanmış telefon ve SMS ile ikinci adım. Numara ve güvenlik değişikliği parola ister. */
interface Durum { telefon: string | null; dogrulandi: boolean; smsIkinciAdim: boolean; totpAktif: boolean; smsHazir: boolean }

export function TelefonDogrulama() {
  const [d, setD] = useState<Durum | null>(null);
  const [telefon, setTelefon] = useState("");
  const [parola, setParola] = useState("");
  const [kod, setKod] = useState("");
  const [kodAdimi, setKodAdimi] = useState(false);
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState(""); const [islem, setIslem] = useState(false);
  const yukle = useCallback(async () => setD(await api<Durum>("/auth/telefon")), []);
  useEffect(() => { void yukle().catch(() => undefined); }, [yukle]);
  async function calis(is: () => Promise<void>) {
    setIslem(true); setHata(""); setBilgi("");
    try { await is(); await yukle(); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem başarısız"); } finally { setIslem(false); }
  }
  const kodIste = (e: FormEvent) => { e.preventDefault(); void calis(async () => {
    const s = await api<{ gonderildi: boolean; mesaj: string }>("/auth/telefon/kod", { method: "POST", body: JSON.stringify({ telefon, parola }) });
    if (s.gonderildi) { setKodAdimi(true); setParola(""); setBilgi(s.mesaj); } else setHata(s.mesaj);
  }); };
  const dogrula = (e: FormEvent) => { e.preventDefault(); void calis(async () => {
    await api("/auth/telefon/dogrula", { method: "POST", body: JSON.stringify({ kod }) });
    setKodAdimi(false); setKod(""); setTelefon(""); setBilgi("Telefonunuz doğrulandı.");
  }); };
  const ikinciAdim = (acik: boolean) => void calis(async () => {
    await api("/auth/telefon/ikinci-adim", { method: "POST", body: JSON.stringify({ acik, parola }) });
    setParola(""); setBilgi(acik ? "SMS ile ikinci adım açıldı." : "SMS ile ikinci adım kapatıldı.");
  });
  const kaldir = () => void calis(async () => {
    await api("/auth/telefon", { method: "DELETE", body: JSON.stringify({ parola }) });
    setParola(""); setBilgi("Telefon kaldırıldı.");
  });
  if (!d) return null;
  return <Card title="Telefon ve SMS doğrulama">
    <Alert tone="error">{hata}</Alert><Alert tone="success">{bilgi}</Alert>
    {!d.smsHazir && <Alert tone="warning">Sistem SMS hesabı henüz tanımlı değil; kod gönderilemez.</Alert>}
    <p>{d.telefon ? <>Kayıtlı numara <strong>{d.telefon}</strong> {d.dogrulandi && <Badge variant="success">Doğrulandı</Badge>}</> : "Kayıtlı telefon yok."}{d.smsIkinciAdim && <> <Badge variant="info">SMS ile ikinci adım açık</Badge></>}</p>
    {kodAdimi ? <form className="row-tight" style={{ alignItems: "flex-end", flexWrap: "wrap" }} onSubmit={dogrula}>
      <Field label="Telefonunuza gelen kod"><Input inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus autoComplete="one-time-code" value={kod} onChange={(e) => setKod(e.target.value)} /></Field>
      <Button variant="primary" type="submit" disabled={islem}>Doğrula</Button>
      <Button onClick={() => setKodAdimi(false)}>Vazgeç</Button>
    </form> : <form className="form-grid" onSubmit={kodIste}>
      <Field label={d.telefon ? "Yeni cep telefonu" : "Cep telefonu"}><Input type="tel" required value={telefon} placeholder="05XX XXX XX XX" onChange={(e) => setTelefon(e.target.value)} autoComplete="tel" /></Field>
      <Field label="Parolanız"><Input type="password" required value={parola} autoComplete="current-password" onChange={(e) => setParola(e.target.value)} /></Field>
      <div><Button type="submit" disabled={islem || !d.smsHazir}>Kod gönder</Button></div>
    </form>}
    {d.dogrulandi && !kodAdimi && <div style={{ marginTop: "1rem" }}>
      <p className="muted">Uygulamayla üretilen kod daha güvenlidir, önerilen yöntem odur.{d.totpAktif ? " Uygulama kodu açık olduğu için girişte o istenir." : ""} İşlem için yukarıya parolanızı yazın.</p>
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        <Button disabled={islem || !parola} onClick={() => ikinciAdim(!d.smsIkinciAdim)}>{d.smsIkinciAdim ? "SMS ile ikinci adımı kapat" : "SMS ile ikinci adımı aç"}</Button>
        <Button variant="danger" disabled={islem || !parola} onClick={kaldir}>Telefonu kaldır</Button>
      </div>
    </div>}
  </Card>;
}
