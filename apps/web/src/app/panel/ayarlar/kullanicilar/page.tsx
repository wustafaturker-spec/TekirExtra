"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  ModalEylem,
  PageHeader,
  Select,
  Status,
  TableWrap,
} from "@/components/ui";
import { ROL_ADI } from "@/lib/rol-adlari";
import { CariSecici } from "@/components/cari-secici";

const ROLLER = ["yonetici", "muhasebe", "satis", "salt_okunur", "mali_musavir", "b2b_bayi", "uretim_planlama", "uretim_operatoru", "depo", "kalite", "maliyet_muhasebesi", "ik"] as const;
type Rol = (typeof ROLLER)[number];
/** PRS-21: çalışan hesabı personel kartından davetle açılır; bu ekranda rolü seçilmez. */
const rolAdi = (r: string) => ROL_ADI[r as Rol | "calisan"] ?? r;

interface Kullanici {
  id: string;
  eposta: string;
  adSoyad: string;
  rol: Rol | "calisan";
  aktif: boolean;
  epostaDogrulandi: boolean;
  totpAktif: boolean;
  smsIkinciAdim?: boolean;
  /** KLN-21: rolü için firma 2FA'yı zorunlu tutuyor. */
  ikiAdimZorunlu: boolean;
  sonGirisAt: string | null;
  maksIskontoYuzdesi: number | null;
  bayiCariId: string | null;
  bayiCari: { id: string; kod: string; unvan: string } | null;
  /** KLN-20: özel rolü varsa `rol` onun şablonudur. */
  ozelRolId: string | null;
  ozelRol: { id: string; ad: string } | null;
}

interface OzelRolOzeti { id: string; ad: string; sablonRol: Rol; aktif: boolean }

interface Cari { id: string; kod: string; unvan: string }

export default function KullanicilarSayfasi() {
  const [kullanicilar, setKullanicilar] = useState<Kullanici[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);

  // Yeni kullanıcı formu
  const [eposta, setEposta] = useState("");
  const [adSoyad, setAdSoyad] = useState("");
  // KLN-20: hazır rol kodu ya da "ozel:<id>".
  const [rol, setRol] = useState<string>("satis");
  const [ozelRoller, setOzelRoller] = useState<OzelRolOzeti[]>([]);
  const [parola, setParola] = useState("");
  // Yönetim P2-3: varsayılan davet; parolayı kullanıcı belirler, yöneticide kalmaz.
  const [davetle, setDavetle] = useState(true);
  const [maksIskonto, setMaksIskonto] = useState("");
  const [bayiCariId, setBayiCariId] = useState("");

  // KLN-10: geçici parola verme penceresi
  const [benId, setBenId] = useState("");
  const [sifirlanan, setSifirlanan] = useState<Kullanici | null>(null);
  const [geciciParola, setGeciciParola] = useState("");
  const [geciciParolaTekrar, setGeciciParolaTekrar] = useState("");
  const [sifirlamaHata, setSifirlamaHata] = useState("");
  const [sifirlaniyor, setSifirlaniyor] = useState(false);
  // Yönetim P1-1: telefonunu kaybeden kullanıcının 2FA'sını kapatma onayı
  const [ikiAdimSifirlanan, setIkiAdimSifirlanan] = useState<Kullanici | null>(null);
  // KLN-23: rol değişikliği onay penceresiyle yapılır; vazgeçilirse seçim eski role döner.
  const [rolDegisimi, setRolDegisimi] = useState<{ kullanici: Kullanici; yeniRol: string } | null>(null);
  const [rolKaydediliyor, setRolKaydediliyor] = useState(false);
  // KLN-23: giriş e-postası değişikliği; yeni adres bağlantıyla onaylanınca geçerli olur.
  const [epostaDegisen, setEpostaDegisen] = useState<Kullanici | null>(null);
  const [yeniEposta, setYeniEposta] = useState("");
  const [epostaHata, setEpostaHata] = useState("");
  const [epostaGonderiliyor, setEpostaGonderiliyor] = useState(false);

  const yukle = useCallback(async () => {
    setHata("");
    try {
      const [kullanicilarVerisi, cariVerisi] = await Promise.all([
        api<Kullanici[]>("/kullanicilar"),
        api<{ kayitlar: Cari[] }>("/cari?adet=200"),
      ]);
      setKullanicilar(kullanicilarVerisi);
      // KLN-20: özel rol listesi isteğe bağlıdır; gelmezse yalnız hazır roller gösterilir.
      const ozel = await api<OzelRolOzeti[]>("/ozel-roller").catch(() => []);
      setOzelRoller(Array.isArray(ozel) ? ozel : []);
      setCariler(cariVerisi.kayitlar);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kullanıcılar yüklenemedi (yalnızca yönetici görebilir)");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  useEffect(() => {
    if (tokenAl()) void api<{ userId: string }>("/auth/ben").then((b) => setBenId(b.userId)).catch(() => undefined);
  }, []);

  function sifirlamaAc(k: Kullanici) {
    setSifirlanan(k);
    setGeciciParola("");
    setGeciciParolaTekrar("");
    setSifirlamaHata("");
  }

  async function ikiAdimSifirla(e: React.FormEvent) {
    e.preventDefault();
    if (!ikiAdimSifirlanan) return;
    setSifirlaniyor(true);
    try {
      const s = await api<{ mesaj: string }>(`/kullanicilar/${ikiAdimSifirlanan.id}/iki-adim-sifirla`, { method: "POST" });
      setBasari(s.mesaj);
      setHata("");
      setIkiAdimSifirlanan(null);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İki adımlı doğrulama sıfırlanamadı");
      setIkiAdimSifirlanan(null);
    } finally {
      setSifirlaniyor(false);
    }
  }

  async function davetiYenidenGonder(k: Kullanici) {
    setHata("");
    setBasari("");
    try {
      const s = await api<{ gonderildi: boolean; mesaj: string }>(`/kullanicilar/${k.id}/davet`, { method: "POST" });
      if (s.gonderildi) setBasari(s.mesaj);
      else setHata(s.mesaj);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Davet gönderilemedi");
    }
  }

  // Yönetim P2-4: kayıp cihaz ya da ayrılan çalışan için bütün oturumları kapatır.
  async function oturumlariKapat(k: Kullanici) {
    setHata("");
    setBasari("");
    try {
      const s = await api<{ mesaj: string }>(`/kullanicilar/${k.id}/oturumlari-kapat`, { method: "POST" });
      setBasari(s.mesaj);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Oturumlar kapatılamadı");
    }
  }

  async function parolaSifirla(e: React.FormEvent) {
    e.preventDefault();
    if (!sifirlanan) return;
    if (geciciParola !== geciciParolaTekrar) {
      setSifirlamaHata("Parolalar birbirini tutmuyor");
      return;
    }
    setSifirlamaHata("");
    setSifirlaniyor(true);
    try {
      const s = await api<{ mesaj: string }>(`/kullanicilar/${sifirlanan.id}/parola`, { method: "POST", body: JSON.stringify({ parola: geciciParola }) });
      setBasari(`${s.mesaj} Yeni parolayı kullanıcıya güvenli bir yoldan iletin.`);
      setHata("");
      setSifirlanan(null);
    } catch (h) {
      setSifirlamaHata(h instanceof Error ? h.message : "Parola sıfırlanamadı");
    } finally {
      setSifirlaniyor(false);
    }
  }

  // KLN-20: rol seçimi hazır rol ya da özel rol ("ozel:<id>"); özel rolde rol şablonundan gelir.
  const kullaniciSecimi = (k: Kullanici) => (k.ozelRolId ? `ozel:${k.ozelRolId}` : k.rol);
  const secimAdi = (secim: string) => {
    if (!secim.startsWith("ozel:")) return rolAdi(secim);
    const o = ozelRoller.find((r) => r.id === secim.slice(5));
    return o ? `${o.ad} (özel rol)` : "Özel rol";
  };
  function rolGovdesi(secim: string): { rol: Rol; ozelRolId?: string | null } {
    if (!secim.startsWith("ozel:")) return { rol: secim as Rol };
    const o = ozelRoller.find((r) => r.id === secim.slice(5));
    return { rol: (o?.sablonRol ?? "salt_okunur"), ozelRolId: secim.slice(5) };
  }
  /** Pasif özel rol yalnız onu taşıyan kullanıcının satırında görünür. */
  const rolSecenekleri = (mevcutOzelId?: string | null) => (
    <>
      {ROLLER.map((r) => (<option key={r} value={r}>{ROL_ADI[r]}</option>))}
      {ozelRoller.some((o) => o.aktif || o.id === mevcutOzelId) && (
        <optgroup label="Özel roller">
          {ozelRoller.filter((o) => o.aktif || o.id === mevcutOzelId).map((o) => (<option key={o.id} value={`ozel:${o.id}`}>{o.ad}{o.aktif ? "" : " (pasif)"}</option>))}
        </optgroup>
      )}
    </>
  );

  async function olustur(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      const sonuc = await api<{ davet?: { gonderildi: boolean; mesaj: string } }>("/kullanicilar", {
        method: "POST",
        body: JSON.stringify({
          eposta,
          adSoyad,
          ...rolGovdesi(rol),
          ...(davetle ? { davet: true } : { parola }),
          maksIskontoYuzdesi: maksIskonto ? Number(maksIskonto) : undefined,
          bayiCariId: rol === "b2b_bayi" ? bayiCariId || undefined : undefined,
        }),
      });
      if (sonuc.davet && !sonuc.davet.gonderildi) setHata(`${adSoyad} kullanıcısı oluşturuldu. ${sonuc.davet.mesaj}`);
      else setBasari(`${adSoyad} kullanıcısı oluşturuldu.${sonuc.davet ? ` ${sonuc.davet.mesaj}` : ""}`);
      setFormAcik(false);
      setEposta("");
      setAdSoyad("");
      setRol("satis");
      setParola("");
      setDavetle(true);
      setMaksIskonto("");
      setBayiCariId("");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kullanıcı oluşturulamadı");
    }
  }

  async function rolDegistir(e: React.FormEvent) {
    e.preventDefault();
    if (!rolDegisimi) return;
    const { kullanici, yeniRol } = rolDegisimi;
    setHata("");
    setBasari("");
    setRolKaydediliyor(true);
    try {
      await api(`/kullanicilar/${kullanici.id}`, { method: "PATCH", body: JSON.stringify(rolGovdesi(yeniRol)) });
      setBasari(`${kullanici.adSoyad} artık ${secimAdi(yeniRol)}.`);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Rol güncellenemedi");
    } finally {
      setRolKaydediliyor(false);
      setRolDegisimi(null);
    }
  }

  async function epostaDegistir(e: React.FormEvent) {
    e.preventDefault();
    if (!epostaDegisen) return;
    setEpostaHata("");
    setEpostaGonderiliyor(true);
    try {
      const s = await api<{ gonderildi: boolean; mesaj: string }>(`/kullanicilar/${epostaDegisen.id}/eposta`, { method: "POST", body: JSON.stringify({ eposta: yeniEposta }) });
      if (!s.gonderildi) { setEpostaHata(s.mesaj); return; }
      setBasari(s.mesaj);
      setEpostaDegisen(null);
    } catch (h) {
      setEpostaHata(h instanceof Error ? h.message : "E-posta değiştirilemedi");
    } finally {
      setEpostaGonderiliyor(false);
    }
  }

  async function aktifDegistir(k: Kullanici) {
    setHata("");
    setBasari("");
    try {
      await api(`/kullanicilar/${k.id}`, { method: "PATCH", body: JSON.stringify({ aktif: !k.aktif }) });
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Durum güncellenemedi");
    }
  }

  async function bayiCariDegistir(kullaniciId: string, yeniCariId: string) {
    setHata("");
    try {
      await api(`/kullanicilar/${kullaniciId}`, { method: "PATCH", body: JSON.stringify({ bayiCariId: yeniCariId || null }) });
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Bayi ataması güncellenemedi");
    }
  }

  return (
    <div>
      <PageHeader
        title="Kullanıcılar"
        subtitle="Firma kullanıcılarını yönetin: davet, rol atama, aktif/pasif (yalnızca yönetici) — KLN-02."
        actions={
          <>
            <Link className="btn btn--ghost" href="/panel/ayarlar/izinler">
              🛡️ Rol Yetkileri
            </Link>
            <Link className="btn btn--ghost" href="/panel/ayarlar/ozel-roller">
              Özel Roller
            </Link>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Kullanıcı"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <Card className="stack" style={{ marginBottom: "1.5rem", maxWidth: 720 }}>
          <h3 style={{ fontSize: "1.05rem" }}>Yeni Kullanıcı</h3>
          <form onSubmit={olustur} className="stack">
            <div className="row">
              <div style={{ flex: 1, minWidth: 200 }}><Field label="Ad Soyad *"><Input value={adSoyad} onChange={(e) => setAdSoyad(e.target.value)} required placeholder="Ayşe Yılmaz" /></Field></div>
              <div style={{ flex: 1, minWidth: 200 }}><Field label="E-posta *"><Input type="email" value={eposta} onChange={(e) => setEposta(e.target.value)} required placeholder="ayse@firma.com" /></Field></div>
            </div>
            <div className="row">
              <div style={{ flex: 1, minWidth: 160 }}><Field label="Rol"><Select value={rol} onChange={(e) => setRol(e.target.value)}>{rolSecenekleri()}</Select></Field></div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <Field label="Giriş">
                  <Select aria-label="Giriş yöntemi" value={davetle ? "davet" : "parola"} onChange={(e) => setDavetle(e.target.value === "davet")}>
                    <option value="davet">Davet e-postası gönder (önerilen)</option>
                    <option value="parola">Parolayı ben belirleyeyim</option>
                  </Select>
                </Field>
              </div>
              {!davetle && <div style={{ flex: 1, minWidth: 200 }}><Field label="Parola * (en az 10, harf + rakam)"><Input type="password" value={parola} onChange={(e) => setParola(e.target.value)} required minLength={10} /></Field></div>}
              <div style={{ flex: 1, minWidth: 160 }}><Field label="Maks. İskonto % (opsiyonel)"><Input type="number" step="0.01" min="0" max="100" value={maksIskonto} onChange={(e) => setMaksIskonto(e.target.value)} placeholder="sınırsız" /></Field></div>
              {rol === "b2b_bayi" && <div style={{ flex: 1, minWidth: 200 }}><Field label="Bağlı Bayi / Cari *"><CariSecici required ariaLabel="Bağlı bayi" cariler={cariler} deger={bayiCariId} onChange={setBayiCariId} placeholder="Bayi ara…" /></Field></div>}
            </div>
            <div><Button variant="primary" type="submit">Kullanıcı Oluştur</Button></div>
          </form>
        </Card>
      )}

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Ad Soyad</th>
              <th>E-posta</th>
              <th>Rol</th>
              <th>Durum</th>
              <th>2FA</th>
              <th>Son giriş</th>
              <th>Bağlı Bayi / Cari</th>
              <th className="num">Maks. İskonto</th>
              <th className="center">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {kullanicilar.length === 0 ? (
              <tr><td colSpan={9} className="empty">Kullanıcı bulunamadı.</td></tr>
            ) : (
              kullanicilar.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 600 }}>{k.adSoyad}</td>
                  <td>
                    {k.eposta}
                    {!k.epostaDogrulandi && <span className="subtle"> · davet bekliyor</span>}
                  </td>
                  <td style={{ minWidth: 150 }}>
                    {k.rol === "calisan" ? <span className="subtle">{rolAdi(k.rol)}</span> : <Select aria-label={`${k.adSoyad} rolü`} disabled={k.id === benId} title={k.id === benId ? "Kendi rolünüzü başka bir yönetici değiştirebilir" : undefined} value={kullaniciSecimi(k)} onChange={(e) => { if (e.target.value !== kullaniciSecimi(k)) setRolDegisimi({ kullanici: k, yeniRol: e.target.value }); }}>
                      {rolSecenekleri(k.ozelRolId)}
                    </Select>}
                  </td>
                  <td><Status tone={k.aktif ? "ok" : "danger"}>{k.aktif ? "Aktif" : "Pasif"}</Status></td>
                  <td>
                    {k.totpAktif || k.smsIkinciAdim ? (
                      <div className="row-tight" style={{ flexWrap: "nowrap" }}>
                        <Badge variant="success">Etkin</Badge>
                        {k.id !== benId && <Button size="sm" variant="ghost" onClick={() => setIkiAdimSifirlanan(k)}>Sıfırla</Button>}
                      </div>
                    ) : k.ikiAdimZorunlu && k.aktif ? <Badge variant="warning">Zorunlu, kurulmamış</Badge> : <span className="subtle">—</span>}
                  </td>
                  <td className="subtle" style={{ whiteSpace: "nowrap" }}>{k.sonGirisAt ? new Date(k.sonGirisAt).toLocaleString("tr-TR") : "Hiç girmedi"}</td>
                  <td style={{ minWidth: 220 }}>{k.rol === "b2b_bayi" ? <CariSecici ariaLabel="Bağlı bayi" cariler={cariler} deger={k.bayiCariId ?? ""} onChange={(id) => bayiCariDegistir(k.id, id)} placeholder="Atanmamış — bayi ara…" /> : <span className="subtle">—</span>}</td>
                  <td className="num">{k.maksIskontoYuzdesi === null ? <span className="subtle">Sınırsız</span> : `%${k.maksIskontoYuzdesi}`}</td>
                  <td className="center">
                    <div className="row-tight" style={{ justifyContent: "center", flexWrap: "nowrap" }}>
                      {k.id !== benId && (
                        <Button size="sm" onClick={() => sifirlamaAc(k)}>Parolayı Sıfırla</Button>
                      )}
                      {k.aktif && !k.epostaDogrulandi && (
                        <Button size="sm" onClick={() => void davetiYenidenGonder(k)}>Daveti Yeniden Gönder</Button>
                      )}
                      {k.id !== benId && k.aktif && (
                        <Button size="sm" onClick={() => { setEpostaDegisen(k); setYeniEposta(""); setEpostaHata(""); setHata(""); setBasari(""); }}>E-postayı Değiştir</Button>
                      )}
                      {k.id !== benId && (
                        <Button size="sm" onClick={() => void oturumlariKapat(k)}>Oturumları Kapat</Button>
                      )}
                      {k.id !== benId && (
                        <Button size="sm" variant={k.aktif ? "danger" : "ghost"} onClick={() => aktifDegistir(k)}>
                          {k.aktif ? "Pasife Al" : "Aktif Et"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>

      {epostaDegisen && (
        <Modal
          baslik="Giriş e-postasını değiştir"
          aciklama={`${epostaDegisen.adSoyad} şu an ${epostaDegisen.eposta} ile giriş yapıyor. Yeni adrese doğrulama bağlantısı, eski adrese bilgilendirme gider; bağlantı kullanılana kadar eski adres geçerli kalır.`}
          onKapat={() => setEpostaDegisen(null)}
        >
          <form onSubmit={epostaDegistir} className="stack">
            <Alert tone="error">{epostaHata}</Alert>
            <Field label="Yeni e-posta">
              <Input type="email" required autoFocus value={yeniEposta} onChange={(e) => setYeniEposta(e.target.value)} placeholder="ayse@firma.com" />
            </Field>
            <ModalEylem onVazgec={() => setEpostaDegisen(null)} isleniyor={epostaGonderiliyor} metin="Doğrulama bağlantısı gönder" />
          </form>
        </Modal>
      )}

      {rolDegisimi && (
        <Modal
          baslik="Rolü değiştir"
          aciklama={`${rolDegisimi.kullanici.adSoyad} (${rolDegisimi.kullanici.eposta}) kullanıcısının rolü ${secimAdi(kullaniciSecimi(rolDegisimi.kullanici))} → ${secimAdi(rolDegisimi.yeniRol)} olacak. Yeni yetkiler hemen geçerli olur; değişiklik denetim izine yazılır.`}
          onKapat={() => setRolDegisimi(null)}
        >
          <form onSubmit={rolDegistir}>
            <ModalEylem onVazgec={() => setRolDegisimi(null)} isleniyor={rolKaydediliyor} metin="Rolü değiştir" />
          </form>
        </Modal>
      )}

      {ikiAdimSifirlanan && (
        <Modal
          baslik="İki adımlı doğrulamayı sıfırla"
          aciklama={`${ikiAdimSifirlanan.adSoyad} (${ikiAdimSifirlanan.eposta}) telefonuna erişemiyorsa 2FA'sını kapatın. Açık oturumları kapanır; kullanıcı yalnız parolasıyla girip Hesap Güvenliği ekranından yeniden kurabilir. Bu işlem denetim izine yazılır.`}
          onKapat={() => setIkiAdimSifirlanan(null)}
        >
          <form onSubmit={ikiAdimSifirla}>
            <ModalEylem onVazgec={() => setIkiAdimSifirlanan(null)} isleniyor={sifirlaniyor} metin="2FA'yı sıfırla" tehlikeli />
          </form>
        </Modal>
      )}

      {sifirlanan && (
        <Modal
          baslik="Parolayı sıfırla"
          aciklama={`${sifirlanan.adSoyad} (${sifirlanan.eposta}) için geçici parola belirleyin. Kullanıcının açık oturumları kapanır; parolayı daha sonra Hesap Güvenliği ekranından kendisi değiştirebilir.`}
          onKapat={() => setSifirlanan(null)}
        >
          <form onSubmit={parolaSifirla} className="stack">
            <Alert tone="error">{sifirlamaHata}</Alert>
            <Field label="Yeni parola (en az 10, harf + rakam)">
              <Input type="password" autoComplete="new-password" required minLength={10} autoFocus value={geciciParola} onChange={(e) => setGeciciParola(e.target.value)} />
            </Field>
            <Field label="Yeni parola (tekrar)">
              <Input type="password" autoComplete="new-password" required minLength={10} value={geciciParolaTekrar} onChange={(e) => setGeciciParolaTekrar(e.target.value)} />
            </Field>
            <ModalEylem onVazgec={() => setSifirlanan(null)} isleniyor={sifirlaniyor} metin="Parolayı kaydet" />
          </form>
        </Modal>
      )}
    </div>
  );
}
