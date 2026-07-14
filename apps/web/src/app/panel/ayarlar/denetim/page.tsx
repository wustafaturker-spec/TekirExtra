"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { stil } from "@/lib/stil";

interface DenetimKullanicisi {
  id: string;
  adSoyad: string;
  eposta: string;
}

interface DenetimKaydi {
  id: string;
  islem: string;
  varlik: string;
  varlikId: string | null;
  zaman: string;
  kullanici: DenetimKullanicisi | null;
}

interface DenetimSayfasi {
  kayitlar: DenetimKaydi[];
  sonrakiImlec: string | null;
}

const ADET = 50;

export default function DenetimIziSayfasi() {
  const [kayitlar, setKayitlar] = useState<DenetimKaydi[]>([]);
  const [varliklar, setVarliklar] = useState<string[]>([]);
  const [varlik, setVarlik] = useState("");
  const [baslangic, setBaslangic] = useState("");
  const [bitis, setBitis] = useState("");
  const [sonrakiImlec, setSonrakiImlec] = useState<string | null>(null);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);

  const sorgu = useCallback(
    (imlec?: string) => {
      const p = new URLSearchParams({ adet: String(ADET) });
      if (varlik) p.set("varlik", varlik);
      if (baslangic) p.set("baslangic", baslangic);
      if (bitis) p.set("bitis", bitis);
      if (imlec) p.set("imlec", imlec);
      return `/denetim?${p.toString()}`;
    },
    [varlik, baslangic, bitis],
  );

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      const veri = await api<DenetimSayfasi>(sorgu());
      setKayitlar(veri.kayitlar);
      setSonrakiImlec(veri.sonrakiImlec);
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Denetim izi yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [sorgu]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  useEffect(() => {
    api<string[]>("/denetim/varliklar")
      .then(setVarliklar)
      .catch(() => setVarliklar([]));
  }, []);

  async function dahaGetir() {
    if (!sonrakiImlec) return;
    setYukleniyor(true);
    try {
      const veri = await api<DenetimSayfasi>(sorgu(sonrakiImlec));
      setKayitlar((mevcut) => [...mevcut, ...veri.kayitlar]);
      setSonrakiImlec(veri.sonrakiImlec);
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Denetim izi yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }

  return (
    <div style={stil.genisKart}>
      <h1 style={{ marginBottom: ".25rem" }}>🛡️ Denetim İzi</h1>
      <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
        Kritik işlemlerin kim tarafından, ne zaman yapıldığını gösterir (KLN-04). Kayıtlar
        salt-okunurdur; silinemez veya değiştirilemez.
      </p>

      <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: ".85rem" }}>
          Varlık
          <select value={varlik} onChange={(e) => setVarlik(e.target.value)} style={stil.girdi}>
            <option value="">Tümü</option>
            {varliklar.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: ".85rem" }}>
          Başlangıç
          <input
            type="date"
            value={baslangic}
            onChange={(e) => setBaslangic(e.target.value)}
            style={stil.girdi}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: ".85rem" }}>
          Bitiş
          <input
            type="date"
            value={bitis}
            onChange={(e) => setBitis(e.target.value)}
            style={stil.girdi}
          />
        </label>
      </div>

      {hata && <p style={stil.hata}>{hata}</p>}

      <table style={stil.tablo}>
        <thead>
          <tr>
            <th style={stil.tabloBaslik}>Zaman</th>
            <th style={stil.tabloBaslik}>Kullanıcı</th>
            <th style={stil.tabloBaslik}>Varlık</th>
            <th style={stil.tabloBaslik}>İşlem</th>
            <th style={stil.tabloBaslik}>Kayıt</th>
          </tr>
        </thead>
        <tbody>
          {kayitlar.map((k) => (
            <tr key={k.id}>
              <td style={stil.tabloHucre}>{new Date(k.zaman).toLocaleString("tr-TR")}</td>
              <td style={stil.tabloHucre}>{k.kullanici?.adSoyad ?? "—"}</td>
              <td style={stil.tabloHucre}>{k.varlik}</td>
              <td style={stil.tabloHucre}>{k.islem}</td>
              <td style={{ ...stil.tabloHucre, color: "#6b7280", fontSize: ".8rem" }}>
                {k.varlikId ?? "—"}
              </td>
            </tr>
          ))}
          {kayitlar.length === 0 && !yukleniyor && (
            <tr>
              <td style={{ ...stil.tabloHucre, textAlign: "center" }} colSpan={5}>
                Kayıt bulunamadı
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {sonrakiImlec && (
        <button type="button" onClick={dahaGetir} disabled={yukleniyor} style={stil.dugmeMuted}>
          {yukleniyor ? "Yükleniyor…" : "Daha fazla getir"}
        </button>
      )}
    </div>
  );
}
