"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui";

interface KurBilgi {
  otpauthUrl: string;
  secret: string;
}

interface TotpDurum {
  aktif: boolean;
  kalanKurtarmaKodu: number;
}

export default function HesapGuvenligiSayfasi() {
  const [kurBilgi, setKurBilgi] = useState<KurBilgi | null>(null);
  const [kod, setKod] = useState("");
  const [durum, setDurum] = useState<TotpDurum | null>(null);
  // Yönetim P1-1: kurtarma kodları yalnız üretildikleri anda gösterilir.
  const [kurtarmaKodlari, setKurtarmaKodlari] = useState<string[] | null>(null);
  const [yonetimKodu, setYonetimKodu] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [mevcutParola, setMevcutParola] = useState("");
  const [yeniParola, setYeniParola] = useState("");
  const [yeniParolaTekrar, setYeniParolaTekrar] = useState("");
  const [parolaHata, setParolaHata] = useState("");
  const [parolaBasari, setParolaBasari] = useState("");
  const [parolaIsleniyor, setParolaIsleniyor] = useState(false);

  // KLN-11: bu oturum açık kalır, diğer cihazlardaki oturumlar kapanır.
  async function parolaDegistir(e: React.FormEvent) {
    e.preventDefault();
    setParolaHata("");
    setParolaBasari("");
    if (yeniParola !== yeniParolaTekrar) {
      setParolaHata("Yeni parolalar birbirini tutmuyor");
      return;
    }
    setParolaIsleniyor(true);
    try {
      const s = await api<{ mesaj: string }>("/auth/parola/degistir", { method: "POST", body: JSON.stringify({ mevcutParola, yeniParola }) });
      setParolaBasari(s.mesaj);
      setMevcutParola("");
      setYeniParola("");
      setYeniParolaTekrar("");
    } catch (h) {
      setParolaHata(h instanceof Error ? h.message : "Parola değiştirilemedi");
    } finally {
      setParolaIsleniyor(false);
    }
  }

  const durumYukle = useCallback(async () => {
    setDurum(await api<TotpDurum>("/auth/totp/durum"));
  }, []);

  useEffect(() => {
    void durumYukle().catch(() => undefined);
  }, [durumYukle]);

  async function calistir(is: () => Promise<void>, varsayilanHata: string) {
    setHata("");
    setBasari("");
    try {
      await is();
    } catch (h) {
      setHata(h instanceof Error ? h.message : varsayilanHata);
    }
  }

  function kur() {
    setKurtarmaKodlari(null);
    void calistir(async () => setKurBilgi(await api<KurBilgi>("/auth/totp/kur", { method: "POST" })), "TOTP kurulamadı");
  }

  function etkinlestir(e: React.FormEvent) {
    e.preventDefault();
    void calistir(async () => {
      const s = await api<{ kurtarmaKodlari: string[] }>("/auth/totp/etkinlestir", { method: "POST", body: JSON.stringify({ kod }) });
      setKurtarmaKodlari(s.kurtarmaKodlari);
      setBasari("İki adımlı doğrulama etkinleştirildi. Bir sonraki girişte doğrulama kodu istenecek.");
      setKurBilgi(null);
      setKod("");
      await durumYukle();
    }, "Kod doğrulanamadı");
  }

  function kodlariYenile() {
    void calistir(async () => {
      const s = await api<{ kurtarmaKodlari: string[] }>("/auth/totp/kurtarma-kodlari", { method: "POST", body: JSON.stringify({ kod: yonetimKodu }) });
      setKurtarmaKodlari(s.kurtarmaKodlari);
      setBasari("Yeni kurtarma kodları oluşturuldu; eski kodlar artık geçersiz.");
      setYonetimKodu("");
      await durumYukle();
    }, "Kurtarma kodları yenilenemedi");
  }

  function kapat() {
    void calistir(async () => {
      await api("/auth/totp/kapat", { method: "POST", body: JSON.stringify({ kod: yonetimKodu }) });
      setKurtarmaKodlari(null);
      setBasari("İki adımlı doğrulama kapatıldı.");
      setYonetimKodu("");
      await durumYukle();
    }, "İki adımlı doğrulama kapatılamadı");
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <PageHeader
        title="Hesap Güvenliği"
        subtitle="Parolanızı değiştirin ve iki adımlı doğrulama (2FA / TOTP) kurun — KLN-05, KLN-11."
      />

      <Card className="stack" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h3 className="card__title" style={{ fontSize: "1.05rem" }}>🔑 Parolamı Değiştir</h3>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            Yeni parola en az 10 karakter olmalı, harf ve rakam içermelidir. Değişiklikten sonra bu cihaz
            dışındaki oturumlarınız kapanır.
          </p>
        </div>
        <Alert tone="error">{parolaHata}</Alert>
        <Alert tone="success">{parolaBasari}</Alert>
        <form onSubmit={parolaDegistir} className="stack">
          <Field label="Mevcut parola">
            <Input type="password" autoComplete="current-password" required value={mevcutParola} onChange={(e) => setMevcutParola(e.target.value)} />
          </Field>
          <Field label="Yeni parola">
            <Input type="password" autoComplete="new-password" required minLength={10} value={yeniParola} onChange={(e) => setYeniParola(e.target.value)} />
          </Field>
          <Field label="Yeni parola (tekrar)">
            <Input type="password" autoComplete="new-password" required minLength={10} value={yeniParolaTekrar} onChange={(e) => setYeniParolaTekrar(e.target.value)} />
          </Field>
          <div><Button variant="primary" type="submit" disabled={parolaIsleniyor}>{parolaIsleniyor ? "Kaydediliyor…" : "Parolayı değiştir"}</Button></div>
        </form>
      </Card>

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <Card className="stack">
        <div>
          <h3 className="card__title" style={{ fontSize: "1.05rem" }}>🔐 İki Adımlı Doğrulama (TOTP)</h3>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            Google Authenticator, Authy, Microsoft Authenticator gibi bir uygulama ile
            hesabınıza ek güvenlik katmanı ekleyin. Kurulumda gösterilen gizli anahtarı
            uygulamanıza girin, ardından ürettiği 6 haneli kod ile etkinleştirin.
          </p>
        </div>

        {kurtarmaKodlari && (
          <div className="stack kurtarma-kodlari" role="region" aria-label="Kurtarma kodları">
            <Alert tone="warning">
              Bu kodları şimdi güvenli bir yere kaydedin; bir daha gösterilmeyecek. Telefonunuza erişemezseniz girişte
              doğrulama kodu yerine bunlardan birini yazın. Her kod bir kez kullanılır.
            </Alert>
            <ol className="kurtarma-kodlari__liste mono">
              {kurtarmaKodlari.map((k) => <li key={k}>{k}</li>)}
            </ol>
            <div><Button onClick={() => void navigator.clipboard?.writeText(kurtarmaKodlari.join("\n"))}>Kodları kopyala</Button></div>
          </div>
        )}

        {durum?.aktif && (
          <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1.25rem" }}>
            <p style={{ margin: 0 }}>
              <strong>Etkin.</strong> Kalan kurtarma kodu: <strong>{durum.kalanKurtarmaKodu}</strong>
              {durum.kalanKurtarmaKodu <= 2 && <span className="subtle"> — kodlarınız azaldı, yenilemenizi öneririz.</span>}
            </p>
            <Field label="Uygulamadaki 6 haneli kod (kapatmada kurtarma kodu da olur)">
              <Input value={yonetimKodu} onChange={(e) => setYonetimKodu(e.target.value)} autoComplete="one-time-code" maxLength={11} placeholder="123456" />
            </Field>
            <div className="row-tight">
              <Button disabled={!yonetimKodu} onClick={kodlariYenile}>Kurtarma kodlarını yenile</Button>
              <Button variant="danger" disabled={!yonetimKodu} onClick={kapat}>İki adımlı doğrulamayı kapat</Button>
            </div>
          </div>
        )}

        {durum && !durum.aktif && !kurBilgi && (
          <div><Button variant="primary" onClick={kur}>İki Adımlı Doğrulamayı Kur</Button></div>
        )}

        {kurBilgi && (
          <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "1.25rem" }}>
            <Field label="1) Gizli anahtar (authenticator uygulamanıza girin)">
              <Input readOnly value={kurBilgi.secret} className="mono" onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <p className="subtle" style={{ fontSize: "0.8rem", margin: 0, wordBreak: "break-all" }}>
              otpauth URL: <span className="mono">{kurBilgi.otpauthUrl}</span>
            </p>
            <form onSubmit={etkinlestir} className="row-tight" style={{ alignItems: "flex-end", flexWrap: "nowrap" }}>
              <div className="grow" style={{ maxWidth: 200 }}>
                <Field label="2) Uygulamadaki 6 haneli kod">
                  <Input value={kod} onChange={(e) => setKod(e.target.value)} inputMode="numeric" pattern="\d{6}" maxLength={6} required placeholder="123456" />
                </Field>
              </div>
              <Button variant="primary" type="submit">Etkinleştir</Button>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}
