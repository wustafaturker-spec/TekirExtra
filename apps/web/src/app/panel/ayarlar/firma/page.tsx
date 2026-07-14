"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";
import { stil } from "@/lib/stil";

interface Logo {
  id: string;
  dosyaAdi: string;
  mimeTip: string;
  boyut: number;
}

interface Firma {
  id: string;
  unvan: string;
  vkn: string;
  vergiDairesi: string | null;
  logo: Logo | null;
}

export default function FirmaAyarlariSayfasi() {
  const yonlendir = useRouter();
  const [firma, setFirma] = useState<Firma | null>(null);
  const [unvan, setUnvan] = useState("");
  const [vergiDairesi, setVergiDairesi] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islemde, setIslemde] = useState(false);

  const yukleLogo = useCallback(async (logoId: string) => {
    try {
      const token = tokenAl();
      const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
      const res = await fetch(`${API_URL}/ekler/${logoId}/indir`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const blob = await res.blob();
        setLogoUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      console.error("Logo yükleme hatası", err);
    }
  }, []);

  const yukle = useCallback(async () => {
    try {
      const veri = await api<Firma>("/firma");
      setFirma(veri);
      setUnvan(veri.unvan);
      setVergiDairesi(veri.vergiDairesi ?? "");
      if (veri.logo) {
        void yukleLogo(veri.logo.id);
      } else {
        setLogoUrl(null);
      }
    } catch (h) {
      if (h instanceof ApiHata && h.durum === 401) {
        tokenYaz(null);
        yonlendir.push("/giris");
      } else {
        setHata(h instanceof Error ? h.message : "Firma bilgileri yüklenemedi");
      }
    }
  }, [yonlendir, yukleLogo]);

  useEffect(() => {
    if (!tokenAl()) {
      yonlendir.push("/giris");
      return;
    }
    void yukle();
  }, [yonlendir, yukle]);

  async function bilgileriKaydet(e: FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    setIslemde(true);
    try {
      const guncel = await api<Firma>("/firma", {
        method: "PATCH",
        body: JSON.stringify({
          unvan: unvan || undefined,
          vergiDairesi: vergiDairesi || undefined,
        }),
      });
      setBasari("Firma bilgileri başarıyla güncellendi.");
      setFirma(guncel);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Güncelleme hatası");
    } finally {
      setIslemde(false);
    }
  }

  async function logoYukle(e: React.ChangeEvent<HTMLInputElement>) {
    const dosya = e.target.files?.[0];
    if (!dosya || !firma) return;

    setHata("");
    setBasari("");
    setIslemde(true);

    const formData = new FormData();
    formData.append("dosya", dosya);

    try {
      const token = tokenAl();
      const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
      
      // Önce varsa eski logoyu silelim (leaks önlemek için)
      if (firma.logo) {
        await api(`/ekler/${firma.logo.id}`, { method: "DELETE" }).catch(() => undefined);
      }

      const res = await fetch(`${API_URL}/ekler?sahipTur=firma&sahipId=${firma.id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.mesaj || errJson.message || "Logo yükleme hatası");
      }

      setBasari("Firma logosu başarıyla güncellendi.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Logo yüklenemedi");
    } finally {
      setIslemde(false);
    }
  }

  async function logoSil() {
    if (!firma || !firma.logo) return;
    if (!confirm("Firma logosunu silmek istediğinize emin misiniz?")) return;

    setHata("");
    setBasari("");
    setIslemde(true);

    try {
      await api(`/ekler/${firma.logo.id}`, { method: "DELETE" });
      setBasari("Firma logosu silindi.");
      setLogoUrl(null);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Logo silinemedi");
    } finally {
      setIslemde(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>🏢 Firma Ayarları</h1>
        <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
          Şirketinizin genel kimlik bilgilerini ve faturada görünecek kurumsal logosunu buradan yönetin.
        </p>
      </div>

      {hata && <p style={stil.hata}>{hata}</p>}
      {basari && <p style={stil.basari}>{basari}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        {/* LOGO GÜNCELLEME KARTI */}
        <div style={stil.genisKart}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "600", marginBottom: "1rem", color: "#a78bfa" }}>
            🖼️ Firma Logosu
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "2rem", flexWrap: "wrap" }}>
            <div
              style={{
                width: 140,
                height: 140,
                borderRadius: 12,
                border: "2px dashed rgba(124, 58, 237, 0.4)",
                background: "rgba(24, 24, 27, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt="Firma Logosu"
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <div style={{ textAlign: "center", color: "#a1a1aa", fontSize: "0.8rem", padding: 10 }}>
                  Logo Yok
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <p style={{ color: "#a1a1aa", fontSize: "0.85rem", margin: 0, maxWidth: 400 }}>
                Faturanızda ve resmi çıktılarda yer alacak şirketinize ait logoyu yükleyin.
                İzin verilen formatlar: PNG, JPEG, WEBP. Maksimum boyut: 10 MB.
              </p>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginTop: "0.5rem" }}>
                <label
                  style={{
                    ...stil.dugmeMuted,
                    background: "linear-gradient(90deg, #7c3aed 0%, #4f46e5 100%)",
                    color: "#ffffff",
                    borderColor: "transparent",
                    display: "inline-block",
                    cursor: "pointer",
                  }}
                >
                  {islemde ? "Yükleniyor…" : "Logo Yükle"}
                  <input
                    type="file"
                    accept="image/png, image/jpeg, image/webp"
                    onChange={logoYukle}
                    disabled={islemde}
                    style={{ display: "none" }}
                  />
                </label>
                {logoUrl && (
                  <button
                    onClick={logoSil}
                    disabled={islemde}
                    style={{
                      ...stil.dugmeMuted,
                      borderColor: "#ef4444",
                      color: "#ef4444",
                    }}
                  >
                    Logoyu Kaldır
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* GENEL BİLGİLER FORMU */}
        <div style={stil.genisKart}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: "600", marginBottom: "1.5rem", color: "#a78bfa" }}>
            📋 Genel Bilgiler
          </h2>
          <form onSubmit={bilgileriKaydet}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Firma Resmi Unvanı</label>
                <input
                  type="text"
                  value={unvan}
                  onChange={(e) => setUnvan(e.target.value)}
                  style={stil.girdi}
                  required
                  placeholder="Ör. Tekir Teknoloji Ltd. Şti."
                />
              </div>
              <div>
                <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>VKN / TCKN (Değiştirilemez)</label>
                <input
                  type="text"
                  value={firma?.vkn ?? ""}
                  style={{ ...stil.girdi, background: "#09090b", color: "#71717a", cursor: "not-allowed" }}
                  disabled
                />
              </div>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Vergi Dairesi</label>
              <input
                type="text"
                value={vergiDairesi}
                onChange={(e) => setVergiDairesi(e.target.value)}
                style={stil.girdi}
                placeholder="Ör. Kadıköy Vergi Dairesi"
              />
            </div>

            <button
              type="submit"
              disabled={islemde}
              style={{
                ...stil.dugme,
                width: "auto",
                padding: "0.75rem 2rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              {islemde ? "Kaydediliyor..." : "💾 Değişiklikleri Kaydet"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
