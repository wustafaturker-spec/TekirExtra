"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Tarih } from "@/components/ui";

type Tetikleyici = "ZAMANLANMIS" | "VADE_GECIKMESI" | "KASA_KRITIK";
type Tur = "ASISTAN" | "NAKIT_TAHSILAT";
interface Gorev {
  id: string; ad: string; tur: Tur; tetikleyici: Tetikleyici; saat: string; gunler: number[]; esikTutar: number | null;
  gorevTalimati: string; aktif: boolean; sahip: string | null; sonCalisma: string | null; sonSonuc: string | null;
}

/** AI-23 */
const TUR_ADI: Record<Tur, string> = {
  ASISTAN: "Asistana talimat",
  NAKIT_TAHSILAT: "Nakit ve tahsilat analizi",
};

const GUNLER = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const TETIK_ADI: Record<Tetikleyici, string> = {
  ZAMANLANMIS: "Zamanlanmış",
  VADE_GECIKMESI: "Vadesi geçen alacak varken",
  KASA_KRITIK: "Nakit eşiğin altındayken",
};

function zamanMetni(g: Pick<Gorev, "saat" | "gunler">) {
  const gunler = g.gunler.length ? g.gunler.map((x) => GUNLER[x - 1]).join(", ") : "her gün";
  return `${gunler} ${g.saat}`;
}

/**
 * AI-16: görev, oluşturanın kimliği ve rolüyle asistanı yalnız okuma
 * araçlarıyla çalıştırır; hiçbir şey yazamaz/gönderemez. Sonuç sahibine
 * bildirim olarak gelir (e-posta bildirim tercihine göre). AI-23: nakit ve
 * tahsilat analizi modelsiz çalışır, sonucu nakit akışı ekranına da yazar.
 */
export function YzGorevlerKart() {
  const [liste, setListe] = useState<Gorev[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [form, setForm] = useState<{ ad: string; tur: Tur; tetikleyici: Tetikleyici; saat: string; gunler: number[]; esik: string; talimat: string } | null>(null);
  const [sonuc, setSonuc] = useState<{ ad: string; metin: string } | null>(null);
  const [calisan, setCalisan] = useState<string | null>(null);

  const yukle = useCallback(() => {
    api<Gorev[]>("/ai/gorevler").then(setListe).catch((e) => setHata(e instanceof Error ? e.message : "Görevler yüklenemedi"));
  }, []);
  useEffect(yukle, [yukle]);

  async function kaydet() {
    if (!form) return;
    setHata(null);
    try {
      await api("/ai/gorevler", {
        method: "POST",
        body: JSON.stringify({
          ad: form.ad, tur: form.tur, tetikleyici: form.tetikleyici, saat: form.saat, gunler: form.gunler,
          ...(form.tur === "ASISTAN" ? { gorevTalimati: form.talimat } : {}),
          esikTutar: form.tetikleyici === "KASA_KRITIK" ? Number(form.esik) : null,
        }),
      });
      setForm(null);
      yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Görev kaydedilemedi");
    }
  }

  async function calistir(g: Gorev) {
    setCalisan(g.id); setHata(null);
    try {
      const r = await api<{ ad: string; raporIcerigi: string }>(`/ai/gorevler/${g.id}/calistir`, { method: "POST" });
      setSonuc({ ad: r.ad, metin: r.raporIcerigi });
      yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Görev çalıştırılamadı");
    } finally {
      setCalisan(null);
    }
  }

  async function aktiflik(g: Gorev) {
    await api(`/ai/gorevler/${g.id}`, { method: "PUT", body: JSON.stringify({ aktif: !g.aktif }) }).catch((e) => setHata(e instanceof Error ? e.message : "Güncellenemedi"));
    yukle();
  }

  async function sil(g: Gorev) {
    if (!window.confirm(`“${g.ad}” görevi silinsin mi?`)) return;
    await api(`/ai/gorevler/${g.id}`, { method: "DELETE" }).catch((e) => setHata(e instanceof Error ? e.message : "Silinemedi"));
    yukle();
  }

  return (
    <Card
      title="Yapay zekâ görevleri"
      actions={<Button size="sm" variant="primary" onClick={() => setForm({ ad: "", tur: "ASISTAN", tetikleyici: "ZAMANLANMIS", saat: "09:00", gunler: [], esik: "", talimat: "" })}>Yeni görev</Button>}
    >
      <p className="muted yz-gorev__not">Görev, oluşturan kişinin yetkisiyle yalnız okur; kayıt açamaz, gönderemez. Asistan görevi talimatı dil modeline verir; nakit ve tahsilat analizi modelsiz hesaplanır ve nakit akışı ekranında da görünür. Sonuç size bildirim olarak gelir; e-posta bildirim tercihinize göre gider.</p>
      {hata && <Alert tone="error">{hata}</Alert>}
      {liste.length === 0 ? <p className="muted">Henüz görev yok.</p> : (
        <ul className="yz-gorev">
          {liste.map((g) => (
            <li key={g.id}>
              <div>
                <strong>{g.ad}</strong> <Badge variant={g.aktif ? "success" : "neutral"}>{g.aktif ? "Etkin" : "Durduruldu"}</Badge>
                <div className="subtle">{TETIK_ADI[g.tetikleyici]}{g.tetikleyici === "KASA_KRITIK" && g.esikTutar ? ` (${g.esikTutar.toLocaleString("tr-TR")} TL)` : ""} · {zamanMetni(g)}{g.sahip ? ` · ${g.sahip}` : ""}</div>
                <div className="subtle">{g.tur === "ASISTAN" ? `“${g.gorevTalimati}”` : TUR_ADI[g.tur]}</div>
                {g.sonCalisma && <div className="subtle">Son çalışma <Tarih deger={g.sonCalisma} saatli />{g.sonSonuc ? ` — ${g.sonSonuc.slice(0, 140)}${g.sonSonuc.length > 140 ? "…" : ""}` : ""}</div>}
              </div>
              <div className="row-tight">
                <Button size="sm" disabled={calisan === g.id} onClick={() => void calistir(g)}>{calisan === g.id ? "Çalışıyor…" : "Şimdi çalıştır"}</Button>
                <Button size="sm" onClick={() => void aktiflik(g)}>{g.aktif ? "Durdur" : "Başlat"}</Button>
                <Button size="sm" variant="danger" onClick={() => void sil(g)}>Sil</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <Modal baslik="Yeni yapay zekâ görevi" onKapat={() => setForm(null)}>
          <div className="stack">
            <Field label="Görev adı"><Input value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Ör. Sabah tahsilat özeti" /></Field>
            <Field label="Görev türü">
              <Select value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value as Tur })}>
                {(Object.keys(TUR_ADI) as Tur[]).map((t) => <option key={t} value={t}>{TUR_ADI[t]}</option>)}
              </Select>
            </Field>
            <Field label="Ne zaman">
              <Select value={form.tetikleyici} onChange={(e) => setForm({ ...form, tetikleyici: e.target.value as Tetikleyici })}>
                {(Object.keys(TETIK_ADI) as Tetikleyici[]).map((t) => <option key={t} value={t}>{TETIK_ADI[t]}</option>)}
              </Select>
            </Field>
            {form.tetikleyici === "KASA_KRITIK" && <Field label="Nakit eşiği (TL)"><Input min={1} type="number" value={form.esik} onChange={(e) => setForm({ ...form, esik: e.target.value })} /></Field>}
            <Field label="Saat (Türkiye)"><Input type="time" value={form.saat} onChange={(e) => setForm({ ...form, saat: e.target.value })} /></Field>
            <Field label="Günler (seçilmezse her gün)">
              <div className="row-tight">
                {GUNLER.map((ad, i) => (
                  <label className="check-row" key={ad}>
                    <input type="checkbox" checked={form.gunler.includes(i + 1)} onChange={(e) => setForm({ ...form, gunler: e.target.checked ? [...form.gunler, i + 1].sort() : form.gunler.filter((x) => x !== i + 1) })} /> {ad}
                  </label>
                ))}
              </div>
            </Field>
            {form.tur === "ASISTAN" ? (
              <Field label="Talimat">
                <textarea className="textarea" maxLength={2000} rows={4} value={form.talimat} onChange={(e) => setForm({ ...form, talimat: e.target.value })} placeholder="Ör. Bugün aranması gereken ilk 5 cariyi ve vadesi geçen toplam alacağı özetle." />
              </Field>
            ) : (
              <p className="muted">30 günlük nakit akışı tahmini, vadesi geçen alacaklar ve tahsilat öncelikleri ekrandaki hesapla okunur; dil modeli kullanılmaz.</p>
            )}
            <div className="row-tight" style={{ justifyContent: "flex-end" }}>
              <Button onClick={() => setForm(null)}>Vazgeç</Button>
              <Button variant="primary" disabled={form.ad.trim().length < 2 || (form.tur === "ASISTAN" && form.talimat.trim().length < 5)} onClick={() => void kaydet()}>Kaydet</Button>
            </div>
          </div>
        </Modal>
      )}

      {sonuc && (
        <Modal baslik={`Görev sonucu: ${sonuc.ad}`} genis onKapat={() => setSonuc(null)}>
          <div className="yz-gorev__sonuc">{sonuc.metin}</div>
        </Modal>
      )}
    </Card>
  );
}
