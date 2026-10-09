"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { bugunTR, MEVZUAT_TUR_TANIMLARI, MEVZUAT_TURLERI, mevzuatDegerOzeti, type MevzuatTuru } from "@tekirextra/shared";
import { tarihTR } from "@/lib/mevzuat-gorunum";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

interface Kayit { id: string; anahtar: string; deger: unknown; yururlukBaslangic: string; yururlukBitis: string | null; degisiklik: { no: number; baslik: string; dayanak: string } | null }

/** MVZ-01/02: bir türün belirli tarihte yürürlükteki değerleri; anahtara tıklayınca geçmişi. */
export default function PlatformTablolari() {
  const [tur, setTur] = useState<MevzuatTuru>("tevkifat_kodu");
  const [tarih, setTarih] = useState(bugunTR());
  const [kayitlar, setKayitlar] = useState<Kayit[]>([]);
  const [gecmis, setGecmis] = useState<{ anahtar: string; kayitlar: Kayit[] } | null>(null);
  const [hata, setHata] = useState("");
  const tanim = MEVZUAT_TUR_TANIMLARI[tur];

  const yukle = useCallback(async () => {
    setKayitlar(await platformApi<Kayit[]>(`/platform/mevzuat/kayitlar?tur=${tur}&tarih=${tarih}`));
    setGecmis(null);
  }, [tur, tarih]);
  useEffect(() => { if (platformTokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi")); }, [yukle]);
  const gecmisAc = async (anahtar: string) => setGecmis({ anahtar, kayitlar: await platformApi<Kayit[]>(`/platform/mevzuat/kayitlar?tur=${tur}&anahtar=${encodeURIComponent(anahtar)}`) });
  const anahtarAdi = (a: string) => tanim.anahtarSecenekleri?.find(([k]) => k === a)?.[1] ?? a;

  return <>
    <PageHeader title="Yürürlükteki değerler" subtitle="Belge kendi tarihindeki değeri kullanır. Tarihi değiştirerek geçmişte ya da ileride yürürlükte olan değerleri görebilirsiniz." />
    <Alert tone="error">{hata}</Alert>
    <Card>
      <div className="form-grid">
        <Field label="Tür"><Select value={tur} onChange={(e) => setTur(e.target.value as MevzuatTuru)}>{MEVZUAT_TURLERI.map((t) => <option key={t} value={t}>{MEVZUAT_TUR_TANIMLARI[t].ad}</option>)}</Select></Field>
        <Field label="Tarih"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} /></Field>
      </div>
    </Card>
    <Card title={`${tanim.ad} — ${tarihTR(tarih)}`} pad={false}>
      <TableWrap>
        <thead><tr><th>{tanim.anahtarEtiketi}</th><th>Değer</th><th>Yürürlük</th><th>Kaynak</th></tr></thead>
        <tbody>
          {kayitlar.map((k) => <tr key={k.id}>
            <td><Button size="sm" variant="ghost" onClick={() => void gecmisAc(k.anahtar)}>{anahtarAdi(k.anahtar)}</Button></td>
            <td>{mevzuatDegerOzeti(tur, k.deger)}</td>
            <td>{tarihTR(k.yururlukBaslangic)} – {k.yururlukBitis ? tarihTR(k.yururlukBitis) : "…"}</td>
            <td className="muted">{k.degisiklik ? `#${k.degisiklik.no} ${k.degisiklik.dayanak}` : "İlk dolum"}</td>
          </tr>)}
          {!kayitlar.length && <tr><td colSpan={4}>Bu tarihte yürürlükte kayıt yok.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>
    {gecmis && <Card title={`${anahtarAdi(gecmis.anahtar)} — geçmiş`} pad={false}>
      <TableWrap>
        <thead><tr><th>Değer</th><th>Yürürlük</th><th>Kaynak</th></tr></thead>
        <tbody>{gecmis.kayitlar.map((k) => <tr key={k.id}><td>{mevzuatDegerOzeti(tur, k.deger)}</td><td>{tarihTR(k.yururlukBaslangic)} – {k.yururlukBitis ? tarihTR(k.yururlukBitis) : "…"}</td><td className="muted">{k.degisiklik ? `#${k.degisiklik.no} ${k.degisiklik.baslik} — ${k.degisiklik.dayanak}` : "İlk dolum"}</td></tr>)}</tbody>
      </TableWrap>
    </Card>}
  </>;
}
