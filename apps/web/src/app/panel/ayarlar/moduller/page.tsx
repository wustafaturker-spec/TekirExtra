"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { BelgeSablonuSecici, type BelgeSablonu } from "@/components/belge-sablonu-secici";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";

/**
 * Modül Ayarları (AYR-01/03): backend jenerik ayar altyapısını
 * (GET/PUT /ayarlar/:modul) tipli bir form ile tüketir. Alan tanımları burada
 * deklaratiftir; yeni modül ayarı gelince yalnız bu tablo genişletilir.
 */
type AlanTip = "enum" | "sayi" | "onay" | "metin" | "kasaRef" | "bankaRef" | "sablon" | "gizli";
interface Alan {
  ad: string;
  etiket: string;
  tip: AlanTip;
  secenekler?: [string, string][]; // enum için [deger, etiket]
  min?: number;
  max?: number;
  ipucu?: string;
}
interface ModulTanim {
  baslik: string;
  ikon: string;
  alanlar: Alan[];
}

const MODUL_TANIM: Record<string, ModulTanim> = {
  arayuz: {
    baslik: "Arayüz",
    ikon: "🎨",
    alanlar: [
      { ad: "tema", etiket: "Tema", tip: "enum", secenekler: [["acik", "Açık"], ["koyu", "Koyu"]] },
      { ad: "sayfaBoyutu", etiket: "Sayfa boyutu (satır)", tip: "sayi", min: 10, max: 200 },
    ],
  },
  cari: {
    baslik: "Cari",
    ikon: "👥",
    alanlar: [
      { ad: "varsayilanVadeGun", etiket: "Varsayılan vade (gün)", tip: "sayi", min: 0, max: 365 },
      { ad: "varsayilanDoviz", etiket: "Varsayılan döviz", tip: "enum", secenekler: DOVIZ_CINSLERI.map((d) => [d, d]) },
      { ad: "riskLimitiPolitikasi", etiket: "Risk limiti politikası (CARI-32)", tip: "enum", secenekler: [["uyar", "Uyar"], ["engelle", "Engelle"], ["yonetici_onayi", "Yönetici onayı"]], ipucu: "Satış siparişi onayında ve satış faturası kesinleştirmede risk limiti aşılırsa davranış; yönetici onayında gerekçe denetim izine yazılır" },
      { ad: "babsEsigi", etiket: "Form BA/BS eşiği (TL, CARI-37)", tip: "sayi", min: 0, ipucu: "Aynı kişiyle bir aydaki KDV hariç toplam bu tutara ulaşırsa BA/BS'ye girer; mevzuattaki tutar 5.000 TL" },
    ],
  },
  stok: {
    baslik: "Stok",
    ikon: "📦",
    alanlar: [
      { ad: "varsayilanBirim", etiket: "Varsayılan birim", tip: "metin" },
      { ad: "kritikSeviyeUyarisi", etiket: "Kritik seviye uyarısı", tip: "onay" },
      { ad: "eksiStokPolitikasi", etiket: "Eksi stok politikası (STK-17)", tip: "enum", secenekler: [["izin", "İzin ver"], ["uyar", "Uyar"], ["engelle", "Engelle"]], ipucu: "Satış çıkışında stok eksiye düşerse davranış" },
    ],
  },
  fatura: {
    baslik: "Fatura",
    ikon: "📄",
    alanlar: [
      { ad: "varsayilanSeri", etiket: "Varsayılan seri (3 büyük harf)", tip: "metin", ipucu: "Ör. TKR" },
      { ad: "varsayilanKdvOrani", etiket: "Varsayılan KDV (%)", tip: "sayi", min: 0, max: 100 },
      // FTR-22/23: şablon ve vurgu rengi tek bir seçim bloğunda, önizlemesiyle.
      { ad: "faturaSablonu", etiket: "Belge şablonu", tip: "sablon" },
      { ad: "vurguRengi", etiket: "Vurgu rengi", tip: "gizli" },
    ],
  },
  satin_alma: {
    baslik: "Satın Alma",
    ikon: "🛒",
    alanlar: [
      { ad: "onayEsigi", etiket: "Onay eşiği (TL)", tip: "sayi", min: 0, max: 1_000_000_000, ipucu: "Tahmini tutar eşik ve altındaysa muhasebe, üstündeyse yönetici onaylar (SAT-03)" },
      { ad: "miktarToleransYuzde", etiket: "Miktar toleransı (%)", tip: "sayi", min: 0, max: 100, ipucu: "Fatura miktarı mal kabulden bu oranın üstünde ayrılırsa Düzeltme Merkezi'ne fark düşer (SAT-11)" },
      { ad: "fiyatToleransYuzde", etiket: "Fiyat toleransı (%)", tip: "sayi", min: 0, max: 100, ipucu: "Fatura birim fiyatı siparişten bu oranın üstünde ayrılırsa Düzeltme Merkezi'ne fark düşer (SAT-11)" },
    ],
  },
  kasaBanka: {
    baslik: "Kasa & Banka",
    ikon: "🏦",
    alanlar: [
      { ad: "varsayilanKasaId", etiket: "Varsayılan kasa", tip: "kasaRef" },
      { ad: "varsayilanBankaHesapId", etiket: "Varsayılan banka hesabı", tip: "bankaRef" },
    ],
  },
};

// Ekranda görünme sırası
const SIRA = ["fatura", "stok", "cari", "satin_alma", "kasaBanka", "arayuz"];

interface Ref {
  id: string;
  ad: string;
  bankaAdi?: string;
}

export default function ModulAyarlariSayfasi() {
  const [moduller, setModuller] = useState<string[]>([]);
  const [degerler, setDegerler] = useState<Record<string, Record<string, unknown>>>({});
  const [kasalar, setKasalar] = useState<Ref[]>([]);
  const [bankalar, setBankalar] = useState<Ref[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [kaydedilen, setKaydedilen] = useState<string>("");

  const yukle = useCallback(async () => {
    setHata("");
    try {
      const { moduller: liste } = await api<{ moduller: string[] }>("/ayarlar");
      setModuller(liste);
      const cift = await Promise.all(
        liste.map(async (m) => [m, await api<Record<string, unknown>>(`/ayarlar/${m}`)] as const),
      );
      setDegerler(Object.fromEntries(cift));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Ayarlar yüklenemedi");
    }
  }, []);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
    api<Ref[]>("/kasa-banka/kasalar").then(setKasalar).catch(() => undefined);
    api<Ref[]>("/kasa-banka/bankalar").then(setBankalar).catch(() => undefined);
  }, [yukle]);

  function alanGuncelle(modul: string, ad: string, deger: unknown) {
    setDegerler((eski) => ({ ...eski, [modul]: { ...eski[modul], [ad]: deger } }));
  }

  async function kaydet(modul: string) {
    setHata("");
    setBasari("");
    const tanim = MODUL_TANIM[modul];
    const ham = degerler[modul] ?? {};
    // Şemaya uygun tiplere dönüştür
    const govde: Record<string, unknown> = {};
    for (const a of tanim.alanlar) {
      const v = ham[a.ad];
      if (a.tip === "sayi") govde[a.ad] = v === "" || v === undefined ? undefined : Number(v);
      else if (a.tip === "onay") govde[a.ad] = Boolean(v);
      else if (a.tip === "kasaRef" || a.tip === "bankaRef") govde[a.ad] = v ? v : null;
      else govde[a.ad] = v;
    }
    try {
      const guncel = await api<Record<string, unknown>>(`/ayarlar/${modul}`, {
        method: "PUT",
        body: JSON.stringify(govde),
      });
      setDegerler((eski) => ({ ...eski, [modul]: guncel }));
      setBasari(`${tanim.baslik} ayarları kaydedildi.`);
      setKaydedilen(modul);
      setTimeout(() => setKaydedilen(""), 2000);
    } catch (h) {
      setHata(h instanceof Error ? h.message : `${tanim.baslik} ayarları kaydedilemedi`);
    }
  }

  function alanGir(modul: string, a: Alan) {
    const v = degerler[modul]?.[a.ad];
    if (a.tip === "sablon") {
      return (
        <BelgeSablonuSecici
          sablon={(v as BelgeSablonu) ?? "standart"}
          renk={String(degerler[modul]?.vurguRengi ?? "#6d28d9")}
          onDegis={(alan, deger) => alanGuncelle(modul, alan, deger)}
        />
      );
    }
    if (a.tip === "enum") {
      return (
        <Select value={String(v ?? "")} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)}>
          {a.secenekler!.map(([deger, etiket]) => (<option key={deger} value={deger}>{etiket}</option>))}
        </Select>
      );
    }
    if (a.tip === "sayi") {
      return <Input type="number" min={a.min} max={a.max} value={v === null || v === undefined ? "" : String(v)} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)} />;
    }
    if (a.tip === "onay") {
      return (
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", height: 38 }}>
          <input type="checkbox" checked={Boolean(v)} onChange={(e) => alanGuncelle(modul, a.ad, e.target.checked)} style={{ width: "1.1rem", height: "1.1rem" }} />
          <span className="muted" style={{ fontSize: "0.9rem" }}>{Boolean(v) ? "Açık" : "Kapalı"}</span>
        </label>
      );
    }
    if (a.tip === "kasaRef" || a.tip === "bankaRef") {
      const kaynak = a.tip === "kasaRef" ? kasalar : bankalar;
      return (
        <Select value={String(v ?? "")} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)}>
          <option value="">— Seçilmemiş —</option>
          {kaynak.map((r) => (<option key={r.id} value={r.id}>{r.bankaAdi ? `${r.ad} — ${r.bankaAdi}` : r.ad}</option>))}
        </Select>
      );
    }
    return <Input value={String(v ?? "")} onChange={(e) => alanGuncelle(modul, a.ad, e.target.value)} placeholder={a.ipucu} />;
  }

  const gorunenModuller = SIRA.filter((m) => moduller.includes(m) && MODUL_TANIM[m]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <PageHeader
        title="Modül Ayarları"
        subtitle="Her modülün varsayılanları burada yönetilir (AYR-01). Firma, kullanıcı ve entegratör gibi sistem ayarları kendi ekranlarındadır."
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="stack">
        {gorunenModuller.map((m) => {
          const tanim = MODUL_TANIM[m];
          return (
            <Card key={m}>
              <div className="between" style={{ marginBottom: "1rem" }}>
                <h3 style={{ fontSize: "1.05rem", margin: 0 }}>{tanim.ikon} {tanim.baslik}</h3>
                <Button variant="primary" size="sm" onClick={() => kaydet(m)}>
                  {kaydedilen === m ? "✓ Kaydedildi" : "Kaydet"}
                </Button>
              </div>
              <div className="row">
                {tanim.alanlar.filter((a) => a.tip !== "gizli").map((a) => (
                  <div key={a.ad} style={a.tip === "sablon" ? { flexBasis: "100%" } : { flex: 1, minWidth: 200 }}>
                    {a.tip === "sablon" ? alanGir(m, a) : <Field label={a.etiket}>{alanGir(m, a)}</Field>}
                    {a.ipucu && a.tip !== "metin" && <p className="subtle" style={{ fontSize: "0.75rem", margin: "0.25rem 0 0" }}>{a.ipucu}</p>}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
