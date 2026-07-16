"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Segmented,
  Select,
  Stat,
  StatGrid,
  Status,
  TableWrap,
  Tabs,
} from "@/components/ui";

const TIP_ETIKETLERI: Record<string, string> = {
  musteri: "👤 Müşteri",
  tedarikci: "🏬 Tedarikçi",
  her_ikisi: "🔄 Müşteri + Tedarikçi",
  personel: "🧑‍💼 Personel",
  ortak: "🤝 Ortak",
  diger: "🏢 Diğer",
};

interface Cari {
  id: string;
  kod: string;
  unvan: string;
  tip: string;
  sektor: string | null;
  vknTckn: string | null;
  eposta: string | null;
  telefon: string | null;
  karaListe: boolean;
  bakiyeler: { dovizCinsi: string; bakiye: string }[];
}

interface Etiket {
  id: string;
  ad: string;
  renk: string | null;
}

interface BankaHesap {
  id: string;
  bankaAdi: string;
  subeAdi: string | null;
  hesapSahibi: string | null;
  iban: string;
  swift: string | null;
  paraBirimi: string;
}

interface CariAdres {
  id: string;
  baslik: string;
  tip: string;
  adres: string;
  il: string;
  ilce: string | null;
}

interface CariKisi {
  id: string;
  adSoyad: string;
  gorev: string | null;
  telefon: string | null;
  eposta: string | null;
}

interface CariDetay extends Cari {
  kisaAd: string | null;
  kisiTipi: string;
  vergiDairesi: string | null;
  mersisNo: string | null;
  ticaretSicilNo: string | null;
  webSitesi: string | null;
  faks: string | null;
  karaListeNotu: string | null;
  riskLimiti: string | null;
  varsayilanVadeGun: number | null;
  bankaHesaplari: BankaHesap[];
  etiketler: Etiket[];
  adresler: CariAdres[];
  kisiler: CariKisi[];
  risk: {
    cekSenetRiski: string;
    mevcutRisk: string;
    limit: string | null;
    kalanLimit: string | null;
    asim: boolean;
  };
  finansalOzet: {
    sonIslemTarihi: string | null;
    sonTahsilatTarihi: string | null;
    sonOdemeTarihi: string | null;
    vadesiGecmisBakiye: string;
  };
}

interface EkstreSatir {
  tarih: string;
  vadeTarihi: string | null;
  tip: "borc" | "alacak";
  aciklama: string | null;
  dovizCinsi: string;
  tutar: string;
  kur: string;
  tutarTry: string;
  yuruyenBakiye: string;
}

interface EkstreVeri {
  cari: { id: string; kod: string; unvan: string };
  satirlar: EkstreSatir[];
}

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

type Sekme = "genel" | "ekstre" | "adresler" | "kisiler" | "bankalar";
type FiltreTip = "tumu" | "musteri" | "tedarikci" | "bloke";

export default function CariSayfasi() {
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [arama, setArama] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [detay, setDetay] = useState<CariDetay | null>(null);
  const [ekstre, setEkstre] = useState<EkstreVeri | null>(null);
  const [etiketler, setEtiketler] = useState<Etiket[]>([]);
  const [aktifSekme, setAktifSekme] = useState<Sekme>("genel");
  const [filtreTip, setFiltreTip] = useState<FiltreTip>("tumu");

  // Form alanları — kimlik
  const [kod, setKod] = useState("");
  const [unvan, setUnvan] = useState("");
  const [kisaAd, setKisaAd] = useState("");
  const [tip, setTip] = useState("musteri");
  const [kisiTipi, setKisiTipi] = useState("tuzel");
  const [sektor, setSektor] = useState("");
  // Vergi / resmi
  const [vknTckn, setVknTckn] = useState("");
  const [vergiDairesi, setVergiDairesi] = useState("");
  const [mersisNo, setMersisNo] = useState("");
  const [ticaretSicilNo, setTicaretSicilNo] = useState("");
  // İletişim
  const [eposta, setEposta] = useState("");
  const [telefon, setTelefon] = useState("");
  const [webSitesi, setWebSitesi] = useState("");
  const [faks, setFaks] = useState("");
  // Finans (CARI-10: özel satış koşulları)
  const [riskLimiti, setRiskLimiti] = useState("");
  const [fiyatListesiId, setFiyatListesiId] = useState("");
  const [varsayilanIskonto, setVarsayilanIskonto] = useState("");
  const [varsayilanVadeGun, setVarsayilanVadeGun] = useState("");
  const [fiyatListeleri, setFiyatListeleri] = useState<{ id: string; ad: string; dovizCinsi: string }[]>([]);
  // Detay panel alt formları
  const [bankaAdi, setBankaAdi] = useState("");
  const [iban, setIban] = useState("");
  const [paraBirimi, setParaBirimi] = useState("TRY");
  const [yeniEtiket, setYeniEtiket] = useState("");
  const [secilenEtiketId, setSecilenEtiketId] = useState("");

  const yukle = useCallback(async () => {
    try {
      const qs = arama ? `?arama=${encodeURIComponent(arama)}` : "";
      const veri = await api<{ kayitlar: Cari[] }>(`/cari${qs}`);
      setCariler(veri.kayitlar);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yükleme hatası");
    }
  }, [arama]);

  const etiketleriYukle = useCallback(async () => {
    try {
      setEtiketler(await api<Etiket[]>("/cari/etiketler"));
    } catch {
      /* etiketler yüklenemezse liste boş kalır */
    }
  }, []);

  useEffect(() => {
    if (tokenAl()) {
      void yukle();
      void etiketleriYukle();
      api<{ id: string; ad: string; dovizCinsi: string }[]>("/fiyat-listeleri")
        .then(setFiyatListeleri)
        .catch(() => undefined);
    }
  }, [yukle, etiketleriYukle]);

  async function detayAc(id: string) {
    setHata("");
    try {
      const [cDetay, cEkstre] = await Promise.all([
        api<CariDetay>(`/cari/${id}`),
        api<EkstreVeri>(`/cari/${id}/ekstre`),
      ]);
      setDetay(cDetay);
      setEkstre(cEkstre);
      setAktifSekme("genel");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Detay veya ekstre yüklenemedi");
    }
  }

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      await api("/cari", {
        method: "POST",
        body: JSON.stringify({
          kod,
          unvan,
          kisaAd: kisaAd || undefined,
          tip,
          kisiTipi,
          sektor: sektor || undefined,
          vknTckn: vknTckn || undefined,
          vergiDairesi: vergiDairesi || undefined,
          mersisNo: mersisNo || undefined,
          ticaretSicilNo: ticaretSicilNo || undefined,
          eposta: eposta || undefined,
          telefon: telefon || undefined,
          webSitesi: webSitesi || undefined,
          faks: faks || undefined,
          riskLimiti: riskLimiti || undefined,
          fiyatListesiId: fiyatListesiId || undefined,
          varsayilanIskonto: varsayilanIskonto || undefined,
          varsayilanVadeGun: varsayilanVadeGun ? Number(varsayilanVadeGun) : undefined,
        }),
      });
      setBasari("Cari kart başarıyla oluşturuldu.");
      setFormAcik(false);
      setKod("");
      setUnvan("");
      setKisaAd("");
      setSektor("");
      setVknTckn("");
      setVergiDairesi("");
      setMersisNo("");
      setTicaretSicilNo("");
      setEposta("");
      setTelefon("");
      setWebSitesi("");
      setFaks("");
      setRiskLimiti("");
      setFiyatListesiId("");
      setVarsayilanIskonto("");
      setVarsayilanVadeGun("");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kayıt hatası");
    }
  }

  async function karaListeDegistir() {
    if (!detay) return;
    const yeniDurum = !detay.karaListe;
    const not = yeniDurum
      ? window.prompt("Blokaj nedeni (isteğe bağlı):") || undefined
      : undefined;
    try {
      await api(`/cari/${detay.id}`, {
        method: "PATCH",
        body: JSON.stringify({ karaListe: yeniDurum, karaListeNotu: not }),
      });
      await detayAc(detay.id);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Güncelleme hatası");
    }
  }

  async function bankaHesabiEkle(e: React.FormEvent) {
    e.preventDefault();
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/banka-hesaplari`, {
        method: "POST",
        body: JSON.stringify({ bankaAdi, iban, paraBirimi }),
      });
      setBankaAdi("");
      setIban("");
      await detayAc(detay.id);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Banka hesabı eklenemedi");
    }
  }

  async function bankaHesabiSil(hesapId: string) {
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/banka-hesaplari/${hesapId}`, { method: "DELETE" });
      await detayAc(detay.id);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Banka hesabı silinemedi");
    }
  }

  async function etiketOlusturVeAta(e: React.FormEvent) {
    e.preventDefault();
    if (!detay || !yeniEtiket.trim()) return;
    try {
      const etiket = await api<Etiket>("/cari/etiketler", {
        method: "POST",
        body: JSON.stringify({ ad: yeniEtiket.trim() }),
      });
      await api(`/cari/${detay.id}/etiketler/${etiket.id}`, { method: "POST" });
      setYeniEtiket("");
      await Promise.all([detayAc(detay.id), etiketleriYukle()]);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Etiket eklenemedi");
    }
  }

  async function etiketAta() {
    if (!detay || !secilenEtiketId) return;
    try {
      await api(`/cari/${detay.id}/etiketler/${secilenEtiketId}`, { method: "POST" });
      setSecilenEtiketId("");
      await detayAc(detay.id);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Etiket atanamadı");
    }
  }

  async function etiketKaldir(etiketId: string) {
    if (!detay) return;
    try {
      await api(`/cari/${detay.id}/etiketler/${etiketId}`, { method: "DELETE" });
      await detayAc(detay.id);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Etiket kaldırılamadı");
    }
  }

  async function excelYukle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setHata("");
    setBasari("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = tokenAl();
      const res = await fetch(`${apiBase()}/cari/excel-aktar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || "Excel yükleme hatası");
      }

      const resData = await res.json();
      setBasari(`Excel başarıyla aktarıldı. ${resData.eklenen} adet cari eklendi/güncellendi.`);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Excel yükleme hatası");
    }
  }

  async function ekstreIndir(id: string, unvanAd: string) {
    try {
      const token = tokenAl();
      const res = await fetch(`${apiBase()}/cari/${id}/ekstre/excel`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Ekstre indirilemedi");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ekstre-${unvanAd.replace(/\s+/g, "-")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setHata("Excel ekstre indirilirken bir hata oluştu.");
    }
  }

  async function kopyala(id: string) {
    setHata("");
    setBasari("");
    try {
      await api(`/cari/${id}/kopyala`, { method: "POST" });
      setBasari("Cari hesap başarıyla kopyalandı.");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kopyalama hatası");
    }
  }

  const filtrelenmisCariler = cariler.filter((c) => {
    if (filtreTip === "musteri") return c.tip === "musteri" || c.tip === "hepsi";
    if (filtreTip === "tedarikci") return c.tip === "tedarikci" || c.tip === "hepsi";
    if (filtreTip === "bloke") return c.karaListe === true;
    return true;
  });

  const musteriSayisi = cariler.filter((c) => c.tip === "musteri" || c.tip === "hepsi").length;
  const tedarikciSayisi = cariler.filter((c) => c.tip === "tedarikci" || c.tip === "hepsi").length;
  const blokeSayisi = cariler.filter((c) => c.karaListe === true).length;

  return (
    <div>
      <PageHeader
        title="Cari Hesaplar"
        subtitle="Müşterileriniz, tedarikçileriniz ve diğer cari ortaklarınızı buradan yönetin."
        actions={
          <>
            <ButtonLabel as="a" href="/panel/cari/raporlar">📈 Raporlar</ButtonLabel>
            <ButtonLabel>
              📥 Excel&apos;den İçe Aktar
              <input type="file" accept=".xlsx" onChange={excelYukle} style={{ display: "none" }} />
            </ButtonLabel>
            <Button variant="primary" onClick={() => setFormAcik(!formAcik)}>
              {formAcik ? "Vazgeç" : "➕ Yeni Cari"}
            </Button>
          </>
        }
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      {formAcik && (
        <Card className="stack" style={{ marginBottom: "1.5rem", maxWidth: 820 }}>
          <h3 style={{ fontSize: "1.05rem" }}>Yeni Cari Kartı Oluştur</h3>

          <FormBolum baslik="Kimlik">
            <FormAlan flex={1} min={180}><Field label="Cari Kodu *"><Input value={kod} onChange={(e) => setKod(e.target.value)} required placeholder="CARI-001" /></Field></FormAlan>
            <FormAlan flex={2} min={240}><Field label="Ünvan / Ad Soyad"><Input value={unvan} onChange={(e) => setUnvan(e.target.value)} required placeholder="Teknoloji A.Ş." /></Field></FormAlan>
            <FormAlan flex={1} min={160}><Field label="Kısa Ad"><Input value={kisaAd} onChange={(e) => setKisaAd(e.target.value)} placeholder="Teknoloji" /></Field></FormAlan>
          </FormBolum>
          <FormBolum>
            <FormAlan flex={1} min={180}><Field label="Cari Tipi"><Select value={tip} onChange={(e) => setTip(e.target.value)}>{Object.entries(TIP_ETIKETLERI).map(([deger, ad]) => (<option key={deger} value={deger}>{ad}</option>))}</Select></Field></FormAlan>
            <FormAlan flex={1} min={180}><Field label="Kişi Tipi"><Select value={kisiTipi} onChange={(e) => setKisiTipi(e.target.value)}><option value="tuzel">Tüzel Kişi</option><option value="gercek">Gerçek Kişi</option></Select></Field></FormAlan>
            <FormAlan flex={1} min={180}><Field label="Sektör"><Input value={sektor} onChange={(e) => setSektor(e.target.value)} placeholder="Perakende" /></Field></FormAlan>
          </FormBolum>

          <FormBolum baslik="Vergi ve Resmi Bilgiler">
            <FormAlan flex={1} min={180}><Field label="VKN / TCKN"><Input value={vknTckn} onChange={(e) => setVknTckn(e.target.value)} placeholder="10-11 hane" /></Field></FormAlan>
            <FormAlan flex={1} min={180}><Field label="Vergi Dairesi"><Input value={vergiDairesi} onChange={(e) => setVergiDairesi(e.target.value)} /></Field></FormAlan>
            <FormAlan flex={1} min={180}><Field label="MERSİS No"><Input value={mersisNo} onChange={(e) => setMersisNo(e.target.value)} placeholder="16 hane" /></Field></FormAlan>
            <FormAlan flex={1} min={180}><Field label="Ticaret Sicil No"><Input value={ticaretSicilNo} onChange={(e) => setTicaretSicilNo(e.target.value)} /></Field></FormAlan>
          </FormBolum>

          <FormBolum baslik="İletişim">
            <FormAlan flex={1} min={180}><Field label="E-posta"><Input type="email" value={eposta} onChange={(e) => setEposta(e.target.value)} /></Field></FormAlan>
            <FormAlan flex={1} min={160}><Field label="Telefon"><Input value={telefon} onChange={(e) => setTelefon(e.target.value)} /></Field></FormAlan>
            <FormAlan flex={1} min={160}><Field label="Web Sitesi"><Input value={webSitesi} onChange={(e) => setWebSitesi(e.target.value)} placeholder="https://..." /></Field></FormAlan>
            <FormAlan flex={1} min={140}><Field label="Faks"><Input value={faks} onChange={(e) => setFaks(e.target.value)} /></Field></FormAlan>
          </FormBolum>

          <FormBolum baslik="Finans ve Satış Koşulları">
            <FormAlan flex={1} min={200}><Field label="Fiyat Listesi"><Select value={fiyatListesiId} onChange={(e) => setFiyatListesiId(e.target.value)}><option value="">— Yok (stok satış fiyatı) —</option>{fiyatListeleri.map((l) => (<option key={l.id} value={l.id}>{l.ad} ({l.dovizCinsi})</option>))}</Select></Field></FormAlan>
            <FormAlan flex={1} min={160}><Field label="Varsayılan İskonto (%)"><Input type="number" step="0.01" min="0" max="100" value={varsayilanIskonto} onChange={(e) => setVarsayilanIskonto(e.target.value)} placeholder="0" /></Field></FormAlan>
            <FormAlan flex={1} min={160}><Field label="Varsayılan Vade (gün)"><Input type="number" min="0" max="365" value={varsayilanVadeGun} onChange={(e) => setVarsayilanVadeGun(e.target.value)} placeholder="0" /></Field></FormAlan>
            <FormAlan flex={1} min={180}><Field label="Risk Limiti (TL)"><Input value={riskLimiti} onChange={(e) => setRiskLimiti(e.target.value)} placeholder="1000000" /></Field></FormAlan>
          </FormBolum>

          <div><Button variant="primary" onClick={kaydet}>Cari Kartı Kaydet</Button></div>
        </Card>
      )}

      {detay && (
        <Card style={{ marginBottom: "1.5rem", borderColor: "var(--accent)" }}>
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ fontSize: "1.15rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {detay.unvan}
                {detay.karaListe && <Badge variant="danger">🚫 Kara Liste</Badge>}
              </h3>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                {detay.kod} · {TIP_ETIKETLERI[detay.tip] ?? detay.tip} · {detay.kisiTipi === "gercek" ? "Gerçek Kişi" : "Tüzel Kişi"}
                {detay.sektor ? ` · ${detay.sektor}` : ""}
              </p>
              {detay.karaListe && detay.karaListeNotu && (
                <p style={{ color: "var(--danger)", fontSize: "0.85rem", margin: "0.3rem 0 0" }}>Blokaj nedeni: {detay.karaListeNotu}</p>
              )}
            </div>
            <div className="row-tight">
              <Button size="sm" onClick={karaListeDegistir}>{detay.karaListe ? "✅ Blokajı Kaldır" : "🚫 Kara Listeye Al"}</Button>
              <Button size="sm" onClick={() => { setDetay(null); setEkstre(null); }}>✖ Kapat</Button>
            </div>
          </div>

          <div style={{ marginTop: "1.25rem" }}>
            <Tabs<Sekme>
              value={aktifSekme}
              onChange={setAktifSekme}
              items={[
                { deger: "genel", baslik: "Genel Bakış" },
                { deger: "ekstre", baslik: "Ekstre" },
                { deger: "adresler", baslik: "Adresler" },
                { deger: "kisiler", baslik: "İlgili Kişiler" },
                { deger: "bankalar", baslik: "Banka Hesapları" },
              ]}
            />
          </div>

          {aktifSekme === "genel" && (
            <div>
              <StatGrid>
                {(() => {
                  const bakiyeNum = Number(detay.bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? "0.00");
                  return (
                    <Stat
                      label="Toplam Bakiye"
                      value={tl(bakiyeNum)}
                      tone={bakiyeNum > 0 ? "success" : bakiyeNum < 0 ? "danger" : "default"}
                      hint={bakiyeNum > 0 ? "Alacaklıyız" : bakiyeNum < 0 ? "Borçluyuz" : "Bakiye Sıfır"}
                    />
                  );
                })()}
                <Stat
                  label="Vadesi Geçmiş"
                  value={tl(detay.finansalOzet.vadesiGecmisBakiye)}
                  tone={Number(detay.finansalOzet.vadesiGecmisBakiye) > 0 ? "danger" : "default"}
                  hint="Açık kalemler"
                />
                <Stat
                  label="Vade Süresi"
                  value={detay.varsayilanVadeGun ? `${detay.varsayilanVadeGun} Gün` : "—"}
                  hint="Varsayılan vade"
                />
                <Stat
                  label="Risk Durumu"
                  value={detay.risk.asim ? "Limit Aşımı" : "Normal"}
                  tone={detay.risk.asim ? "danger" : "accent"}
                  hint={detay.risk.limit ? `Limit: ${tl(detay.risk.limit)}` : "Limit Tanımsız"}
                />
              </StatGrid>

              <div className="row">
                <Card className="grow" style={{ flex: 2, minWidth: 280 }}>
                  <div className="card__title">⚖️ Risk &amp; Finans Bilgileri</div>
                  <table style={{ width: "100%", fontSize: "0.9rem" }}>
                    <tbody>
                      <SatirCift ad="Mevcut Risk" deger={tl(detay.risk.mevcutRisk)} />
                      <SatirCift ad="Çek/Senet Riski" deger={tl(detay.risk.cekSenetRiski)} />
                      {detay.risk.kalanLimit !== null && (
                        <tr>
                          <td className="muted" style={{ padding: "0.4rem 0" }}>Kalan Risk Limiti</td>
                          <td className="num" style={{ fontWeight: 700, color: detay.risk.asim ? "var(--danger)" : "var(--success)" }}>{tl(detay.risk.kalanLimit)}</td>
                        </tr>
                      )}
                      <SatirCift ad="Son İşlem Tarihi" deger={detay.finansalOzet.sonIslemTarihi ?? "—"} />
                      <SatirCift ad="Son Tahsilat Tarihi" deger={detay.finansalOzet.sonTahsilatTarihi ?? "—"} />
                      <SatirCift ad="Son Ödeme Tarihi" deger={detay.finansalOzet.sonOdemeTarihi ?? "—"} />
                    </tbody>
                  </table>
                  {detay.risk.asim && <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.75rem" }}>⚠️ Risk limiti aşılmış durumda.</p>}
                </Card>

                <Card className="grow" style={{ flex: 1, minWidth: 220 }}>
                  <div className="card__title">🏷️ Etiket Yönetimi</div>
                  <div className="row-tight" style={{ marginBottom: "0.75rem" }}>
                    {detay.etiketler.length === 0 && <span className="subtle" style={{ fontSize: "0.85rem" }}>Etiket yok</span>}
                    {detay.etiketler.map((e) => (
                      <span key={e.id} className="chip">
                        {e.ad}
                        <button onClick={() => etiketKaldir(e.id)}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div className="row-tight" style={{ marginBottom: "0.5rem", flexWrap: "nowrap" }}>
                    <Select className="grow" value={secilenEtiketId} onChange={(e) => setSecilenEtiketId(e.target.value)}>
                      <option value="">Seç...</option>
                      {etiketler.filter((e) => !detay.etiketler.some((d) => d.id === e.id)).map((e) => (
                        <option key={e.id} value={e.id}>{e.ad}</option>
                      ))}
                    </Select>
                    <Button size="sm" onClick={etiketAta}>Ata</Button>
                  </div>
                  <form onSubmit={etiketOlusturVeAta} className="row-tight" style={{ flexWrap: "nowrap" }}>
                    <Input className="grow" value={yeniEtiket} onChange={(e) => setYeniEtiket(e.target.value)} placeholder="Yeni etiket..." />
                    <Button size="sm" type="submit">➕</Button>
                  </form>
                </Card>
              </div>
            </div>
          )}

          {aktifSekme === "ekstre" && (
            <Card>
              <div className="card__title">📊 Cari Hesap Ekstresi</div>
              {!ekstre ? (
                <p className="subtle" style={{ fontSize: "0.85rem" }}>Ekstre yükleniyor...</p>
              ) : ekstre.satirlar.length === 0 ? (
                <p className="subtle" style={{ fontSize: "0.85rem" }}>Cari hesaba ait herhangi bir hareket bulunmuyor.</p>
              ) : (
                <TableWrap>
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>Vade Tarihi</th>
                      <th>Açıklama</th>
                      <th className="num">Borç (TL)</th>
                      <th className="num">Alacak (TL)</th>
                      <th className="num">Bakiye (TL)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ekstre.satirlar.map((row, idx) => {
                      const borcVal = row.tip === "borc" ? Number(row.tutarTry) : 0;
                      const alacakVal = row.tip === "alacak" ? Number(row.tutarTry) : 0;
                      const bakiyeNum = Number(row.yuruyenBakiye);
                      return (
                        <tr key={idx}>
                          <td>{row.tarih}</td>
                          <td>{row.vadeTarihi || "—"}</td>
                          <td>{row.aciklama || "—"}</td>
                          <td className="num" style={{ color: borcVal > 0 ? "var(--danger)" : undefined }}>{borcVal > 0 ? tl(borcVal) : "—"}</td>
                          <td className="num" style={{ color: alacakVal > 0 ? "var(--success)" : undefined }}>{alacakVal > 0 ? tl(alacakVal) : "—"}</td>
                          <td className={`num money ${bakiyeNum > 0 ? "pos" : bakiyeNum < 0 ? "neg" : ""}`}>{tl(bakiyeNum)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
              )}
            </Card>
          )}

          {aktifSekme === "adresler" && (
            <Card>
              <div className="card__title">🏢 Adres Bilgileri</div>
              {detay.adresler && detay.adresler.length === 0 ? (
                <p className="subtle" style={{ fontSize: "0.85rem" }}>Kayıtlı adres bilgisi yok.</p>
              ) : (
                <TableWrap>
                  <thead>
                    <tr><th>Başlık</th><th>Tip</th><th>Adres</th><th>İl / İlçe</th></tr>
                  </thead>
                  <tbody>
                    {detay.adresler?.map((a) => (
                      <tr key={a.id}>
                        <td>{a.baslik}</td>
                        <td>{a.tip === "fatura" ? "📄 Fatura Adresi" : a.tip === "sevk" ? "🚚 Sevk Adresi" : "🏢 Merkez/Şube"}</td>
                        <td>{a.adres}</td>
                        <td>{a.ilce ? `${a.ilce} / ` : ""}{a.il}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </Card>
          )}

          {aktifSekme === "kisiler" && (
            <Card>
              <div className="card__title">👥 İlgili Kişiler</div>
              {detay.kisiler && detay.kisiler.length === 0 ? (
                <p className="subtle" style={{ fontSize: "0.85rem" }}>Kayıtlı ilgili kişi yok.</p>
              ) : (
                <TableWrap>
                  <thead>
                    <tr><th>Ad Soyad</th><th>Görev</th><th>Telefon</th><th>E-posta</th></tr>
                  </thead>
                  <tbody>
                    {detay.kisiler?.map((k) => (
                      <tr key={k.id}>
                        <td>{k.adSoyad}</td>
                        <td>{k.gorev || "—"}</td>
                        <td>{k.telefon || "—"}</td>
                        <td>{k.eposta || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </Card>
          )}

          {aktifSekme === "bankalar" && (
            <Card className="stack">
              <div className="card__title" style={{ margin: 0 }}>🏦 Banka Hesapları</div>
              {detay.bankaHesaplari.length === 0 ? (
                <p className="subtle" style={{ fontSize: "0.85rem", margin: 0 }}>Kayıtlı banka hesabı yok.</p>
              ) : (
                <TableWrap>
                  <thead>
                    <tr><th>Banka Adı</th><th>IBAN</th><th>Döviz</th><th className="center">İşlem</th></tr>
                  </thead>
                  <tbody>
                    {detay.bankaHesaplari.map((b) => (
                      <tr key={b.id}>
                        <td>{b.bankaAdi}{b.subeAdi ? ` / ${b.subeAdi}` : ""}</td>
                        <td className="mono">{b.iban}</td>
                        <td>{b.paraBirimi}</td>
                        <td className="center"><button className="btn-link" style={{ color: "var(--danger)" }} onClick={() => bankaHesabiSil(b.id)}>Sil</button></td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
              <form onSubmit={bankaHesabiEkle} className="row-tight" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", flexWrap: "nowrap" }}>
                <Input className="grow" value={bankaAdi} onChange={(e) => setBankaAdi(e.target.value)} placeholder="Banka adı" required style={{ minWidth: 140 }} />
                <Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="TR + 24 rakam" required style={{ flex: 2, minWidth: 220 }} />
                <Select value={paraBirimi} onChange={(e) => setParaBirimi(e.target.value)} style={{ width: 90 }}>
                  <option>TRY</option><option>USD</option><option>EUR</option>
                </Select>
                <Button size="sm" type="submit">➕ Ekle</Button>
              </form>
            </Card>
          )}
        </Card>
      )}

      <StatGrid>
        <Stat label="Toplam Cari" value={cariler.length} />
        <Stat label="Müşteri" value={musteriSayisi} tone="accent" />
        <Stat label="Tedarikçi" value={tedarikciSayisi} tone="info" />
        <Stat label="Bloke" value={blokeSayisi} tone={blokeSayisi > 0 ? "danger" : "default"} />
      </StatGrid>

      <div className="toolbar">
        <SearchInput
          className="grow"
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Cari adı, kodu veya VKN ile ara..."
        />
        <Segmented<FiltreTip>
          value={filtreTip}
          onChange={setFiltreTip}
          items={[
            { deger: "tumu", baslik: "Tümü" },
            { deger: "musteri", baslik: "Müşteri" },
            { deger: "tedarikci", baslik: "Tedarikçi" },
            { deger: "bloke", baslik: "Bloke" },
          ]}
        />
      </div>

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Cari Adı</th>
              <th>Tür</th>
              <th>Sektör</th>
              <th>VKN / TCKN</th>
              <th className="num">Bakiye</th>
              <th>Risk</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {filtrelenmisCariler.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">Arama kriterlerinize uygun cari hesap kaydı bulunamadı.</td>
              </tr>
            ) : (
              filtrelenmisCariler.map((c) => {
                const bakiyeNum = Number(c.bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? "0.00");
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="cell-entity">
                        <Avatar isim={c.unvan} />
                        <div>
                          <div className="cell-entity__name">
                            {c.karaListe && <span title="Kara liste / işlem blokajı">🚫 </span>}
                            {c.unvan}
                          </div>
                          <div className="cell-entity__meta">{c.kod}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge variant={c.tip === "musteri" ? "success" : c.tip === "tedarikci" ? "info" : "accent"}>
                        {c.tip === "musteri" ? "Müşteri" : c.tip === "tedarikci" ? "Tedarikçi" : "İkisi de"}
                      </Badge>
                    </td>
                    <td>{c.sektor || "—"}</td>
                    <td>{c.vknTckn || "—"}</td>
                    <td className={`num money ${bakiyeNum > 0 ? "pos" : bakiyeNum < 0 ? "neg" : ""}`}>{tl(bakiyeNum)}</td>
                    <td>
                      <Status tone={c.karaListe ? "danger" : "ok"}>{c.karaListe ? "Bloke" : "Normal"}</Status>
                    </td>
                    <td className="center">
                      <div className="row-tight" style={{ flexWrap: "nowrap", justifyContent: "center" }}>
                        <Button size="sm" onClick={() => detayAc(c.id)}>🔍 Detay</Button>
                        <Button size="sm" onClick={() => ekstreIndir(c.id, c.unvan)}>📊 Ekstre</Button>
                        <Button size="sm" onClick={() => kopyala(c.id)}>📋 Kopyala</Button>
                      </div>
                    </td>
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

/* ─── Sayfaya özel küçük yardımcılar ─────────────────────────────────────── */
function FormBolum({ baslik, children }: { baslik?: string; children: React.ReactNode }) {
  return (
    <div>
      {baslik && <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--accent-text)", margin: "0 0 0.5rem" }}>{baslik}</p>}
      <div className="row">{children}</div>
    </div>
  );
}

function FormAlan({ flex, min, children }: { flex: number; min: number; children: React.ReactNode }) {
  return <div style={{ flex: flex === 0 ? `0 1 ${min}px` : flex, minWidth: min }}>{children}</div>;
}

function SatirCift({ ad, deger }: { ad: string; deger: string }) {
  return (
    <tr>
      <td className="muted" style={{ padding: "0.4rem 0" }}>{ad}</td>
      <td className="num" style={{ color: "var(--text)" }}>{deger}</td>
    </tr>
  );
}
