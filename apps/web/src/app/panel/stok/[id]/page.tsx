"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, tokenAl } from "@/lib/api";
import { useDepolar } from "@/lib/depolar";
import { DepoSecici } from "@/components/depo-secici";
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
  Stat,
  StatGrid,
  Tabs,
  TableWrap,
} from "@/components/ui";

/* ─── Tipler ─────────────────────────────────────────────────────────────── */

interface Kategori {
  id: string;
  ad: string;
  ust: { id: string; ad: string } | null;
}

interface Birim {
  id: string;
  ad: string;
  katsayi: string;
}

interface Barkod {
  id: string;
  barkod: string;
  birim: string | null;
  satisFiyati: string | null;
}

interface Tedarikci {
  id: string;
  cariId: string;
  tedarikciUrunKodu: string | null;
  alisFiyati: string | null;
  dovizCinsi: string;
  tedarikSuresiGun: number | null;
  varsayilan: boolean;
  cari: { id: string; kod: string; unvan: string };
}

interface Hareket {
  id: string;
  tip: string;
  miktar: string;
  girilenBirim: string;
  girilenMiktar: string;
  maliyet: string;
  tarih: string;
  aciklama: string | null;
  kaynakTur: string;
  kaynakRef: string | null;
  depo?: { id: string; kod: string; ad: string } | null;
}

interface StokDetay {
  id: string;
  kod: string;
  ad: string;
  kisaAd: string | null;
  aciklama: string | null;
  tip: string;
  marka: string | null;
  model: string | null;
  mensei: string | null;
  gtipKodu: string | null;
  ureticiUrunKodu: string | null;
  barkod: string | null;
  kategoriId: string | null;
  anaBirim: string;
  kdvOrani: string;
  alisFiyati: string | null;
  satisFiyati: string | null;
  kritikSeviye: string | null;
  minStok: string | null;
  maksStok: string | null;
  guvenlikStogu: string | null;
  tedarikSuresiGun: number | null;
  gorselUrl: string | null;
  mevcutMiktar: string;
  rezerveMiktar: string;
  yoldakiMiktar: string;
  kullanilabilirMiktar: string;
  ortalamaMaliyet: string;
  aktif: boolean;
  kategori: Kategori | null;
  birimler: Birim[];
  barkodlar: Barkod[];
  tedarikciler: Tedarikci[];
  izinliEylemler: string[];
}

interface CariOzet {
  id: string;
  kod: string;
  unvan: string;
}

type Sekme = "genel" | "hareketler" | "depolar" | "birimler" | "barkodlar" | "tedarikciler";

/** Stok kartının depo bazlı kırılımı (STK-07). */
interface DepoBakiyeSatiri {
  depoId: string;
  depoKod: string;
  depoAd: string;
  depoAktif: boolean;
  mevcutMiktar: string;
  rezerveMiktar: string;
  yoldakiMiktar: string;
  kullanilabilirMiktar: string;
}

/* ─── Sabitler ───────────────────────────────────────────────────────────── */

/** STK-19: giriş gibi işlenenler acilis/giris; kalanlar çıkış tarafı. */
const HAREKET_TIPLERI: { deger: string; baslik: string; yon: "giris" | "cikis" | "duzeltme" }[] = [
  { deger: "giris", baslik: "Giriş", yon: "giris" },
  { deger: "cikis", baslik: "Çıkış", yon: "cikis" },
  { deger: "acilis", baslik: "Açılış", yon: "giris" },
  { deger: "fire", baslik: "Fire", yon: "cikis" },
  { deger: "zayi", baslik: "Zayi", yon: "cikis" },
  { deger: "numune", baslik: "Numune", yon: "cikis" },
  { deger: "promosyon", baslik: "Promosyon", yon: "cikis" },
  { deger: "sayim_duzeltme", baslik: "Sayım Düzeltme", yon: "duzeltme" },
];

/**
 * Elle girilemeyen, yalnız listede görünen türler (STK-07): depolar arası
 * transferin iki ayağı — transfer fişi ekranından üretilir.
 */
const TUREYEN_HAREKET_TIPLERI: { deger: string; baslik: string; yon: "giris" | "cikis" }[] = [
  { deger: "transfer_giris", baslik: "Transfer Girişi", yon: "giris" },
  { deger: "transfer_cikis", baslik: "Transfer Çıkışı", yon: "cikis" },
];

const TUM_HAREKET_TIPLERI = [...HAREKET_TIPLERI, ...TUREYEN_HAREKET_TIPLERI];

const TIP_ETIKETLERI: Record<string, string> = {
  urun: "📦 Ürün",
  hizmet: "🛠️ Hizmet",
  sarf: "🧰 Sarf",
};

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

const adet = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

const bugun = () => new Date().toISOString().slice(0, 10);

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

/* ─── Sayfa ──────────────────────────────────────────────────────────────── */

export default function StokDetaySayfasi() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [detay, setDetay] = useState<StokDetay | null>(null);
  const [hareketler, setHareketler] = useState<Hareket[]>([]);
  const [depoBakiyeleri, setDepoBakiyeleri] = useState<DepoBakiyeSatiri[]>([]);
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [cariler, setCariler] = useState<CariOzet[]>([]);
  const [aktifSekme, setAktifSekme] = useState<Sekme>("genel");
  const { cokluDepo } = useDepolar();
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [uyari, setUyari] = useState("");

  const yukle = useCallback(async () => {
    try {
      const veri = await api<StokDetay>(`/stok/${id}`);
      setDetay(veri);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Stok kartı yüklenemedi");
    }
  }, [id]);

  const hareketleriYukle = useCallback(async () => {
    try {
      setHareketler(await api<Hareket[]>(`/stok/${id}/hareketler`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Hareketler yüklenemedi");
    }
  }, [id]);

  const depoBakiyeleriYukle = useCallback(async () => {
    try {
      setDepoBakiyeleri(await api<DepoBakiyeSatiri[]>(`/stok/${id}/depo-bakiyeleri`));
    } catch {
      setDepoBakiyeleri([]);
    }
  }, [id]);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
    void hareketleriYukle();
    void depoBakiyeleriYukle();
    void api<Kategori[]>("/stok/kategoriler").then(setKategoriler).catch(() => {});
    void api<{ kayitlar: CariOzet[] }>("/cari")
      .then((v) => setCariler(v.kayitlar))
      .catch(() => {});
  }, [yukle, hareketleriYukle, depoBakiyeleriYukle]);

  /** Alt kayıt ekleme/silme sonrası ortak akış. */
  async function islem(calistir: () => Promise<unknown>, basariMesaji: string) {
    setHata("");
    setBasari("");
    setUyari("");
    try {
      await calistir();
      setBasari(basariMesaji);
      await yukle();
      return true;
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İşlem başarısız");
      return false;
    }
  }

  if (!detay) {
    return (
      <div>
        <PageHeader title="Stok Kartı" />
        <Alert tone="error">{hata}</Alert>
        {!hata && <Card>Yükleniyor…</Card>}
      </div>
    );
  }

  const miktar = Number(detay.mevcutMiktar);
  const kritik = detay.kritikSeviye ? Number(detay.kritikSeviye) : null;
  const kritikAlti = kritik !== null && miktar <= kritik;

  return (
    <div>
      <PageHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
            {detay.ad}
            {!detay.aktif && <Badge variant="neutral">Pasif</Badge>}
            {kritikAlti && <Badge variant="warning">⚠️ Kritik Seviye</Badge>}
          </span>
        }
        subtitle={
          <>
            {detay.kod} · {TIP_ETIKETLERI[detay.tip] ?? detay.tip} · Ana birim: {detay.anaBirim}
            {detay.kategori ? ` · ${detay.kategori.ad}` : ""}
          </>
        }
        actions={
          <ButtonLabel as="a" href="/panel/stok">
            ← Stok Listesi
          </ButtonLabel>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      {uyari && <Alert tone="error">⚠️ {uyari}</Alert>}

      <StatGrid>
        <Stat
          label="Mevcut Stok"
          value={`${adet(detay.mevcutMiktar)} ${detay.anaBirim}`}
          tone={miktar < 0 || kritikAlti ? "danger" : miktar > 0 ? "success" : "default"}
          hint={kritik !== null ? `Kritik seviye: ${adet(kritik)}` : "Kritik seviye tanımsız"}
        />
        <Stat
          label="Kullanılabilir"
          value={`${adet(detay.kullanilabilirMiktar)} ${detay.anaBirim}`}
          tone={Number(detay.kullanilabilirMiktar) < 0 ? "danger" : "default"}
          hint={`Rezerve: ${adet(detay.rezerveMiktar)}`}
        />
        <Stat label="Yoldaki" value={`${adet(detay.yoldakiMiktar)} ${detay.anaBirim}`} hint="Açık alış siparişi" />
        <Stat
          label="Ort. Maliyet"
          value={tl(detay.ortalamaMaliyet)}
          tone="info"
          hint={`Stok değeri: ${tl(Number(detay.ortalamaMaliyet) * miktar)}`}
        />
      </StatGrid>

      <div style={{ margin: "1.25rem 0" }}>
        <Tabs<Sekme>
          value={aktifSekme}
          onChange={setAktifSekme}
          items={[
            { deger: "genel", baslik: "Genel" },
            { deger: "hareketler", baslik: `Hareketler (${hareketler.length})` },
            ...(cokluDepo
              ? [{ deger: "depolar" as Sekme, baslik: `Depolar (${depoBakiyeleri.length})` }]
              : []),
            { deger: "birimler", baslik: `Birimler (${detay.birimler.length})` },
            { deger: "barkodlar", baslik: `Barkodlar (${detay.barkodlar.length})` },
            { deger: "tedarikciler", baslik: `Tedarikçiler (${detay.tedarikciler.length})` },
          ]}
        />
      </div>

      {aktifSekme === "genel" && (
        <GenelSekmesi
          detay={detay}
          kategoriler={kategoriler}
          onKaydet={(govde) =>
            islem(
              () => api(`/stok/${id}`, { method: "PATCH", body: JSON.stringify(govde) }),
              "Stok kartı güncellendi.",
            )
          }
          onSil={
            detay.izinliEylemler.includes("sil")
              ? async () => {
                  const ok = await islem(() => api(`/stok/${id}`, { method: "DELETE" }), "Stok kartı silindi.");
                  if (ok) router.push("/panel/stok");
                }
              : undefined
          }
        />
      )}

      {aktifSekme === "hareketler" && (
        <HareketlerSekmesi
          detay={detay}
          hareketler={hareketler}
          onEkle={async (govde) => {
            setHata("");
            setBasari("");
            setUyari("");
            try {
              const yanit = await api<{ eksiStokUyarisi: string | null }>(`/stok/${id}/hareketler`, {
                method: "POST",
                body: JSON.stringify(govde),
              });
              setBasari("Stok hareketi işlendi.");
              if (yanit.eksiStokUyarisi) setUyari(yanit.eksiStokUyarisi);
              await yukle();
              await hareketleriYukle();
              await depoBakiyeleriYukle();
              return true;
            } catch (h) {
              setHata(h instanceof Error ? h.message : "Hareket işlenemedi");
              return false;
            }
          }}
        />
      )}

      {aktifSekme === "depolar" && (
        <DepolarSekmesi detay={detay} satirlar={depoBakiyeleri} />
      )}

      {aktifSekme === "birimler" && (
        <BirimlerSekmesi
          detay={detay}
          onEkle={(govde) =>
            islem(
              () => api(`/stok/${id}/birimler`, { method: "POST", body: JSON.stringify(govde) }),
              "Birim eklendi.",
            )
          }
          onSil={(birimId) =>
            islem(() => api(`/stok/${id}/birimler/${birimId}`, { method: "DELETE" }), "Birim silindi.")
          }
        />
      )}

      {aktifSekme === "barkodlar" && (
        <BarkodlarSekmesi
          detay={detay}
          onEkle={(govde) =>
            islem(
              () => api(`/stok/${id}/barkodlar`, { method: "POST", body: JSON.stringify(govde) }),
              "Barkod eklendi.",
            )
          }
          onSil={(barkodId) =>
            islem(() => api(`/stok/${id}/barkodlar/${barkodId}`, { method: "DELETE" }), "Barkod silindi.")
          }
          onHata={setHata}
        />
      )}

      {aktifSekme === "tedarikciler" && (
        <TedarikcilerSekmesi
          detay={detay}
          cariler={cariler}
          onEkle={(govde) =>
            islem(
              () => api(`/stok/${id}/tedarikciler`, { method: "POST", body: JSON.stringify(govde) }),
              "Tedarikçi eklendi.",
            )
          }
          onSil={(tedarikciId) =>
            islem(
              () => api(`/stok/${id}/tedarikciler/${tedarikciId}`, { method: "DELETE" }),
              "Tedarikçi bağlantısı silindi.",
            )
          }
        />
      )}
    </div>
  );
}

/* ─── Genel sekmesi ──────────────────────────────────────────────────────── */

function GenelSekmesi({
  detay,
  kategoriler,
  onKaydet,
  onSil,
}: {
  detay: StokDetay;
  kategoriler: Kategori[];
  onKaydet: (govde: Record<string, unknown>) => Promise<boolean>;
  onSil?: () => void;
}) {
  const duzenlenebilir = detay.izinliEylemler.includes("duzenle");
  const [form, setForm] = useState({
    ad: detay.ad,
    kisaAd: detay.kisaAd ?? "",
    aciklama: detay.aciklama ?? "",
    kategoriId: detay.kategoriId ?? "",
    marka: detay.marka ?? "",
    model: detay.model ?? "",
    mensei: detay.mensei ?? "",
    gtipKodu: detay.gtipKodu ?? "",
    ureticiUrunKodu: detay.ureticiUrunKodu ?? "",
    kdvOrani: detay.kdvOrani,
    alisFiyati: detay.alisFiyati ?? "",
    satisFiyati: detay.satisFiyati ?? "",
    kritikSeviye: detay.kritikSeviye ?? "",
    minStok: detay.minStok ?? "",
    maksStok: detay.maksStok ?? "",
    guvenlikStogu: detay.guvenlikStogu ?? "",
    tedarikSuresiGun: detay.tedarikSuresiGun?.toString() ?? "",
    aktif: detay.aktif,
  });

  const alan = (k: keyof typeof form) => ({
    value: form[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  /** Boş metin alanları null, sayısal alanlar API'nin beklediği string olarak gider. */
  function kaydet() {
    const bosNull = (d: string) => (d.trim() === "" ? null : d.trim());
    void onKaydet({
      ad: form.ad,
      kisaAd: bosNull(form.kisaAd),
      aciklama: bosNull(form.aciklama),
      kategoriId: bosNull(form.kategoriId),
      marka: bosNull(form.marka),
      model: bosNull(form.model),
      mensei: bosNull(form.mensei),
      gtipKodu: bosNull(form.gtipKodu),
      ureticiUrunKodu: bosNull(form.ureticiUrunKodu),
      kdvOrani: form.kdvOrani || "20",
      alisFiyati: bosNull(form.alisFiyati),
      satisFiyati: bosNull(form.satisFiyati),
      kritikSeviye: bosNull(form.kritikSeviye),
      minStok: bosNull(form.minStok),
      maksStok: bosNull(form.maksStok),
      guvenlikStogu: bosNull(form.guvenlikStogu),
      tedarikSuresiGun: form.tedarikSuresiGun.trim() === "" ? null : Number(form.tedarikSuresiGun),
      aktif: form.aktif,
    });
  }

  return (
    <Card className="stack">
      <div className="between">
        <div className="card__title" style={{ margin: 0 }}>
          Kart Bilgileri
        </div>
        <div className="row-tight">
          {duzenlenebilir && (
            <Button size="sm" onClick={() => setForm((f) => ({ ...f, aktif: !f.aktif }))}>
              {form.aktif ? "Pasife Al" : "Aktife Al"}
            </Button>
          )}
          {onSil && (
            <Button size="sm" variant="danger" onClick={onSil}>
              🗑️ Sil
            </Button>
          )}
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 2, minWidth: 240 }}>
          <Field label="Ürün/Hizmet Adı *">
            <Input {...alan("ad")} required />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Kısa Ad">
            <Input {...alan("kisaAd")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Field label="Kategori">
            <Select {...alan("kategoriId")}>
              <option value="">— Kategorisiz —</option>
              {kategoriler.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ust ? `${k.ust.ad} › ${k.ad}` : k.ad}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <Field label="Açıklama">
        <Input {...alan("aciklama")} placeholder="Serbest not" />
      </Field>

      <div className="row">
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Marka">
            <Input {...alan("marka")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Model">
            <Input {...alan("model")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <Field label="Menşei">
            <Input {...alan("mensei")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <Field label="GTİP Kodu">
            <Input {...alan("gtipKodu")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Üretici Ürün Kodu">
            <Input {...alan("ureticiUrunKodu")} />
          </Field>
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 130 }}>
          <Field label="KDV Oranı (%)">
            <Input type="number" step="0.01" {...alan("kdvOrani")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Alış Fiyatı (TRY)">
            <Input type="number" step="0.0001" {...alan("alisFiyati")} placeholder="0.0000" />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Satış Fiyatı (TRY)">
            <Input type="number" step="0.0001" {...alan("satisFiyati")} placeholder="0.0000" />
          </Field>
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="Kritik Seviye">
            <Input type="number" step="0.001" {...alan("kritikSeviye")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <Field label="Min. Stok">
            <Input type="number" step="0.001" {...alan("minStok")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <Field label="Maks. Stok">
            <Input type="number" step="0.001" {...alan("maksStok")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <Field label="Güvenlik Stoğu">
            <Input type="number" step="0.001" {...alan("guvenlikStogu")} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Tedarik Süresi (gün)">
            <Input type="number" min="0" max="365" {...alan("tedarikSuresiGun")} />
          </Field>
        </div>
      </div>

      <div>
        <Button variant="primary" onClick={kaydet} disabled={!duzenlenebilir}>
          Değişiklikleri Kaydet
        </Button>
        {!duzenlenebilir && (
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
            Bu kartı düzenleme yetkiniz yok.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ─── Hareketler sekmesi (STK-02) ────────────────────────────────────────── */

/* ─── Depolar sekmesi (STK-07) ───────────────────────────────────────────── */

function DepolarSekmesi({
  detay,
  satirlar,
}: {
  detay: StokDetay;
  satirlar: DepoBakiyeSatiri[];
}) {
  return (
    <Card pad={false}>
      <TableWrap>
        <thead>
          <tr>
            <th>Depo</th>
            <th className="num">Mevcut</th>
            <th className="num">Rezerve</th>
            <th className="num">Kullanılabilir</th>
            <th className="num">Yoldaki</th>
          </tr>
        </thead>
        <tbody>
          {satirlar.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty">
                Bu ürünün henüz hiçbir depoda bakiyesi yok.
              </td>
            </tr>
          ) : (
            <>
              {satirlar.map((s) => (
                <tr key={s.depoId}>
                  <td>
                    <span className="mono">{s.depoKod}</span> · {s.depoAd}
                    {!s.depoAktif && " (pasif)"}
                  </td>
                  <td className="num">
                    {adet(s.mevcutMiktar)} {detay.anaBirim}
                  </td>
                  <td className="num">{adet(s.rezerveMiktar)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {adet(s.kullanilabilirMiktar)}
                  </td>
                  <td className="num">{adet(s.yoldakiMiktar)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700 }}>Toplam</td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.mevcutMiktar)} {detay.anaBirim}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.rezerveMiktar)}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.kullanilabilirMiktar)}
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {adet(detay.yoldakiMiktar)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </TableWrap>
    </Card>
  );
}

function HareketlerSekmesi({
  detay,
  hareketler,
  onEkle,
}: {
  detay: StokDetay;
  hareketler: Hareket[];
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
}) {
  const { cokluDepo } = useDepolar();
  const [formAcik, setFormAcik] = useState(false);
  const [tip, setTip] = useState("giris");
  const [girilenMiktar, setGirilenMiktar] = useState("");
  const [girilenBirim, setGirilenBirim] = useState(detay.anaBirim);
  const [maliyet, setMaliyet] = useState("0");
  const [tarih, setTarih] = useState(bugun());
  const [aciklama, setAciklama] = useState("");
  const [depoId, setDepoId] = useState("");

  /** Seçili birimin ana birim karşılığı; ana birim için katsayı 1. */
  const katsayi =
    girilenBirim === detay.anaBirim
      ? 1
      : Number(detay.birimler.find((b) => b.ad === girilenBirim)?.katsayi ?? 1);
  const anaBirimMiktar = girilenMiktar ? Number(girilenMiktar) * katsayi : 0;

  async function kaydet() {
    const eklendi = await onEkle({
      stokId: detay.id,
      depoId: depoId || null,
      tip,
      // Ana birim cinsinden miktar; API girilen değeri kendi çevirmez.
      miktar: anaBirimMiktar.toFixed(3),
      girilenBirim,
      girilenMiktar: Number(girilenMiktar).toFixed(3),
      maliyet: (maliyet || "0").toString(),
      tarih,
      aciklama: aciklama.trim() === "" ? null : aciklama.trim(),
    });
    if (eklendi) {
      setGirilenMiktar("");
      setAciklama("");
      setFormAcik(false);
    }
  }

  const yon = (t: string) => TUM_HAREKET_TIPLERI.find((h) => h.deger === t)?.yon ?? "duzeltme";
  const baslik = (t: string) => TUM_HAREKET_TIPLERI.find((h) => h.deger === t)?.baslik ?? t;

  return (
    <div className="stack">
      <Card>
        <div className="between">
          <div className="card__title" style={{ margin: 0 }}>
            Stok Hareketleri
          </div>
          <Button variant={formAcik ? "ghost" : "primary"} size="sm" onClick={() => setFormAcik(!formAcik)}>
            {formAcik ? "Vazgeç" : "➕ Hareket Ekle"}
          </Button>
        </div>

        {formAcik && (
          <div className="stack" style={{ marginTop: "1rem" }}>
            <div className="row">
              <div style={{ flex: 1, minWidth: 170 }}>
                <Field label="Hareket Tipi">
                  <Select value={tip} onChange={(e) => setTip(e.target.value)}>
                    {HAREKET_TIPLERI.map((h) => (
                      <option key={h.deger} value={h.deger}>
                        {h.baslik}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <Field label="Miktar *">
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    value={girilenMiktar}
                    onChange={(e) => setGirilenMiktar(e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <Field label="Birim">
                  <Select value={girilenBirim} onChange={(e) => setGirilenBirim(e.target.value)}>
                    <option value={detay.anaBirim}>{detay.anaBirim} (ana birim)</option>
                    {detay.birimler.map((b) => (
                      <option key={b.id} value={b.ad}>
                        {b.ad} (×{adet(b.katsayi)})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="Birim Maliyet (TRY)">
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={maliyet}
                    onChange={(e) => setMaliyet(e.target.value)}
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="Tarih *">
                  <Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <DepoSecici deger={depoId} onChange={setDepoId} />
              </div>
            </div>

            <Field label="Açıklama">
              <Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Örn. Fatura dışı giriş" />
            </Field>

            {girilenBirim !== detay.anaBirim && girilenMiktar && (
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                {adet(girilenMiktar)} {girilenBirim} × {adet(katsayi)} ={" "}
                <strong>
                  {adet(anaBirimMiktar)} {detay.anaBirim}
                </strong>{" "}
                stoğa işlenecek.
              </p>
            )}

            <div>
              <Button variant="primary" onClick={kaydet} disabled={!girilenMiktar || Number(girilenMiktar) <= 0}>
                Hareketi Kaydet
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th>
              {cokluDepo && <th>Depo</th>}
              <th>Tip</th>
              <th className="num">Girilen</th>
              <th className="num">Ana Birim</th>
              <th className="num">Birim Maliyet</th>
              <th>Kaynak</th>
              <th>Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {hareketler.length === 0 ? (
              <tr>
                <td colSpan={cokluDepo ? 8 : 7} className="empty">
                  Bu ürün için henüz stok hareketi yok.
                </td>
              </tr>
            ) : (
              hareketler.map((h) => {
                const y = yon(h.tip);
                // miktar API'de işaretli saklanır (çıkışlarda eksi); işareti biz eklemiyoruz.
                const degisim = Number(h.miktar);
                return (
                  <tr key={h.id}>
                    <td className="mono">{h.tarih.slice(0, 10)}</td>
                    {cokluDepo && <td>{h.depo?.ad ?? "—"}</td>}
                    <td>
                      <Badge variant={y === "giris" ? "success" : y === "cikis" ? "danger" : "info"}>
                        {baslik(h.tip)}
                      </Badge>
                    </td>
                    <td className="num">
                      {adet(h.girilenMiktar)} {h.girilenBirim}
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 700, color: degisim < 0 ? "var(--danger)" : "var(--success)" }}
                    >
                      {degisim > 0 ? "+" : ""}
                      {adet(degisim)} {detay.anaBirim}
                    </td>
                    <td className="num">{Number(h.maliyet) > 0 ? tl(h.maliyet) : "—"}</td>
                    <td>
                      <span className="muted" style={{ fontSize: "0.85rem" }}>
                        {h.kaynakTur === "manuel" ? "Manuel" : h.kaynakTur}
                      </span>
                    </td>
                    <td>{h.aciklama ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

/* ─── Birimler sekmesi (STK-10) ──────────────────────────────────────────── */

function BirimlerSekmesi({
  detay,
  onEkle,
  onSil,
}: {
  detay: StokDetay;
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
  onSil: (birimId: string) => void;
}) {
  const [ad, setAd] = useState("");
  const [katsayi, setKatsayi] = useState("");

  async function ekle() {
    const eklendi = await onEkle({ ad: ad.trim(), katsayi: Number(katsayi).toFixed(6) });
    if (eklendi) {
      setAd("");
      setKatsayi("");
    }
  }

  return (
    <div className="stack">
      <Card>
        <div className="card__title">Ek Birim Ekle</div>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          Katsayı, bir ek birimin kaç <strong>{detay.anaBirim}</strong> ettiğidir. Örnek: 1 koli = 12 adet ise katsayı 12.
        </p>
        <div className="row">
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Birim Adı *">
              <Input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="koli" />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label={`Katsayı (1 birim = ? ${detay.anaBirim}) *`}>
              <Input
                type="number"
                step="0.000001"
                min="0"
                value={katsayi}
                onChange={(e) => setKatsayi(e.target.value)}
                placeholder="12"
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={ekle} disabled={!ad.trim() || !katsayi || Number(katsayi) <= 0}>
              ➕ Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Birim</th>
              <th className="num">Katsayı</th>
              <th>Karşılığı</th>
              <th className="center">Eylem</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>{detay.anaBirim}</strong>
              </td>
              <td className="num">1</td>
              <td>
                <Badge variant="accent">Ana birim</Badge>
              </td>
              <td className="center">—</td>
            </tr>
            {detay.birimler.map((b) => (
              <tr key={b.id}>
                <td>{b.ad}</td>
                <td className="num">{adet(b.katsayi)}</td>
                <td>
                  1 {b.ad} = {adet(b.katsayi)} {detay.anaBirim}
                </td>
                <td className="center">
                  <Button size="sm" variant="danger" onClick={() => onSil(b.id)}>
                    Sil
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

/* ─── Barkodlar sekmesi (STK-15) ─────────────────────────────────────────── */

function BarkodlarSekmesi({
  detay,
  onEkle,
  onSil,
  onHata,
}: {
  detay: StokDetay;
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
  onSil: (barkodId: string) => void;
  onHata: (mesaj: string) => void;
}) {
  const [barkod, setBarkod] = useState("");
  const [birim, setBirim] = useState("");
  const [satisFiyati, setSatisFiyati] = useState("");
  const [etiketAdet, setEtiketAdet] = useState("1");
  const [etiketBarkod, setEtiketBarkod] = useState("");

  async function ekle() {
    const eklendi = await onEkle({
      barkod: barkod.trim(),
      birim: birim === "" ? null : birim,
      satisFiyati: satisFiyati.trim() === "" ? null : satisFiyati,
    });
    if (eklendi) {
      setBarkod("");
      setBirim("");
      setSatisFiyati("");
    }
  }

  /** Etiket PDF'i JSON değil blob döner; api() kullanılamaz. */
  async function etiketBas() {
    try {
      const res = await fetch(`${apiBase()}/stok/etiketler`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAl()}` },
        body: JSON.stringify({
          kalemler: [
            {
              stokId: detay.id,
              adet: Number(etiketAdet) || 1,
              ...(etiketBarkod ? { barkod: etiketBarkod } : {}),
            },
          ],
        }),
      });
      if (!res.ok) {
        const govde = await res.json().catch(() => ({}));
        throw new Error(govde.message || "Etiket PDF'i alınamadı");
      }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (h) {
      onHata(h instanceof Error ? h.message : "Etiket basılamadı");
    }
  }

  return (
    <div className="stack">
      <Card>
        <div className="card__title">Barkod Ekle</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Barkod *">
              <Input value={barkod} onChange={(e) => setBarkod(e.target.value)} placeholder="8690000000000" />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Birim">
              <Select value={birim} onChange={(e) => setBirim(e.target.value)}>
                <option value="">{detay.anaBirim} (ana birim)</option>
                {detay.birimler.map((b) => (
                  <option key={b.id} value={b.ad}>
                    {b.ad}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Satış Fiyatı (TRY)">
              <Input
                type="number"
                step="0.0001"
                value={satisFiyati}
                onChange={(e) => setSatisFiyati(e.target.value)}
                placeholder="Kart fiyatı kullanılır"
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button variant="primary" onClick={ekle} disabled={barkod.trim().length < 3}>
              ➕ Ekle
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="card__title">🏷️ Etiket Bas</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 200 }}>
            <Field label="Barkod">
              <Select value={etiketBarkod} onChange={(e) => setEtiketBarkod(e.target.value)}>
                <option value="">— İlk barkod —</option>
                {detay.barkodlar.map((b) => (
                  <option key={b.id} value={b.barkod}>
                    {b.barkod}
                    {b.birim ? ` (${b.birim})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="Adet">
              <Input
                type="number"
                min="1"
                max="500"
                value={etiketAdet}
                onChange={(e) => setEtiketAdet(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button onClick={etiketBas} disabled={detay.barkodlar.length === 0}>
              🖨️ Etiket PDF&apos;i Aç
            </Button>
          </div>
        </div>
        {detay.barkodlar.length === 0 && (
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
            Etiket basmak için önce en az bir barkod eklemelisiniz.
          </p>
        )}
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Barkod</th>
              <th>Birim</th>
              <th className="num">Satış Fiyatı</th>
              <th className="center">Eylem</th>
            </tr>
          </thead>
          <tbody>
            {detay.barkodlar.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  Bu ürüne tanımlı barkod yok.
                </td>
              </tr>
            ) : (
              detay.barkodlar.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.barkod}</td>
                  <td>{b.birim ?? detay.anaBirim}</td>
                  <td className="num">{b.satisFiyati ? tl(b.satisFiyati) : "—"}</td>
                  <td className="center">
                    <Button size="sm" variant="danger" onClick={() => onSil(b.id)}>
                      Sil
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

/* ─── Tedarikçiler sekmesi (STK-18) ──────────────────────────────────────── */

function TedarikcilerSekmesi({
  detay,
  cariler,
  onEkle,
  onSil,
}: {
  detay: StokDetay;
  cariler: CariOzet[];
  onEkle: (govde: Record<string, unknown>) => Promise<boolean>;
  onSil: (tedarikciId: string) => void;
}) {
  const [cariId, setCariId] = useState("");
  const [urunKodu, setUrunKodu] = useState("");
  const [alisFiyati, setAlisFiyati] = useState("");
  const [dovizCinsi, setDovizCinsi] = useState("TRY");
  const [tedarikSuresiGun, setTedarikSuresiGun] = useState("");
  const [varsayilan, setVarsayilan] = useState(false);

  async function ekle() {
    const eklendi = await onEkle({
      cariId,
      tedarikciUrunKodu: urunKodu.trim() === "" ? null : urunKodu.trim(),
      alisFiyati: alisFiyati.trim() === "" ? null : alisFiyati,
      dovizCinsi,
      tedarikSuresiGun: tedarikSuresiGun.trim() === "" ? null : Number(tedarikSuresiGun),
      varsayilan,
    });
    if (eklendi) {
      setCariId("");
      setUrunKodu("");
      setAlisFiyati("");
      setTedarikSuresiGun("");
      setVarsayilan(false);
    }
  }

  const bagliCariIdler = new Set(detay.tedarikciler.map((t) => t.cariId));

  return (
    <div className="stack">
      <Card>
        <div className="card__title">Tedarikçi Ekle</div>
        <div className="row">
          <div style={{ flex: 2, minWidth: 220 }}>
            <Field label="Cari *">
              <Select value={cariId} onChange={(e) => setCariId(e.target.value)}>
                <option value="">— Cari seçin —</option>
                {cariler
                  .filter((c) => !bagliCariIdler.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.kod} · {c.unvan}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Field label="Tedarikçi Ürün Kodu">
              <Input value={urunKodu} onChange={(e) => setUrunKodu(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <Field label="Alış Fiyatı">
              <Input
                type="number"
                step="0.0001"
                value={alisFiyati}
                onChange={(e) => setAlisFiyati(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <Field label="Döviz">
              <Select value={dovizCinsi} onChange={(e) => setDovizCinsi(e.target.value)}>
                <option value="TRY">TRY</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </Select>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Field label="Tedarik Süresi (gün)">
              <Input
                type="number"
                min="0"
                max="365"
                value={tedarikSuresiGun}
                onChange={(e) => setTedarikSuresiGun(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="between" style={{ marginTop: "0.75rem" }}>
          <label className="row-tight" style={{ alignItems: "center", cursor: "pointer", fontSize: "0.9rem" }}>
            <input type="checkbox" checked={varsayilan} onChange={(e) => setVarsayilan(e.target.checked)} />
            Varsayılan tedarikçi olarak işaretle
          </label>
          <Button variant="primary" onClick={ekle} disabled={!cariId}>
            ➕ Ekle
          </Button>
        </div>
      </Card>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Cari</th>
              <th>Tedarikçi Ürün Kodu</th>
              <th className="num">Alış Fiyatı</th>
              <th className="num">Tedarik Süresi</th>
              <th className="center">Eylem</th>
            </tr>
          </thead>
          <tbody>
            {detay.tedarikciler.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  Bu ürüne bağlı tedarikçi yok.
                </td>
              </tr>
            ) : (
              detay.tedarikciler.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="cell-entity__name">
                      {t.cari.unvan} {t.varsayilan && <Badge variant="accent">Varsayılan</Badge>}
                    </div>
                    <div className="cell-entity__meta">{t.cari.kod}</div>
                  </td>
                  <td className="mono">{t.tedarikciUrunKodu ?? "—"}</td>
                  <td className="num">
                    {t.alisFiyati
                      ? `${Number(t.alisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${t.dovizCinsi}`
                      : "—"}
                  </td>
                  <td className="num">{t.tedarikSuresiGun !== null ? `${t.tedarikSuresiGun} gün` : "—"}</td>
                  <td className="center">
                    <Button size="sm" variant="danger" onClick={() => onSil(t.id)}>
                      Sil
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
