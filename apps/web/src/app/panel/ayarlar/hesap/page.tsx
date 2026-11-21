"use client";

import { useCallback, useEffect, useState } from "react";
import { TelefonDogrulama } from "@/components/telefon-dogrulama";
import { AiMetinTercihiKart } from "@/components/ai-metin-tercihi-kart";
import { api, IKI_ADIM_KURULDU_OLAYI } from "@/lib/api";
import { tarayiciAdi } from "@/lib/tarayici-adi";
import { Alert, Badge, Button, Card, Field, Input, PageHeader } from "@/components/ui";

interface KurBilgi {
  otpauthUrl: string;
  secret: string;
  karekod: string;
}

interface Oturum {
  id: string;
  girisAt: string;
  sonYenilemeAt: string;
  ip: string | null;
  tarayici: string | null;
  buOturum: boolean;
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
  // Yönetim P2-4: açık oturumlar
  const [oturumlar, setOturumlar] = useState<Oturum[]>([]);
  const [yeniEposta, setYeniEposta] = useState("");
  const [epostaParola, setEpostaParola] = useState("");
  const [epostaIsleniyor, setEpostaIsleniyor] = useState(false);
  const [epostaMesaji, setEpostaMesaji] = useState<{ ton: "success" | "error"; metin: string } | null>(null);
  const [oturumMesaji, setOturumMesaji] = useState<{ ton: "success" | "error"; metin: string } | null>(null);
  const [mevcutParola, setMevcutParola] = useState("");
  const [yeniParola, setYeniParola] = useState("");
  const [yeniParolaTekrar, setYeniParolaTekrar] = useState("");
  const [parolaHata, setParolaHata] = useState("");
  const [parolaBasari, setParolaBasari] = useState("");
  const [parolaIsleniyor, setParolaIsleniyor] = useState(false);
  // KLN-21: panel, zorunlu 2FA kurulmamışsa buraya `?iki-adim=zorunlu` ile yönlendirir.
  const [ikiAdimZorunlu, setIkiAdimZorunlu] = useState(false);
  useEffect(() => { setIkiAdimZorunlu(new URLSearchParams(window.location.search).get("iki-adim") === "zorunlu"); }, []);

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

  async function epostaDegistir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEpostaMesaji(null);
    setEpostaIsleniyor(true);
    try {
      const s = await api<{ gonderildi: boolean; mesaj: string }>("/auth/eposta/degistir", { method: "POST", body: JSON.stringify({ eposta: yeniEposta, mevcutParola: epostaParola }) });
      setEpostaMesaji({ ton: s.gonderildi ? "success" : "error", metin: s.mesaj });
      if (s.gonderildi) { setYeniEposta(""); setEpostaParola(""); }
    } catch (h) {
      setEpostaMesaji({ ton: "error", metin: h instanceof Error ? h.message : "E-posta değiştirilemedi" });
    } finally {
      setEpostaIsleniyor(false);
    }
  }

  const durumYukle = useCallback(async () => {
    setDurum(await api<TotpDurum>("/auth/totp/durum"));
  }, []);

  useEffect(() => {
    void durumYukle().catch(() => undefined);
  }, [durumYukle]);

  const oturumlariYukle = useCallback(async () => {
    const liste = await api<Oturum[]>("/auth/oturumlar");
    setOturumlar(Array.isArray(liste) ? liste : []);
  }, []);

  useEffect(() => {
    void oturumlariYukle().catch(() => undefined);
  }, [oturumlariYukle]);

  async function oturumKapat(id?: string) {
    setOturumMesaji(null);
    try {
      if (id) {
        await api(`/auth/oturumlar/${id}/kapat`, { method: "POST" });
        setOturumMesaji({ ton: "success", metin: "Oturum kapatıldı; o cihaz en geç 15 dakika içinde çıkış yapar." });
      } else {
        const s = await api<{ kapatilan: number }>("/auth/oturumlar/digerlerini-kapat", { method: "POST" });
        setOturumMesaji({ ton: "success", metin: `${s.kapatilan} oturum kapatıldı; o cihazlar hemen çıkış yapar.` });
      }
      await oturumlariYukle();
    } catch (h) {
      setOturumMesaji({ ton: "error", metin: h instanceof Error ? h.message : "Oturum kapatılamadı" });
    }
  }

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
      window.dispatchEvent(new Event(IKI_ADIM_KURULDU_OLAYI));
      setIkiAdimZorunlu(false);
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
        subtitle="Parolanızı ve giriş e-postanızı değiştirin, iki adımlı doğrulama (2FA / TOTP) kurun — KLN-05, KLN-11, KLN-23."
      />
      {ikiAdimZorunlu && !durum?.aktif && (
        <div style={{ marginBottom: "1.5rem" }}>
          <Alert tone="warning">
            Firmanız rolünüz için iki adımlı doğrulamayı zorunlu tuttu. Aşağıdaki <strong>İki Adımlı Doğrulama</strong> bölümünden
            kurulumu bitirene kadar diğer ekranlar açılmaz.
          </Alert>
        </div>
      )}

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

      <Card className="stack" style={{ marginBottom: "1.5rem" }}>
        <div>
          <h3 className="card__title" style={{ fontSize: "1.05rem" }}>✉️ Giriş E-postamı Değiştir</h3>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            Yeni adrese doğrulama bağlantısı, şu anki adresinize bilgilendirme gider. Bağlantıyı onaylayana kadar
            mevcut adresinizle giriş yaparsınız.
          </p>
        </div>
        {epostaMesaji && <Alert tone={epostaMesaji.ton}>{epostaMesaji.metin}</Alert>}
        <form onSubmit={epostaDegistir} className="stack">
          <Field label="Yeni e-posta">
            <Input type="email" autoComplete="email" required value={yeniEposta} onChange={(e) => setYeniEposta(e.target.value)} />
          </Field>
          <Field label="Parolanız (onay için)">
            <Input type="password" autoComplete="current-password" required value={epostaParola} onChange={(e) => setEpostaParola(e.target.value)} />
          </Field>
          <div><Button variant="primary" type="submit" disabled={epostaIsleniyor}>{epostaIsleniyor ? "Gönderiliyor…" : "Doğrulama bağlantısı gönder"}</Button></div>
        </form>
      </Card>

      <Card className="stack" style={{ marginBottom: "1.5rem" }}>
        <div className="between">
          <h3 className="card__title" style={{ fontSize: "1.05rem" }}>💻 Oturumlarım</h3>
          {oturumlar.some((o) => !o.buOturum) && <Button size="sm" variant="danger" onClick={() => void oturumKapat()}>Diğer oturumları kapat</Button>}
        </div>
        {oturumMesaji && <Alert tone={oturumMesaji.ton}>{oturumMesaji.metin}</Alert>}
        <ul className="oturum-listesi" aria-label="Açık oturumlar">
          {oturumlar.map((o) => (
            <li key={o.id}>
              <div>
                <strong>{tarayiciAdi(o.tarayici)}</strong> {o.buOturum && <Badge variant="success">Bu cihaz</Badge>}
                <div className="subtle">
                  Giriş {new Date(o.girisAt).toLocaleString("tr-TR")} · son etkinlik {new Date(o.sonYenilemeAt).toLocaleString("tr-TR")}{o.ip ? ` · ${o.ip}` : ""}
                </div>
              </div>
              {!o.buOturum && <Button size="sm" onClick={() => void oturumKapat(o.id)}>Kapat</Button>}
            </li>
          ))}
          {oturumlar.length === 0 && <li className="subtle">Açık oturum bilgisi yok.</li>}
        </ul>
      </Card>

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <AiMetinTercihiKart />
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
            <img src={kurBilgi.karekod} alt="İki adımlı doğrulama karekodu" width={180} height={180} style={{ background: "#fff", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }} />
            <Field label="1) Karekodu authenticator uygulamanızla okutun ya da gizli anahtarı elle girin">
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
      <TelefonDogrulama />
    </div>
  );
}
