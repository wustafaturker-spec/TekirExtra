"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { stil } from "@/lib/stil";

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

export default function CariSayfasi() {
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [arama, setArama] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [detay, setDetay] = useState<CariDetay | null>(null);
  const [ekstre, setEkstre] = useState<EkstreVeri | null>(null);
  const [etiketler, setEtiketler] = useState<Etiket[]>([]);
  const [aktifSekme, setAktifSekme] = useState<"genel" | "ekstre" | "adresler" | "kisiler" | "bankalar">("genel");
  const [filtreTip, setFiltreTip] = useState<"tumu" | "musteri" | "tedarikci" | "bloke">("tumu");

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
  // Finans
  const [riskLimiti, setRiskLimiti] = useState("");
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
          kod: kod || undefined,
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}/cari/excel-aktar`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
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

  async function ekstreIndir(id: string, unvan: string) {
    try {
      const token = tokenAl();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}/cari/${id}/ekstre/excel`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error("Ekstre indirilemedi");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ekstre-${unvan.replace(/\s+/g, "-")}.xlsx`;
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

  const alanEtiketi = { fontSize: "0.85rem", color: "#a1a1aa" } as const;
  const bolumBaslik = {
    margin: "1.25rem 0 0.5rem",
    fontSize: "0.9rem",
    fontWeight: "bold",
    color: "#a78bfa",
  } as const;

  const filtrelenmisCariler = cariler.filter((c) => {
    if (filtreTip === "musteri") return c.tip === "musteri" || c.tip === "hepsi";
    if (filtreTip === "tedarikci") return c.tip === "tedarikci" || c.tip === "hepsi";
    if (filtreTip === "bloke") return c.karaListe === true;
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>👥 Cari Hesaplar</h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
            Müşterileriniz, tedarikçileriniz ve diğer cari ortaklarınızı buradan yönetin.
          </p>
        </div>
        <div style={{ display: "flex", gap: "1rem" }}>
          <a href="/panel/cari/raporlar" style={{ ...stil.dugmeMuted, display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
            📈 Raporlar
          </a>
          <label style={{ ...stil.dugmeMuted, display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            📥 Excel&apos;den İçe Aktar
            <input type="file" accept=".xlsx" onChange={excelYukle} style={{ display: "none" }} />
          </label>
          <button onClick={() => setFormAcik(!formAcik)} style={{ ...stil.dugme, width: "auto", padding: "0.5rem 1.25rem" }}>
            {formAcik ? "Vazgeç" : "➕ Yeni Cari"}
          </button>
        </div>
      </div>

      {hata && <p style={stil.hata}>{hata}</p>}
      {basari && <p style={stil.basari}>{basari}</p>}

      {formAcik && (
        <form onSubmit={kaydet} style={{ ...stil.genisKart, marginBottom: "2rem", maxWidth: "760px" }}>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem", fontWeight: "bold" }}>Yeni Cari Kartı Oluştur</h3>

          <p style={bolumBaslik}>Kimlik</p>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={alanEtiketi}>Cari Kodu</label>
              <input type="text" value={kod} onChange={(e) => setKod(e.target.value)} style={stil.girdi} placeholder="CARI-001" />
            </div>
            <div style={{ flex: 2, minWidth: "240px" }}>
              <label style={alanEtiketi}>Ünvan / Ad Soyad</label>
              <input type="text" value={unvan} onChange={(e) => setUnvan(e.target.value)} style={stil.girdi} required placeholder="Teknoloji A.Ş." />
            </div>
            <div style={{ flex: 1, minWidth: "160px" }}>
              <label style={alanEtiketi}>Kısa Ad</label>
              <input type="text" value={kisaAd} onChange={(e) => setKisaAd(e.target.value)} style={stil.girdi} placeholder="Teknoloji" />
            </div>
          </div>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={alanEtiketi}>Cari Tipi</label>
              <select value={tip} onChange={(e) => setTip(e.target.value)} style={stil.girdi}>
                {Object.entries(TIP_ETIKETLERI).map(([deger, ad]) => (
                  <option key={deger} value={deger}>{ad}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={alanEtiketi}>Kişi Tipi</label>
              <select value={kisiTipi} onChange={(e) => setKisiTipi(e.target.value)} style={stil.girdi}>
                <option value="tuzel">Tüzel Kişi</option>
                <option value="gercek">Gerçek Kişi</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={alanEtiketi}>Sektör</label>
              <input type="text" value={sektor} onChange={(e) => setSektor(e.target.value)} style={stil.girdi} placeholder="Perakende" />
            </div>
          </div>

          <p style={bolumBaslik}>Vergi ve Resmi Bilgiler</p>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={alanEtiketi}>VKN / TCKN</label>
              <input type="text" value={vknTckn} onChange={(e) => setVknTckn(e.target.value)} style={stil.girdi} placeholder="10-11 hane" />
            </div>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={alanEtiketi}>Vergi Dairesi</label>
              <input type="text" value={vergiDairesi} onChange={(e) => setVergiDairesi(e.target.value)} style={stil.girdi} />
            </div>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={alanEtiketi}>MERSİS No</label>
              <input type="text" value={mersisNo} onChange={(e) => setMersisNo(e.target.value)} style={stil.girdi} placeholder="16 hane" />
            </div>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={alanEtiketi}>Ticaret Sicil No</label>
              <input type="text" value={ticaretSicilNo} onChange={(e) => setTicaretSicilNo(e.target.value)} style={stil.girdi} />
            </div>
          </div>

          <p style={bolumBaslik}>İletişim</p>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={alanEtiketi}>E-posta</label>
              <input type="email" value={eposta} onChange={(e) => setEposta(e.target.value)} style={stil.girdi} />
            </div>
            <div style={{ flex: 1, minWidth: "160px" }}>
              <label style={alanEtiketi}>Telefon</label>
              <input type="text" value={telefon} onChange={(e) => setTelefon(e.target.value)} style={stil.girdi} />
            </div>
            <div style={{ flex: 1, minWidth: "160px" }}>
              <label style={alanEtiketi}>Web Sitesi</label>
              <input type="text" value={webSitesi} onChange={(e) => setWebSitesi(e.target.value)} style={stil.girdi} placeholder="https://..." />
            </div>
            <div style={{ flex: 1, minWidth: "140px" }}>
              <label style={alanEtiketi}>Faks</label>
              <input type="text" value={faks} onChange={(e) => setFaks(e.target.value)} style={stil.girdi} />
            </div>
          </div>

          <p style={bolumBaslik}>Finans</p>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "180px", maxWidth: "260px" }}>
              <label style={alanEtiketi}>Risk Limiti (TL)</label>
              <input type="text" value={riskLimiti} onChange={(e) => setRiskLimiti(e.target.value)} style={stil.girdi} placeholder="1000000" />
            </div>
          </div>

          <button type="submit" style={stil.dugme}>Cari Kartı Kaydet</button>
        </form>
      )}

      {detay && (
        <div style={{ ...stil.genisKart, marginBottom: "2rem", border: "1px solid #6d28d9" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: "bold" }}>
                {detay.unvan} {detay.karaListe && <span style={{ color: "#ef4444" }}>🚫 Kara Liste</span>}
              </h3>
              <p style={{ color: "#a1a1aa", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>
                {detay.kod} · {TIP_ETIKETLERI[detay.tip] ?? detay.tip} · {detay.kisiTipi === "gercek" ? "Gerçek Kişi" : "Tüzel Kişi"}
                {detay.sektor ? ` · ${detay.sektor}` : ""}
              </p>
              {detay.karaListe && detay.karaListeNotu && (
                <p style={{ color: "#ef4444", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>Blokaj nedeni: {detay.karaListeNotu}</p>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={karaListeDegistir} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}>
                {detay.karaListe ? "✅ Blokajı Kaldır" : "🚫 Kara Listeye Al"}
              </button>
              <button onClick={() => { setDetay(null); setEkstre(null); }} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}>
                ✖ Kapat
              </button>
            </div>
          </div>

          {/* Tab Bar (Sekmeler) */}
          <div style={{ display: "flex", borderBottom: "1px solid #27272a", marginBottom: "1.25rem", marginTop: "1rem", gap: "1rem" }}>
            {(["genel", "ekstre", "adresler", "kisiler", "bankalar"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setAktifSekme(tab)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: aktifSekme === tab ? "2px solid #ea580c" : "2px solid transparent",
                  color: aktifSekme === tab ? "#fafaf9" : "#a1a1aa",
                  padding: "0.5rem 0.25rem",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: aktifSekme === tab ? "600" : "normal",
                  transition: "all 0.2s"
                }}
              >
                {tab === "genel" ? "Genel Bakış" : tab === "ekstre" ? "Ekstre" : tab === "adresler" ? "Adresler" : tab === "kisiler" ? "İlgili Kişiler" : "Banka Hesapları"}
              </button>
            ))}
          </div>

          {/* Tab Content (Sekme İçeriği) */}
          {aktifSekme === "genel" && (
            <div>
              {/* Summary Cards */}
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
                {/* Kart 1: Toplam Bakiye */}
                {(() => {
                  const tryBakiye = detay.bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? "0.00";
                  const bakiyeNum = Number(tryBakiye);
                  return (
                    <div style={{ flex: 1, minWidth: "180px", background: "#1c1917", border: "1px solid #27272a", borderRadius: "8px", padding: "1rem" }}>
                      <p style={{ fontSize: "0.75rem", color: "#a1a1aa", textTransform: "uppercase", margin: 0 }}>Toplam Bakiye</p>
                      <p style={{ fontSize: "1.5rem", fontWeight: "bold", margin: "0.25rem 0 0", color: bakiyeNum > 0 ? "#22c55e" : bakiyeNum < 0 ? "#ef4444" : "#fafaf9" }}>
                        {bakiyeNum.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                      </p>
                      <p style={{ fontSize: "0.75rem", color: "#a1a1aa", margin: "0.25rem 0 0" }}>{bakiyeNum > 0 ? "Alacaklıyız" : bakiyeNum < 0 ? "Borçluyuz" : "Bakiye Sıfır"}</p>
                    </div>
                  );
                })()}

                {/* Kart 2: Vadesi Geçmiş */}
                <div style={{ flex: 1, minWidth: "180px", background: "#1c1917", border: "1px solid #27272a", borderRadius: "8px", padding: "1rem" }}>
                  <p style={{ fontSize: "0.75rem", color: "#a1a1aa", textTransform: "uppercase", margin: 0 }}>Vadesi Geçmiş</p>
                  <p style={{ fontSize: "1.5rem", fontWeight: "bold", margin: "0.25rem 0 0", color: Number(detay.finansalOzet.vadesiGecmisBakiye) > 0 ? "#ef4444" : "#fafaf9" }}>
                    {Number(detay.finansalOzet.vadesiGecmisBakiye).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "#a1a1aa", margin: "0.25rem 0 0" }}>Açık kalemler</p>
                </div>

                {/* Kart 3: Vade Süresi */}
                <div style={{ flex: 1, minWidth: "180px", background: "#1c1917", border: "1px solid #27272a", borderRadius: "8px", padding: "1rem" }}>
                  <p style={{ fontSize: "0.75rem", color: "#a1a1aa", textTransform: "uppercase", margin: 0 }}>Vade Süresi</p>
                  <p style={{ fontSize: "1.5rem", fontWeight: "bold", margin: "0.25rem 0 0", color: "#fafaf9" }}>
                    {detay.varsayilanVadeGun ? `${detay.varsayilanVadeGun} Gün` : "Belirtilmemiş"}
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "#a1a1aa", margin: "0.25rem 0 0" }}>Varsayılan vade</p>
                </div>

                {/* Kart 4: Risk Durumu */}
                <div style={{ flex: 1, minWidth: "180px", background: "#1c1917", border: "1px solid #27272a", borderRadius: "8px", padding: "1rem" }}>
                  <p style={{ fontSize: "0.75rem", color: "#a1a1aa", textTransform: "uppercase", margin: 0 }}>Risk Durumu</p>
                  <p style={{ fontSize: "1.5rem", fontWeight: "bold", margin: "0.25rem 0 0", color: detay.risk.asim ? "#ef4444" : "#ea580c" }}>
                    {detay.risk.asim ? "Limit Aşımı" : "Normal"}
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "#a1a1aa", margin: "0.25rem 0 0" }}>
                    {detay.risk.limit ? `Limit: ${tl(detay.risk.limit)}` : "Limit Tanımsız"}
                  </p>
                </div>
              </div>

              {/* Grid content */}
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                {/* Risk ve Finansal Detaylar Tablosu */}
                <div style={{ flex: 2, minWidth: "280px", background: "#1c1917", borderRadius: "8px", padding: "1rem" }}>
                  <p style={{ ...bolumBaslik, margin: "0 0 0.75rem", color: "#fafaf9" }}>⚖️ Risk & Finans Bilgileri</p>
                  <table style={{ width: "100%", fontSize: "0.9rem" }}>
                    <tbody>
                      <tr><td style={{ color: "#a1a1aa", padding: "0.35rem 0" }}>Mevcut Risk</td><td style={{ textAlign: "right", color: "#fafaf9" }}>{tl(detay.risk.mevcutRisk)}</td></tr>
                      <tr><td style={{ color: "#a1a1aa", padding: "0.35rem 0" }}>Çek/Senet Riski</td><td style={{ textAlign: "right", color: "#fafaf9" }}>{tl(detay.risk.cekSenetRiski)}</td></tr>
                      {detay.risk.kalanLimit !== null && (
                        <tr>
                          <td style={{ color: "#a1a1aa", padding: "0.35rem 0" }}>Kalan Risk Limiti</td>
                          <td style={{ textAlign: "right", fontWeight: "bold", color: detay.risk.asim ? "#ef4444" : "#22c55e" }}>{tl(detay.risk.kalanLimit)}</td>
                        </tr>
                      )}
                      <tr><td style={{ color: "#a1a1aa", padding: "0.35rem 0" }}>Son İşlem Tarihi</td><td style={{ textAlign: "right", color: "#fafaf9" }}>{detay.finansalOzet.sonIslemTarihi ?? "—"}</td></tr>
                      <tr><td style={{ color: "#a1a1aa", padding: "0.35rem 0" }}>Son Tahsilat Tarihi</td><td style={{ textAlign: "right", color: "#fafaf9" }}>{detay.finansalOzet.sonTahsilatTarihi ?? "—"}</td></tr>
                      <tr><td style={{ color: "#a1a1aa", padding: "0.35rem 0" }}>Son Ödeme Tarihi</td><td style={{ textAlign: "right", color: "#fafaf9" }}>{detay.finansalOzet.sonOdemeTarihi ?? "—"}</td></tr>
                    </tbody>
                  </table>
                  {detay.risk.asim && <p style={{ color: "#ef4444", fontSize: "0.85rem", margin: "0.75rem 0 0" }}>⚠️ Risk limiti aşılmış durumda.</p>}
                </div>

                {/* Etiketler Bölümü */}
                <div style={{ flex: 1, minWidth: "220px", background: "#1c1917", borderRadius: "8px", padding: "1rem" }}>
                  <p style={{ ...bolumBaslik, margin: "0 0 0.75rem", color: "#fafaf9" }}>🏷️ Etiket Yönetimi</p>
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                    {detay.etiketler.length === 0 && <span style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Etiket yok</span>}
                    {detay.etiketler.map((e) => (
                      <span key={e.id} style={{ background: e.renk ?? "#ea580c", borderRadius: "999px", padding: "0.15rem 0.6rem", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                        {e.ad}
                        <button onClick={() => etiketKaldir(e.id)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0 }}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }}>
                    <select value={secilenEtiketId} onChange={(e) => setSecilenEtiketId(e.target.value)} style={{ ...stil.girdi, margin: 0, flex: 1 }}>
                      <option value="">Seç...</option>
                      {etiketler
                        .filter((e) => !detay.etiketler.some((d) => d.id === e.id))
                        .map((e) => (
                          <option key={e.id} value={e.id}>{e.ad}</option>
                        ))}
                    </select>
                    <button onClick={etiketAta} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}>Ata</button>
                  </div>
                  <form onSubmit={etiketOlusturVeAta} style={{ display: "flex", gap: "0.4rem" }}>
                    <input type="text" value={yeniEtiket} onChange={(e) => setYeniEtiket(e.target.value)} placeholder="Yeni etiket..." style={{ ...stil.girdi, margin: 0, flex: 1 }} />
                    <button type="submit" style={{ ...stil.dugmeMuted, padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}>➕</button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {aktifSekme === "ekstre" && (
            <div style={{ background: "#1c1917", borderRadius: "8px", padding: "1rem" }}>
              <p style={{ ...bolumBaslik, margin: "0 0 0.75rem", color: "#fafaf9" }}>📊 Cari Hesap Ekstresi</p>
              {!ekstre ? (
                <p style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Ekstre yükleniyor...</p>
              ) : ekstre.satirlar.length === 0 ? (
                <p style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Cari hesaba ait herhangi bir hareket bulunmuyor.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={stil.tablo}>
                    <thead>
                      <tr>
                        <th style={stil.tabloBaslik}>Tarih</th>
                        <th style={stil.tabloBaslik}>Vade Tarihi</th>
                        <th style={stil.tabloBaslik}>Açıklama</th>
                        <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Borç (TL)</th>
                        <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Alacak (TL)</th>
                        <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Bakiye (TL)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ekstre.satirlar.map((row, idx) => {
                        const borcVal = row.tip === "borc" ? Number(row.tutarTry) : 0;
                        const alacakVal = row.tip === "alacak" ? Number(row.tutarTry) : 0;
                        const bakiyeNum = Number(row.yuruyenBakiye);

                        return (
                          <tr key={idx}>
                            <td style={stil.tabloHucre}>{row.tarih}</td>
                            <td style={stil.tabloHucre}>{row.vadeTarihi || "—"}</td>
                            <td style={stil.tabloHucre}>{row.aciklama || "—"}</td>
                            <td style={{ ...stil.tabloHucre, textAlign: "right", color: borcVal > 0 ? "#ef4444" : undefined }}>
                              {borcVal > 0 ? borcVal.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL" : "—"}
                            </td>
                            <td style={{ ...stil.tabloHucre, textAlign: "right", color: alacakVal > 0 ? "#22c55e" : undefined }}>
                              {alacakVal > 0 ? alacakVal.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL" : "—"}
                            </td>
                            <td style={{ ...stil.tabloHucre, textAlign: "right", fontWeight: "bold", color: bakiyeNum > 0 ? "#22c55e" : bakiyeNum < 0 ? "#ef4444" : "#fafaf9" }}>
                              {bakiyeNum.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {aktifSekme === "adresler" && (
            <div style={{ background: "#1c1917", borderRadius: "8px", padding: "1rem" }}>
              <p style={{ ...bolumBaslik, margin: "0 0 0.75rem", color: "#fafaf9" }}>🏢 Adres Bilgileri</p>
              {detay.adresler && detay.adresler.length === 0 ? (
                <p style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Kayıtlı adres bilgisi yok.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={stil.tablo}>
                    <thead>
                      <tr>
                        <th style={stil.tabloBaslik}>Başlık</th>
                        <th style={stil.tabloBaslik}>Tip</th>
                        <th style={stil.tabloBaslik}>Adres</th>
                        <th style={stil.tabloBaslik}>İl / İlçe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detay.adresler?.map((a) => (
                        <tr key={a.id}>
                          <td style={stil.tabloHucre}>{a.baslik}</td>
                          <td style={stil.tabloHucre}>
                            {a.tip === "fatura" ? "📄 Fatura Adresi" : a.tip === "sevk" ? "🚚 Sevk Adresi" : "🏢 Merkez/Şube"}
                          </td>
                          <td style={stil.tabloHucre}>{a.adres}</td>
                          <td style={stil.tabloHucre}>{a.ilce ? `${a.ilce} / ` : ""}{a.il}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {aktifSekme === "kisiler" && (
            <div style={{ background: "#1c1917", borderRadius: "8px", padding: "1rem" }}>
              <p style={{ ...bolumBaslik, margin: "0 0 0.75rem", color: "#fafaf9" }}>👥 İlgili Kişiler</p>
              {detay.kisiler && detay.kisiler.length === 0 ? (
                <p style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Kayıtlı ilgili kişi yok.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={stil.tablo}>
                    <thead>
                      <tr>
                        <th style={stil.tabloBaslik}>Ad Soyad</th>
                        <th style={stil.tabloBaslik}>Görev</th>
                        <th style={stil.tabloBaslik}>Telefon</th>
                        <th style={stil.tabloBaslik}>E-posta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detay.kisiler?.map((k) => (
                        <tr key={k.id}>
                          <td style={stil.tabloHucre}>{k.adSoyad}</td>
                          <td style={stil.tabloHucre}>{k.gorev || "—"}</td>
                          <td style={stil.tabloHucre}>{k.telefon || "—"}</td>
                          <td style={stil.tabloHucre}>{k.eposta || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {aktifSekme === "bankalar" && (
            <div style={{ background: "#1c1917", borderRadius: "8px", padding: "1rem" }}>
              <p style={{ ...bolumBaslik, margin: "0 0 0.75rem", color: "#fafaf9" }}>🏦 Banka Hesapları</p>
              {detay.bankaHesaplari.length === 0 ? (
                <p style={{ color: "#a1a1aa", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>Kayıtlı banka hesabı yok.</p>
              ) : (
                <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                  <table style={{ width: "100%", fontSize: "0.9rem" }}>
                    <thead>
                      <tr>
                        <th style={{ ...stil.tabloBaslik, textAlign: "left" }}>Banka Adı</th>
                        <th style={{ ...stil.tabloBaslik, textAlign: "left" }}>IBAN</th>
                        <th style={{ ...stil.tabloBaslik, textAlign: "left" }}>Döviz</th>
                        <th style={{ ...stil.tabloBaslik, textAlign: "center", width: "80px" }}>İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detay.bankaHesaplari.map((b) => (
                        <tr key={b.id}>
                          <td style={stil.tabloHucre}>{b.bankaAdi}{b.subeAdi ? ` / ${b.subeAdi}` : ""}</td>
                          <td style={{ ...stil.tabloHucre, fontFamily: "monospace" }}>{b.iban}</td>
                          <td style={stil.tabloHucre}>{b.paraBirimi}</td>
                          <td style={{ ...stil.tabloHucre, textAlign: "center" }}>
                            <button onClick={() => bankaHesabiSil(b.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.85rem" }}>Sil</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <form onSubmit={bankaHesabiEkle} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", borderTop: "1px solid #27272a", paddingTop: "1rem" }}>
                <input type="text" value={bankaAdi} onChange={(e) => setBankaAdi(e.target.value)} placeholder="Banka adı" required style={{ ...stil.girdi, margin: 0, flex: 1, minWidth: "140px" }} />
                <input type="text" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="TR + 24 rakam" required style={{ ...stil.girdi, margin: 0, flex: 2, minWidth: "220px" }} />
                <select value={paraBirimi} onChange={(e) => setParaBirimi(e.target.value)} style={{ ...stil.girdi, margin: 0, width: "90px" }}>
                  <option>TRY</option>
                  <option>USD</option>
                  <option>EUR</option>
                </select>
                <button type="submit" style={{ ...stil.dugmeMuted, padding: "0.35rem 0.75rem" }}>➕ Ekle</button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* İstatistik Özet Kartları (Toplam, Müşteri, Tedarikçi, Bloke) */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <div style={{ flex: 1, minWidth: "160px", background: "#1c1917", border: "1px solid #27272a", borderRadius: "8px", padding: "1rem" }}>
          <p style={{ fontSize: "0.75rem", color: "#a1a1aa", textTransform: "uppercase", margin: 0 }}>Toplam Cari</p>
          <p style={{ fontSize: "1.75rem", fontWeight: "bold", margin: "0.25rem 0 0", color: "#fafaf9" }}>{cariler.length}</p>
        </div>
        <div style={{ flex: 1, minWidth: "160px", background: "#1c1917", border: "1px solid #27272a", borderRadius: "8px", padding: "1rem" }}>
          <p style={{ fontSize: "0.75rem", color: "#a1a1aa", textTransform: "uppercase", margin: 0 }}>Müşteri</p>
          <p style={{ fontSize: "1.75rem", fontWeight: "bold", margin: "0.25rem 0 0", color: "#ea580c" }}>{cariler.filter(c => c.tip === "musteri" || c.tip === "hepsi").length}</p>
        </div>
        <div style={{ flex: 1, minWidth: "160px", background: "#1c1917", border: "1px solid #27272a", borderRadius: "8px", padding: "1rem" }}>
          <p style={{ fontSize: "0.75rem", color: "#a1a1aa", textTransform: "uppercase", margin: 0 }}>Tedarikçi</p>
          <p style={{ fontSize: "1.75rem", fontWeight: "bold", margin: "0.25rem 0 0", color: "#3b82f6" }}>{cariler.filter(c => c.tip === "tedarikci" || c.tip === "hepsi").length}</p>
        </div>
        <div style={{ flex: 1, minWidth: "160px", background: "#1c1917", border: "1px solid #27272a", borderRadius: "8px", padding: "1rem" }}>
          <p style={{ fontSize: "0.75rem", color: "#a1a1aa", textTransform: "uppercase", margin: 0 }}>Bloke</p>
          <p style={{ fontSize: "1.75rem", fontWeight: "bold", margin: "0.25rem 0 0", color: "#ef4444" }}>{cariler.filter(c => c.karaListe === true).length}</p>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
        <input
          type="text"
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Cari adı, kodu veya VKN ile ara..."
          style={{ ...stil.girdi, margin: 0, maxWidth: "400px", flex: 1 }}
        />

        {/* Segmented Control */}
        <div style={{ display: "flex", background: "#1c1917", borderRadius: "8px", border: "1px solid #27272a", padding: "2px" }}>
          {(["tumu", "musteri", "tedarikci", "bloke"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFiltreTip(t)}
              style={{
                background: filtreTip === t ? "#ea580c" : "transparent",
                color: filtreTip === t ? "#ffffff" : "#a1a1aa",
                border: "none",
                borderRadius: "6px",
                padding: "0.35rem 0.85rem",
                fontSize: "0.85rem",
                cursor: "pointer",
                fontWeight: filtreTip === t ? "600" : "normal",
                transition: "all 0.2s"
              }}
            >
              {t === "tumu" ? "Tümü" : t === "musteri" ? "Müşteri" : t === "tedarikci" ? "Tedarikçi" : "Bloke"}
            </button>
          ))}
        </div>
      </div>

      <div style={stil.genisKart}>
        <table style={stil.tablo}>
          <thead>
            <tr>
              <th style={stil.tabloBaslik}>Cari Adı</th>
              <th style={stil.tabloBaslik}>Tür</th>
              <th style={stil.tabloBaslik}>Sektör</th>
              <th style={stil.tabloBaslik}>VKN / TCKN</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Bakiye</th>
              <th style={stil.tabloBaslik}>Risk</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "center" }}>Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {filtrelenmisCariler.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>
                  Arama kriterlerinize uygun cari hesap kaydı bulunamadı.
                </td>
              </tr>
            ) : (
              filtrelenmisCariler.map((c) => {
                const tryBakiye = c.bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? "0.00";
                const bakiyeNum = Number(tryBakiye);

                const ilkHarf = c.unvan.trim().charAt(0).toUpperCase();
                const renkler = ["#7c3aed", "#2563eb", "#db2777", "#059669", "#d97706", "#dc2626"];
                const renk = renkler[ilkHarf.charCodeAt(0) % renkler.length];

                return (
                  <tr key={c.id}>
                    <td style={stil.tabloHucre}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          backgroundColor: renk,
                          color: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: "bold",
                          fontSize: "0.9rem"
                        }}>
                          {ilkHarf}
                        </div>
                        <div>
                          <div style={{ fontWeight: "600", color: "#fafaf9" }}>
                            {c.karaListe && <span title="Kara liste / işlem blokajı">🚫 </span>}
                            {c.unvan}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#a1a1aa" }}>{c.kod}</div>
                        </div>
                      </div>
                    </td>
                    <td style={stil.tabloHucre}>
                      <span style={{
                        background: c.tip === "musteri" ? "rgba(5, 150, 105, 0.15)" : c.tip === "tedarikci" ? "rgba(37, 99, 235, 0.15)" : "rgba(124, 58, 237, 0.15)",
                        color: c.tip === "musteri" ? "#34d399" : c.tip === "tedarikci" ? "#60a5fa" : "#c084fc",
                        borderRadius: "999px",
                        padding: "0.15rem 0.5rem",
                        fontSize: "0.8rem",
                        fontWeight: "600"
                      }}>
                        {c.tip === "musteri" ? "Müşteri" : c.tip === "tedarikci" ? "Tedarikçi" : "İkisi de"}
                      </span>
                    </td>
                    <td style={stil.tabloHucre}>{c.sektor || "—"}</td>
                    <td style={stil.tabloHucre}>{c.vknTckn || "—"}</td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: bakiyeNum > 0 ? "#22c55e" : bakiyeNum < 0 ? "#ef4444" : "#fafaf9", fontWeight: "bold" }}>
                      {bakiyeNum.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={stil.tabloHucre}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                        <span style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          backgroundColor: c.karaListe ? "#ef4444" : "#ea580c",
                          display: "inline-block"
                        }} />
                        <span style={{ fontSize: "0.85rem", color: "#fafaf9" }}>{c.karaListe ? "Bloke" : "Normal"}</span>
                      </div>
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "center", whiteSpace: "nowrap" }}>
                      <button onClick={() => detayAc(c.id)} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.65rem", fontSize: "0.8rem", marginRight: "0.4rem" }}>
                        🔍 Detay
                      </button>
                      <button onClick={() => ekstreIndir(c.id, c.unvan)} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.65rem", fontSize: "0.8rem", marginRight: "0.4rem" }}>
                        📊 Ekstre
                      </button>
                      <button onClick={() => kopyala(c.id)} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}>
                        📋 Kopyala
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
