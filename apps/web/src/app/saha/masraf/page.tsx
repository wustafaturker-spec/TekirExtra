"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { gorselKucult } from "@/lib/gorsel-kucult";
import { kuyrugaEkle } from "@/lib/saha-depo";
import type { MasrafSonucu, SoruOzeti } from "@/lib/saha-kuyruk";
import { useSaha } from "../saha-baglam";

/** Sonuç metnindeki panel bağlantıları tıklanabilir yazılır. */
function Metin({ metin }: { metin: string }) {
  return (
    <p className="saha-metin">
      {metin.split(/(https?:\/\/\S+)/).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p.replace(/^https?:\/\/[^/]+/, "")}>panelde aç</a> : <span key={i}>{p}</span>))}
    </p>
  );
}

/** SAH-08: kameradan masraf fişi; taslak CNL-16/21/22 kurallarıyla açılır, kesinleştirme panelde. */
export default function SahaMasrafSayfasi() {
  const { sahip, cevrimici, gonder, kuyrukYenile } = useSaha();
  const [foto, setFoto] = useState<Blob | null>(null);
  const [onizleme, setOnizleme] = useState("");
  const [not, setNot] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [sonuclar, setSonuclar] = useState<string[]>([]);
  const [soru, setSoru] = useState<SoruOzeti | null>(null);

  async function sec(dosya: File | undefined) {
    if (!dosya) return;
    setHata(""); setSonuclar([]); setSoru(null);
    const b = await gorselKucult(dosya);
    if (b.size > 6 * 1024 * 1024) { setHata("Fotoğraf 6 MB'tan büyük; daha düşük çözünürlükte çekin."); return; }
    setFoto(b);
    setOnizleme((eski) => { if (eski) URL.revokeObjectURL(eski); return URL.createObjectURL(b); });
  }

  function sonucuGoster(s: MasrafSonucu) {
    if (s.sonuc) setSonuclar((l) => [...l, s.sonuc]);
    setSoru(s.soru ?? null);
  }

  async function gonderFis() {
    if (!sahip || !foto) return;
    setIsleniyor(true); setHata("");
    const id = crypto.randomUUID();
    try {
      await kuyrugaEkle({ id, sahip, tur: "masraf", olusturma: Date.now(), baslik: not.trim() || "Fiş fotoğrafı", durum: "bekliyor", deneme: 0, veri: { foto, dosyaAdi: "saha-fis.jpg", not: not.trim() } });
      await kuyrukYenile();
      setFoto(null); setNot("");
      if (!cevrimici) { setSonuclar(["Fiş cihazda kuyruğa alındı; bağlantı gelince okunup taslak açılacak."]); return; }
      const g = (await gonder(id)).find((x) => x.is.id === id);
      if (g?.tur === "masraf") sonucuGoster(g.sonuc);
      else setSonuclar(["Fiş kuyrukta; gönderilemedi. Saha ana sayfasından yeniden deneyebilirsiniz."]);
    } catch (e) { setHata(e instanceof Error ? e.message : "Fiş gönderilemedi"); } finally { setIsleniyor(false); }
  }

  async function yanitla(kod: string) {
    if (!soru) return;
    setIsleniyor(true); setHata("");
    try {
      const r = await api<{ sonuc: string; sonrakiSoru?: SoruOzeti }>(`/ai/sorular/${soru.id}/yanit`, { method: "POST", body: JSON.stringify({ kod }) });
      sonucuGoster({ sonuc: r.sonuc, ...(r.sonrakiSoru ? { soru: r.sonrakiSoru } : {}) });
    } catch (e) { setHata(e instanceof Error ? e.message : "Yanıt işlenemedi"); } finally { setIsleniyor(false); }
  }

  return (
    <div className="saha-masraf">
      <h1>Masraf fişi</h1>
      {hata && <Alert tone="error">{hata}</Alert>}
      <section className="saha-kart">
        <label className="saha-foto">
          <input type="file" accept="image/*" capture="environment" onChange={(e) => void sec(e.target.files?.[0])} />
          {onizleme && foto ? <img src={onizleme} alt="Fiş önizlemesi" /> : <span>📷 Fişin fotoğrafını çek</span>}
        </label>
        <Field label="Not (isteğe bağlı)"><Input value={not} maxLength={300} onChange={(e) => setNot(e.target.value)} placeholder="Ör. Ankara yolu yakıt" /></Field>
        <Button variant="primary" block disabled={!foto || isleniyor} onClick={() => void gonderFis()}>{isleniyor ? "Okunuyor… (1 dakikaya kadar sürebilir)" : "Gönder ve taslak aç"}</Button>
        {!cevrimici && <small className="muted">Çevrimdışısınız; fiş cihazda bekler, bağlantı gelince gönderilir.</small>}
      </section>

      {(sonuclar.length > 0 || soru) && (
        <section className="saha-kart" aria-live="polite">
          {sonuclar.map((m, i) => <Metin key={i} metin={m} />)}
          {soru && (
            <>
              <Metin metin={soru.soru} />
              <div className="saha-secenekler">
                {soru.secenekler.filter((s) => s.kod !== "panel").map((s) => <Button key={s.kod} disabled={isleniyor} onClick={() => void yanitla(s.kod)}>{s.etiket}</Button>)}
              </div>
              <small className="muted">Şimdi yanıtlamazsanız soru panelde Asistan › Sorular kutusunda bekler.</small>
            </>
          )}
        </section>
      )}
    </div>
  );
}
