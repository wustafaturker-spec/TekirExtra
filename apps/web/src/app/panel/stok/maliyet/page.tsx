"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Card, PageHeader, Para, Stat, StatGrid, Table } from "@/components/ui";

interface Kart { stokId: string; kod: string; ad: string; mevcut: string; eskiOrtalama: string; yeniOrtalama: string; eskiDeger: string; yeniDeger: string; degisenHareket: number; uretimSarfiDegisen: number; tanimsizBirimler: string[] }
interface Sonuc { acikBaslangic: string | null; kartlar: Kart[]; degisenHareket: number; uretimSarfiDegisen: number; eskiDeger: string; yeniDeger: string; degerFarki: string }
const miktar = (v: string) => Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 3 });

/** STK-28: hareketleri baştan işleyip stok maliyetlerini düzeltir; önce önizleme, sonra onayla uygulama. */
export default function StokMaliyetSayfasi() {
  const [onizleme, setOnizleme] = useState<Sonuc | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const yukle = useCallback(async () => {
    try { setYukleniyor(true); setHata(null); setOnizleme(await api<Sonuc>("/stok/maliyet/yeniden-hesapla")); }
    catch (e) { setHata(e instanceof ApiHata && e.durum === 403 ? "Bu işlem yalnız yönetici rolüne açıktır." : e instanceof Error ? e.message : "Önizleme alınamadı"); }
    finally { setYukleniyor(false); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const uygula = async () => {
    if (!onizleme?.kartlar.length) return;
    if (!window.confirm(`${onizleme.kartlar.length} kartın ortalama maliyeti ve ${onizleme.degisenHareket} hareketin maliyeti yeniden yazılacak. İşlem denetim kaydına geçer. Devam edilsin mi?`)) return;
    try {
      setYukleniyor(true); setHata(null);
      const r = await api<Sonuc>("/stok/maliyet/yeniden-hesapla", { method: "POST", body: "{}" });
      setBilgi(`${r.kartlar.length} kartın maliyeti düzeltildi (${r.degisenHareket} hareket).`);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Yeniden hesaplama yapılamadı"); }
    finally { setYukleniyor(false); }
  };

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/stok">← Stok kartları</Link>
      <PageHeader
        title="Maliyeti yeniden hesapla"
        subtitle="Stok hareketleri tarih sırasıyla yeniden işlenir: alış maliyeti faturanın net TL tutarından, satış iadesi çıktığı maliyetten, alış iadesi ve iptaller alış maliyetinden gelir; çıkışlar o günkü ortalamayla, sayım düzeltmeleri sayım onayındaki kuralla yeniden yazılır. Elle girişler, açılış ve üretim girişleri olduğu gibi kalır. Hareketin eski maliyeti geçmişe kaydedilir."
        actions={<>
          <Button disabled={yukleniyor} onClick={() => void yukle()}>Önizlemeyi yenile</Button>
          <Button variant="primary" disabled={yukleniyor || !onizleme?.kartlar.length} onClick={() => void uygula()}>{yukleniyor ? "Çalışıyor…" : "Uygula"}</Button>
        </>}
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{bilgi}</Alert>
      {onizleme && <>
        {onizleme.acikBaslangic && <Alert tone="warning">Kapalı dönem nedeniyle {onizleme.acikBaslangic.split("-").reverse().join(".")} öncesindeki hareketlerin maliyeti değişmez; ortalamaya kayıtlı maliyetleriyle girer.</Alert>}
        {onizleme.uretimSarfiDegisen > 0 && <Alert tone="warning">{onizleme.uretimSarfiDegisen} üretim sarfının maliyeti değişiyor; üretim emirlerinin kayıtlı maliyetleri yeniden hesaplanmaz, ilgili emirleri gözden geçirin.</Alert>}
        <StatGrid>
          <Stat label="Değişecek kart" value={onizleme.kartlar.length} hint={`${onizleme.degisenHareket} hareketin maliyeti`} />
          <Stat label="Envanter değeri (şimdi)" value={<Para deger={onizleme.eskiDeger} />} hint="Değişecek kartların" />
          <Stat label="Envanter değeri (sonra)" value={<Para deger={onizleme.yeniDeger} />} hint={<>Fark <Para deger={onizleme.degerFarki} /></>} tone="accent" />
        </StatGrid>
        <Card pad={false}>
          <Table>
            <thead><tr><th>Ürün</th><th className="num">Mevcut</th><th className="num">Ortalama (şimdi → sonra)</th><th className="num">Değer (şimdi → sonra)</th><th className="num">Değişen hareket</th></tr></thead>
            <tbody>
              {onizleme.kartlar.map((k) => (
                <tr key={k.stokId}>
                  <td><Link href={`/panel/stok/${k.stokId}`}><strong>{k.kod}</strong></Link> <span className="muted">{k.ad}</span>{k.tanimsizBirimler.length > 0 && <><br /><small style={{ color: "var(--warning)" }}>Kartta tanımsız birimle fatura satırı: {k.tanimsizBirimler.join(", ")} (katsayı 1 sayıldı)</small></>}</td>
                  <td className="num">{miktar(k.mevcut)}</td>
                  <td className="num"><Para deger={k.eskiOrtalama} /> → <strong><Para deger={k.yeniOrtalama} /></strong></td>
                  <td className="num"><Para deger={k.eskiDeger} /> → <strong><Para deger={k.yeniDeger} /></strong></td>
                  <td className="num">{k.degisenHareket}{k.uretimSarfiDegisen > 0 && <small className="muted"> · {k.uretimSarfiDegisen} üretim</small>}</td>
                </tr>
              ))}
              {!onizleme.kartlar.length && <tr><td className="muted" colSpan={5}>{yukleniyor ? "Hesaplanıyor…" : "Bütün maliyetler kurallarla uyumlu; değişecek kart yok."}</td></tr>}
            </tbody>
          </Table>
        </Card>
      </>}
    </div>
  );
}
