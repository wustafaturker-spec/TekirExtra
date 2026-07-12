"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { stil } from "@/lib/stil";

interface StokKart {
  id: string;
  kod: string;
  ad: string;
  tip: string;
  barkod: string | null;
  anaBirim: string;
  kdvOrani: string;
  alisFiyati: string | null;
  satisFiyati: string | null;
  mevcutMiktar: string;
  ortalamaMaliyet: string;
}

export default function StokSayfasi() {
  const [stoklar, setStoklar] = useState<StokKart[]>([]);
  const [arama, setArama] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);

  // Form alanları
  const [kod, setKod] = useState("");
  const [ad, setAd] = useState("");
  const [tip, setTip] = useState("urun");
  const [barkod, setBarkod] = useState("");
  const [kdvOrani, setKdvOrani] = useState("20");
  const [alisFiyati, setAlisFiyati] = useState("");
  const [satisFiyati, setSatisFiyati] = useState("");

  const yukle = useCallback(async () => {
    try {
      const qs = arama ? `?arama=${encodeURIComponent(arama)}` : "";
      const veri = await api<{ kayitlar: StokKart[] }>(`/stok${qs}`);
      setStoklar(veri.kayitlar);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Yükleme hatası");
    }
  }, [arama]);

  useEffect(() => {
    if (tokenAl()) {
      void yukle();
    }
  }, [yukle]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    setBasari("");
    try {
      await api("/stok", {
        method: "POST",
        body: JSON.stringify({
          kod: kod || undefined,
          ad,
          tip,
          barkod: barkod || null,
          kdvOrani: Number(kdvOrani),
          alisFiyati: alisFiyati ? Number(alisFiyati) : null,
          satisFiyati: satisFiyati ? Number(satisFiyati) : null,
        }),
      });
      setBasari("Stok kartı başarıyla oluşturuldu.");
      setFormAcik(false);
      // Temizle
      setKod("");
      setAd("");
      setBarkod("");
      setKdvOrani("20");
      setAlisFiyati("");
      setSatisFiyati("");
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Kayıt hatası");
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}/stok/excel-aktar`, {
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
      setBasari(`Excel başarıyla aktarıldı. ${resData.eklenen} adet ürün eklendi/güncellendi.`);
      void yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Excel yükleme hatası");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", margin: 0 }}>📦 Stok Kartları</h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", margin: "0.25rem 0 0" }}>
            Ürünlerinizi, hizmetlerinizi, envanter miktarlarını ve maliyetlerini takip edin.
          </p>
        </div>
        <div style={{ display: "flex", gap: "1rem" }}>
          <a href="/panel/stok/raporlar" style={{ ...stil.dugmeMuted, display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
            📈 Raporlar
          </a>
          <label style={{ ...stil.dugmeMuted, display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            📥 Excel&apos;den İçe Aktar
            <input type="file" accept=".xlsx" onChange={excelYukle} style={{ display: "none" }} />
          </label>
          <button onClick={() => setFormAcik(!formAcik)} style={{ ...stil.dugme, width: "auto", padding: "0.5rem 1.25rem" }}>
            {formAcik ? "Vazgeç" : "➕ Yeni Ürün/Hizmet"}
          </button>
        </div>
      </div>

      {hata && <p style={stil.hata}>{hata}</p>}
      {basari && <p style={stil.basari}>{basari}</p>}

      {formAcik && (
        <form onSubmit={kaydet} style={{ ...stil.genisKart, marginBottom: "2rem", maxWidth: "600px" }}>
          <h3 style={{ margin: "0 0 1.5rem", fontSize: "1.1rem", fontWeight: "bold" }}>Yeni Stok Kartı Oluştur</h3>
          
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Stok Kodu (Otomatik boş bırakılabilir)</label>
              <input type="text" value={kod} onChange={(e) => setKod(e.target.value)} style={stil.girdi} placeholder="STK-001" />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Stok Tipi</label>
              <select value={tip} onChange={(e) => setTip(e.target.value)} style={stil.girdi}>
                <option value="urun">Ürün (Envanter Takipli)</option>
                <option value="hizmet">Hizmet (Envantersiz)</option>
              </select>
            </div>
          </div>

          <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Ürün/Hizmet Adı</label>
          <input type="text" value={ad} onChange={(e) => setAd(e.target.value)} style={stil.girdi} required placeholder="Örn. 15.6 inç Taşınabilir Monitör" />

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Barkod</label>
              <input type="text" value={barkod} onChange={(e) => setBarkod(e.target.value)} style={stil.girdi} placeholder="8690..." />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>KDV Oranı (%)</label>
              <input type="number" value={kdvOrani} onChange={(e) => setKdvOrani(e.target.value)} style={stil.girdi} required />
            </div>
          </div>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Alış Fiyatı (TRY)</label>
              <input type="number" step="0.0001" value={alisFiyati} onChange={(e) => setAlisFiyati(e.target.value)} style={stil.girdi} placeholder="0.0000" />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Satış Fiyatı (TRY)</label>
              <input type="number" step="0.0001" value={satisFiyati} onChange={(e) => setSatisFiyati(e.target.value)} style={stil.girdi} placeholder="0.0000" />
            </div>
          </div>

          <button type="submit" style={stil.dugme}>Stok Kartını Kaydet</button>
        </form>
      )}

      <div style={{ display: "flex", marginBottom: "1.5rem" }}>
        <input
          type="text"
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Stok adına, koduna veya barkoduna göre ara..."
          style={{ ...stil.girdi, margin: 0, maxWidth: "400px" }}
        />
      </div>

      <div style={stil.genisKart}>
        <table style={stil.tablo}>
          <thead>
            <tr>
              <th style={stil.tabloBaslik}>Kod</th>
              <th style={stil.tabloBaslik}>Ürün/Hizmet Adı</th>
              <th style={stil.tabloBaslik}>Tip</th>
              <th style={stil.tabloBaslik}>KDV Oranı</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Mevcut Stok</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Ort. Maliyet</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Alış Fiyatı</th>
              <th style={{ ...stil.tabloBaslik, textAlign: "right" }}>Satış Fiyatı</th>
            </tr>
          </thead>
          <tbody>
            {stoklar.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...stil.tabloHucre, textAlign: "center", color: "#a1a1aa" }}>
                  Arama kriterlerinize uygun stok kartı bulunamadı.
                </td>
              </tr>
            ) : (
              stoklar.map((s) => {
                const miktar = Number(s.mevcutMiktar);
                const maliyet = Number(s.ortalamaMaliyet);

                return (
                  <tr key={s.id}>
                    <td style={stil.tabloHucre}>{s.kod}</td>
                    <td style={{ ...stil.tabloHucre, fontWeight: "600" }}>
                      {s.ad}
                      {s.barkod ? <span style={{ display: "block", fontSize: "0.75rem", color: "#a1a1aa", fontWeight: "normal" }}>Barcode: {s.barkod}</span> : ""}
                    </td>
                    <td style={stil.tabloHucre}>{s.tip === "urun" ? "📦 Ürün" : "🛠️ Hizmet"}</td>
                    <td style={stil.tabloHucre}>%{Number(s.kdvOrani).toFixed(0)}</td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", fontWeight: "bold", color: miktar > 0 ? "#fafaf9" : "#a1a1aa" }}>
                      {miktar.toLocaleString("tr-TR", { minimumFractionDigits: 0 })} {s.anaBirim}
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: "#6366f1" }}>
                      {maliyet > 0 ? `${maliyet.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL` : "-"}
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right" }}>
                      {s.alisFiyati ? `${Number(s.alisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL` : "-"}
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", fontWeight: "600" }}>
                      {s.satisFiyati ? `${Number(s.satisFiyati).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL` : "-"}
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
