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

interface CariDetay extends Cari {
  kisaAd: string | null;
  kisiTipi: string;
  sektor: string | null;
  vergiDairesi: string | null;
  mersisNo: string | null;
  ticaretSicilNo: string | null;
  webSitesi: string | null;
  faks: string | null;
  karaListeNotu: string | null;
  riskLimiti: string | null;
  bankaHesaplari: BankaHesap[];
  etiketler: Etiket[];
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

const tl = (deger: string | number): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " TL";

export default function CariSayfasi() {
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [arama, setArama] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);
  const [detay, setDetay] = useState<CariDetay | null>(null);
  const [etiketler, setEtiketler] = useState<Etiket[]>([]);

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
      setDetay(await api<CariDetay>(`/cari/${id}`));
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Detay yüklenemedi");
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

  const alanEtiketi = { fontSize: "0.85rem", color: "#a1a1aa" } as const;
  const bolumBaslik = {
    margin: "1.25rem 0 0.5rem",
    fontSize: "0.9rem",
    fontWeight: "bold",
    color: "#a78bfa",
  } as const;

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
              <button onClick={() => setDetay(null)} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}>
                ✖ Kapat
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1.25rem" }}>
            <div style={{ flex: 1, minWidth: "260px", background: "#1c1917", borderRadius: "8px", padding: "1rem" }}>
              <p style={{ ...bolumBaslik, margin: "0 0 0.5rem" }}>⚖️ Risk Özeti</p>
              <table style={{ width: "100%", fontSize: "0.9rem" }}>
                <tbody>
                  <tr><td style={{ color: "#a1a1aa", padding: "0.15rem 0" }}>Risk Limiti</td><td style={{ textAlign: "right" }}>{detay.risk.limit ? tl(detay.risk.limit) : "Tanımsız"}</td></tr>
                  <tr><td style={{ color: "#a1a1aa", padding: "0.15rem 0" }}>Mevcut Risk</td><td style={{ textAlign: "right" }}>{tl(detay.risk.mevcutRisk)}</td></tr>
                  <tr><td style={{ color: "#a1a1aa", padding: "0.15rem 0" }}>Çek/Senet Riski</td><td style={{ textAlign: "right" }}>{tl(detay.risk.cekSenetRiski)}</td></tr>
                  {detay.risk.kalanLimit !== null && (
                    <tr>
                      <td style={{ color: "#a1a1aa", padding: "0.15rem 0" }}>Kalan Limit</td>
                      <td style={{ textAlign: "right", fontWeight: "bold", color: detay.risk.asim ? "#ef4444" : "#22c55e" }}>{tl(detay.risk.kalanLimit)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {detay.risk.asim && <p style={{ color: "#ef4444", fontSize: "0.85rem", margin: "0.5rem 0 0" }}>⚠️ Risk limiti aşılmış durumda.</p>}
            </div>

            <div style={{ flex: 1, minWidth: "260px", background: "#1c1917", borderRadius: "8px", padding: "1rem" }}>
              <p style={{ ...bolumBaslik, margin: "0 0 0.5rem" }}>📈 Finansal Özet</p>
              <table style={{ width: "100%", fontSize: "0.9rem" }}>
                <tbody>
                  <tr><td style={{ color: "#a1a1aa", padding: "0.15rem 0" }}>Vadesi Geçmiş Bakiye</td><td style={{ textAlign: "right", color: Number(detay.finansalOzet.vadesiGecmisBakiye) > 0 ? "#ef4444" : undefined }}>{tl(detay.finansalOzet.vadesiGecmisBakiye)}</td></tr>
                  <tr><td style={{ color: "#a1a1aa", padding: "0.15rem 0" }}>Son İşlem</td><td style={{ textAlign: "right" }}>{detay.finansalOzet.sonIslemTarihi ?? "—"}</td></tr>
                  <tr><td style={{ color: "#a1a1aa", padding: "0.15rem 0" }}>Son Tahsilat</td><td style={{ textAlign: "right" }}>{detay.finansalOzet.sonTahsilatTarihi ?? "—"}</td></tr>
                  <tr><td style={{ color: "#a1a1aa", padding: "0.15rem 0" }}>Son Ödeme</td><td style={{ textAlign: "right" }}>{detay.finansalOzet.sonOdemeTarihi ?? "—"}</td></tr>
                </tbody>
              </table>
            </div>

            <div style={{ flex: 1, minWidth: "260px", background: "#1c1917", borderRadius: "8px", padding: "1rem" }}>
              <p style={{ ...bolumBaslik, margin: "0 0 0.5rem" }}>🏷️ Etiketler</p>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                {detay.etiketler.length === 0 && <span style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>Etiket yok</span>}
                {detay.etiketler.map((e) => (
                  <span key={e.id} style={{ background: e.renk ?? "#6d28d9", borderRadius: "999px", padding: "0.15rem 0.6rem", fontSize: "0.8rem" }}>
                    {e.ad}{" "}
                    <button onClick={() => etiketKaldir(e.id)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0 }}>✕</button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }}>
                <select value={secilenEtiketId} onChange={(e) => setSecilenEtiketId(e.target.value)} style={{ ...stil.girdi, margin: 0, flex: 1 }}>
                  <option value="">Etiket seç...</option>
                  {etiketler
                    .filter((e) => !detay.etiketler.some((d) => d.id === e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>{e.ad}</option>
                    ))}
                </select>
                <button onClick={etiketAta} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}>Ata</button>
              </div>
              <form onSubmit={etiketOlusturVeAta} style={{ display: "flex", gap: "0.4rem" }}>
                <input
                  type="text"
                  value={yeniEtiket}
                  onChange={(e) => setYeniEtiket(e.target.value)}
                  placeholder="Yeni etiket (ör. VIP)"
                  style={{ ...stil.girdi, margin: 0, flex: 1 }}
                />
                <button type="submit" style={{ ...stil.dugmeMuted, padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}>➕</button>
              </form>
            </div>
          </div>

          <div style={{ background: "#1c1917", borderRadius: "8px", padding: "1rem", marginTop: "1rem" }}>
            <p style={{ ...bolumBaslik, margin: "0 0 0.5rem" }}>🏦 Banka Hesapları</p>
            {detay.bankaHesaplari.length === 0 ? (
              <p style={{ color: "#a1a1aa", fontSize: "0.85rem", margin: "0 0 0.75rem" }}>Kayıtlı banka hesabı yok.</p>
            ) : (
              <table style={{ width: "100%", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
                <tbody>
                  {detay.bankaHesaplari.map((b) => (
                    <tr key={b.id}>
                      <td style={{ padding: "0.2rem 0" }}>{b.bankaAdi}{b.subeAdi ? ` / ${b.subeAdi}` : ""}</td>
                      <td style={{ fontFamily: "monospace" }}>{b.iban}</td>
                      <td>{b.paraBirimi}</td>
                      <td style={{ textAlign: "right" }}>
                        <button onClick={() => bankaHesabiSil(b.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>Sil</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form onSubmit={bankaHesabiEkle} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
        </div>
      )}

      <div style={{ display: "flex", marginBottom: "1.5rem" }}>
        <input
          type="text"
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Cari adına, koduna veya VKN/TCKN numarasına göre ara..."
          style={{ ...stil.girdi, margin: 0, maxWidth: "400px" }}
        />
      </div>

      <div style={stil.genisKart}>
        <table style={stil.tablo}>
          <thead>
            <tr>
              <th style={stil.tabloBaslik}>Cari Kodu</th>
              <th style={stil.tabloBaslik}>Cari Ünvan</th>
              <th style={stil.tabloBaslik}>Cari Tipi</th>
              <th style={stil.tabloBaslik}>VKN / TCKN</th>
              <th style={stil.tabloBaslik}>İletişim</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>TRY Bakiye</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "center" }}>Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {cariler.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>
                  Arama kriterlerinize uygun cari hesap kaydı bulunamadı.
                </td>
              </tr>
            ) : (
              cariler.map((c) => {
                const tryBakiye = c.bakiyeler.find((b) => b.dovizCinsi === "TRY")?.bakiye ?? "0.00";
                const bakiyeNum = Number(tryBakiye);

                return (
                  <tr key={c.id}>
                    <td style={stil.tabloHucre}>{c.kod}</td>
                    <td style={{ ...stil.tabloHucre, fontWeight: "600" }}>
                      {c.karaListe && <span title="Kara liste / işlem blokajı">🚫 </span>}
                      {c.unvan}
                    </td>
                    <td style={stil.tabloHucre}>{TIP_ETIKETLERI[c.tip] ?? c.tip}</td>
                    <td style={stil.tabloHucre}>{c.vknTckn || "-"}</td>
                    <td style={stil.tabloHucre}>
                      <span style={{ fontSize: "0.85rem", display: "block" }}>{c.eposta || ""}</span>
                      <span style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>{c.telefon || ""}</span>
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: bakiyeNum > 0 ? "#22c55e" : bakiyeNum < 0 ? "#ef4444" : "#fafaf9", fontWeight: "bold" }}>
                      {bakiyeNum.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "center", whiteSpace: "nowrap" }}>
                      <button onClick={() => detayAc(c.id)} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.65rem", fontSize: "0.8rem", marginRight: "0.4rem" }}>
                        🔍 Detay
                      </button>
                      <button onClick={() => ekstreIndir(c.id, c.unvan)} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}>
                        📊 Ekstre
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
