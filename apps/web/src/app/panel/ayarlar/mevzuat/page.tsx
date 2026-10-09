"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { bugunTR, MEVZUAT_TUR_TANIMLARI, MEVZUAT_TURLERI, mevzuatDegerOzeti, type MevzuatTuru } from "@tekirextra/shared";
import { ISLEM_ADI, tarihTR } from "@/lib/mevzuat-gorunum";

interface Degisiklik { id: string; no: number; baslik: string; dayanak: string; aciklama: string | null; yururlukBaslangic: string; yayinZamani: string; satirlar: { tur: string; anahtar: string; islem: "ekle" | "degistir" | "kaldir"; deger: unknown }[] }
interface Deger { anahtar: string; deger: unknown; yururlukBaslangic: string; yururlukBitis: string | null }

const anahtarAdi = (tur: string, anahtar: string) => (MEVZUAT_TUR_TANIMLARI as Record<string, { anahtarSecenekleri?: readonly (readonly [string, string])[] }>)[tur]?.anahtarSecenekleri?.find(([k]) => k === anahtar)?.[1] ?? anahtar;
const turAdi = (tur: string) => (MEVZUAT_TUR_TANIMLARI as Record<string, { ad: string }>)[tur]?.ad ?? tur;

/**
 * MVZ-07/09: Mevzuat Merkezi'nin kiracı görünümü. Vergi ve belge mevzuatı
 * değerleri (KDV oranları, tevkifat, istisna kodları, kanuni süre ve eşikler)
 * platform ekibince merkezi yönetilir; firma burada görür, değiştiremez, eksik
 * ya da hatalı gördüğünü bildirir.
 */
function MevzuatGorunumu() {
  const vurgulu = useSearchParams().get("degisiklik");
  const [degisiklikler, setDegisiklikler] = useState<Degisiklik[]>([]);
  const [tur, setTur] = useState<MevzuatTuru>("tevkifat_kodu");
  const [tarih, setTarih] = useState(bugunTR());
  const [degerler, setDegerler] = useState<Deger[]>([]);
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState(false);

  const yukle = useCallback(async () => {
    const [d, v] = await Promise.all([api<Degisiklik[]>("/mevzuat/degisiklikler"), api<Deger[]>(`/mevzuat/kayitlar?tur=${tur}&tarih=${tarih}`)]);
    setDegisiklikler(d); setDegerler(v);
  }, [tur, tarih]);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi")); }, [yukle]);

  async function bildir(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const v = new FormData(form);
    setIslem(true); setHata(""); setBasari("");
    try {
      const s = await api<{ mesaj: string }>("/mevzuat/talepler", { method: "POST", body: JSON.stringify({ tur: v.get("tur") || null, anahtar: v.get("anahtar") || null, aciklama: v.get("aciklama") }) });
      setBasari(s.mesaj); form.reset();
    } catch (h) { setHata(h instanceof Error ? h.message : "Gönderilemedi"); } finally { setIslem(false); }
  }

  const tanim = MEVZUAT_TUR_TANIMLARI[tur];
  return <div className="production-page">
    <PageHeader title="Mevzuat" subtitle="KDV oranları, tevkifat ve istisna kodları, kanuni süre ve eşikler ile bordro parametreleri tüm firmalar için merkezi olarak güncel tutulur. Belgeleriniz kendi tarihindeki değerle hesaplanır; kesinleşmiş belgeler ve onaylı bordrolar değişmez." />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>

    <Card title="Son değişiklikler" pad={false}>
      <TableWrap>
        <thead><tr><th>Değişiklik</th><th>Yürürlük</th><th>Kalemler</th></tr></thead>
        <tbody>
          {degisiklikler.map((d) => <tr key={d.id} className={d.id === vurgulu ? "is-selected" : undefined}>
            <td><strong>{d.baslik}</strong><div className="muted">Dayanak: {d.dayanak}</div>{d.aciklama && <div className="muted">{d.aciklama}</div>}</td>
            <td>{tarihTR(d.yururlukBaslangic)}</td>
            <td><ul style={{ margin: 0, paddingLeft: "1rem" }}>{d.satirlar.map((s) => <li key={`${s.tur}/${s.anahtar}`}>{turAdi(s.tur)} {anahtarAdi(s.tur, s.anahtar)}: {ISLEM_ADI[s.islem]}{s.islem !== "kaldir" ? ` → ${mevzuatDegerOzeti(s.tur, s.deger)}` : ""}</li>)}</ul></td>
          </tr>)}
          {!degisiklikler.length && <tr><td colSpan={3}>Henüz yayınlanmış değişiklik yok.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>

    <Card title="Yürürlükteki değerler">
      <div className="form-grid">
        <Field label="Tür"><Select value={tur} onChange={(e) => setTur(e.target.value as MevzuatTuru)}>{MEVZUAT_TURLERI.map((t) => <option key={t} value={t}>{MEVZUAT_TUR_TANIMLARI[t].ad}</option>)}</Select></Field>
        <Field label="Tarih"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} /></Field>
      </div>
      <TableWrap>
        <thead><tr><th>{tanim.anahtarEtiketi}</th><th>Değer</th><th>Yürürlük</th></tr></thead>
        <tbody>
          {degerler.map((k) => <tr key={`${k.anahtar}-${k.yururlukBaslangic}`}><td><strong>{anahtarAdi(tur, k.anahtar)}</strong></td><td>{mevzuatDegerOzeti(tur, k.deger)}</td><td>{tarihTR(k.yururlukBaslangic)} – {k.yururlukBitis ? tarihTR(k.yururlukBitis) : "…"}</td></tr>)}
          {!degerler.length && <tr><td colSpan={3}>Bu tür için merkezi kayıt henüz yüklenmedi.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>

    <Card title="Eksik ya da hatalı değer bildir">
      <form className="form-grid" onSubmit={(e) => void bildir(e)}>
        <Field label="Tür (isteğe bağlı)"><Select name="tur" defaultValue=""><option value="">Seçin</option>{MEVZUAT_TURLERI.map((t) => <option key={t} value={t}>{MEVZUAT_TUR_TANIMLARI[t].ad}</option>)}</Select></Field>
        <Field label="Kod / değer (isteğe bağlı)"><Input name="anahtar" maxLength={40} placeholder="ör. 603" /></Field>
        <Field label="Açıklama"><Input name="aciklama" required minLength={10} maxLength={2000} placeholder="Ne eksik ya da hatalı, dayanağı nedir?" /></Field>
        <p className="muted">Bildiriminiz Mevzuat Merkezi ekibine iletilir. Değerler doğrulandıktan sonra tüm firmalar için güncellenir; firma tek başına değer değiştiremez.</p>
        <div><Button type="submit" variant="primary" disabled={islem}>Bildir</Button></div>
      </form>
    </Card>
  </div>;
}

export default function MevzuatSayfasi() {
  return <Suspense fallback={<p className="muted">Yükleniyor…</p>}><MevzuatGorunumu /></Suspense>;
}
