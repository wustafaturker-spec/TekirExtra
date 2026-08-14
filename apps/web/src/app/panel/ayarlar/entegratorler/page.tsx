"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader } from "@/components/ui";

interface Baglanti {
  id: string;
  saglayici: string;
  durum: string;
  kullaniciAdiMaskeli: string;
}

const SAGLAYICILAR = [
  { id: "sovos", ad: "Sovos Bulut", aciklama: "Sovos Bulut e-Fatura ve e-Arşiv SOAP bağlantısı" },
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
  const [islemde, setIslemde] = useState<string | null>(null); // Yüklenme durumu için

  const yukle = useCallback(async () => {
    try {
      setBaglantilar(await api<Baglanti[]>("/baglantilar"));
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

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <PageHeader
        title="⚙️ Entegratör Ayarları"
        subtitle="Şirketinizin e-Belge (e-Fatura / e-Arşiv) entegrasyon ayarlarını buradan yönetebilirsiniz."
        actions={<ButtonLabel as="a" href="/panel">← Panele Dön</ButtonLabel>}
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="stack">
        {SAGLAYICILAR.map((s) => {
          const baglanti = baglantilar.find((b) => b.saglayici === s.id);
          const formAcik = aktifForm === s.id;
          const aktif = baglanti?.durum === "aktif";

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
                        <Button size="sm" onClick={() => { setDuzenleId(baglanti.id); setAktifForm(s.id); }} disabled={islemde !== null}>Düzenle</Button>
                        <Button variant="danger" size="sm" onClick={() => void sil(baglanti.id, s.id)} disabled={islemde !== null}>Sil</Button>
                      </>
                    ) : (
                      <Button variant="primary" size="sm" onClick={() => { setDuzenleId(null); setAktifForm(s.id); }} disabled={islemde !== null}>Bağlantıyı Kur</Button>
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
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                    <Field label="Kullanıcı Adı *"><Input name="kullaniciAdi" required placeholder="entegrator_kullanici_adi" /></Field>
                    <Field label="Parola / Şifre"><Input name="parola" type="password" placeholder="••••••••" /></Field>
                    <Field label="API Anahtarı (Opsiyonel)"><Input name="apiAnahtari" placeholder="api_key_xyz" /></Field>
                    <Field label={s.id === "sovos" ? "e-Fatura Servis URL *" : "Servis URL (Opsiyonel)"}><Input name="servisAdresi" required={s.id === "sovos"} placeholder={s.id === "sovos" ? "Sovos tarafından verilen .svc adresi" : "https://api.entegrator.com"} /></Field>
                    {s.id === "sovos" && <>
                      <Field label="Firma VKN/TCKN *"><Input name="vknTckn" required inputMode="numeric" placeholder="1234567890" /></Field>
                      <Field label="Gönderici Birim (GB) Etiketi *"><Input name="gondericiBirimEtiketi" required placeholder="urn:mail:defaultgb@firma.com" /></Field>
                      <Field label="Posta Kutusu (PK) Etiketi"><Input name="postaKutusuEtiketi" placeholder="urn:mail:defaultpk@firma.com" /></Field>
                      <Field label="e-Arşiv Servis URL"><Input name="earsivServisAdresi" placeholder="Sovos tarafından verilen e-Arşiv .svc adresi" /></Field>
                      <Field label="e-İrsaliye Servis URL"><Input name="irsaliyeServisAdresi" placeholder="Sovos tarafından verilen e-İrsaliye .svc adresi" /></Field>
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
