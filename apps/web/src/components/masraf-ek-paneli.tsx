"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { BelgeDosyalari, belgeDosyalariniYukle } from "@/components/belge-dosyalari";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { Alert, Button } from "@/components/ui";

interface Ek { id: string; dosyaAdi: string; boyut: number; createdAt: string }

export function MasrafEkPaneli({ masrafId, baslik, onKapat }: { masrafId: string; baslik: string; onKapat: () => void }) {
  const [ekler, setEkler] = useState<Ek[]>([]); const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [hata, setHata] = useState(""); const [islemde, setIslemde] = useState(false);
  const yenile = useCallback(async () => { try { setEkler(await api<Ek[]>(`/ekler?sahipTur=masraf&sahipId=${masrafId}`)); } catch (e) { setHata(e instanceof Error ? e.message : "Ekler yüklenemedi"); } }, [masrafId]);
  useEffect(() => { void yenile(); }, [yenile]);
  async function ekle() { setIslemde(true); setHata(""); try { await belgeDosyalariniYukle("masraf", masrafId, dosyalar); setDosyalar([]); await yenile(); } catch (e) { setHata(e instanceof Error ? e.message : "Dosyalar yüklenemedi"); } finally { setIslemde(false); } }
  async function sil(ek: Ek) { if (!confirm(`${ek.dosyaAdi} silinsin mi?`)) return; try { await api(`/ekler/${ek.id}`, { method: "DELETE" }); await yenile(); } catch (e) { setHata(e instanceof Error ? e.message : "Dosya silinemedi"); } }
  return <HizliKayitPaneli baslik={`Masraf ekleri · ${baslik}`} onKapat={onKapat}><Alert tone="error">{hata}</Alert><BelgeDosyalari dosyalar={dosyalar} onChange={setDosyalar} /><Button variant="primary" disabled={!dosyalar.length || islemde} onClick={() => void ekle()}>{islemde ? "Yükleniyor..." : "Seçilen dosyaları yükle"}</Button><div className="document-attachments__saved"><h4>Kayıtlı dosyalar</h4>{ekler.length === 0 ? <p className="muted">Henüz dosya eklenmemiş.</p> : ekler.map((ek) => <div className="document-attachment" key={ek.id}><span>📎</span><div><strong>{ek.dosyaAdi}</strong><small>{(ek.boyut / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB · {new Date(ek.createdAt).toLocaleDateString("tr-TR")}</small></div><div className="row-tight"><Button size="sm" onClick={() => void apiDosyaIndir(`/ekler/${ek.id}/indir`, ek.dosyaAdi)}>İndir</Button><Button size="sm" variant="danger" onClick={() => void sil(ek)}>Sil</Button></div></div>)}</div></HizliKayitPaneli>;
}
