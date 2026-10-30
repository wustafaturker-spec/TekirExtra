"use client";

import { useState } from "react";
import { History, CalendarDays } from "lucide-react";
import { Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { PlatformArama, PlatformListeDurumu } from "@/components/platform-liste";
import { bugunTR, MEVZUAT_TUR_TANIMLARI, MEVZUAT_TURLERI, mevzuatDegerOzeti, type MevzuatTuru } from "@tekirextra/shared";
import { tarihTR } from "@/lib/mevzuat-gorunum";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import Link from "next/link";

interface Kayit { id: string; degisiklikId?: string | null; anahtar: string; deger: unknown; yururlukBaslangic: string; yururlukBitis: string | null; degisiklik: { no: number; baslik: string; dayanak: string } | null }

/** Belge tarihine göre yürürlükteki değerler ve anahtarın değişiklik geçmişi. */
export default function PlatformTablolari() {
  const [tur, setTur] = useState<MevzuatTuru>("tevkifat_kodu");
  const [tarih, setTarih] = useState(bugunTR());
  const [arama, setArama] = useState("");
  const [gecmisAnahtari, setGecmisAnahtari] = useState<string | null>(null);
  const tanim = MEVZUAT_TUR_TANIMLARI[tur];
  const { veri: kayitlar, yukleniyor, hata, yenile } = usePlatformVerisi<Kayit[]>(tarih ? `/platform/mevzuat/kayitlar?tur=${tur}&tarih=${tarih}` : null);
  const { veri: gecmis, yukleniyor: gecmisYukleniyor, hata: gecmisHatasi, yenile: gecmisYenile } = usePlatformVerisi<Kayit[]>(gecmisAnahtari !== null ? `/platform/mevzuat/kayitlar?tur=${tur}&anahtar=${encodeURIComponent(gecmisAnahtari)}` : null);
  const anahtarAdi = (a: string) => tanim.anahtarSecenekleri?.find(([k]) => k === a)?.[1] ?? a;
  const aranan = arama.trim().toLocaleLowerCase("tr-TR");
  const gorunen = (kayitlar ?? []).filter((k) => `${k.anahtar} ${anahtarAdi(k.anahtar)} ${mevzuatDegerOzeti(tur, k.deger)}`.toLocaleLowerCase("tr-TR").includes(aranan));
  const tarihSec = (v: string) => { setTarih(v); setGecmisAnahtari(null); };
  const kaynak = (k: Kayit) => {
    if (!k.degisiklik) return <span className="muted">İlk dolum</span>;
    const metin = `#${k.degisiklik.no} ${k.degisiklik.dayanak}`;
    return k.degisiklikId ? <Link href={`/platform/degisiklik?id=${encodeURIComponent(k.degisiklikId)}`}>{metin}</Link> : metin;
  };

  return <>
    <PageHeader title="Yürürlükteki değerler" subtitle="Bir mevzuat türü ve tarih seçin. Değerin nasıl değiştiğini görmek için anahtarın geçmişini açın." actions={<Button onClick={() => tarihSec(bugunTR())}><CalendarDays size={16} aria-hidden="true" />Bugüne dön</Button>} />
    <Card title="Görünümü seçin">
      <div className="platform-value-filters">
        <Field label="Mevzuat türü"><Select value={tur} onChange={(e) => { setTur(e.target.value as MevzuatTuru); setArama(""); setGecmisAnahtari(null); }}>{MEVZUAT_TURLERI.map((t) => <option key={t} value={t}>{MEVZUAT_TUR_TANIMLARI[t].ad}</option>)}</Select></Field>
        <Field label="Geçerlilik tarihi"><Input type="date" value={tarih} onChange={(e) => tarihSec(e.target.value)} required /></Field>
      </div>
      <p className="platform-field-help">Her belge, kendi tarihindeki mevzuat değerini kullanır. Geçmiş veya gelecek bir tarihi inceleyebilirsiniz.</p>
    </Card>
    <Card title={tanim.ad} className="platform-values" pad={false}>
      <div className="platform-list-tools">
        <PlatformArama etiket="Değer ara" deger={arama} onChange={setArama} placeholder="Anahtar veya değer ara…" />
        <span className="muted" role="status">{!tarih ? "Tarih seçin" : yukleniyor ? "Yükleniyor…" : hata ? "Liste alınamadı" : `${tarihTR(tarih)} · ${gorunen.length} kayıt`}</span>
      </div>
      <TableWrap className="platform-responsive-table platform-value-table">
        <thead><tr><th>{tanim.anahtarEtiketi}</th><th>Değer</th><th>Yürürlük</th><th>Kaynak</th></tr></thead>
        <tbody>
          {!yukleniyor && !hata && gorunen.map((k) => <tr key={k.id}>
            <td data-label={tanim.anahtarEtiketi}><Button size="sm" variant="ghost" aria-label={`${anahtarAdi(k.anahtar)} geçmişini göster`} aria-expanded={gecmisAnahtari === k.anahtar} onClick={() => setGecmisAnahtari(k.anahtar)}><History size={14} aria-hidden="true" />{anahtarAdi(k.anahtar)}</Button></td>
            <td data-label="Değer">{mevzuatDegerOzeti(tur, k.deger)}</td>
            <td data-label="Yürürlük">{tarihTR(k.yururlukBaslangic)} – {k.yururlukBitis ? tarihTR(k.yururlukBitis) : "Devam ediyor"}</td>
            <td data-label="Kaynak" className="muted">{kaynak(k)}</td>
          </tr>)}
          <PlatformListeDurumu sutun={4} yukleniyor={yukleniyor} hata={hata} bos={!gorunen.length} baslik={!tarih ? "Bir geçerlilik tarihi seçin." : aranan ? "Aramanıza uygun değer yok." : "Bu tarihte yürürlükte kayıt yok."} aciklama={aranan ? "Arama metnini değiştirerek yeniden deneyin." : "Mevzuat türünü veya tarihi değiştirerek diğer değerleri inceleyin."} onTekrar={yenile} />
        </tbody>
      </TableWrap>
    </Card>
    {gecmisAnahtari !== null && <Card title={`${anahtarAdi(gecmisAnahtari)} — geçmiş`} pad={false} className="platform-value-history" actions={<Button size="sm" onClick={() => setGecmisAnahtari(null)}>Geçmişi kapat</Button>}>
      <TableWrap className="platform-responsive-table">
        <thead><tr><th>Değer</th><th>Yürürlük</th><th>Kaynak</th></tr></thead>
        <tbody>
          {!gecmisYukleniyor && !gecmisHatasi && gecmis?.map((k) => <tr key={k.id}><td data-label="Değer">{mevzuatDegerOzeti(tur, k.deger)}</td><td data-label="Yürürlük">{tarihTR(k.yururlukBaslangic)} – {k.yururlukBitis ? tarihTR(k.yururlukBitis) : "Devam ediyor"}</td><td data-label="Kaynak">{kaynak(k)}</td></tr>)}
          <PlatformListeDurumu sutun={3} yukleniyor={gecmisYukleniyor} hata={gecmisHatasi} bos={!gecmis?.length} baslik="Bu anahtar için geçmiş kaydı yok." onTekrar={gecmisYenile} />
        </tbody>
      </TableWrap>
    </Card>}
  </>;
}
