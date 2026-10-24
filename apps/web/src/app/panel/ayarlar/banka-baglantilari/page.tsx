"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { paraBicimle } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";

interface Baglanti {
  id: string;
  aile: string;
  saglayici: string;
  durum: string;
  kullaniciAdiMaskeli: string;
}
interface BankaHesap {
  id: string;
  ad: string;
  bankaAdi: string;
  dovizCinsi: string;
}
interface Esleme {
  id: string;
  disHesapId: string;
  sonHareketId: string | null;
  sonSenkronTarihi: string | null;
  baglanti: { id: string; saglayici: string; durum: string };
  bankaHesap: BankaHesap;
}
/** KSB-15: otomatik çekim ayarı ve son durum. */
interface SenkronDurumu {
  id: string;
  otomatikSenkronDk: number;
  sonSenkronTarihi: string | null;
  sonSenkronDenemesi: string | null;
  sonSenkronHatasi: string | null;
  ardisikHata: number;
  otomatikDurduNedeni: string | null;
}
const ARALIKLAR = [
  { dk: 0, ad: "Kapalı" },
  { dk: 15, ad: "15 dakikada bir" },
  { dk: 30, ad: "30 dakikada bir" },
  { dk: 60, ad: "Saatte bir" },
  { dk: 1440, ad: "Günde bir" },
];
const zaman = (t: string | null) => (t ? new Date(t).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—");
interface VomsisHesap {
  id: number;
  fec_name: string;
  account_number: string;
  iban?: string | null;
  bank?: { bank_title?: string };
}

export default function BankaBaglantilari() {
  const [baglantilar, setBaglantilar] = useState<Baglanti[]>([]);
  const [hesaplar, setHesaplar] = useState<BankaHesap[]>([]);
  const [eslemeler, setEslemeler] = useState<Esleme[]>([]);
  const [vomsisHesaplar, setVomsisHesaplar] = useState<VomsisHesap[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [senkron, setSenkron] = useState<SenkronDurumu[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const yukle = useCallback(async () => {
    const [b, h, e, ben] = await Promise.all([
      api<Baglanti[]>("/baglantilar"),
      api<BankaHesap[]>("/kasa-banka/bankalar"),
      api<Esleme[]>("/kasa-banka/banka-baglantilari/eslemeler"),
      api<{ tenantId: string }>("/auth/ben"),
    ]);
    setBaglantilar(b.filter((x) => x.aile === "banka"));
    setHesaplar(h);
    setEslemeler(e);
    setTenantId(ben.tenantId);
    setSenkron(await api<SenkronDurumu[]>("/kasa-banka/banka-baglantilari/senkron-durumu").catch(() => []));
  }, []);
  useEffect(() => {
    void yukle().catch((x) => setHata(x instanceof Error ? x.message : "Ayarlar yüklenemedi"));
  }, [yukle]);
  const vomsis = baglantilar.find((x) => x.saglayici === "vomsis");
  const webhookBaglantisi = baglantilar.find((x) => x.saglayici === "webhook");
  async function vomsisKaydet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHata("");
    const f = new FormData(e.currentTarget);
    try {
      await api("/baglantilar", {
        method: "POST",
        body: JSON.stringify({
          aile: "banka",
          saglayici: "vomsis",
          config: { kullaniciAdi: f.get("appKey"), parola: f.get("appSecret"), servisAdresi: "https://developers.vomsis.com/api/v2" },
        }),
      });
      setBasari("Vomsis bağlantısı kaydedildi.");
      await yukle();
    } catch (x) {
      setHata(x instanceof Error ? x.message : "Vomsis bağlantısı kaydedilemedi");
    }
  }
  async function webhookKaydet(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHata("");
    const f = new FormData(e.currentTarget);
    try {
      await api("/baglantilar", {
        method: "POST",
        body: JSON.stringify({
          aile: "banka",
          saglayici: "webhook",
          config: { kullaniciAdi: f.get("saglayiciAdi"), apiAnahtari: f.get("apiAnahtari"), bankaHesapId: f.get("bankaHesapId") },
        }),
      });
      setBasari("Webhook bağlantısı kaydedildi.");
      await yukle();
    } catch (x) {
      setHata(x instanceof Error ? x.message : "Webhook bağlantısı kaydedilemedi");
    }
  }
  // Test yalnız doğrular; aktifleştirme ayrı uçtur (tenant baglantilar.service). Önceden yalnız test çağrılıyor, bağlantı hiç aktif olmuyordu.
  async function etkinlestir(b: Baglanti) {
    setHata("");
    try {
      const s = await api<{ basarili: boolean; mesaj?: string }>(`/baglantilar/${b.id}/test`, { method: "POST" });
      if (s.basarili) {
        await api(`/baglantilar/${b.id}/aktif-et`, { method: "POST" });
        setBasari(`${b.saglayici} bağlantısı etkinleştirildi.`);
      } else setHata(s.mesaj ?? "Doğrulama başarısız");
      await yukle();
    } catch (x) {
      setHata(x instanceof Error ? x.message : "Doğrulama başarısız");
    }
  }
  async function eslemeEkle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!vomsis) return;
    const f = new FormData(e.currentTarget);
    try {
      await api("/kasa-banka/banka-baglantilari/eslemeler", {
        method: "POST",
        body: JSON.stringify({ baglantiId: vomsis.id, bankaHesapId: f.get("bankaHesapId"), disHesapId: f.get("disHesapId") }),
      });
      setBasari("Vomsis hesabı yerel banka hesabıyla eşlendi.");
      await yukle();
    } catch (x) {
      setHata(x instanceof Error ? x.message : "Hesap eşlenemedi");
    }
  }
  async function senkronize() {
    if (!vomsis) return;
    setHata("");
    try {
      const s = await api<{ yeniSatir: number; yinelenenSatir: number; bakiyeFarklari?: { bankaHesapId: string; fark: string; tarih: string }[] }>(
        `/kasa-banka/banka-baglantilari/${vomsis.id}/senkronize`,
        { method: "POST" },
      );
      setBasari(`${s.yeniSatir} yeni Vomsis hareketi alındı; ${s.yinelenenSatir} tekrar atlandı.`);
      // KSB-31: bankanın bildirdiği bakiye sistemle tutmuyorsa hemen söylenir.
      const farklar = (s.bakiyeFarklari ?? []).map((b) => `${hesaplar.find((h) => h.id === b.bankaHesapId)?.ad ?? "Banka hesabı"}: ${paraBicimle(b.fark)} fark`);
      if (farklar.length) setHata(`Banka bakiyesi sistemle tutmuyor (${farklar.join("; ")}). Ekstre ekranındaki mutabakattan farkın kaynağına bakın.`);
      await yukle();
    } catch (x) {
      setHata(x instanceof Error ? x.message : "Vomsis hareketleri alınamadı");
    }
  }
  async function araligiKaydet(dakika: number) {
    if (!vomsis) return;
    setHata("");
    try {
      await api(`/kasa-banka/banka-baglantilari/${vomsis.id}/otomatik-senkron`, { method: "PUT", body: JSON.stringify({ dakika }) });
      setBasari(dakika ? "Otomatik çekim aralığı kaydedildi." : "Otomatik çekim kapatıldı.");
      await yukle();
    } catch (x) {
      setHata(x instanceof Error ? x.message : "Aralık kaydedilemedi");
    }
  }
  async function vomsisHesaplariniYukle() {
    if (!vomsis) return;
    setHata("");
    try {
      setVomsisHesaplar(await api<VomsisHesap[]>(`/kasa-banka/banka-baglantilari/${vomsis.id}/vomsis-hesaplari`));
    } catch (x) {
      setHata(x instanceof Error ? x.message : "Vomsis hesapları alınamadı");
    }
  }
  const webhook =
    webhookBaglantisi && tenantId
      ? `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}/banka-webhook/${tenantId}/${webhookBaglantisi.id}`
      : "";
  const vomsisSenkron = vomsis ? senkron.find((x) => x.id === vomsis.id) : undefined;
  const durum = (b: Baglanti) => <Badge variant={b.durum === "aktif" ? "success" : "neutral"}>{b.durum}</Badge>;
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }} className="stack">
      <PageHeader
        title="Banka Bağlantıları"
        subtitle="Vomsis üzerinden hareketleri çekin veya sağlayıcınızın webhook ile aktarmasını sağlayın."
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      <Card>
        <h3>Vomsis</h3>
        {vomsis ? (
          <div className="stack">
            <div className="between">
              <p>
                {vomsis.kullaniciAdiMaskeli} · {durum(vomsis)}
              </p>
              <div className="row-tight">
                <Button onClick={() => void etkinlestir(vomsis)}>Etkinleştir</Button>
                <Button onClick={() => void vomsisHesaplariniYukle()}>Vomsis hesaplarını getir</Button>
                <Button variant="primary" disabled={vomsis.durum !== "aktif" || !eslemeler.length} onClick={() => void senkronize()}>
                  Hareketleri çek
                </Button>
              </div>
            </div>
            {vomsisSenkron && (
              <div className="row" style={{ alignItems: "flex-end" }}>
                <Field label="Otomatik çekim">
                  <Select value={String(vomsisSenkron.otomatikSenkronDk)} onChange={(e) => void araligiKaydet(Number(e.target.value))}>
                    {ARALIKLAR.map((a) => (
                      <option key={a.dk} value={a.dk}>
                        {a.ad}
                      </option>
                    ))}
                  </Select>
                </Field>
                <p className="muted" style={{ margin: 0 }}>
                  Son başarılı çekim: {zaman(vomsisSenkron.sonSenkronTarihi)} · son deneme: {zaman(vomsisSenkron.sonSenkronDenemesi)}
                </p>
              </div>
            )}
            {vomsisSenkron?.otomatikDurduNedeni ? (
              <Alert tone="error">
                Otomatik çekim durdu: {vomsisSenkron.otomatikDurduNedeni}. Bilgileri düzeltip &quot;Hareketleri çek&quot; ile deneyin;
                başarılı çekimde yeniden başlar.
              </Alert>
            ) : vomsisSenkron?.sonSenkronHatasi ? (
              <Alert tone="warning">
                Son çekim başarısız ({vomsisSenkron.ardisikHata} kez üst üste): {vomsisSenkron.sonSenkronHatasi}
              </Alert>
            ) : null}
            <form className="row" onSubmit={eslemeEkle}>
              <Field label="TekirExtra banka hesabı">
                <Select name="bankaHesapId" required>
                  <option value="">Hesap seçin</option>
                  {hesaplar.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.bankaAdi} · {h.ad} · {h.dovizCinsi}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Vomsis hesabı">
                <Select name="disHesapId" required>
                  <option value="">Vomsis hesabı seçin</option>
                  {vomsisHesaplar.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.bank?.bank_title ?? "Banka"} · {h.iban ?? h.account_number} · {h.fec_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" disabled={!vomsisHesaplar.length}>
                Hesabı eşle
              </Button>
            </form>
            {eslemeler
              .filter((e) => e.baglanti.id === vomsis.id)
              .map((e) => (
                <p key={e.id}>
                  <strong>{e.bankaHesap.ad}</strong> ↔ Vomsis #{e.disHesapId} · son hareket {e.sonHareketId ?? "—"}
                </p>
              ))}
          </div>
        ) : (
          <form className="stack" onSubmit={vomsisKaydet}>
            <div className="row">
              <Field label="Vomsis App Key">
                <Input name="appKey" required />
              </Field>
              <Field label="Vomsis App Secret">
                <Input name="appSecret" type="password" required />
              </Field>
            </div>
            <Button type="submit" variant="primary">
              Vomsis bağlantısını kaydet
            </Button>
          </form>
        )}
      </Card>
      <Card>
        <h3>Sağlayıcı webhook'u</h3>
        {webhookBaglantisi ? (
          <div className="stack">
            <div className="between">
              <p>
                {webhookBaglantisi.kullaniciAdiMaskeli} · {durum(webhookBaglantisi)}
              </p>
              <Button onClick={() => void etkinlestir(webhookBaglantisi)}>Etkinleştir</Button>
            </div>
            <Field label="Webhook adresi">
              <Input value={webhook} readOnly />
            </Field>
          </div>
        ) : (
          <form className="stack" onSubmit={webhookKaydet}>
            <div className="row">
              <Field label="Sağlayıcı adı">
                <Input name="saglayiciAdi" required />
              </Field>
              <Field label="Banka hesabı">
                <Select name="bankaHesapId" required>
                  <option value="">Hesap seçin</option>
                  {hesaplar.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.bankaAdi} · {h.ad}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bearer erişim anahtarı">
                <Input name="apiAnahtari" type="password" required minLength={24} />
              </Field>
            </div>
            <Button type="submit">Webhook bağlantısını kaydet</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
