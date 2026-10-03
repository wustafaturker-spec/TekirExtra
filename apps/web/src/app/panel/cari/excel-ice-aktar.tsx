"use client";

import { useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Badge, Button, Card, Stat, StatGrid, TableWrap } from "@/components/ui";

type Durum = "yeni" | "guncelle" | "degisiklik_yok" | "hatali";
interface Ozet { toplam: number; yeni: number; guncelle: number; degisiklikYok: number; hatali: number; acilis: number }
interface Onizleme {
  ozet: Ozet;
  satirlar: Array<{ satir: number; durum: Durum; kod: string; unvan: string; degisenAlanlar: string[]; hatalar: string[]; uyarilar: string[] }>;
}

const DURUM: Record<Durum, { ad: string; ton: "success" | "info" | "neutral" | "danger" }> = {
  yeni: { ad: "Yeni", ton: "success" },
  guncelle: { ad: "Güncellenecek", ton: "info" },
  degisiklik_yok: { ad: "Değişiklik yok", ton: "neutral" },
  hatali: { ad: "Hatalı", ton: "danger" },
};
const SIRA: Record<Durum, number> = { hatali: 0, yeni: 1, guncelle: 2, degisiklik_yok: 3 };

const form = (dosya: File) => { const f = new FormData(); f.append("file", dosya); return f; };

/**
 * CARI-31: Excel'den cari içe aktarma. Dosya önce önizlenir (hiçbir şey
 * yazılmaz); onayda sunucu dosyayı yeniden doğrular ve hatasız satırları yazar.
 */
export function ExcelIceAktar({ onKapat, onTamam }: { onKapat: () => void; onTamam: (mesaj: string) => void }) {
  const [dosya, setDosya] = useState<File | null>(null);
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [yalnizSorunlu, setYalnizSorunlu] = useState(false);
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState(false);

  async function sec(e: React.ChangeEvent<HTMLInputElement>) {
    const secilen = e.target.files?.[0];
    e.target.value = "";
    if (!secilen) return;
    setDosya(secilen); setOnizleme(null); setHata(""); setIslemde(true);
    try {
      const o = await api<Onizleme>("/cari/excel/onizleme", { method: "POST", body: form(secilen) });
      setOnizleme(o); setYalnizSorunlu(o.ozet.hatali > 0);
    } catch (err) { setHata(err instanceof Error ? err.message : "Dosya okunamadı"); }
    finally { setIslemde(false); }
  }

  async function aktar() {
    if (!dosya || !onizleme) return;
    setHata(""); setIslemde(true);
    try {
      const o = await api<Ozet>("/cari/excel/ice-aktar", { method: "POST", body: form(dosya) });
      onTamam(`İçe aktarıldı: ${o.yeni} yeni, ${o.guncelle} güncellenen cari${o.acilis ? `, ${o.acilis} açılış bakiyesi` : ""}${o.hatali ? `; ${o.hatali} hatalı satır atlandı` : ""}.`);
    } catch (err) { setHata(err instanceof Error ? err.message : "İçe aktarılamadı"); }
    finally { setIslemde(false); }
  }

  const yazilacak = onizleme ? onizleme.ozet.yeni + onizleme.ozet.guncelle : 0;
  const satirlar = (onizleme?.satirlar ?? [])
    .filter((s) => !yalnizSorunlu || s.durum === "hatali" || s.uyarilar.length > 0)
    .sort((a, b) => SIRA[a.durum] - SIRA[b.durum] || a.satir - b.satir);

  return (
    <Card className="cari-ice-aktar" title="Excel'den cari içe aktar" actions={<Button size="sm" onClick={onKapat}>Kapat</Button>}>
      <p className="subtle">
        Satır <b>koda</b>, kod boşsa <b>VKN/TCKN</b>'ye göre mevcut kartla eşleşir. Eşleşen kartta yalnız dolu hücreler yazılır; boş hücre mevcut değeri silmez.
        Dosya önce önizlenir, onaylayana kadar hiçbir şey kaydedilmez.
      </p>
      <div className="cari-ice-aktar__araclar">
        <Button onClick={() => void apiDosyaIndir("/cari/excel/sablon", "cari-sablonu.xlsx")}>Şablonu indir</Button>
        <label className="btn btn--primary">
          {dosya ? "Başka dosya seç" : "Excel dosyası seç (.xlsx)"}
          <input type="file" accept=".xlsx" onChange={(e) => void sec(e)} disabled={islemde} style={{ display: "none" }} />
        </label>
        {dosya && <span className="muted">{dosya.name}</span>}
      </div>
      {hata && <Alert tone="error">{hata}</Alert>}
      {islemde && !onizleme && <p className="subtle">Dosya denetleniyor…</p>}
      {onizleme && (
        <>
          <StatGrid>
            <Stat label="Yeni cari" value={onizleme.ozet.yeni} tone="success" />
            <Stat label="Güncellenecek" value={onizleme.ozet.guncelle} />
            <Stat label="Değişiklik yok" value={onizleme.ozet.degisiklikYok} />
            <Stat label="Hatalı (atlanır)" value={onizleme.ozet.hatali} tone={onizleme.ozet.hatali ? "danger" : "default"} />
          </StatGrid>
          {onizleme.ozet.acilis > 0 && <p className="subtle">{onizleme.ozet.acilis} cariye açılış bakiyesi yazılacak.</p>}
          <div className="cari-ice-aktar__araclar">
            <label className="check-row"><input type="checkbox" checked={yalnizSorunlu} onChange={(e) => setYalnizSorunlu(e.target.checked)} /> Yalnız hatalı ve uyarılı satırlar</label>
            {onizleme.ozet.hatali > 0 && dosya && (
              <Button size="sm" onClick={() => void apiDosyaIndir("/cari/excel/hatali-satirlar", "cari-hatali-satirlar.xlsx", { method: "POST", body: form(dosya) }).catch((e) => setHata(e instanceof Error ? e.message : "İndirilemedi"))}>Hatalı satırları indir</Button>
            )}
          </div>
          <TableWrap className="cari-ice-aktar__tablo">
            <thead><tr><th className="num">Satır</th><th>Durum</th><th>Kod</th><th>Ünvan</th><th>Ayrıntı</th></tr></thead>
            <tbody>
              {satirlar.map((s) => (
                <tr key={s.satir}>
                  <td className="num">{s.satir}</td>
                  <td><Badge variant={DURUM[s.durum].ton}>{DURUM[s.durum].ad}</Badge></td>
                  <td className="mono">{s.kod || "—"}</td>
                  <td>{s.unvan || "—"}</td>
                  <td>
                    {s.hatalar.map((h) => <div key={h} className="is-danger">{h}</div>)}
                    {s.durum === "guncelle" && <div className="muted">Değişen: {s.degisenAlanlar.join(", ")}</div>}
                    {s.uyarilar.map((u) => <div key={u} className="muted">⚠ {u}</div>)}
                  </td>
                </tr>
              ))}
              {satirlar.length === 0 && <tr><td colSpan={5} className="muted">Gösterilecek satır yok.</td></tr>}
            </tbody>
          </TableWrap>
          <footer className="cari-ice-aktar__alt">
            <Button onClick={onKapat}>Vazgeç</Button>
            <Button variant="primary" disabled={islemde || yazilacak === 0} onClick={() => void aktar()}>
              {islemde ? "İçe aktarılıyor…" : yazilacak ? `${yazilacak} cariyi içe aktar` : "Yazılacak satır yok"}
            </Button>
          </footer>
        </>
      )}
    </Card>
  );
}
