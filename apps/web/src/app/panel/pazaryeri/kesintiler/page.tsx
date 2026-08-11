"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, PageHeader, Select, TableWrap } from "@/components/ui";

interface Kesinti { id: string; siparisNo: string | null; tur: string; aciklama: string | null; tarih: string; tutar: string; dovizCinsi: string; durum: string; baglanti: { saglayici: string }; }
interface Hesap { id: string; ad: string; dovizCinsi: string; }

export default function PazaryeriKesintileri() {
  const [kesintiler, setKesintiler] = useState<Kesinti[]>([]);
  const [kasalar, setKasalar] = useState<Hesap[]>([]);
  const [bankalar, setBankalar] = useState<Hesap[]>([]);
  const [secimler, setSecimler] = useState<Record<string, boolean>>({});
  const [hesap, setHesap] = useState("");
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islemde, setIslemde] = useState(false);
  const yukle = useCallback(async () => {
    try {
      const [k, ks, bs] = await Promise.all([api<Kesinti[]>("/pazaryeri/kesintiler"), api<Hesap[]>("/kasa-banka/kasalar"), api<Hesap[]>("/kasa-banka/bankalar")]);
      setKesintiler(k); setKasalar(ks); setBankalar(bs);
    } catch (e) { setHata(e instanceof Error ? e.message : "Kesintiler yüklenemedi"); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);
  async function giderlestir() {
    const ids = kesintiler.filter((k) => k.durum === "bekliyor" && secimler[k.id]).map((k) => k.id);
    if (!ids.length) return setHata("Giderleştirilecek kesinti seçin.");
    if (!hesap) return setHata("Kasa veya banka hesabı seçin.");
    const [tur, id] = hesap.split(":"); setIslemde(true); setHata(""); setBasari("");
    try {
      const sonuc = await api<{ giderlestirilen: number }>("/pazaryeri/kesintiler/giderlestir", { method: "POST", body: JSON.stringify({ kesintiIds: ids, ...(tur === "kasa" ? { kasaId: id } : { bankaHesapId: id }), kur: 1 }) });
      setBasari(`${sonuc.giderlestirilen} kesinti gider kaydına dönüştürüldü.`); setSecimler({}); await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Giderleştirme başarısız"); } finally { setIslemde(false); }
  }
  async function senkronize() {
    setIslemde(true); setHata(""); setBasari("");
    try {
      const sonuc = await api<{ sonuclar: { alinan: number; eklenen: number; hata?: string }[] }>("/pazaryeri/kesintiler/senkronize", { method: "POST", body: "{}" });
      const alinan = sonuc.sonuclar.reduce((t, s) => t + s.alinan, 0); const eklenen = sonuc.sonuclar.reduce((t, s) => t + s.eklenen, 0); const hataMesaji = sonuc.sonuclar.find((s) => s.hata)?.hata;
      if (hataMesaji) setHata(hataMesaji); else setBasari(`${alinan} Amazon finans kesintisi alındı, ${eklenen} yeni kayıt eklendi.`); await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Kesinti senkronizasyonu başarısız"); } finally { setIslemde(false); }
  }
  return <div><PageHeader title="Pazaryeri Komisyon ve Kesintileri" subtitle="Amazon finans hareketlerini alın; sağlayıcı kesintilerini kasa/banka tediye giderine dönüştürün." actions={<div className="row-tight"><Button disabled={islemde} onClick={() => void senkronize()}>Amazon kesintilerini al</Button><Field label="Ödeme hesabı"><Select value={hesap} onChange={(e) => setHesap(e.target.value)}><option value="">Hesap seçin</option>{kasalar.map((h) => <option key={h.id} value={`kasa:${h.id}`}>Kasa · {h.ad} ({h.dovizCinsi})</option>)}{bankalar.map((h) => <option key={h.id} value={`banka:${h.id}`}>Banka · {h.ad} ({h.dovizCinsi})</option>)}</Select></Field><Button variant="primary" disabled={islemde} onClick={() => void giderlestir()}>{islemde ? "İşleniyor…" : "Seçilenleri giderleştir"}</Button></div>} /><Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert><Card pad={false}><TableWrap><thead><tr><th className="center">Seç</th><th>Sağlayıcı</th><th>Tarih</th><th>Tür / Sipariş</th><th>Açıklama</th><th>Durum</th><th className="num">Tutar</th></tr></thead><tbody>{kesintiler.map((k) => <tr key={k.id}><td className="center"><input type="checkbox" aria-label={`${k.tur} kesintisini seç`} disabled={k.durum !== "bekliyor"} checked={Boolean(secimler[k.id])} onChange={(e) => setSecimler((x) => ({ ...x, [k.id]: e.target.checked }))}/></td><td>{k.baglanti.saglayici}</td><td>{new Date(k.tarih).toLocaleDateString("tr-TR")}</td><td><strong>{k.tur}</strong>{k.siparisNo && <><br/><small>{k.siparisNo}</small></>}</td><td>{k.aciklama ?? "—"}</td><td><Badge variant={k.durum === "giderlesti" ? "success" : "neutral"}>{k.durum}</Badge></td><td className="num">{Number(k.tutar).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {k.dovizCinsi}</td></tr>)}{!kesintiler.length && <tr><td colSpan={7}>Henüz komisyon veya kesinti kaydı yok.</td></tr>}</tbody></TableWrap></Card></div>;
}
