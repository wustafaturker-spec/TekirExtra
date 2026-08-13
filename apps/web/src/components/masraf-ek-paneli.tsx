"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BelgeDosyalari, belgeDosyalariniYukle, KayitliEkSatiri, type KayitliEk } from "@/components/belge-dosyalari";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { Alert, Button } from "@/components/ui";

type Ek = KayitliEk;

export function MasrafEkPaneli({ masrafId, baslik, onKapat }: { masrafId: string; baslik: string; onKapat: () => void }) {
  const [ekler, setEkler] = useState<Ek[]>([]); const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [hata, setHata] = useState(""); const [islemde, setIslemde] = useState(false);
  const yenile = useCallback(async () => { try { setEkler(await api<Ek[]>(`/ekler?sahipTur=masraf&sahipId=${masrafId}`)); } catch (e) { setHata(e instanceof Error ? e.message : "Ekler yüklenemedi"); } }, [masrafId]);
  useEffect(() => { void yenile(); }, [yenile]);
  async function ekle() { setIslemde(true); setHata(""); try { await belgeDosyalariniYukle("masraf", masrafId, dosyalar); setDosyalar([]); await yenile(); } catch (e) { setHata(e instanceof Error ? e.message : "Dosyalar yüklenemedi"); } finally { setIslemde(false); } }
  async function sil(ek: Ek) { if (!confirm(`${ek.dosyaAdi} silinsin mi?`)) return; try { await api(`/ekler/${ek.id}`, { method: "DELETE" }); await yenile(); } catch (e) { setHata(e instanceof Error ? e.message : "Dosya silinemedi"); } }
  return <HizliKayitPaneli baslik={`Masraf ekleri · ${baslik}`} onKapat={onKapat}><Alert tone="error">{hata}</Alert><BelgeDosyalari dosyalar={dosyalar} onChange={setDosyalar} /><Button variant="primary" disabled={!dosyalar.length || islemde} onClick={() => void ekle()}>{islemde ? "Yükleniyor..." : "Seçilen dosyaları yükle"}</Button><div className="document-attachments__saved"><h4>Kayıtlı dosyalar</h4>{ekler.length === 0 ? <p className="muted">Henüz dosya eklenmemiş.</p> : ekler.map((ek) => <KayitliEkSatiri ek={ek} key={ek.id} onSil={(secili) => void sil(secili)} />)}</div></HizliKayitPaneli>;
}
