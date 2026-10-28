"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Select, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

type PlatformRolu = "yonetici" | "mevzuat_editoru";
interface PlatformKullanici {
  id: string; eposta: string; adSoyad: string; rol: PlatformRolu; aktif: boolean;
  sonGiris: string | null; createdAt: string;
  /** Bekleyen kurulum: "hesap" davet, "iki_adim" 2FA yeniden kurulumu. */
  davetTuru: "hesap" | "iki_adim" | null; davetSonGecerlilik: string | null;
}
interface DavetSonucu { gonderildi: boolean; mesaj: string; baglanti?: string }

const ROL_ADI: Record<PlatformRolu, string> = { yonetici: "Platform yöneticisi", mevzuat_editoru: "Mevzuat editörü" };
const zaman = (s: string | null) => (s ? new Date(s).toLocaleString("tr-TR") : "—");

/** Onay penceresiyle yapılan işlemler. */
type Onay =
  | { tur: "rol"; k: PlatformKullanici; rol: PlatformRolu }
  | { tur: "aktif"; k: PlatformKullanici; aktif: boolean }
  | { tur: "iki-adim"; k: PlatformKullanici };

/**
 * PLT-07: platform kullanıcıları. Yeni kullanıcı davet bağlantısıyla parolasını
 * belirler ve 2FA'yı kurar; 2FA sıfırlanınca aynı yolla yeniden kurar.
 */
export default function PlatformKullanicilari() {
  const [liste, setListe] = useState<PlatformKullanici[] | null>(null);
  const [benId, setBenId] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [baglanti, setBaglanti] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [eposta, setEposta] = useState("");
  const [adSoyad, setAdSoyad] = useState("");
  const [rol, setRol] = useState<PlatformRolu>("mevzuat_editoru");
  const [onay, setOnay] = useState<Onay | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(async () => setListe(await platformApi<PlatformKullanici[]>("/platform/kullanicilar")), []);
  useEffect(() => {
    if (!platformTokenAl()) return;
    void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi"));
    void platformApi<{ kullaniciId: string }>("/platform/auth/ben").then((b) => setBenId(b.kullaniciId)).catch(() => undefined);
  }, [yukle]);

  function davetSonucuGoster(s: DavetSonucu) {
    if (s.gonderildi) setBasari(s.mesaj);
    else setHata(s.mesaj);
    setBaglanti(s.baglanti ?? "");
  }

  async function calistir(is: () => Promise<void>) {
    setIsleniyor(true);
    setHata("");
    setBasari("");
    setBaglanti("");
    try {
      await is();
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İşlem başarısız");
    } finally {
      setIsleniyor(false);
    }
  }

  function olustur(e: React.FormEvent) {
    e.preventDefault();
    void calistir(async () => {
      const s = await platformApi<{ davet: DavetSonucu }>("/platform/kullanicilar", { method: "POST", body: JSON.stringify({ eposta, adSoyad, rol }) });
      davetSonucuGoster(s.davet);
      setFormAcik(false);
      setEposta("");
      setAdSoyad("");
    });
  }

  function onayla(e: React.FormEvent) {
    e.preventDefault();
    if (!onay) return;
    const o = onay;
    setOnay(null);
    void calistir(async () => {
      if (o.tur === "rol") {
        await platformApi(`/platform/kullanicilar/${o.k.id}`, { method: "PATCH", body: JSON.stringify({ rol: o.rol }) });
        setBasari(`${o.k.adSoyad} artık ${ROL_ADI[o.rol].toLocaleLowerCase("tr-TR")}.`);
      } else if (o.tur === "aktif") {
        await platformApi(`/platform/kullanicilar/${o.k.id}`, { method: "PATCH", body: JSON.stringify({ aktif: o.aktif }) });
        setBasari(o.aktif ? `${o.k.adSoyad} aktif edildi.` : `${o.k.adSoyad} pasife alındı; açık oturumu en geç 10 saniyede düşer.`);
      } else {
        davetSonucuGoster(await platformApi<DavetSonucu>(`/platform/kullanicilar/${o.k.id}/iki-adim-sifirla`, { method: "POST" }));
      }
    });
  }

  const davetYenile = (k: PlatformKullanici) => void calistir(async () => davetSonucuGoster(await platformApi<DavetSonucu>(`/platform/kullanicilar/${k.id}/davet`, { method: "POST" })));

  return (
    <div className="stack">
      <PageHeader
        title="Platform kullanıcıları"
        subtitle="Davetle açılan hesaplar parolasını kendisi belirler ve iki adımlı doğrulamayı kurar. En az bir aktif platform yöneticisi kalır; kimse kendi rolünü değiştiremez."
        actions={<Button variant="primary" onClick={() => setFormAcik(true)}>Kullanıcı davet et</Button>}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      {baglanti && (
        <Card>
          <Field label="Kurulum bağlantısı (bir kez kullanılır)">
            <Input readOnly value={baglanti} onFocus={(e) => e.currentTarget.select()} />
          </Field>
        </Card>
      )}
      <Card pad={false}>
        <TableWrap>
          <table className="table">
            <thead><tr><th>Ad soyad</th><th>E-posta</th><th>Rol</th><th>Durum</th><th>Son giriş</th><th /></tr></thead>
            <tbody>
              {(liste ?? []).map((k) => {
                const ben = k.id === benId;
                return (
                  <tr key={k.id}>
                    <td>{k.adSoyad}{ben && <span className="subtle"> (siz)</span>}</td>
                    <td>{k.eposta}</td>
                    <td>
                      {ben ? ROL_ADI[k.rol] : (
                        <Select aria-label={`${k.adSoyad} rolü`} value={k.rol} disabled={isleniyor} onChange={(e) => setOnay({ tur: "rol", k, rol: e.target.value as PlatformRolu })}>
                          <option value="yonetici">{ROL_ADI.yonetici}</option>
                          <option value="mevzuat_editoru">{ROL_ADI.mevzuat_editoru}</option>
                        </Select>
                      )}
                    </td>
                    <td>
                      {!k.aktif ? <Badge variant="danger">Pasif</Badge>
                        : k.davetTuru === "hesap" ? <Badge variant="warning">Davet bekliyor</Badge>
                        : k.davetTuru === "iki_adim" ? <Badge variant="warning">2FA yeniden kurulacak</Badge>
                        : <Badge variant="success">Aktif</Badge>}
                      {k.davetTuru && k.davetSonGecerlilik && new Date(k.davetSonGecerlilik) < new Date() && <span className="subtle"> · bağlantı süresi doldu</span>}
                    </td>
                    <td className="subtle" style={{ whiteSpace: "nowrap" }}>{zaman(k.sonGiris)}</td>
                    <td>
                      {!ben && (
                        <div className="row-tight" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                          {k.aktif && k.davetTuru && <Button size="sm" disabled={isleniyor} onClick={() => davetYenile(k)}>Bağlantıyı yeniden gönder</Button>}
                          {k.aktif && k.davetTuru !== "hesap" && <Button size="sm" disabled={isleniyor} onClick={() => setOnay({ tur: "iki-adim", k })}>2FA sıfırla</Button>}
                          <Button size="sm" variant={k.aktif ? "danger" : "ghost"} disabled={isleniyor} onClick={() => setOnay({ tur: "aktif", k, aktif: !k.aktif })}>{k.aktif ? "Pasife al" : "Aktif et"}</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {liste && !liste.length && <tr><td colSpan={6}>Kayıt yok.</td></tr>}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      {formAcik && (
        <Modal baslik="Platform kullanıcısı davet et" aciklama="Kullanıcıya parolasını belirleyip iki adımlı doğrulamayı kuracağı bir bağlantı gider." onKapat={() => setFormAcik(false)}>
          <form onSubmit={olustur} className="stack">
            <Field label="Ad soyad"><Input required minLength={2} value={adSoyad} onChange={(e) => setAdSoyad(e.target.value)} /></Field>
            <Field label="E-posta"><Input type="email" required value={eposta} onChange={(e) => setEposta(e.target.value)} /></Field>
            <Field label="Rol">
              <Select value={rol} onChange={(e) => setRol(e.target.value as PlatformRolu)}>
                <option value="mevzuat_editoru">{ROL_ADI.mevzuat_editoru}</option>
                <option value="yonetici">{ROL_ADI.yonetici}</option>
              </Select>
            </Field>
            <p className="subtle" style={{ margin: 0 }}>Mevzuat editörü yalnız Mevzuat Merkezi&apos;nde çalışır; firmaları ve abonelikleri göremez.</p>
            <ModalEylem onVazgec={() => setFormAcik(false)} isleniyor={isleniyor} metin="Davet gönder" />
          </form>
        </Modal>
      )}

      {onay && (
        <Modal
          baslik={onay.tur === "rol" ? "Rol değişikliği" : onay.tur === "aktif" ? (onay.aktif ? "Kullanıcıyı aktif et" : "Kullanıcıyı pasife al") : "2FA sıfırlama"}
          onKapat={() => setOnay(null)}
        >
          <form onSubmit={onayla} className="stack">
            <p>
              {onay.tur === "rol" && <><strong>{onay.k.adSoyad}</strong> kullanıcısının rolü <strong>{ROL_ADI[onay.k.rol]}</strong> → <strong>{ROL_ADI[onay.rol]}</strong> olacak. Açık oturumuna en geç 10 saniyede yansır.</>}
              {onay.tur === "aktif" && (onay.aktif ? <><strong>{onay.k.adSoyad}</strong> yeniden giriş yapabilecek.</> : <><strong>{onay.k.adSoyad}</strong> giriş yapamayacak; açık oturumu en geç 10 saniyede düşer.</>)}
              {onay.tur === "iki-adim" && <><strong>{onay.k.adSoyad}</strong> kullanıcısının 2FA'sı geçersizleşir ve oturumu düşer. Kendisine mevcut parolasıyla 2FA'yı yeniden kuracağı bir bağlantı gider.</>}
            </p>
            <ModalEylem onVazgec={() => setOnay(null)} isleniyor={isleniyor} metin="Onayla" tehlikeli={onay.tur !== "rol" && !(onay.tur === "aktif" && onay.aktif)} />
          </form>
        </Modal>
      )}
    </div>
  );
}
