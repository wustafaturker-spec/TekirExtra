"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Segmented, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

import { DURUM_ADI, DURUM_ROZETI, tarihTR, type MevzuatDurum as Durum } from "@/lib/mevzuat-gorunum";

interface Degisiklik { id: string; no: number; baslik: string; dayanak: string; yururlukBaslangic: string; durum: Durum; satirSayisi: number; yayinZamani: string | null; hazirlayan: { adSoyad: string }; yayinlayan: { adSoyad: string } | null; retGerekcesi: string | null }


/** MVZ-05: değişiklik listesi ve yeni değişiklik taslağı. */
export default function PlatformDegisiklikleri() {
  const yonlendir = useRouter();
  const [liste, setListe] = useState<Degisiklik[]>([]);
  const [durum, setDurum] = useState<Durum | "hepsi">("hepsi");
  const [hata, setHata] = useState("");
  const [islem, setIslem] = useState(false);

  const yukle = useCallback(async () => {
    setListe(await platformApi<Degisiklik[]>(`/platform/mevzuat/degisiklikler${durum === "hepsi" ? "" : `?durum=${durum}`}`));
  }, [durum]);
  useEffect(() => { if (platformTokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Liste yüklenemedi")); }, [yukle]);

  async function olustur(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = new FormData(e.currentTarget);
    setIslem(true); setHata("");
    try {
      const d = await platformApi<{ id: string }>("/platform/mevzuat/degisiklikler", {
        method: "POST",
        body: JSON.stringify({ baslik: v.get("baslik"), dayanak: v.get("dayanak"), yururlukBaslangic: v.get("yururlukBaslangic"), aciklama: v.get("aciklama") || null }),
      });
      yonlendir.push(`/platform/degisiklik?id=${d.id}`);
    } catch (h) { setHata(h instanceof Error ? h.message : "Oluşturulamadı"); } finally { setIslem(false); }
  }

  return <>
    <PageHeader title="Mevzuat değişiklikleri" subtitle="Her değişiklik bir düzenlemedir (tebliğ, kılavuz): dayanağı ve yürürlük tarihiyle hazırlanır, onaya gönderilir, başka bir platform yetkilisi yayınlar. Yayınlanan değişiklik tüm kiracılar için geçerlidir ve değiştirilemez." />
    <Alert tone="error">{hata}</Alert>
    <Card title="Değişiklikler" actions={<Segmented ariaLabel="Durum" value={durum} onChange={setDurum} items={[{ deger: "hepsi", baslik: "Hepsi" }, { deger: "taslak", baslik: "Taslak" }, { deger: "onay_bekliyor", baslik: "Onay bekliyor" }, { deger: "yayinlandi", baslik: "Yayınlandı" }]} />} pad={false}>
      <TableWrap>
        <thead><tr><th>No</th><th>Başlık</th><th>Dayanak</th><th>Yürürlük</th><th>Kalem</th><th>Durum</th><th>Hazırlayan / Yayınlayan</th></tr></thead>
        <tbody>
          {liste.map((d) => <tr key={d.id}>
            <td>{d.no}</td>
            <td><Link href={`/platform/degisiklik?id=${d.id}`}><strong>{d.baslik}</strong></Link>{d.durum === "taslak" && d.retGerekcesi && <div className="muted">Geri çevrildi: {d.retGerekcesi}</div>}</td>
            <td className="muted">{d.dayanak}</td>
            <td>{tarihTR(d.yururlukBaslangic)}</td>
            <td>{d.satirSayisi}</td>
            <td><Badge variant={DURUM_ROZETI[d.durum]}>{DURUM_ADI[d.durum]}</Badge></td>
            <td className="muted">{d.hazirlayan.adSoyad}{d.yayinlayan ? ` / ${d.yayinlayan.adSoyad}` : ""}</td>
          </tr>)}
          {!liste.length && <tr><td colSpan={7}>Kayıt yok.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>
    <Card title="Yeni değişiklik">
      <form className="form-grid" onSubmit={(e) => void olustur(e)}>
        <Field label="Başlık"><Input name="baslik" required minLength={3} maxLength={200} placeholder="ör. KDV tevkifat oranları güncellemesi" /></Field>
        <Field label="Mevzuat dayanağı"><Input name="dayanak" required minLength={5} maxLength={500} placeholder="ör. KDVGUT değişikliği, Seri No: 50, RG 02.03.2024" /></Field>
        <Field label="Yürürlük başlangıcı"><Input name="yururlukBaslangic" type="date" required /></Field>
        <Field label="Açıklama (isteğe bağlı)"><Input name="aciklama" maxLength={2000} /></Field>
        <div><Button type="submit" variant="primary" disabled={islem}>Taslak oluştur</Button></div>
      </form>
    </Card>
  </>;
}
