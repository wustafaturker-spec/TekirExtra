"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, Card, PageHeader, Select, Table } from "@/components/ui";

type Tur = "urun_eslesme" | "cari_eslesme" | "musteri_tercihi" | "siniflandirma" | "susturma" | "fikir_isareti";
type Durum = "aktif" | "oneri" | "pasif";
interface Kayit {
  id: string; tur: Tur; anahtar: string; metin: string | null; etiket: string | null; kaynak: "kullanici" | "otomatik" | "ai_onerisi"; durum: Durum;
  cari: { id: string; kod: string; unvan: string } | null;
  stok: { id: string; kod: string; ad: string; aktif: boolean } | null;
  varyant: { id: string; kod: string; ad: string; aktif: boolean } | null;
  olusturan: string | null; kaynakEpostaId: string | null; kullanimSayisi: number; sonKullanimAt: string | null; guncellendi: string;
}

const TUR_ADI: Record<Tur, string> = {
  urun_eslesme: "Ürün eşleşmesi",
  cari_eslesme: "Cari eşleşmesi",
  musteri_tercihi: "Müşteri tercihi",
  siniflandirma: "Sınıflandırma örneği",
  susturma: "Susturulan gönderen",
  fikir_isareti: "Fikir işareti",
};
const KAYNAK_ADI = { kullanici: "Kullanıcı", otomatik: "Onaylı tekliften", ai_onerisi: "AI önerisi" } as const;
const DURUM: Record<Durum, { ad: string; varyant: "success" | "warning" | "neutral" }> = {
  aktif: { ad: "Kullanılıyor", varyant: "success" },
  oneri: { ad: "Onay bekliyor", varyant: "warning" },
  pasif: { ad: "Kapalı", varyant: "neutral" },
};
const ADET = 50;
const tarih = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });

function Ne({ k }: { k: Kayit }) {
  if (k.tur === "urun_eslesme") {
    const pasif = (k.stok && !k.stok.aktif) || (k.varyant && !k.varyant.aktif);
    return (
      <div className="hafiza__ne">
        <span>“{k.metin ?? k.anahtar}” → {k.stok ? `[${k.stok.kod}] ${k.stok.ad}` : "silinmiş kart"}{k.varyant ? ` — ${k.varyant.ad || k.varyant.kod}` : ""}</span>
        <span className="muted">{k.cari?.unvan}{pasif ? " · kart/varyant pasif, kullanılmıyor" : ""}</span>
      </div>
    );
  }
  if (k.tur === "cari_eslesme") return <div className="hafiza__ne"><span>{k.metin ?? k.anahtar} → {k.cari?.unvan ?? "silinmiş cari"}</span></div>;
  if (k.tur === "musteri_tercihi") return <div className="hafiza__ne"><span>{k.metin}</span><span className="muted">{k.cari?.unvan}</span></div>;
  if (k.tur === "siniflandirma") {
    return (
      <div className="hafiza__ne">
        <span>{k.etiket === "teklif" ? "Teklif talebiydi" : "Teklif talebi değildi"}</span>
        <span className="muted">{(k.metin ?? "").split("\n")[0]}</span>
      </div>
    );
  }
  return <div className="hafiza__ne"><span>{k.metin ?? k.anahtar}</span><span className="muted">Bu adresin e-postaları teklif talebi olarak işlenmez.</span></div>;
}

/**
 * AI-59: yapay zekânın kullanıcı düzeltmelerinden öğrendikleri. Tutar ya da
 * bakiye tutulmaz; öneriler onaylanmadan kullanılmaz.
 */
export default function HafizaSayfasi() {
  const [tur, setTur] = useState<Tur | "">("");
  const [durum, setDurum] = useState<Durum | "">("");
  const [sayfa, setSayfa] = useState(1);
  const [veri, setVeri] = useState<{ toplam: number; kayitlar: Kayit[] } | null>(null);
  const [hata, setHata] = useState("");
  const [islem, setIslem] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    setHata("");
    const q = new URLSearchParams({ sayfa: String(sayfa), adet: String(ADET) });
    if (tur) q.set("tur", tur);
    if (durum) q.set("durum", durum);
    try { setVeri(await api(`/ai/hafiza?${q}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Hafıza yüklenemedi"); }
  }, [tur, durum, sayfa]);
  useEffect(() => { if (tokenAl()) void yukle(); }, [yukle]);

  async function eylem(id: string, fn: () => Promise<unknown>) {
    setIslem(id); setHata("");
    try { await fn(); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); }
    finally { setIslem(null); }
  }
  const durumYap = (k: Kayit, d: "aktif" | "pasif") => eylem(k.id, () => api(`/ai/hafiza/${k.id}`, { method: "PATCH", body: JSON.stringify({ durum: d }) }));
  const sil = (k: Kayit) => eylem(k.id, () => api(`/ai/hafiza/${k.id}`, { method: "DELETE" }));
  const sayfaSayisi = veri ? Math.max(1, Math.ceil(veri.toplam / ADET)) : 1;

  return <>
    <PageHeader
      title="Yapay Zekâ Hafızası"
      subtitle="E-posta teklif hattının düzeltmelerinizden öğrendikleri: ürün ve cari eşleşmeleri, müşteri tercihleri, sınıflandırma örnekleri ve susturulan gönderenler. Tutar ya da bakiye tutulmaz; AI önerileri siz onaylamadan kullanılmaz."
      actions={<div className="row-tight">
        <Select value={tur} onChange={(e) => { setTur(e.target.value as Tur | ""); setSayfa(1); }} aria-label="Tür">
          <option value="">Tüm türler</option>
          {(Object.keys(TUR_ADI) as Tur[]).map((t) => <option key={t} value={t}>{TUR_ADI[t]}</option>)}
        </Select>
        <Select value={durum} onChange={(e) => { setDurum(e.target.value as Durum | ""); setSayfa(1); }} aria-label="Durum">
          <option value="">Tüm durumlar</option>
          {(Object.keys(DURUM) as Durum[]).map((d) => <option key={d} value={d}>{DURUM[d].ad}</option>)}
        </Select>
      </div>}
    />
    <Alert tone="error">{hata}</Alert>
    {veri && !veri.kayitlar.length && <Card><p className="muted">{tur || durum ? "Bu süzgeçle kayıt yok." : "Henüz öğrenilen bir şey yok. Teklif panelinde doğru ürünü seçtiğinizde, cari seçtiğinizde ya da sınıflandırmayı düzelttiğinizde burada görünür."}</p></Card>}
    {!!veri?.kayitlar.length && (
      <Card>
        <Table density="compact">
          <thead><tr><th>Tür</th><th>Öğrenilen</th><th>Kaynak</th><th>Durum</th><th>Kullanım</th><th>Güncelleme</th><th aria-label="Eylemler" /></tr></thead>
          <tbody>
            {veri.kayitlar.map((k) => (
              <tr key={k.id}>
                <td>{TUR_ADI[k.tur]}</td>
                <td><Ne k={k} /></td>
                <td>
                  <div className="hafiza__ne">
                    <span>{KAYNAK_ADI[k.kaynak]}</span>
                    <span className="muted">{k.olusturan ?? ""}{k.kaynakEpostaId ? <> {k.olusturan ? "· " : ""}<Link href={`/panel/eposta?id=${k.kaynakEpostaId}`}>e-posta</Link></> : null}</span>
                  </div>
                </td>
                <td><Badge variant={DURUM[k.durum].varyant}>{DURUM[k.durum].ad}</Badge></td>
                <td>{k.kullanimSayisi ? <span title={k.sonKullanimAt ? `Son: ${tarih(k.sonKullanimAt)}` : undefined}>{k.kullanimSayisi} kez</span> : <span className="muted">—</span>}</td>
                <td>{tarih(k.guncellendi)}</td>
                <td>
                  <div className="row-tight">
                    {k.durum === "oneri" && <Button size="sm" variant="primary" disabled={islem !== null} onClick={() => void durumYap(k, "aktif")}>Onayla</Button>}
                    {k.durum === "pasif" && <Button size="sm" disabled={islem !== null} onClick={() => void durumYap(k, "aktif")}>Etkinleştir</Button>}
                    {k.durum !== "pasif" && <Button size="sm" disabled={islem !== null} onClick={() => void durumYap(k, "pasif")}>{k.durum === "oneri" ? "Reddet" : "Kapat"}</Button>}
                    <Button size="sm" variant="danger" disabled={islem !== null} onClick={() => void sil(k)}>Sil</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {sayfaSayisi > 1 && (
          <div className="row-tight">
            <Button size="sm" disabled={sayfa <= 1} onClick={() => setSayfa((s) => s - 1)}>Önceki</Button>
            <span className="muted">{sayfa} / {sayfaSayisi}</span>
            <Button size="sm" disabled={sayfa >= sayfaSayisi} onClick={() => setSayfa((s) => s + 1)}>Sonraki</Button>
          </div>
        )}
      </Card>
    )}
  </>;
}
