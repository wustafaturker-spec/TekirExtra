"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";
import { uygulamaAcik, type EbelgeUygulamalari } from "@tekirextra/shared";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader } from "@/components/ui";

interface Baglanti {
  id: string;
  saglayici: string;
  durum: string;
  kullaniciAdiMaskeli: string;
  testOrtami: boolean;
  /** Gizli olmayan kayıtlı ayarlar; düzenleme formu bunlarla açılır (EBLG-01b). */
  ayarlar: Partial<Record<string, string>>;
}

/** EBLG-01a: NES adresi girilmez, test ortamı seçiminden türer. */
const NES_ADRESI = { test: "https://apitest.nes.com.tr", canli: "https://api.nes.com.tr" };

/** GİB mükellef listesinin lokal kopyasının durumu (EBLG-10). */
interface MukellefListesi {
  sonSenkronAt: string | null;
  kayitSayisi: number;
  durum: string;
  hataMesaji: string | null;
  saglayici: string | null;
  taze: boolean;
}

const SAGLAYICILAR = [
  { id: "sovos", ad: "Sovos Bulut", aciklama: "Sovos Bulut e-Fatura ve e-Arşiv SOAP bağlantısı" },
  { id: "nes", ad: "NES", aciklama: "NES e-Belge Özel Entegratör REST API bağlantısı" },
  { id: "izibiz", ad: "İzibiz", aciklama: "İzibiz e-Belge Özel Entegratör Bağlantısı" },
  { id: "foriba", ad: "Foriba", aciklama: "Foriba (SAP) e-Belge Özel Entegratör Bağlantısı" },
  { id: "elogo", ad: "eLogo", aciklama: "Logo Yazılım (eLogo) e-Belge Özel Entegratör Bağlantısı" },
  { id: "uyumsoft", ad: "Uyumsoft", aciklama: "Uyumsoft e-Belge Özel Entegratör Bağlantısı" },
] as const;

function durumRozet(durum: string) {
  if (durum === "aktif") return <Badge variant="success">AKTİF</Badge>;
  if (durum === "hata") return <Badge variant="danger">HATA</Badge>;
  return <Badge variant="neutral">{durum.toUpperCase()}</Badge>;
}

export default function EntegratorAyarlariSayfasi() {
  const yonlendir = useRouter();
  const [baglantilar, setBaglantilar] = useState<Baglanti[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [aktifForm, setAktifForm] = useState<string | null>(null); // Hangi entegratörün formunun açık olduğunu tutar
  const [duzenleId, setDuzenleId] = useState<string | null>(null); // Düzenlenen bağlantının ID'si
  // Güncelleme config'i baştan yazar; düzenlemede seçim korunmazsa test bağlantısı canlıya döner.
  const [testOrtami, setTestOrtami] = useState(false);
  const [islemde, setIslemde] = useState<string | null>(null); // Yüklenme durumu için
  const [mukellefListesi, setMukellefListesi] = useState<MukellefListesi | null>(null);
  // EBLG-77: mükellef listesi yalnız e-Fatura kanalında anlamlıdır; e-Arşiv
  // kullanan firmada bölüm hiç gösterilmez (uç da guard ile kapalıdır).
  const [ebelgeUygulamalari, setEbelgeUygulamalari] = useState<EbelgeUygulamalari | null>(null);

  const yukle = useCallback(async () => {
    try {
      setBaglantilar(await api<Baglanti[]>("/baglantilar"));
      // Liste durumu bağlantıdan bağımsız okunur; bağlantı yoksa uç boş döner.
      setEbelgeUygulamalari(await api<EbelgeUygulamalari>("/ebelge/uygulamalar").catch(() => null));
      setMukellefListesi(await api<MukellefListesi>("/ebelge/mukellef-listesi").catch(() => null));
    } catch (h) {
      if (h instanceof ApiHata && h.durum === 401) {
        tokenYaz(null);
        yonlendir.push("/giris");
      } else {
        setHata(h instanceof Error ? h.message : "Bağlantılar yüklenemedi");
      }
    }
  }, [yonlendir]);

  useEffect(() => {
    if (!tokenAl()) {
      yonlendir.push("/giris");
      return;
    }
    void yukle();
  }, [yonlendir, yukle]);

  async function baglantiKaydet(e: FormEvent<HTMLFormElement>, saglayici: string) {
    e.preventDefault();
    setHata("");
    setBasari("");
    setIslemde(saglayici);
    const v = new FormData(e.currentTarget);
    const config = {
      kullaniciAdi: v.get("kullaniciAdi") as string,
      parola: (v.get("parola") as string) || undefined,
      apiAnahtari: (v.get("apiAnahtari") as string) || undefined,
      servisAdresi: (v.get("servisAdresi") as string) || undefined,
      earsivServisAdresi: (v.get("earsivServisAdresi") as string) || undefined,
      irsaliyeServisAdresi: (v.get("irsaliyeServisAdresi") as string) || undefined,
      vknTckn: (v.get("vknTckn") as string) || undefined,
      gondericiBirimEtiketi: (v.get("gondericiBirimEtiketi") as string) || undefined,
      postaKutusuEtiketi: (v.get("postaKutusuEtiketi") as string) || undefined,
      belgeSeriOneki: (v.get("belgeSeriOneki") as string) || undefined,
      earsivSeriOneki: (v.get("earsivSeriOneki") as string) || undefined,
      eirsaliyeSeriOneki: (v.get("eirsaliyeSeriOneki") as string) || undefined,
      eirsaliyeYanitSeriOneki: (v.get("eirsaliyeYanitSeriOneki") as string) || undefined,
      testOrtami: v.get("testOrtami") === "on" || undefined,
    };

    try {
      if (duzenleId) {
        await api(`/baglantilar/${duzenleId}`, {
          method: "PATCH",
          body: JSON.stringify({ config }),
        });
        setBasari(`${saglayici.toUpperCase()} entegratör ayarları güncellendi.`);
      } else {
        await api("/baglantilar", {
          method: "POST",
          body: JSON.stringify({ aile: "ebelge", saglayici, config }),
        });
        setBasari(`${saglayici.toUpperCase()} entegratör bağlantısı başarıyla eklendi.`);
      }
      setAktifForm(null);
      setDuzenleId(null);
      await yukle();
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "İşlem sırasında bir hata oluştu");
    } finally {
      setIslemde(null);
    }
  }

  async function testEt(id: string, saglayici: string) {
    setHata("");
    setBasari("");
    setIslemde(`test-${id}`);
    try {
      const s = await api<{ basarili: boolean; mesaj?: string }>(
        `/baglantilar/${id}/test`,
        { method: "POST" },
      );
      if (s.basarili) {
        setBasari(`${saglayici.toUpperCase()} bağlantı testi başarılı.`);
      } else {
        setHata(s.mesaj ?? `${saglayici.toUpperCase()} bağlantı testi başarısız.`);
      }
      await yukle();
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "Test hatası");
    } finally {
      setIslemde(null);
    }
  }

  async function aktifEt(id: string, saglayici: string) {
    setHata("");
    setBasari("");
    setIslemde(`aktif-${id}`);
    try {
      await api(`/baglantilar/${id}/aktif-et`, { method: "POST" });
      setBasari(`${saglayici.toUpperCase()} şu anda aktif entegratör olarak seçildi.`);
      await yukle();
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "Aktifleştirme hatası");
    } finally {
      setIslemde(null);
    }
  }

  async function sil(id: string, saglayici: string) {
    if (!confirm(`${saglayici.toUpperCase()} entegratör ayarlarını silmek istediğinize emin misiniz?`)) {
      return;
    }
    setHata("");
    setBasari("");
    setIslemde(`sil-${id}`);
    try {
      await api(`/baglantilar/${id}`, { method: "DELETE" });
      setBasari(`${saglayici.toUpperCase()} entegratör ayarları silindi.`);
      await yukle();
    } catch (h) {
      setHata(h instanceof ApiHata ? h.message : "Silme hatası");
    } finally {
      setIslemde(null);
    }
  }

  async function mukellefListesiniGuncelle() {
    setIslemde("mukellef");
    setHata("");
    setBasari("");
    try {
      const sonuc = await api<MukellefListesi>("/ebelge/mukellef-listesi/senkron", { method: "POST" });
      setMukellefListesi(sonuc);
      setBasari(`GİB mükellef listesi güncellendi: ${sonuc.kayitSayisi.toLocaleString("tr-TR")} etiket.`);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Mükellef listesi güncellenemedi");
    } finally {
      setIslemde(null);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <PageHeader
        title="⚙️ Entegratör Ayarları"
        subtitle="Şirketinizin e-Belge (e-Fatura / e-Arşiv) entegrasyon ayarlarını buradan yönetebilirsiniz."
        actions={<ButtonLabel as="a" href="/panel">← Panele Dön</ButtonLabel>}
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {(!ebelgeUygulamalari || uygulamaAcik(ebelgeUygulamalari, "efatura") || ebelgeUygulamalari.efatura.acik === null) && (
      <Card>
        <div className="between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="row-tight">
              <h3 style={{ fontSize: "1.15rem", margin: 0 }}>GİB Mükellef Listesi</h3>
              {mukellefListesi && (mukellefListesi.taze
                ? <Badge variant="success">GÜNCEL</Badge>
                : <Badge variant="danger">{mukellefListesi.sonSenkronAt ? "BAYAT" : "İNDİRİLMEDİ"}</Badge>)}
            </div>
            <p className="muted" style={{ fontSize: "0.85rem", margin: "0.35rem 0" }}>
              Alıcının e-Fatura mükellefi olup olmadığı bu lokal listeden belirlenir; gönderim sırasında
              entegratöre sorulmaz. Liste günde bir kez kendiliğinden güncellenir.
            </p>
            {mukellefListesi?.sonSenkronAt && (
              <div style={{ fontSize: "0.85rem" }}>
                <span className="muted">Son güncelleme: </span>
                {new Date(mukellefListesi.sonSenkronAt).toLocaleString("tr-TR")}
                <span className="muted"> · </span>
                {mukellefListesi.kayitSayisi.toLocaleString("tr-TR")} etiket
                {mukellefListesi.saglayici && <><span className="muted"> · </span>{mukellefListesi.saglayici}</>}
              </div>
            )}
            {mukellefListesi && !mukellefListesi.taze && (
              <p style={{ fontSize: "0.85rem", color: "var(--danger)", margin: "0.5rem 0 0" }}>
                Liste güncel olmadığı sürece e-Belge gönderimi durur — yanlış kanal seçmektense durmak tercih edilir.
                {mukellefListesi.hataMesaji && ` Son hata: ${mukellefListesi.hataMesaji}`}
              </p>
            )}
          </div>
          <Button variant="primary" size="sm" onClick={() => void mukellefListesiniGuncelle()} disabled={islemde !== null}>
            {islemde === "mukellef" ? "Güncelleniyor..." : "Listeyi Güncelle"}
          </Button>
        </div>
      </Card>
      )}

      <div className="stack">
        {SAGLAYICILAR.map((s) => {
          const baglanti = baglantilar.find((b) => b.saglayici === s.id);
          const formAcik = aktifForm === s.id;
          const aktif = baglanti?.durum === "aktif";
          // Sovos SOAP kullanıcı/parola ile, NES tek API anahtarıyla yetkilenir;
          // zorunlu alanlar bu yüzden sağlayıcıya göre değişir.
          const sovos = s.id === "sovos";
          const nes = s.id === "nes";
          // Düzenlemede gizli olmayan alanlar kayıtlı değerle açılır; gizli alanlar boş kalır ve boşsa korunur.
          const duzenlenen = duzenleId && baglanti?.id === duzenleId ? baglanti : undefined;
          const ayar = (ad: string) => duzenlenen?.ayarlar[ad] ?? "";
          const gizliIpucu = duzenlenen ? "Kayıtlı — değiştirmek için yazın" : undefined;

          return (
            <Card key={s.id} style={aktif ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : undefined}>
              <div className="between" style={{ alignItems: "flex-start" }}>
                <div>
                  <div className="row-tight">
                    <h3 style={{ fontSize: "1.15rem", margin: 0 }}>{s.ad}</h3>
                    {baglanti && durumRozet(baglanti.durum)}
                  </div>
                  <p className="muted" style={{ fontSize: "0.85rem", margin: "0.35rem 0" }}>{s.aciklama}</p>
                  {baglanti && (
                    <div style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
                      <span className="muted">Kullanıcı Adı: </span>
                      <code className="mono">{baglanti.kullaniciAdiMaskeli}</code>
                    </div>
                  )}
                </div>

                {!formAcik && (
                  <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                    {baglanti ? (
                      <>
                        {baglanti.durum !== "aktif" && (
                          <Button variant="primary" size="sm" onClick={() => void aktifEt(baglanti.id, s.id)} disabled={islemde !== null}>Aktif Et</Button>
                        )}
                        <Button size="sm" onClick={() => void testEt(baglanti.id, s.id)} disabled={islemde !== null}>
                          {islemde === `test-${baglanti.id}` ? "Test ediliyor..." : "Bağlantı Testi"}
                        </Button>
                        <Button size="sm" onClick={() => { setDuzenleId(baglanti.id); setTestOrtami(baglanti.testOrtami); setAktifForm(s.id); }} disabled={islemde !== null}>Düzenle</Button>
                        <Button variant="danger" size="sm" onClick={() => void sil(baglanti.id, s.id)} disabled={islemde !== null}>Sil</Button>
                      </>
                    ) : (
                      <Button variant="primary" size="sm" onClick={() => { setDuzenleId(null); setTestOrtami(false); setAktifForm(s.id); }} disabled={islemde !== null}>Bağlantıyı Kur</Button>
                    )}
                  </div>
                )}
              </div>

              {formAcik && (
                <form
                  onSubmit={(e) => void baglantiKaydet(e, s.id)}
                  style={{ marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: "1px dashed var(--border-strong)" }}
                >
                  <h4 className="card__title" style={{ fontSize: "0.95rem" }}>
                    {duzenleId ? `${s.ad} Bilgilerini Güncelle` : `${s.ad} Bağlantı Bilgileri`}
                  </h4>
                  {duzenlenen && (
                    <p className="muted" style={{ fontSize: "0.85rem", margin: "0 0 0.75rem" }}>
                      Kullanıcı adı, parola ve API anahtarı güvenlik nedeniyle gösterilmez; boş bırakırsanız kayıtlı değer korunur.
                      Diğer alanlar kayıtlı değerleriyle gelir — sildiğiniz alan kayıttan da silinir.
                    </p>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                    <Field label={nes ? "Portal Kullanıcısı *" : "Kullanıcı Adı *"}><Input name="kullaniciAdi" required={!duzenlenen} placeholder={gizliIpucu ?? (nes ? "test01@nes.com.tr" : "entegrator_kullanici_adi")} /></Field>
                    <Field label={nes ? "Portal Parolası" : "Parola / Şifre"}><Input name="parola" type="password" placeholder={gizliIpucu ?? "••••••••"} /></Field>
                    <Field label={nes ? "API Anahtarı *" : "API Anahtarı (Opsiyonel)"}><Input name="apiAnahtari" required={nes && !duzenlenen} placeholder={gizliIpucu ?? (nes ? "NES erişim sayfasındaki API KEY" : "api_key_xyz")} /></Field>
                    {!nes && <Field label={sovos ? "e-Fatura Servis URL *" : "Servis URL (Opsiyonel)"}><Input name="servisAdresi" defaultValue={ayar("servisAdresi")} required={sovos} placeholder={sovos ? "Sovos tarafından verilen .svc adresi" : "https://api.entegrator.com"} /></Field>}
                    {(sovos || nes) && <>
                      <Field label={sovos ? "Firma VKN/TCKN *" : "Firma VKN/TCKN"}><Input name="vknTckn" defaultValue={ayar("vknTckn")} required={sovos} inputMode="numeric" placeholder="1234567890" /></Field>
                      <Field label="Gönderici Birim (GB) Etiketi *"><Input name="gondericiBirimEtiketi" defaultValue={ayar("gondericiBirimEtiketi")} required placeholder="urn:mail:defaultgb@firma.com" /></Field>
                      <Field label="Posta Kutusu (PK) Etiketi"><Input name="postaKutusuEtiketi" defaultValue={ayar("postaKutusuEtiketi")} placeholder="urn:mail:defaultpk@firma.com" /></Field>
                    </>}
                    {(sovos || nes) && (
                      <Field label="Test Ortamı">
                        <label className="row-tight" style={{ gap: "0.5rem", alignItems: "center" }}>
                          <input type="checkbox" name="testOrtami" checked={testOrtami} onChange={(e) => setTestOrtami(e.target.checked)} />
                          <span className="muted" style={{ fontSize: "0.85rem" }}>
                            Entegratörün test ortamı — sentetik firma VKN&apos;si kabul edilir
                            {nes && <><br />Bağlanılacak adres: <code className="mono">{testOrtami ? NES_ADRESI.test : NES_ADRESI.canli}</code></>}
                          </span>
                        </label>
                      </Field>
                    )}
                    {nes && (
                      <>
                        <Field label="Otomatik Seri Öneki (e-Fatura)">
                          <Input name="belgeSeriOneki" defaultValue={ayar("belgeSeriOneki")} maxLength={8} placeholder="K07 — boşsa numarayı TekirExtra atar" />
                        </Field>
                        <Field label="Otomatik Seri Öneki (e-Arşiv)">
                          <Input name="earsivSeriOneki" defaultValue={ayar("earsivSeriOneki")} maxLength={8} placeholder="GİB e-Fatura serisinden farklı olmasını ister" />
                        </Field>
                        <Field label="e-İrsaliye Seri Öneki (elle numaralı)">
                          <Input name="eirsaliyeSeriOneki" defaultValue={ayar("eirsaliyeSeriOneki")} maxLength={3} placeholder="Ör. TX2 — zorunlu; otomatik seri olamaz" />
                          <small className="muted">Numarayı program verir; seri entegratörde elle numaralı tanımlı olmalı. Etkinleştirmede entegratördeki serilerle karşılaştırılır.</small>
                        </Field>
                        <Field label="e-İrsaliye Yanıt Seri Öneki">
                          <Input name="eirsaliyeYanitSeriOneki" defaultValue={ayar("eirsaliyeYanitSeriOneki")} maxLength={3} placeholder="YNT — numarayı entegratör atar" />
                        </Field>
                      </>
                    )}
                    {sovos && <>
                      <Field label="e-Arşiv Servis URL"><Input name="earsivServisAdresi" defaultValue={ayar("earsivServisAdresi")} placeholder="Sovos tarafından verilen e-Arşiv .svc adresi" /></Field>
                      <Field label="e-İrsaliye Servis URL"><Input name="irsaliyeServisAdresi" defaultValue={ayar("irsaliyeServisAdresi")} placeholder="Sovos tarafından verilen e-İrsaliye .svc adresi" /></Field>
                    </>}
                  </div>
                  <div className="row-tight" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
                    <Button type="button" onClick={() => { setAktifForm(null); setDuzenleId(null); }}>İptal</Button>
                    <Button variant="primary" type="submit" disabled={islemde !== null}>
                      {islemde === s.id ? "Kaydediliyor..." : "Bağlantıyı Kaydet"}
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
