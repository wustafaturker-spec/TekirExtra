"use client";

import { useEffect, useState } from "react";
import { AKTARIM_ALANLARI, HAZIR_AKTARIM_PROFILLERI, type AktarimAlani, type AktarimProfili } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

/**
 * MUH-06: aktarım dosyasının biçimi. Mali müşavirin programı hangi sütunları
 * hangi sırayla ve hangi başlıkla istiyorsa burada kurulur; hazır profil
 * başlangıç noktasıdır.
 */
export function DosyaProfili() {
  const [profil, setProfil] = useState<AktarimProfili | null>(null);
  const [mesaj, setMesaj] = useState<{ tur: "success" | "error"; metin: string } | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    void api<{ profil: AktarimProfili }>("/mali-musavir/muhasebe/ayarlar").then((a) => setProfil(a.profil)).catch((e) => setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Profil okunamadı" }));
  }, []);
  if (!profil) return mesaj ? <Alert tone={mesaj.tur}>{mesaj.metin}</Alert> : null;

  const guncelle = (p: Partial<AktarimProfili>) => setProfil({ ...profil, ...p });
  const sutunlar = profil.sutunlar;
  const tasi = (i: number, yon: -1 | 1) => {
    const yeni = [...sutunlar];
    [yeni[i], yeni[i + yon]] = [yeni[i + yon], yeni[i]];
    guncelle({ sutunlar: yeni });
  };
  const eklenebilir = (Object.keys(AKTARIM_ALANLARI) as AktarimAlani[]).filter((a) => !sutunlar.some((s) => s.alan === a));

  async function kaydet() {
    setKaydediliyor(true);
    setMesaj(null);
    try {
      const a = await api<{ profil: AktarimProfili }>("/mali-musavir/muhasebe/ayarlar/profil", { method: "PUT", body: JSON.stringify(profil) });
      setProfil(a.profil);
      setMesaj({ tur: "success", metin: "Dosya profili kaydedildi; Excel ve CSV aktarımı bu sütunlarla üretilir." });
    } catch (e) {
      setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Kaydedilemedi" });
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <Card
      title={<div><span className="muh-ust">DOSYA</span><h2>Aktarım dosyası profili</h2><small>Luca profili programın Excel'den fiş aktarımına göre hazırlandı; ilk aktarımı mali müşavirinizle birlikte deneyin.</small></div>}
      actions={<Button variant="primary" size="sm" onClick={() => void kaydet()} disabled={kaydediliyor || !sutunlar.length}>{kaydediliyor ? "Kaydediliyor…" : "Kaydet"}</Button>}
    >
      {mesaj && <Alert tone={mesaj.tur}>{mesaj.metin}</Alert>}
      <div className="muh-profil-ayar">
        <Field label="Hazır profilden başla">
          <Select value="" onChange={(e) => e.target.value && setProfil(structuredClone(HAZIR_AKTARIM_PROFILLERI[e.target.value as "genel" | "luca"]))}>
            <option value="">Seçin…</option>
            <option value="genel">{HAZIR_AKTARIM_PROFILLERI.genel.ad}</option>
            <option value="luca">{HAZIR_AKTARIM_PROFILLERI.luca.ad}</option>
          </Select>
        </Field>
        <Field label="Profil adı"><Input value={profil.ad} maxLength={60} onChange={(e) => guncelle({ ad: e.target.value })} /></Field>
        <Field label="Varsayılan biçim">
          <Select value={profil.bicim} onChange={(e) => guncelle({ bicim: e.target.value as AktarimProfili["bicim"] })}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></Select>
        </Field>
        <Field label="Tarih biçimi">
          <Select value={profil.tarihBicimi} onChange={(e) => guncelle({ tarihBicimi: e.target.value as AktarimProfili["tarihBicimi"] })}><option value="GG.AA.YYYY">GG.AA.YYYY</option><option value="YYYY-AA-GG">YYYY-AA-GG</option></Select>
        </Field>
        <Field label="Ondalık ayırıcı (CSV)">
          <Select value={profil.ondalik} onChange={(e) => guncelle({ ondalik: e.target.value as AktarimProfili["ondalik"] })}><option value=",">Virgül (1234,56)</option><option value=".">Nokta (1234.56)</option></Select>
        </Field>
        <Field label="CSV sütun ayırıcı">
          <Select value={profil.csvAyirici} onChange={(e) => guncelle({ csvAyirici: e.target.value as AktarimProfili["csvAyirici"] })}><option value=";">Noktalı virgül</option><option value=",">Virgül</option><option value={"\t"}>Sekme</option></Select>
        </Field>
      </div>

      <h3 className="muh-alt-baslik">Sütunlar</h3>
      <ol className="muh-sutunlar">
        {sutunlar.map((s, i) => (
          <li key={s.alan}>
            <span className="muh-sira">{i + 1}</span>
            <span className="muh-alan">{AKTARIM_ALANLARI[s.alan]}</span>
            <Input aria-label={`${AKTARIM_ALANLARI[s.alan]} başlığı`} value={s.baslik} maxLength={60} onChange={(e) => guncelle({ sutunlar: sutunlar.map((x, j) => (j === i ? { ...x, baslik: e.target.value } : x)) })} />
            <Button size="sm" aria-label="Yukarı taşı" disabled={i === 0} onClick={() => tasi(i, -1)}>↑</Button>
            <Button size="sm" aria-label="Aşağı taşı" disabled={i === sutunlar.length - 1} onClick={() => tasi(i, 1)}>↓</Button>
            <Button size="sm" variant="danger" aria-label="Sütunu çıkar" onClick={() => guncelle({ sutunlar: sutunlar.filter((_, j) => j !== i) })}>×</Button>
          </li>
        ))}
      </ol>
      {eklenebilir.length > 0 && (
        <Select aria-label="Sütun ekle" value="" onChange={(e) => { const a = e.target.value as AktarimAlani; if (a) guncelle({ sutunlar: [...sutunlar, { alan: a, baslik: AKTARIM_ALANLARI[a] }] }); }} style={{ maxWidth: 280 }}>
          <option value="">+ Sütun ekle</option>
          {eklenebilir.map((a) => <option key={a} value={a}>{AKTARIM_ALANLARI[a]}</option>)}
        </Select>
      )}
    </Card>
  );
}
