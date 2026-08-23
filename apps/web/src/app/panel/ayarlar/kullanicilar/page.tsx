"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Status,
  TableWrap,
} from "@/components/ui";

const ROLLER = ["yonetici", "muhasebe", "satis", "salt_okunur", "mali_musavir", "b2b_bayi", "uretim_planlama", "uretim_operatoru", "depo", "kalite", "maliyet_muhasebesi"] as const;
type Rol = (typeof ROLLER)[number];
const ROL_ADI: Record<Rol, string> = {
  yonetici: "Yönetici",
  muhasebe: "Muhasebe",
  satis: "Satış",
  salt_okunur: "Salt Okunur",
  mali_musavir: "Mali Müşavir",
  b2b_bayi: "B2B Bayi",
  uretim_planlama: "Üretim Planlama",
  uretim_operatoru: "Üretim Operatörü",
  depo: "Depo Sorumlusu",
  kalite: "Kalite Sorumlusu",
  maliyet_muhasebesi: "Maliyet Muhasebesi",
};

interface Kullanici {
  id: string;
  eposta: string;
  adSoyad: string;
  rol: Rol;
  aktif: boolean;
  epostaDogrulandi: boolean;
  totpAktif: boolean;
  maksIskontoYuzdesi: number | null;
}

export default function KullanicilarSayfasi() {
  const [kullanicilar, setKullanicilar] = useState<Kullanici[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);

  // Yeni kullanıcı formu
  const [eposta, setEposta] = useState("");
  const [adSoyad, setAdSoyad] = useState("");
  const [rol, setRol] = useState<Rol>("satis");
  const [parola, setParola] = useState("");
  const [maksIskonto, setMaksIskonto] = useState("");

  const yukle = useCallback(async () => {
    setHata("");
    try {
      setKullanicilar(await api<Kullanici[]>("/kullanicilar"));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kullanıcılar yüklenemedi (yalnızca yönetici görebilir)");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

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
        }),
      });
      setBasari(`${adSoyad} kullanıcısı oluşturuldu.`);
      setFormAcik(false);
      setEposta("");
      setAdSoyad("");
      setRol("satis");
      setParola("");
      setMaksIskonto("");
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

  return (
    <div>
      <PageHeader
        title="Kullanıcılar"
        subtitle="Firma kullanıcılarını yönetin: davet, rol atama, aktif/pasif (yalnızca yönetici) — KLN-02."
        actions={
          <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
            {formAcik ? "Vazgeç" : "➕ Yeni Kullanıcı"}
          </Button>
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
              <th className="num">Maks. İskonto</th>
              <th className="center">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {kullanicilar.length === 0 ? (
              <tr><td colSpan={7} className="empty">Kullanıcı bulunamadı.</td></tr>
            ) : (
              kullanicilar.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontWeight: 600 }}>{k.adSoyad}</td>
                  <td>
                    {k.eposta}
                    {!k.epostaDogrulandi && <span className="subtle"> · doğrulanmadı</span>}
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <Select value={k.rol} onChange={(e) => rolDegistir(k.id, e.target.value as Rol)}>
                      {ROLLER.map((r) => (<option key={r} value={r}>{ROL_ADI[r]}</option>))}
                    </Select>
                  </td>
                  <td><Status tone={k.aktif ? "ok" : "danger"}>{k.aktif ? "Aktif" : "Pasif"}</Status></td>
                  <td>{k.totpAktif ? <Badge variant="success">Etkin</Badge> : <span className="subtle">—</span>}</td>
                  <td className="num">{k.maksIskontoYuzdesi === null ? <span className="subtle">Sınırsız</span> : `%${k.maksIskontoYuzdesi}`}</td>
                  <td className="center">
                    <Button size="sm" variant={k.aktif ? "danger" : "ghost"} onClick={() => aktifDegistir(k)}>
                      {k.aktif ? "Pasife Al" : "Aktif Et"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
