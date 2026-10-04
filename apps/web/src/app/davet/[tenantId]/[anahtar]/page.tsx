"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";

interface Davet { firma: string; adSoyad: string; eposta: string }

/**
 * PRS-21: çalışan self-servis daveti. Girişsiz sayfa; bağlantıdaki anahtarla
 * çalışan parolasını belirler, sonra normal giriş ekranından girer.
 */
export default function SelfServisDaveti() {
  const { tenantId, anahtar } = useParams<{ tenantId: string; anahtar: string }>();
  const yol = `/self-servis-davet/${tenantId}/${anahtar}`;
  const [davet, setDavet] = useState<Davet | null>(null);
  const [yukHata, setYukHata] = useState("");
  const [parola, setParola] = useState("");
  const [tekrar, setTekrar] = useState("");
  const [hata, setHata] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [tamam, setTamam] = useState(false);

  useEffect(() => {
    api<Davet>(yol).then(setDavet).catch((h) => setYukHata(h instanceof Error ? h.message : "Davet açılamadı"));
  }, [yol]);

  async function gonder(e: FormEvent) {
    e.preventDefault();
    if (parola !== tekrar) { setHata("Parolalar aynı değil"); return; }
    setGonderiliyor(true); setHata("");
    try {
      await api(yol, { method: "POST", body: JSON.stringify({ parola }) });
      setTamam(true);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Parola kaydedilemedi");
    } finally { setGonderiliyor(false); }
  }

  return (
    <main className="mutabakat-portal">
      <div className="auth-brand"><span className="sidebar__brand-mark">TE</span>Tekir<b>Extra</b></div>
      {yukHata && <div className="card card--pad"><Alert tone="error">{yukHata}</Alert></div>}
      {!davet && !yukHata && <p className="muted">Yükleniyor…</p>}
      {davet && (
        <div className="card card--pad mutabakat-portal__kart">
          <p className="subtle">{davet.firma}</p>
          <h1 className="mutabakat-portal__baslik">Çalışan self-servis hesabı</h1>
          {tamam ? (<>
            <Alert tone="success">Parolanız kaydedildi. Giriş adınız: <strong>{davet.eposta}</strong></Alert>
            <p><Link className="btn btn--primary" href="/giris">Giriş yap</Link></p>
          </>) : (<>
            <p>Merhaba <strong>{davet.adSoyad}</strong>, ücret pusulalarınızı görmek, izin ve avans talebi oluşturmak için parolanızı belirleyin. Giriş adınız <strong>{davet.eposta}</strong>.</p>
            <form onSubmit={gonder} className="mutabakat-portal__form">
              <Field label="Parola (en az 10 karakter, harf ve rakam)"><Input type="password" autoComplete="new-password" required minLength={10} value={parola} onChange={(e) => setParola(e.target.value)} /></Field>
              <Field label="Parola (tekrar)"><Input type="password" autoComplete="new-password" required minLength={10} value={tekrar} onChange={(e) => setTekrar(e.target.value)} /></Field>
              {hata && <Alert tone="error">{hata}</Alert>}
              <Button variant="primary" type="submit" disabled={gonderiliyor}>{gonderiliyor ? "Kaydediliyor…" : "Parolamı belirle"}</Button>
            </form>
          </>)}
        </div>
      )}
    </main>
  );
}
