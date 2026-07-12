"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiHata, tokenAl } from "@/lib/api";
import { stil } from "@/lib/stil";

interface Cari {
  id: string;
  kod: string;
  unvan: string;
  tip: string;
  vknTckn: string | null;
  eposta: string | null;
  telefon: string | null;
  bakiyeler: { dovizCinsi: string; bakiye: string }[];
}

export default function CariSayfasi() {
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [arama, setArama] = useState("");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [formAcik, setFormAcik] = useState(false);

  // Form alanları
  const [kod, setKod] = useState("");
  const [unvan, setUnvan] = useState("");
  const [tip, setTip] = useState("musteri");
  const [vknTckn, setVknTckn] = useState("");
  const [eposta, setEposta] = useState("");
  const [telefon, setTelefon] = useState("");

  const yukle = useCallback(async () => {
    try {
      const qs = arama ? `?arama=${encodeURIComponent(arama)}` : "";
      const veri = await api<{ kayitlar: Cari[] }>(`/cari${qs}`);
      setCariler(veri.kayitlar);
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
      await api("/cari", {
        method: "POST",
        body: JSON.stringify({
          kod: kod || undefined,
          unvan,
          tip,
          vknTckn: vknTckn || null,
          eposta: eposta || null,
          telefon: telefon || null,
        }),
      });
      setBasari("Cari kart başarıyla oluşturuldu.");
      setFormAcik(false);
      // Temizle
      setKod("");
      setUnvan("");
      setVknTckn("");
      setEposta("");
      setTelefon("");
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
    } catch (h) {
      setHata("Excel ekstre indirilirken bir hata oluştu.");
    }
  }

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
        <form onSubmit={kaydet} style={{ ...stil.genisKart, marginBottom: "2rem", maxWidth: "600px" }}>
          <h3 style={{ margin: "0 0 1.5rem", fontSize: "1.1rem", fontWeight: "bold" }}>Yeni Cari Kartı Oluştur</h3>
          
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Cari Kodu (Boş bırakılırsa otomatik üretilir)</label>
              <input type="text" value={kod} onChange={(e) => setKod(e.target.value)} style={stil.girdi} placeholder="CARI-001" />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Cari Tipi</label>
              <select value={tip} onChange={(e) => setTip(e.target.value)} style={stil.girdi}>
                <option value="musteri">Müşteri</option>
                <option value="tedarikci">Tedarikçi</option>
                <option value="diger">Diğer</option>
              </select>
            </div>
          </div>

          <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Ünvan / Ad Soyad</label>
          <input type="text" value={unvan} onChange={(e) => setUnvan(e.target.value)} style={stil.girdi} required placeholder="Örn. Ahmet Yılmaz Veya Teknoloji A.Ş." />

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>VKN / TCKN</label>
              <input type="text" value={vknTckn} onChange={(e) => setVknTckn(e.target.value)} style={stil.girdi} placeholder="10 veya 11 Haneli Numara" />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>E-posta</label>
              <input type="email" value={eposta} onChange={(e) => setEposta(e.target.value)} style={stil.girdi} placeholder="iletisim@firma.com" />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Telefon</label>
              <input type="text" value={telefon} onChange={(e) => setTelefon(e.target.value)} style={stil.girdi} placeholder="0500..." />
            </div>
          </div>

          <button type="submit" style={stil.dugme}>Cari Kartı Kaydet</button>
        </form>
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
                    <td style={{ ...stil.tabloHucre, fontWeight: "600" }}>{c.unvan}</td>
                    <td style={stil.tabloHucre}>
                      {c.tip === "musteri" ? "👤 Müşteri" : c.tip === "tedarikci" ? "🏬 Tedarikçi" : "🏢 Diğer"}
                    </td>
                    <td style={stil.tabloHucre}>{c.vknTckn || "-"}</td>
                    <td style={stil.tabloHucre}>
                      <span style={{ fontSize: "0.85rem", display: "block" }}>{c.eposta || ""}</span>
                      <span style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>{c.telefon || ""}</span>
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "right", color: bakiyeNum > 0 ? "#22c55e" : bakiyeNum < 0 ? "#ef4444" : "#fafaf9", fontWeight: "bold" }}>
                      {bakiyeNum.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                    </td>
                    <td style={{ ...stil.tabloHucre, textAlign: "center" }}>
                      <button onClick={() => ekstreIndir(c.id, c.unvan)} style={{ ...stil.dugmeMuted, padding: "0.35rem 0.65rem", fontSize: "0.8rem" }}>
                        📊 Ekstre (Excel)
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
