"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";
import { stil } from "@/lib/stil";

interface Baglanti {
  id: string;
  saglayici: string;
  durum: string;
  kullaniciAdiMaskeli: string;
}

const SAGLAYICILAR = [
  { id: "izibiz", ad: "İzibiz", aciklama: "İzibiz e-Belge Özel Entegratör Bağlantısı" },
  { id: "foriba", ad: "Foriba", aciklama: "Foriba (SAP) e-Belge Özel Entegratör Bağlantısı" },
  { id: "elogo", ad: "eLogo", aciklama: "Logo Yazılım (eLogo) e-Belge Özel Entegratör Bağlantısı" },
  { id: "uyumsoft", ad: "Uyumsoft", aciklama: "Uyumsoft e-Belge Özel Entegratör Bağlantısı" },
] as const;

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
    };

    try {
      if (duzenleId) {
        // Güncelleme işlemi
        await api(`/baglantilar/${duzenleId}`, {
          method: "PATCH",
          body: JSON.stringify({ config }),
        });
        setBasari(`${saglayici.toUpperCase()} entegratör ayarları güncellendi.`);
      } else {
        // Yeni kayıt işlemi
        await api("/baglantilar", {
          method: "POST",
          body: JSON.stringify({
            aile: "ebelge",
            saglayici,
            config,
          }),
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
    <main style={{ ...stil.sayfa, alignItems: "flex-start", paddingTop: "3rem", paddingBottom: "3rem" }}>
      <div style={{ ...stil.kart, maxWidth: 800, width: "90%", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", margin: 0 }}>⚙️ Entegratör Ayarları</h1>
            <p style={{ color: "#78716c", fontSize: "0.9rem", marginTop: "0.25rem" }}>
              Şirketinizin e-Belge (e-Fatura / e-Arşiv) entegrasyon ayarlarını buradan yönetebilirsiniz.
            </p>
          </div>
          <button
            onClick={() => yonlendir.push("/panel")}
            style={{
              ...stil.dugme,
              width: "auto",
              padding: ".5rem 1rem",
              background: "#78716c",
            }}
          >
            Geri Dön
          </button>
        </div>

        {hata && <div style={{ ...stil.hata, padding: "0.75rem", background: "#fef2f2", borderRadius: "8px", marginBottom: "1rem" }}>{hata}</div>}
        {basari && <div style={{ ...stil.basari, padding: "0.75rem", background: "#f0fdf4", borderRadius: "8px", marginBottom: "1rem" }}>{basari}</div>}

        <div style={{ display: "grid", gap: "1.5rem" }}>
          {SAGLAYICILAR.map((s) => {
            const baglanti = baglantilar.find((b) => b.saglayici === s.id);
            const formAcik = aktifForm === s.id;

            return (
              <div
                key={s.id}
                style={{
                  border: "1px solid #e7e5e4",
                  borderRadius: "12px",
                  padding: "1.5rem",
                  background: baglanti?.durum === "aktif" ? "#fafaf9" : "#fff",
                  boxShadow: baglanti?.durum === "aktif" ? "0 0 0 2px #1c1917" : "none",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <h3 style={{ margin: 0, fontSize: "1.2rem" }}>{s.ad}</h3>
                      {baglanti && (
                        <span
                          style={{
                            padding: "0.2rem 0.6rem",
                            borderRadius: "9999px",
                            fontSize: "0.75rem",
                            fontWeight: "bold",
                            background:
                              baglanti.durum === "aktif"
                                ? "#dcfce7"
                                : baglanti.durum === "hata"
                                ? "#fee2e2"
                                : "#f5f5f4",
                            color:
                              baglanti.durum === "aktif"
                                ? "#15803d"
                                : baglanti.durum === "hata"
                                ? "#b91c1c"
                                : "#57534e",
                          }}
                        >
                          {baglanti.durum.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p style={{ color: "#78716c", fontSize: "0.85rem", margin: "0.3rem 0" }}>{s.aciklama}</p>
                    {baglanti && (
                      <div style={{ fontSize: "0.85rem", color: "#444", marginTop: "0.5rem" }}>
                        <strong>Kullanıcı Adı:</strong> <code>{baglanti.kullaniciAdiMaskeli}</code>
                      </div>
                    )}
                  </div>

                  {!formAcik && (
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {baglanti ? (
                        <>
                          {baglanti.durum !== "aktif" && (
                            <button
                              onClick={() => void aktifEt(baglanti.id, s.id)}
                              disabled={islemde !== null}
                              style={{
                                ...stil.dugme,
                                width: "auto",
                                padding: "0.45rem 0.9rem",
                                background: "#15803d",
                                fontSize: "0.85rem",
                              }}
                            >
                              Aktif Et
                            </button>
                          )}
                          <button
                            onClick={() => void testEt(baglanti.id, s.id)}
                            disabled={islemde !== null}
                            style={{
                              ...stil.dugme,
                              width: "auto",
                              padding: "0.45rem 0.9rem",
                              background: "#0284c7",
                              fontSize: "0.85rem",
                            }}
                          >
                            {islemde === `test-${baglanti.id}` ? "Test ediliyor..." : "Bağlantı Testi"}
                          </button>
                          <button
                            onClick={() => {
                              setDuzenleId(baglanti.id);
                              setAktifForm(s.id);
                            }}
                            disabled={islemde !== null}
                            style={{
                              ...stil.dugme,
                              width: "auto",
                              padding: "0.45rem 0.9rem",
                              background: "#78716c",
                              fontSize: "0.85rem",
                            }}
                          >
                            Düzenle
                          </button>
                          <button
                            onClick={() => void sil(baglanti.id, s.id)}
                            disabled={islemde !== null}
                            style={{
                              ...stil.dugme,
                              width: "auto",
                              padding: "0.45rem 0.9rem",
                              background: "#b91c1c",
                              fontSize: "0.85rem",
                            }}
                          >
                            Sil
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setDuzenleId(null);
                            setAktifForm(s.id);
                          }}
                          disabled={islemde !== null}
                          style={{
                            ...stil.dugme,
                            width: "auto",
                            padding: "0.45rem 0.9rem",
                            fontSize: "0.85rem",
                          }}
                        >
                          Bağlantıyı Kur
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {formAcik && (
                  <form
                    onSubmit={(e) => void baglantiKaydet(e, s.id)}
                    style={{
                      marginTop: "1.25rem",
                      paddingTop: "1.25rem",
                      borderTop: "1px dashed #e7e5e4",
                    }}
                  >
                    <h4 style={{ margin: "0 0 1rem 0" }}>
                      {duzenleId ? `${s.ad} Bilgilerini Güncelle` : `${s.ad} Bağlantı Bilgileri`}
                    </h4>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                      <label style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
                        Kullanıcı Adı *
                        <input name="kullaniciAdi" required style={stil.girdi} placeholder="entegrator_kullanici_adi" />
                      </label>
                      <label style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
                        Parola / Şifre
                        <input name="parola" type="password" style={stil.girdi} placeholder="••••••••" />
                      </label>
                      <label style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
                        API Anahtarı (Opsiyonel)
                        <input name="apiAnahtari" style={stil.girdi} placeholder="api_key_xyz" />
                      </label>
                      <label style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
                        Servis URL (Opsiyonel)
                        <input name="servisAdresi" style={stil.girdi} placeholder="https://api.entegrator.com" />
                      </label>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setAktifForm(null);
                          setDuzenleId(null);
                        }}
                        style={{
                          ...stil.dugme,
                          width: "auto",
                          padding: "0.5rem 1rem",
                          background: "#e7e5e4",
                          color: "#1c1917",
                        }}
                      >
                        İptal
                      </button>
                      <button
                        type="submit"
                        disabled={islemde !== null}
                        style={{
                          ...stil.dugme,
                          width: "auto",
                          padding: "0.5rem 1rem",
                        }}
                      >
                        {islemde === s.id ? "Kaydediliyor..." : "Bağlantıyı Kaydet"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
