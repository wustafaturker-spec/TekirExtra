"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CircleCheck } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { PlatformAuth, PlatformParola } from "@/components/platform-auth";
import { platformApi } from "@/lib/platform-api";

interface DavetBilgisi { eposta: string; adSoyad: string; tur: "hesap" | "iki_adim"; secret: string; karekod: string }

/** Tek kullanımlık bağlantı, adres çubuğundan kaldırılarak kurulum boyunca bellekte tutulur. */
export default function PlatformDavetSayfasi() {
  const [anahtar, setAnahtar] = useState("");
  const [bilgi, setBilgi] = useState<DavetBilgisi | null>(null);
  const [hata, setHata] = useState("");
  const [tamam, setTamam] = useState(false);
  const [bilgiYukleniyor, setBilgiYukleniyor] = useState(true);
  const [yukleniyor, setYukleniyor] = useState(false);
  const istendi = useRef(false);

  async function davetiYukle(a: string) {
    setBilgiYukleniyor(true); setHata("");
    try { setBilgi(await platformApi<DavetBilgisi>("/platform/auth/davet/bilgi", { method: "POST", body: JSON.stringify({ anahtar: a }) })); }
    catch (h) { setHata(h instanceof Error ? h.message : "Bağlantı açılamadı."); }
    finally { setBilgiYukleniyor(false); }
  }
  useEffect(() => {
    if (istendi.current) return;
    istendi.current = true;
    // PLT-30: yeni bağlantılar anahtarı URL parçasında (#anahtar=) taşır, sunucuya gitmez; eski ?anahtar= bağlantıları da açılır.
    const a = new URLSearchParams(window.location.hash.slice(1)).get("anahtar") ?? new URLSearchParams(window.location.search).get("anahtar") ?? "";
    window.history.replaceState(window.history.state, "", "/platform/davet");
    setAnahtar(a);
    if (!a) { setHata("Bağlantı eksik; e-postadaki bağlantıyı açın veya platform yöneticinizden yeni bir davet isteyin."); setBilgiYukleniyor(false); return; }
    void davetiYukle(a);
  }, []);

  async function gonder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bilgi || yukleniyor) return;
    const v = new FormData(e.currentTarget);
    const parola = String(v.get("parola") ?? "");
    if (bilgi.tur === "hesap" && parola !== String(v.get("parolaTekrar") ?? "")) { setHata("Parolalar birbirini tutmuyor."); return; }
    setHata(""); setYukleniyor(true);
    try {
      await platformApi("/platform/auth/davet/tamamla", { method: "POST", body: JSON.stringify({ anahtar, parola, kod: String(v.get("kod") ?? "") }) });
      setTamam(true); setBilgi(null); setAnahtar("");
    } catch (h) { setHata(h instanceof Error ? h.message : "Kurulum tamamlanamadı."); }
    finally { setYukleniyor(false); }
  }

  const hesap = bilgi?.tur === "hesap";
  const title = tamam ? "Kurulum tamamlandı" : !bilgi ? "Platform hesabı kurulumu" : hesap ? "Hesabınızı oluşturun" : "Doğrulamayı yeniden kurun";
  return <PlatformAuth title={title} description={bilgi ? `${bilgi.adSoyad} · ${bilgi.eposta}` : "Platform ekibine erişim için hesap ve doğrulama kurulumunuzu tamamlayın."}>
    <Alert tone="error">{hata}</Alert>
    {bilgiYukleniyor && <p className="platform-auth-help" role="status">Davet bağlantınız kontrol ediliyor…</p>}
    {!bilgi && !bilgiYukleniyor && !tamam && <div className="platform-auth-fields">{anahtar && <Button onClick={() => void davetiYukle(anahtar)}>Bağlantıyı yeniden dene</Button>}<Link className="btn btn--ghost" href="/platform/giris">Platform girişine dön</Link></div>}
    {tamam ? <div className="platform-auth-complete"><CircleCheck size={40} aria-hidden="true" /><p>Parolanız ve doğrulayıcı uygulamanızdaki kodla giriş yapabilirsiniz.</p><Link className="btn btn--primary" href="/platform/giris">Platform girişine git</Link></div> : bilgi && <form onSubmit={(e) => void gonder(e)}><fieldset disabled={yukleniyor} className="platform-auth-fields">
      <section className="platform-setup-step" aria-labelledby="parola-adimi"><h2 id="parola-adimi"><span>1</span>{hesap ? "Parolanızı belirleyin" : "Mevcut parolanızı girin"}</h2>{hesap ? <>
        <PlatformParola label="Parola (en az 10 karakter, harf ve rakam)" name="parola" autoComplete="new-password" minLength={10} required />
        <PlatformParola label="Parola (tekrar)" name="parolaTekrar" autoComplete="new-password" minLength={10} required />
      </> : <PlatformParola label="Mevcut parolanız" name="parola" autoComplete="current-password" required />}</section>
      <section className="platform-setup-step" aria-labelledby="dogrulama-adimi"><h2 id="dogrulama-adimi"><span>2</span>Doğrulayıcı uygulamayı bağlayın</h2><p className="platform-auth-help">Google Authenticator veya Microsoft Authenticator gibi bir uygulamayla karekodu okutun.</p>
        <div className="platform-qr"><img src={bilgi.karekod} alt="İki adımlı doğrulama karekodu" width={180} height={180} /></div>
        <details className="platform-manual-key"><summary>Karekodu okutamıyor musunuz?</summary><Field label="Elle kurulum anahtarı"><Input readOnly autoComplete="off" value={bilgi.secret} onFocus={(e) => e.currentTarget.select()} /></Field></details>
        <Field label="Uygulamadaki doğrulama kodu"><Input name="kod" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required placeholder="6 haneli kod" className="platform-otp" /></Field>
      </section>
      <Button type="submit" variant="primary" disabled={yukleniyor}>{yukleniyor ? "Kaydediliyor…" : "Kurulumu tamamla"}</Button>
    </fieldset></form>}
  </PlatformAuth>;
}
