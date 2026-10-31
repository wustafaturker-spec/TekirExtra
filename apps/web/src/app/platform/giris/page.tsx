"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { PlatformAuth, PlatformParola } from "@/components/platform-auth";
import { platformApi, platformTokenYaz } from "@/lib/platform-api";

/** Platform hesabı, parola ve doğrulayıcı uygulamadaki kodla açılır. */
export default function PlatformGirisSayfasi() {
  const yonlendir = useRouter();
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [cikis, setCikis] = useState<string | null>(null);
  // PLT-25: çıkışın sunucuda doğrulanıp doğrulanmadığı adres çubuğuyla gelir.
  useEffect(() => { setCikis(new URLSearchParams(window.location.search).get("cikis")); }, []);

  async function gonder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (yukleniyor) return;
    const v = new FormData(e.currentTarget);
    setHata(""); setYukleniyor(true);
    try {
      const s = await platformApi<{ accessToken: string }>("/platform/auth/giris", {
        method: "POST", body: JSON.stringify({ eposta: String(v.get("eposta") ?? "").trim(), parola: String(v.get("parola") ?? ""), totpKodu: String(v.get("totpKodu") ?? "") }),
      });
      platformTokenYaz(s.accessToken);
      yonlendir.replace("/platform");
    } catch (h) { setHata(h instanceof Error ? h.message : "Giriş başarısız."); }
    finally { setYukleniyor(false); }
  }

  return <PlatformAuth title="Platforma giriş yapın" description="Platform hesabınızı ve doğrulayıcı uygulamanızdaki 6 haneli kodu kullanın.">
    <Alert tone="error">{hata}</Alert>
    {cikis === "dogrulanamadi" && <Alert tone="warning">Bu sekmede çıkış yapıldı, ancak oturumun sunucuda kapatıldığı doğrulanamadı (bağlantı hatası). Şüpheniz varsa yeniden girip &ldquo;Tüm oturumlar&rdquo; ile bütün oturumlarınızı kapatın.</Alert>}
    {cikis === "tum" && <Alert tone="success">Tüm platform oturumlarınız kapatıldı.</Alert>}
    <form onSubmit={(e) => void gonder(e)}><fieldset disabled={yukleniyor} className="platform-auth-fields">
      <Field label="E-posta"><Input name="eposta" type="email" autoComplete="username" required placeholder="ad@firma.com" /></Field>
      <PlatformParola label="Parola" name="parola" autoComplete="current-password" required />
      <Field label="Doğrulama kodu"><Input name="totpKodu" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required placeholder="6 haneli kod" className="platform-otp" /></Field>
      <p className="platform-auth-help"><ShieldCheck size={16} aria-hidden="true" />Kodu, hesabınıza bağlı doğrulayıcı uygulamadan alın.</p>
      <Button type="submit" variant="primary" disabled={yukleniyor}>{yukleniyor ? "Giriş yapılıyor…" : "Giriş yap"}<ArrowRight size={16} aria-hidden="true" /></Button>
    </fieldset></form>
    <p className="platform-auth-switch">Firma kullanıcısı mısınız? <Link href="/giris">Firma girişine gidin</Link></p>
  </PlatformAuth>;
}
