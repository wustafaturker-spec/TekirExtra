"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Field, Input } from "@/components/ui";
export interface CekOkumaVerisi {
  belgeTuru: "CEK" | "SENET" | "BILINMIYOR"; cekNo: string | null; banka: string | null; sube: string | null;
  hesapNo: string | null; borclu: string | null; kesideYeri: string | null; tarih: string | null;
  tutar: string | null; paraBirimi: string | null; yaziylaTutar: string | null; guvenSkoru: number;
}
export function CekAiOku({ onAktar }: { onAktar: (v: CekOkumaVerisi) => void }) {
  const [dosya, setDosya] = useState<File | null>(null);
  const [sonuc, setSonuc] = useState<{ veri: CekOkumaVerisi; uyarilar: string[] } | null>(null);
  const [hata, setHata] = useState("");
  const [bekliyor, setBekliyor] = useState(false);
  const surum = useRef(0);
  const [goruntu, setGoruntu] = useState<string | null>(null);
  useEffect(() => {
    if (!dosya) { setGoruntu(null); return; }
    const adres = URL.createObjectURL(dosya); setGoruntu(adres);
    return () => URL.revokeObjectURL(adres);
  }, [dosya]);
  useEffect(() => () => { surum.current += 1; }, []);
  const tara = async () => {
    if (!dosya) return;
    const istek = ++surum.current;
    setBekliyor(true); setHata(""); setSonuc(null);
    try {
      if (dosya.size > 6 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(dosya.type)) throw new Error("En çok 6 MB JPEG, PNG veya WebP seçin.");
      const gorselBase64 = await new Promise<string>((resolve, reject) => {
        const okuyucu = new FileReader(); okuyucu.onload = () => resolve(String(okuyucu.result));
        okuyucu.onerror = () => reject(new Error("Görsel okunamadı")); okuyucu.readAsDataURL(dosya);
      });
      if (istek !== surum.current) return;
      const s = await api<{ veri: CekOkumaVerisi; uyarilar: string[] }>("/ai/cek/oku", {
        method: "POST", body: JSON.stringify({ gorselBase64, mimeType: dosya.type }),
      });
      if (istek === surum.current) setSonuc(s);
    } catch (h) { if (istek === surum.current) setHata(h instanceof Error ? h.message : "Çek okunamadı"); }
    finally { if (istek === surum.current) setBekliyor(false); }
  };
  return <div className="stack">
    <details>
      <summary>Çek/senet görüntüsünden yapay zekâ ile doldur</summary>
      <p className="muted">Görsel etkin AI sağlayıcısına gönderilir; mevcut veri aktarım onayı ve tarama kotası geçerlidir. Sonuç öneridir, otomatik kayıt değildir. Görsel bu işlemle evrak eki olarak saklanmaz.</p>
      <Field label="Çek/senet ön yüzü (JPEG, PNG, WebP; en çok 6 MB)">
        <Input type="file" accept="image/jpeg,image/png,image/webp" disabled={bekliyor} onChange={(e) => {
          surum.current += 1; setDosya(e.target.files?.[0] ?? null); setSonuc(null); setHata("");
        }} />
      </Field>
      {goruntu && <img src={goruntu} alt="Kontrol için seçilen çek/senet görüntüsü" style={{ maxWidth: "100%", maxHeight: 360, objectFit: "contain" }} />}
      <Button disabled={!dosya || bekliyor} onClick={() => void tara()}>{bekliyor ? "Görsel okunuyor…" : "Görseli oku"}</Button>
      <Alert tone="error">{hata}</Alert>
      {sonuc && <div className="stack">
        <p>Tür: {sonuc.veri.belgeTuru} · Çek no: {sonuc.veri.cekNo ?? "Okunamadı"} · Keşideci: {sonuc.veri.borclu ?? "Okunamadı"}</p>
        <p>Tutar: {sonuc.veri.tutar ?? "Elle girilmeli"} {sonuc.veri.paraBirimi ?? "Para birimi belirsiz"} · Belgedeki tarih: {sonuc.veri.tarih ?? "Elle girilmeli"}</p>
        <p>Banka / şube: {sonuc.veri.banka ?? "—"} / {sonuc.veri.sube ?? "—"} · Hesap no: {sonuc.veri.hesapNo ?? "—"}</p>
        {sonuc.veri.yaziylaTutar && <p>Yazıyla tutar: {sonuc.veri.yaziylaTutar}</p>}
        {sonuc.uyarilar.map((u) => <p className="muted" key={u}>{u}</p>)}
        <Button disabled={sonuc.veri.belgeTuru === "BILINMIYOR"} onClick={() => { onAktar(sonuc.veri); setSonuc(null); }}>Mevcut form alanlarını bu öneriyle doldur</Button>
      </div>}
    </details>
  </div>;
}
