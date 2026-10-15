"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";

interface Ayar {
  host: string;
  port: number;
  guvenlik: "yok" | "starttls" | "ssl";
  kullaniciAdi?: string;
  gondericiAdi: string;
  gondericiEposta: string;
  yanitAdresi?: string;
  parolaKayitli: boolean;
  yapilandirildi: boolean;
  imapHost?: string;
  imapPort?: number;
  imapGuvenlik?: "ssl" | "starttls" | "yok";
  imapKullaniciAdi?: string;
  imapKlasor?: string;
  imapAktif?: boolean;
  imapParolaKayitli?: boolean;
  imapYapilandirildi?: boolean;
}

interface Gonderim {
  id: string;
  alici: string;
  konu: string;
  tur: string;
  durum: string;
  ekSayisi: number;
  hataMesaji: string | null;
  createdAt: string;
}

const ilk: Ayar = {
  host: "",
  port: 587,
  guvenlik: "starttls",
  kullaniciAdi: "",
  gondericiAdi: "",
  gondericiEposta: "",
  yanitAdresi: "",
  parolaKayitli: false,
  yapilandirildi: false,
  imapHost: "",
  imapPort: 993,
  imapGuvenlik: "ssl",
  imapKullaniciAdi: "",
  imapKlasor: "INBOX",
  imapAktif: false,
  imapParolaKayitli: false,
  imapYapilandirildi: false,
};

export default function EpostaAyarlari() {
  const [ayar, setAyar] = useState<Ayar>(ilk);
  const [gecmis, setGecmis] = useState<Gonderim[]>([]);
  const [testAdresi, setTestAdresi] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState(false);
  const [imapTestEdiliyor, setImapTestEdiliyor] = useState(false);

  const yukle = useCallback(async () => {
    const [a, g] = await Promise.all([
      api<Ayar>("/eposta/ayarlar"),
      api<Gonderim[]>("/eposta/gecmis"),
    ]);
    setAyar(a);
    setGecmis(g);
    setTestAdresi((x) => x || a.gondericiEposta || "");
  }, []);

  useEffect(() => {
    void yukle().catch((x) => setHata(x instanceof Error ? x.message : "E-posta ayarları yüklenemedi"));
  }, [yukle]);

  async function kaydet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setIslemde(true);
    setHata("");
    setBasari("");
    try {
      await api("/eposta/ayarlar", {
        method: "PUT",
        body: JSON.stringify({
          host: f.get("host"),
          port: Number(f.get("port")),
          guvenlik: f.get("guvenlik"),
          kullaniciAdi: String(f.get("kullaniciAdi") || "") || undefined,
          parola: String(f.get("parola") || "") || undefined,
          gondericiAdi: f.get("gondericiAdi"),
          gondericiEposta: f.get("gondericiEposta"),
          yanitAdresi: f.get("yanitAdresi"),
          imapHost: String(f.get("imapHost") || "") || undefined,
          imapPort: Number(f.get("imapPort") || 993),
          imapGuvenlik: f.get("imapGuvenlik"),
          imapKullaniciAdi: String(f.get("imapKullaniciAdi") || "") || undefined,
          imapParola: String(f.get("imapParola") || "") || undefined,
          imapKlasor: String(f.get("imapKlasor") || "INBOX"),
          imapAktif: f.get("imapAktif") === "on",
        }),
      });
      setBasari("E-posta sunucusu (SMTP ve IMAP) ayarları güvenli şekilde kaydedildi.");
      await yukle();
    } catch (x) {
      setHata(x instanceof Error ? x.message : "Ayarlar kaydedilemedi");
    } finally {
      setIslemde(false);
    }
  }

  async function testEtSmtp() {
    if (!testAdresi) return;
    setIslemde(true);
    setHata("");
    setBasari("");
    try {
      const s = await api<{ mesaj: string }>("/eposta/test", {
        method: "POST",
        body: JSON.stringify({ alici: testAdresi }),
      });
      setBasari(s.mesaj);
      await yukle();
    } catch (x) {
      setHata(x instanceof Error ? x.message : "SMTP bağlantı testi başarısız");
    } finally {
      setIslemde(false);
    }
  }

  async function testEtImap() {
    setImapTestEdiliyor(true);
    setHata("");
    setBasari("");
    try {
      const s = await api<{ mesaj: string }>("/eposta/imap-test", {
        method: "POST",
      });
      setBasari(s.mesaj);
      await yukle();
    } catch (x) {
      setHata(x instanceof Error ? x.message : "IMAP bağlantı testi başarısız");
    } finally {
      setImapTestEdiliyor(false);
    }
  }

  return (
    <div className="email-settings">
      <div className="between mb-4">
        <PageHeader
          title="E-posta Ayarları"
          subtitle="Giden iletiler (SMTP) ve içeri alınacak gelen e-postalar (IMAP) için kurumsal posta kanallarını yönetin."
        />
        <Link href="/panel/eposta">
          <Button variant="ghost">📬 Gelen E-postalar Kutusunu Aç</Button>
        </Link>
      </div>

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="email-settings__status">
        <Card>
          <span>Giden E-posta (SMTP)</span>
          <strong>
            <Badge variant={ayar.yapilandirildi ? "success" : "neutral"}>
              {ayar.yapilandirildi ? "Yapılandırıldı" : "Kurulum gerekli"}
            </Badge>
          </strong>
          <small>{ayar.yapilandirildi ? `${ayar.host}:${ayar.port}` : "SMTP henüz tanımlanmadı"}</small>
        </Card>
        <Card>
          <span>Gelen E-posta (IMAP)</span>
          <strong>
            <Badge variant={ayar.imapYapilandirildi ? "success" : "neutral"}>
              {ayar.imapYapilandirildi ? (ayar.imapAktif ? "Aktif & Taranıyor" : "Yapılandırıldı (Duraklatıldı)") : "Kurulum gerekli"}
            </Badge>
          </strong>
          <small>{ayar.imapYapilandirildi ? `${ayar.imapHost}:${ayar.imapPort}` : "IMAP henüz tanımlanmadı"}</small>
        </Card>
        <Card>
          <span>Son 50 gönderim</span>
          <strong>{gecmis.length}</strong>
          <small>{gecmis.filter((g) => g.durum === "basarisiz").length} başarısız gönderim</small>
        </Card>
      </div>

      <form className="email-settings__form" onSubmit={kaydet}>
        {/* SMTP KARTI */}
        <Card className="email-settings__card">
          <div className="expense-entry__section-head">
            <span className="expense-entry__step">SMTP</span>
            <div>
              <h3>Giden E-posta Sunucusu (Fatura, Ekstre, Bildirimler)</h3>
              <p>Parola AES-256-GCM ile şifrelenerek saklanır ve tekrar ekrana getirilmez.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="SMTP sunucusu">
              <Input name="host" defaultValue={ayar.host} placeholder="smtp.firmaniz.com" required />
            </Field>
            <Field label="Port">
              <Input name="port" type="number" min="1" max="65535" defaultValue={ayar.port} required />
            </Field>
            <Field label="Güvenlik">
              <Select name="guvenlik" defaultValue={ayar.guvenlik}>
                <option value="starttls">STARTTLS (önerilen)</option>
                <option value="ssl">SSL / TLS</option>
                <option value="yok">Şifresiz</option>
              </Select>
            </Field>
            <Field label="SMTP kullanıcı adı">
              <Input name="kullaniciAdi" defaultValue={ayar.kullaniciAdi ?? ""} autoComplete="username" />
            </Field>
            <Field label={ayar.parolaKayitli ? "SMTP parolası (değiştirmek için girin)" : "SMTP parolası"}>
              <Input
                name="parola"
                type="password"
                autoComplete="new-password"
                placeholder={ayar.parolaKayitli ? "Kayıtlı parola korunacak" : "Parola"}
              />
            </Field>
            <Field label="Gönderici adı">
              <Input name="gondericiAdi" defaultValue={ayar.gondericiAdi} placeholder="Firma Ünvanı" required />
            </Field>
            <Field label="Gönderici e-posta">
              <Input name="gondericiEposta" type="email" defaultValue={ayar.gondericiEposta} placeholder="muhasebe@firma.com" required />
            </Field>
            <Field label="Yanıt adresi">
              <Input name="yanitAdresi" type="email" defaultValue={ayar.yanitAdresi ?? ""} placeholder="destek@firma.com" />
            </Field>
          </div>
        </Card>

        {/* IMAP KARTI */}
        <Card className="email-settings__card mt-4">
          <div className="expense-entry__section-head">
            <span className="expense-entry__step">IMAP</span>
            <div>
              <h3>Gelen E-posta Sunucusu (Gelen Kutusu, Fatura ve CRM Ayrıştırma)</h3>
              <p>Kurumsal posta kutunuza bağlanarak gelen iletileri ve ekli faturaları sisteme çeker.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="IMAP sunucusu">
              <Input name="imapHost" defaultValue={ayar.imapHost ?? ""} placeholder="imap.firmaniz.com" />
            </Field>
            <Field label="Port">
              <Input name="imapPort" type="number" min="1" max="65535" defaultValue={ayar.imapPort ?? 993} />
            </Field>
            <Field label="Güvenlik">
              <Select name="imapGuvenlik" defaultValue={ayar.imapGuvenlik ?? "ssl"}>
                <option value="ssl">SSL / TLS (993)</option>
                <option value="starttls">STARTTLS (143)</option>
                <option value="yok">Şifresiz</option>
              </Select>
            </Field>
            <Field label="IMAP kullanıcı adı">
              <Input name="imapKullaniciAdi" defaultValue={ayar.imapKullaniciAdi ?? ""} placeholder="destek@firmaniz.com" />
            </Field>
            <Field label={ayar.imapParolaKayitli ? "IMAP parolası (değiştirmek için girin)" : "IMAP parolası"}>
              <Input
                name="imapParola"
                type="password"
                autoComplete="new-password"
                placeholder={ayar.imapParolaKayitli ? "Kayıtlı parola korunacak" : "Parola"}
              />
            </Field>
            <Field label="Taranacak klasör">
              <Input name="imapKlasor" defaultValue={ayar.imapKlasor ?? "INBOX"} placeholder="INBOX" />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer font-medium">
              <input type="checkbox" name="imapAktif" defaultChecked={ayar.imapAktif} />
              <span>Otomatik arka plan senkronizasyonunu etkinleştir (Her 5 dakikada bir tarar)</span>
            </label>
          </div>
        </Card>

        <div className="email-settings__actions mt-4 flex justify-between">
          <Button disabled={islemde} type="submit" variant="primary">
            {islemde ? "Kaydediliyor…" : "Tüm Ayarları Kaydet"}
          </Button>
          {ayar.imapYapilandirildi && (
            <Button
              type="button"
              variant="ghost"
              disabled={imapTestEdiliyor || islemde}
              onClick={() => void testEtImap()}
            >
              {imapTestEdiliyor ? "IMAP Test Ediliyor…" : "IMAP Bağlantısını Doğrula"}
            </Button>
          )}
        </div>
      </form>

      {/* SMTP DOĞRULAMA */}
      <Card className="mt-4">
        <div className="between">
          <div>
            <h3>SMTP Gönderimini Doğrula</h3>
            <p className="muted">SMTP sunucu bağlantısı test edilir ve gerçek bir test e-postası gönderilir.</p>
          </div>
          <div className="row-tight">
            <Input
              aria-label="Test e-posta adresi"
              type="email"
              value={testAdresi}
              onChange={(e) => setTestAdresi(e.target.value)}
              placeholder="test@firma.com"
            />
            <Button disabled={!ayar.yapilandirildi || !testAdresi || islemde} onClick={() => void testEtSmtp()}>
              Test e-postası gönder
            </Button>
          </div>
        </div>
      </Card>

      {/* GEÇMİŞ */}
      <Card pad={false} className="mt-4">
        <div className="email-settings__history-head">
          <h3>Gönderim geçmişi</h3>
          <p>Başarılı ve başarısız iletilerin son durumları</p>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Alıcı</th>
              <th>Konu</th>
              <th>Tür</th>
              <th>Ek</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {gecmis.map((g) => (
              <tr key={g.id}>
                <td>{new Date(g.createdAt).toLocaleString("tr-TR")}</td>
                <td>{g.alici}</td>
                <td>
                  <strong>{g.konu}</strong>
                  {g.hataMesaji && <small className="email-settings__error">{g.hataMesaji}</small>}
                </td>
                <td>{g.tur}</td>
                <td>{g.ekSayisi}</td>
                <td>
                  <Badge variant={g.durum === "gonderildi" ? "success" : "danger"}>{g.durum}</Badge>
                </td>
              </tr>
            ))}
            {!gecmis.length && (
              <tr>
                <td colSpan={6} className="muted">
                  Henüz e-posta gönderim kaydı yok.
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
