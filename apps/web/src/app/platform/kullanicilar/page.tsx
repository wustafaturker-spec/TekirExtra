"use client";

import { useState } from "react";
import { RefreshCw, UserPlus } from "lucide-react";
import { PlatformArama, PlatformListeDurumu } from "@/components/platform-liste";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Select, TableWrap } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";

type PlatformRolu = "yonetici" | "mevzuat_editoru";
interface PlatformKullanici {
  id: string; eposta: string; adSoyad: string; rol: PlatformRolu; aktif: boolean;
  sonGiris: string | null; createdAt: string;
  /** Bekleyen kurulum: "hesap" davet, "iki_adim" 2FA yeniden kurulumu. */
  davetTuru: "hesap" | "iki_adim" | null; davetSonGecerlilik: string | null;
  /** PLT-31: üzerindeki açık platform görevi; editöre düşürülürken aktarılır. */
  acikPlatformGorevi: number;
}
interface DavetSonucu { gonderildi: boolean; mesaj: string; baglanti?: string }

const ROL_ADI: Record<PlatformRolu, string> = { yonetici: "Platform yöneticisi", mevzuat_editoru: "Mevzuat editörü" };
const zaman = (s: string | null) => (s ? new Date(s).toLocaleString("tr-TR") : "—");

/** Onay penceresiyle yapılan işlemler. */
type Onay =
  | { tur: "rol"; k: PlatformKullanici; rol: PlatformRolu; hedefId: string }
  | { tur: "aktif"; k: PlatformKullanici; aktif: boolean }
  | { tur: "iki-adim"; k: PlatformKullanici };

/**
 * PLT-07: platform kullanıcıları. Yeni kullanıcı davet bağlantısıyla parolasını
 * belirler ve 2FA'yı kurar; 2FA sıfırlanınca aynı yolla yeniden kurar.
 */
export default function PlatformKullanicilari() {
  const { veri: liste, yukleniyor, hata: listeHatasi, yenile: yukle } = usePlatformVerisi<PlatformKullanici[]>("/platform/kullanicilar");
  const { veri: kimlik, hata: kimlikHatasi, yukleniyor: kimlikYukleniyor, yenile: kimlikYenile } = usePlatformVerisi<{ kullaniciId: string }>("/platform/auth/ben");
  const benId = kimlik?.kullaniciId;
  const [arama, setArama] = useState("");
  const [durumFiltresi, setDurumFiltresi] = useState("hepsi");
  const [rolFiltresi, setRolFiltresi] = useState("hepsi");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [baglanti, setBaglanti] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [eposta, setEposta] = useState("");
  const [adSoyad, setAdSoyad] = useState("");
  const [rol, setRol] = useState<PlatformRolu>("mevzuat_editoru");
  const [onay, setOnay] = useState<Onay | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  const aranan = arama.trim().toLocaleLowerCase("tr-TR");
  const gorunen = (liste ?? []).filter((k) => (rolFiltresi === "hepsi" || k.rol === rolFiltresi)
    && (durumFiltresi === "hepsi" || (durumFiltresi === "pasif" ? !k.aktif : durumFiltresi === "kurulum" ? k.aktif && Boolean(k.davetTuru) : k.aktif && !k.davetTuru))
    && `${k.adSoyad} ${k.eposta}`.toLocaleLowerCase("tr-TR").includes(aranan));
  const kilitli = isleniyor || !benId;
  // PLT-31: editöre düşen kişi platform görevlerini göremez; açık olanlar başka bir kurulu, aktif yöneticiye aktarılır.
  const aktarimGerekli = (o: Onay): o is Extract<Onay, { tur: "rol" }> => o.tur === "rol" && o.k.rol === "yonetici" && o.rol !== "yonetici" && o.k.acikPlatformGorevi > 0;
  const aktarimAdaylari = (k: PlatformKullanici) => (liste ?? []).filter((x) => x.id !== k.id && x.rol === "yonetici" && x.aktif && !x.davetTuru);

  function davetSonucuGoster(s: DavetSonucu) {
    if (s.gonderildi) setBasari(s.mesaj);
    else setHata(s.mesaj);
    setBaglanti(s.baglanti ?? "");
  }

  async function calistir(is: () => Promise<void>) {
    if (isleniyor || !benId) return;
    setIsleniyor(true);
    setHata("");
    setBasari("");
    setBaglanti("");
    try {
      await is();
      yukle();
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
    if (aktarimGerekli(onay) && !onay.hedefId) return;
    const o = onay;
    setOnay(null);
    void calistir(async () => {
      if (o.tur === "rol") {
        const aktarim = aktarimGerekli(o) ? { gorevAktarimHedefiId: o.hedefId } : {};
        await platformApi(`/platform/kullanicilar/${o.k.id}`, { method: "PATCH", body: JSON.stringify({ rol: o.rol, ...aktarim }) });
        const hedef = aktarimGerekli(o) ? liste?.find((k) => k.id === o.hedefId)?.adSoyad : undefined;
        setBasari(`${o.k.adSoyad} artık ${ROL_ADI[o.rol].toLocaleLowerCase("tr-TR")}.${hedef ? ` ${o.k.acikPlatformGorevi} açık platform görevi ${hedef} kişisine aktarıldı.` : ""}`);
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
    <div className="stack platform-users">
      <PageHeader
        title="Platform kullanıcıları"
        subtitle="Davetle açılan hesaplar parolasını kendisi belirler ve iki adımlı doğrulamayı kurar. En az bir aktif platform yöneticisi kalır; kimse kendi rolünü değiştiremez."
        actions={<div className="platform-row-actions"><Button disabled={yukleniyor || isleniyor} onClick={yukle}><RefreshCw size={16} aria-hidden="true" />Yenile</Button><Button variant="primary" disabled={kilitli} onClick={() => setFormAcik(true)}><UserPlus size={16} aria-hidden="true" />Kullanıcı davet et</Button></div>}
      />
      {(kimlikHatasi || (!kimlikYukleniyor && !benId)) && <Alert tone="warning">Oturum kimliği doğrulanamadı. Kullanıcı işlemleri için yeniden deneyin. <Button size="sm" onClick={kimlikYenile}>Kimliği yeniden doğrula</Button></Alert>}
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      {baglanti && (
        <Card>
          <Field label="Kurulum bağlantısı (bir kez kullanılır)">
            <Input readOnly value={baglanti} onFocus={(e) => e.currentTarget.select()} />
          </Field>
        </Card>
      )}
      <div className="platform-overview platform-user-overview" aria-label="Kullanıcı durumları">{([
        ["hepsi", "Tüm hesaplar", liste?.length ?? 0],
        ["aktif", "Aktif", liste?.filter((k) => k.aktif && !k.davetTuru).length ?? 0],
        ["kurulum", "Kurulum bekliyor", liste?.filter((k) => k.aktif && k.davetTuru).length ?? 0],
        ["pasif", "Pasif", liste?.filter((k) => !k.aktif).length ?? 0],
      ] as const).map(([deger, ad, sayi]) => <button key={deger} className={`platform-metric${durumFiltresi === deger ? " is-active" : ""}`} aria-pressed={durumFiltresi === deger} onClick={() => setDurumFiltresi(deger)}><span>{ad}</span><strong>{yukleniyor || listeHatasi ? "—" : sayi}</strong></button>)}</div>
      <Card title="Ekip ve erişim" pad={false}>
        <div className="platform-filter-bar">
          <PlatformArama etiket="Platform kullanıcısı ara" deger={arama} onChange={setArama} placeholder="Ad soyad veya e-posta ara…" />
          <Field label="Rol filtresi"><Select value={rolFiltresi} onChange={(e) => setRolFiltresi(e.target.value)}><option value="hepsi">Tüm roller</option><option value="yonetici">Platform yöneticisi</option><option value="mevzuat_editoru">Mevzuat editörü</option></Select></Field>
        </div>
        <div className="platform-list-caption" role="status">{yukleniyor ? "Kullanıcılar yükleniyor…" : listeHatasi ? "Liste alınamadı" : `${gorunen.length} kullanıcı`}</div>
        <TableWrap className="platform-responsive-table platform-users-table">
          <table className="table">
            <thead><tr><th>Ad soyad</th><th>E-posta</th><th>Rol</th><th>Durum</th><th>Son giriş</th><th>İşlem</th></tr></thead>
            <tbody>
              {(!yukleniyor && !listeHatasi ? gorunen : []).map((k) => {
                const ben = k.id === benId;
                return (
                  <tr key={k.id}>
                    <td data-label="Ad soyad" className="platform-cell-title"><strong>{k.adSoyad}</strong>{ben && <span className="subtle"> (siz)</span>}</td>
                    <td data-label="E-posta">{k.eposta}</td>
                    <td data-label="Rol">
                      {ben ? ROL_ADI[k.rol] : (
                        <Select aria-label={`${k.adSoyad} rolü`} value={k.rol} disabled={kilitli} onChange={(e) => setOnay({ tur: "rol", k, rol: e.target.value as PlatformRolu, hedefId: "" })}>
                          <option value="yonetici">{ROL_ADI.yonetici}</option>
                          <option value="mevzuat_editoru">{ROL_ADI.mevzuat_editoru}</option>
                        </Select>
                      )}
                    </td>
                    <td data-label="Durum">
                      {!k.aktif ? <Badge variant="danger">Pasif</Badge>
                        : k.davetTuru === "hesap" ? <Badge variant="warning">Davet bekliyor</Badge>
                        : k.davetTuru === "iki_adim" ? <Badge variant="warning">2FA yeniden kurulacak</Badge>
                        : <Badge variant="success">Aktif</Badge>}
                      {k.davetTuru && k.davetSonGecerlilik && new Date(k.davetSonGecerlilik) < new Date() && <span className="subtle"> · bağlantı süresi doldu</span>}
                    </td>
                    <td data-label="Son giriş" className="subtle">{zaman(k.sonGiris)}</td>
                    <td data-label="İşlem">
                      {!ben && (
                        <div className="platform-row-actions">
                          {k.aktif && k.davetTuru && <Button size="sm" disabled={kilitli} onClick={() => davetYenile(k)}>Bağlantıyı yeniden gönder</Button>}
                          {k.aktif && k.davetTuru !== "hesap" && <Button size="sm" disabled={kilitli} onClick={() => setOnay({ tur: "iki-adim", k })}>2FA sıfırla</Button>}
                          <Button size="sm" variant={k.aktif ? "danger" : "ghost"} disabled={kilitli} onClick={() => setOnay({ tur: "aktif", k, aktif: !k.aktif })}>{k.aktif ? "Pasife al" : "Aktif et"}</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              <PlatformListeDurumu sutun={6} yukleniyor={yukleniyor} hata={listeHatasi} bos={!gorunen.length} baslik="Eşleşen kullanıcı yok." aciklama="Arama metnini, durumu veya rol filtresini değiştirin." onTekrar={yukle} />
            </tbody>
          </table>
        </TableWrap>
      </Card>

      {formAcik && (
        <Modal baslik="Platform kullanıcısı davet et" aciklama="Kullanıcıya parolasını belirleyip iki adımlı doğrulamayı kuracağı bir bağlantı gider." onKapat={() => setFormAcik(false)}>
          <form onSubmit={olustur} className="stack">
            <Field label="Ad soyad"><Input autoFocus required minLength={2} value={adSoyad} onChange={(e) => setAdSoyad(e.target.value)} /></Field>
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
              {onay.tur === "aktif" && (onay.aktif ? <><strong>{onay.k.adSoyad}</strong> yeniden giriş yapabilecek.</> : <><strong>{onay.k.adSoyad}</strong> giriş yapamayacak; açık oturumu en geç 10 saniyede düşer.{onay.k.acikPlatformGorevi > 0 && <> Üzerindeki <strong>{onay.k.acikPlatformGorevi}</strong> açık platform görevi görev merkezinde &ldquo;Sorumlusu pasif&rdquo; olarak işaretlenir; yeniden atayın.</>}</>)}
              {onay.tur === "iki-adim" && <><strong>{onay.k.adSoyad}</strong> kullanıcısının 2FA'sı geçersizleşir ve oturumu düşer. Kendisine mevcut parolasıyla 2FA'yı yeniden kuracağı bir bağlantı gider.</>}
            </p>
            {aktarimGerekli(onay) && (aktarimAdaylari(onay.k).length ? (
              <Field label={`${onay.k.acikPlatformGorevi} açık platform görevinin aktarılacağı yönetici`}>
                <Select required value={onay.hedefId} onChange={(e) => setOnay({ ...onay, hedefId: e.target.value })}>
                  <option value="">Yönetici seçin…</option>
                  {aktarimAdaylari(onay.k).map((k) => <option key={k.id} value={k.id}>{k.adSoyad}</option>)}
                </Select>
              </Field>
            ) : <Alert tone="warning">Görevleri devralabilecek, kurulumu tamamlanmış başka bir aktif yönetici yok. Önce bir yönetici ekleyin ya da görevleri görev merkezinden yeniden atayın.</Alert>)}
            <ModalEylem onVazgec={() => setOnay(null)} isleniyor={isleniyor} metin="Onayla" tehlikeli={onay.tur !== "rol" && !(onay.tur === "aktif" && onay.aktif)} />
          </form>
        </Modal>
      )}
    </div>
  );
}
