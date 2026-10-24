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
  maksIskontoYuzdesi: number | null;
  bayiCariId: string | null;
  bayiCari: { id: string; kod: string; unvan: string } | null;
}

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
  const [rol, setRol] = useState<Rol>("satis");
  const [parola, setParola] = useState("");
  const [maksIskonto, setMaksIskonto] = useState("");
  const [bayiCariId, setBayiCariId] = useState("");

  // KLN-10: geçici parola verme penceresi
  const [benId, setBenId] = useState("");
  const [sifirlanan, setSifirlanan] = useState<Kullanici | null>(null);
  const [geciciParola, setGeciciParola] = useState("");
  const [geciciParolaTekrar, setGeciciParolaTekrar] = useState("");
  const [sifirlamaHata, setSifirlamaHata] = useState("");
  const [sifirlaniyor, setSifirlaniyor] = useState(false);

  const yukle = useCallback(async () => {
    setHata("");
    try {
      const [kullanicilarVerisi, cariVerisi] = await Promise.all([
        api<Kullanici[]>("/kullanicilar"),
        api<{ kayitlar: Cari[] }>("/cari?adet=200"),
      ]);
      setKullanicilar(kullanicilarVerisi);
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

  async function olustur(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      await api("/kullanicilar", {
        method: "POST",
        body: JSON.stringify({
          eposta,
          adSoyad,
          rol,
          parola,
          maksIskontoYuzdesi: maksIskonto ? Number(maksIskonto) : undefined,
          bayiCariId: rol === "b2b_bayi" ? bayiCariId || undefined : undefined,
        }),
      });
      setBasari(`${adSoyad} kullanıcısı oluşturuldu.`);
      setFormAcik(false);
      setEposta("");
      setAdSoyad("");
      setRol("satis");
      setParola("");
      setMaksIskonto("");
      setBayiCariId("");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kullanıcı oluşturulamadı");
    }
  }

  async function rolDegistir(id: string, yeniRol: Rol) {
    setHata("");
    setBasari("");
    try {
      await api(`/kullanicilar/${id}`, { method: "PATCH", body: JSON.stringify({ rol: yeniRol }) });
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Rol güncellenemedi");
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
              <div style={{ flex: 1, minWidth: 160 }}><Field label="Rol"><Select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>{ROLLER.map((r) => (<option key={r} value={r}>{ROL_ADI[r]}</option>))}</Select></Field></div>
              <div style={{ flex: 1, minWidth: 200 }}><Field label="Parola * (en az 10, harf + rakam)"><Input type="password" value={parola} onChange={(e) => setParola(e.target.value)} required minLength={10} /></Field></div>
              <div style={{ flex: 1, minWidth: 160 }}><Field label="Maks. İskonto % (opsiyonel)"><Input type="number" step="0.01" min="0" max="100" value={maksIskonto} onChange={(e) => setMaksIskonto(e.target.value)} placeholder="sınırsız" /></Field></div>
              {rol === "b2b_bayi" && <div style={{ flex: 1, minWidth: 200 }}><Field label="Bağlı Bayi / Cari *"><Select required value={bayiCariId} onChange={(e) => setBayiCariId(e.target.value)}><option value="">Bayi seçin</option>{cariler.map((c) => <option key={c.id} value={c.id}>{c.unvan} ({c.kod})</option>)}</Select></Field></div>}
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
              <th>Bağlı Bayi / Cari</th>
              <th className="num">Maks. İskonto</th>
              <th className="center">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {kullanicilar.length === 0 ? (
              <tr><td colSpan={8} className="empty">Kullanıcı bulunamadı.</td></tr>
            ) : (
              kullanicilar.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 600 }}>{k.adSoyad}</td>
                  <td>
                    {k.eposta}
                    {!k.epostaDogrulandi && <span className="subtle"> · doğrulanmadı</span>}
                  </td>
                  <td style={{ minWidth: 150 }}>
                    {k.rol === "calisan" ? <span className="subtle">{rolAdi(k.rol)}</span> : <Select value={k.rol} onChange={(e) => rolDegistir(k.id, e.target.value as Rol)}>
                      {ROLLER.map((r) => (<option key={r} value={r}>{ROL_ADI[r]}</option>))}
                    </Select>}
                  </td>
                  <td><Status tone={k.aktif ? "ok" : "danger"}>{k.aktif ? "Aktif" : "Pasif"}</Status></td>
                  <td>{k.totpAktif ? <Badge variant="success">Etkin</Badge> : <span className="subtle">—</span>}</td>
                  <td style={{ minWidth: 220 }}>{k.rol === "b2b_bayi" ? <Select value={k.bayiCariId ?? ""} onChange={(e) => bayiCariDegistir(k.id, e.target.value)}><option value="">Atanmamış</option>{cariler.map((c) => <option key={c.id} value={c.id}>{c.unvan} ({c.kod})</option>)}</Select> : <span className="subtle">—</span>}</td>
                  <td className="num">{k.maksIskontoYuzdesi === null ? <span className="subtle">Sınırsız</span> : `%${k.maksIskontoYuzdesi}`}</td>
                  <td className="center">
                    <div className="row-tight" style={{ justifyContent: "center", flexWrap: "nowrap" }}>
                      {k.id !== benId && (
                        <Button size="sm" onClick={() => sifirlamaAc(k)}>Parolayı Sıfırla</Button>
                      )}
                      <Button size="sm" variant={k.aktif ? "danger" : "ghost"} onClick={() => aktifDegistir(k)}>
                        {k.aktif ? "Pasife Al" : "Aktif Et"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>

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
