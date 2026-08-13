"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { BelgeDosyalari, belgeDosyalariniYukle } from "@/components/belge-dosyalari";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { Alert, Button } from "@/components/ui";

interface Ek { id: string; dosyaAdi: string; mimeTip: string; boyut: number; createdAt: string }

export function FaturaEkPaneli({ faturaId, baslik, onKapat }: { faturaId: string; baslik: string; onKapat: () => void }) {
  const [ekler, setEkler] = useState<Ek[]>([]);
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(false);
  const yukle = useCallback(async () => {
    try { setEkler(await api<Ek[]>(`/ekler?sahipTur=fatura&sahipId=${faturaId}`)); }
    catch (h) { setHata(h instanceof Error ? h.message : "Ekler yüklenemedi"); }
  }, [faturaId]);
  useEffect(() => { void yukle(); }, [yukle]);

  async function ekle() {
    if (!dosyalar.length) return;
    setYukleniyor(true); setHata("");
    try { await belgeDosyalariniYukle("fatura", faturaId, dosyalar); setDosyalar([]); await yukle(); }
    catch (h) { setHata(h instanceof Error ? h.message : "Dosya yüklenemedi"); }
    finally { setYukleniyor(false); }
  }
  async function sil(ek: Ek) {
    if (!window.confirm(`${ek.dosyaAdi} silinsin mi?`)) return;
    try { await api(`/ekler/${ek.id}`, { method: "DELETE" }); await yukle(); }
    catch (h) { setHata(h instanceof Error ? h.message : "Ek silinemedi"); }
  }

  return <HizliKayitPaneli baslik={`Fatura ekleri · ${baslik}`} onKapat={onKapat}>
    <Alert tone="error">{hata}</Alert>
    <BelgeDosyalari dosyalar={dosyalar} onChange={setDosyalar} />
    <Button variant="primary" disabled={!dosyalar.length || yukleniyor} onClick={() => void ekle()}>{yukleniyor ? "Yükleniyor..." : "Seçilen dosyaları yükle"}</Button>
    <div className="document-attachments__saved">
      <h4>Kayıtlı dosyalar</h4>
      {ekler.length === 0 ? <p className="muted">Bu faturaya henüz dosya eklenmemiş.</p> : ekler.map((ek) => <div className="document-attachment" key={ek.id}>
        <span aria-hidden="true">📎</span>
        <div><strong>{ek.dosyaAdi}</strong><small>{(ek.boyut / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB · {new Date(ek.createdAt).toLocaleDateString("tr-TR")}</small></div>
        <div className="row-tight"><Button size="sm" onClick={() => void apiDosyaIndir(`/ekler/${ek.id}/indir`, ek.dosyaAdi)}>İndir</Button><Button variant="danger" size="sm" onClick={() => void sil(ek)}>Sil</Button></div>
      </div>)}
    </div>
  </HizliKayitPaneli>;
}
