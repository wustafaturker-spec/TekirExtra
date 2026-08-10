"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiHata, tokenAl, tokenYaz } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader } from "@/components/ui";

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
  abonelik: {
    planKodu: string;
    durum: "deneme" | "aktif" | "askida" | "iptal";
    faturaEpostasi: string | null;
    donemBaslangici: string | null;
    donemSonu: string | null;
  } | null;
}

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

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
      const res = await fetch(`${apiBase()}/ekler/${logoId}/indir`, {
        headers: { Authorization: `Bearer ${token}` },
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

      // Önce varsa eski logoyu silelim (leaks önlemek için)
      if (firma.logo) {
        await api(`/ekler/${firma.logo.id}`, { method: "DELETE" }).catch(() => undefined);
      }

      const res = await fetch(`${apiBase()}/ekler?sahipTur=firma&sahipId=${firma.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
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
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <PageHeader
        title="Firma Ayarları"
        subtitle="Şirketinizin genel kimlik bilgilerini ve faturada görünecek kurumsal logosunu buradan yönetin."
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="stack">
        <Card>
          <div className="between">
            <div>
              <h2 className="card__title" style={{ fontSize: "1.1rem", margin: 0 }}>Hesap ve Abonelik Altyapısı</h2>
              <p className="muted" style={{ margin: ".35rem 0 0" }}>v1.0 sürümünde fiyatlandırma ve ücret tahsilatı uygulanmaz.</p>
            </div>
            <Badge variant={firma?.abonelik?.durum === "aktif" ? "success" : "neutral"}>{firma?.abonelik?.durum ?? "Hazırlanıyor"}</Badge>
          </div>
          <div className="row" style={{ marginTop: "1rem" }}>
            <div className="grow"><span className="subtle">Plan kodu</span><div><strong>{firma?.abonelik?.planKodu ?? "v1"}</strong></div></div>
            <div className="grow"><span className="subtle">Fatura iletişimi</span><div><strong>{firma?.abonelik?.faturaEpostasi ?? "—"}</strong></div></div>
            <div className="grow"><span className="subtle">Dönem</span><div><strong>{firma?.abonelik?.donemBaslangici && firma.abonelik.donemSonu ? `${new Date(firma.abonelik.donemBaslangici).toLocaleDateString("tr-TR")} – ${new Date(firma.abonelik.donemSonu).toLocaleDateString("tr-TR")}` : "Süresiz v1 erişimi"}</strong></div></div>
          </div>
        </Card>

        {/* LOGO GÜNCELLEME KARTI */}
        <Card>
          <h2 className="card__title" style={{ fontSize: "1.1rem" }}>🖼️ Firma Logosu</h2>
          <div className="row" style={{ alignItems: "center", gap: "2rem" }}>
            <div
              style={{
                width: 140,
                height: 140,
                borderRadius: "var(--radius)",
                border: "2px dashed var(--border-strong)",
                background: "var(--surface-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Firma Logosu" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                <div className="subtle" style={{ textAlign: "center", fontSize: "0.8rem", padding: 10 }}>Logo Yok</div>
              )}
            </div>
            <div className="grow" style={{ minWidth: 260 }}>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0 0 1rem", maxWidth: 400 }}>
                Faturanızda ve resmi çıktılarda yer alacak şirketinize ait logoyu yükleyin.
                İzin verilen formatlar: PNG, JPEG, WEBP. Maksimum boyut: 10 MB.
              </p>
              <div className="row-tight">
                <ButtonLabel variant="primary">
                  {islemde ? "Yükleniyor…" : "Logo Yükle"}
                  <input type="file" accept="image/png, image/jpeg, image/webp" onChange={logoYukle} disabled={islemde} style={{ display: "none" }} />
                </ButtonLabel>
                {logoUrl && (
                  <Button variant="danger" onClick={logoSil} disabled={islemde}>Logoyu Kaldır</Button>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* GENEL BİLGİLER FORMU */}
        <Card>
          <h2 className="card__title" style={{ fontSize: "1.1rem" }}>📋 Genel Bilgiler</h2>
          <form onSubmit={bilgileriKaydet} className="stack">
            <div className="row">
              <div style={{ flex: 1, minWidth: 220 }}>
                <Field label="Firma Resmi Unvanı">
                  <Input value={unvan} onChange={(e) => setUnvan(e.target.value)} required placeholder="Ör. Tekir Teknoloji Ltd. Şti." />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <Field label="VKN / TCKN (Değiştirilemez)">
                  <Input value={firma?.vkn ?? ""} disabled style={{ background: "var(--surface-2)", color: "var(--text-subtle)", cursor: "not-allowed" }} />
                </Field>
              </div>
            </div>
            <Field label="Vergi Dairesi">
              <Input value={vergiDairesi} onChange={(e) => setVergiDairesi(e.target.value)} placeholder="Ör. Kadıköy Vergi Dairesi" />
            </Field>
            <div>
              <Button variant="primary" type="submit" disabled={islemde}>
                {islemde ? "Kaydediliyor..." : "💾 Değişiklikleri Kaydet"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
