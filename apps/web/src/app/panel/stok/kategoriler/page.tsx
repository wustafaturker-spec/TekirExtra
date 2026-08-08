"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
} from "@/components/ui";

interface Kategori {
  id: string;
  ad: string;
  ustId: string | null;
  ust: { id: string; ad: string } | null;
}

interface Dugum extends Kategori {
  altlar: Dugum[];
  derinlik: number;
}

/** Düz listeyi ağaca çevirir; sahipsiz (üstü silinmiş) düğümler köke alınır. */
function agacKur(kategoriler: Kategori[]): Dugum[] {
  const dugumler = new Map<string, Dugum>(
    kategoriler.map((k) => [k.id, { ...k, altlar: [], derinlik: 0 }]),
  );
  const kokler: Dugum[] = [];

  for (const d of dugumler.values()) {
    const ust = d.ustId ? dugumler.get(d.ustId) : undefined;
    if (ust) ust.altlar.push(d);
    else kokler.push(d);
  }

  const derinlikVer = (liste: Dugum[], derinlik: number) => {
    liste.sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
    for (const d of liste) {
      d.derinlik = derinlik;
      derinlikVer(d.altlar, derinlik + 1);
    }
  };
  derinlikVer(kokler, 0);
  return kokler;
}

/** Ağacı ekranda basılacak sıraya düzleştirir. */
function duzlestir(kokler: Dugum[]): Dugum[] {
  const sonuc: Dugum[] = [];
  const gez = (d: Dugum) => {
    sonuc.push(d);
    d.altlar.forEach(gez);
  };
  kokler.forEach(gez);
  return sonuc;
}

export default function KategorilerSayfasi() {
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [urunSayilari, setUrunSayilari] = useState<Record<string, number>>({});
  const [ad, setAd] = useState("");
  const [ustId, setUstId] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try {
      const [kategoriler, stoklar] = await Promise.all([
        api<Kategori[]>("/stok/kategoriler"),
        tumSayfalariAl<{ kategoriId: string | null }>("/stok"),
      ]);
      const sayac: Record<string, number> = {};
      for (const stok of stoklar) {
        if (stok.kategoriId) sayac[stok.kategoriId] = (sayac[stok.kategoriId] ?? 0) + 1;
      }
      setKategoriler(kategoriler);
      setUrunSayilari(sayac);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kategoriler yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) void yukle();
  }, [yukle]);

  const kokler = useMemo(() => agacKur(kategoriler), [kategoriler]);
  const sirali = useMemo(() => duzlestir(kokler), [kokler]);

  async function ekle() {
    setHata("");
    setBasari("");
    try {
      await api("/stok/kategoriler", {
        method: "POST",
        body: JSON.stringify({ ad: ad.trim(), ustId: ustId === "" ? null : ustId }),
      });
      setBasari(`'${ad.trim()}' kategorisi eklendi.`);
      setAd("");
      setUstId("");
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kategori eklenemedi");
    }
  }

  async function sil(kategori: Dugum) {
    setHata("");
    setBasari("");
    try {
      await api(`/stok/kategoriler/${kategori.id}`, { method: "DELETE" });
      setBasari(`'${kategori.ad}' kategorisi silindi.`);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kategori silinemedi");
    }
  }

  return (
    <div>
      <PageHeader
        title="Stok Kategorileri"
        subtitle="Ürünlerinizi ağaç yapısında gruplayın. Alt kategorisi ya da ürünü olan kategoriler silinemez."
        actions={
          <ButtonLabel as="a" href="/panel/stok">
            ← Stok Listesi
          </ButtonLabel>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <Card style={{ marginBottom: "1.5rem", maxWidth: 720 }}>
        <div className="card__title">Yeni Kategori</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Kategori Adı *">
              <Input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Örn. Hırdavat" />
            </Field>
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Üst Kategori">
              <Select value={ustId} onChange={(e) => setUstId(e.target.value)}>
                <option value="">— Kök kategori —</option>
                {sirali.map((k) => (
                  <option key={k.id} value={k.id}>
                    {" ".repeat(k.derinlik * 4)}
                    {k.derinlik > 0 ? "› " : ""}
                    {k.ad}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={ekle} disabled={ad.trim().length < 2}>
              ➕ Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        {sirali.length === 0 ? (
          <p className="empty" style={{ padding: "2rem", textAlign: "center", margin: 0 }}>
            Henüz kategori tanımlanmamış. Yukarıdaki formdan ilk kategoriyi ekleyebilirsiniz.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: "0.5rem 0" }}>
            {sirali.map((k) => {
              const urun = urunSayilari[k.id] ?? 0;
              const silinebilir = k.altlar.length === 0 && urun === 0;
              return (
                <li
                  key={k.id}
                  className="between"
                  style={{
                    padding: "0.6rem 1.25rem",
                    paddingLeft: `${1.25 + k.derinlik * 1.75}rem`,
                    borderTop: k.derinlik === 0 ? "1px solid var(--line)" : "none",
                  }}
                >
                  <div className="row-tight" style={{ alignItems: "center" }}>
                    <span className="muted">{k.derinlik === 0 ? "📁" : "└"}</span>
                    <span style={{ fontWeight: k.derinlik === 0 ? 600 : 400 }}>{k.ad}</span>
                    {k.altlar.length > 0 && <Badge variant="neutral">{k.altlar.length} alt kategori</Badge>}
                    {urun > 0 && <Badge variant="info">{urun} ürün</Badge>}
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => sil(k)}
                    disabled={!silinebilir}
                    title={
                      silinebilir
                        ? undefined
                        : k.altlar.length > 0
                          ? "Alt kategorisi bulunan kategori silinemez"
                          : "Ürünleri bulunan kategori silinemez"
                    }
                  >
                    Sil
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
