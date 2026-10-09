"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl } from "@/lib/api";
import { Alert, Badge, Button, Card, PageHeader, TableWrap } from "@/components/ui";
import { bugunTR, type TevkifatKodu } from "@tekirextra/shared";

/**
 * MVZ-09 (FTR-35'in yerini alır): tevkifat kodları ve oranları Mevzuat
 * Merkezi'nde tüm firmalar için tutulur; firma değiştiremez. Burada yalnız
 * kullanmadığı kodları fatura listesinden gizler. Gizli kod yeni satırda
 * seçilemez, gelen e-Faturada yine tanınır.
 */
export default function TevkifatKodlariSayfasi() {
  const [tablo, setTablo] = useState<TevkifatKodu[]>([]);
  const [gizli, setGizli] = useState<Set<string>>(new Set());
  const [kayitli, setKayitli] = useState<Set<string>>(new Set());
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [islem, setIslem] = useState(false);

  const yukle = useCallback(async () => {
    const t = await api<TevkifatKodu[]>(`/mevzuat/tevkifat-tablosu?tarih=${bugunTR()}`);
    const g = new Set(t.filter((k) => k.pasif).map((k) => k.kod));
    setTablo(t); setGizli(g); setKayitli(new Set(g));
  }, []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Tevkifat kodları yüklenemedi")); }, [yukle]);

  const degisti = useMemo(() => gizli.size !== kayitli.size || [...gizli].some((k) => !kayitli.has(k)), [gizli, kayitli]);
  const degistir = (kod: string, goster: boolean) => setGizli((eski) => { const y = new Set(eski); if (goster) y.delete(kod); else y.add(kod); return y; });

  async function kaydet() {
    setIslem(true); setHata(""); setBasari("");
    try {
      await api("/ayarlar/tevkifat", { method: "PUT", body: JSON.stringify({ gizli: [...gizli].sort() }) });
      await yukle();
      setBasari("Kaydedildi. Gizlenen kodlar yeni fatura satırında listelenmez.");
    } catch (e) { setHata(e instanceof Error ? e.message : "Kaydedilemedi"); } finally { setIslem(false); }
  }

  return <div className="production-page">
    <PageHeader title="Tevkifat Kodları" subtitle="Kodlar ve oranlar Mevzuat Merkezi'nde tüm firmalar için güncel tutulur ve belge tarihine göre uygulanır. Kullanmadığınız kodları fatura listesinden gizleyebilirsiniz." />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{basari}</Alert>
    <Card
      title={`Bugün yürürlükteki kodlar (${tablo.length})`}
      actions={<Button variant="primary" disabled={islem || !degisti} onClick={() => void kaydet()}>{islem ? "Kaydediliyor..." : "Kaydet"}</Button>}
      pad={false}
    >
      <TableWrap>
        <thead><tr><th>Kod</th><th>Ad</th><th>Oran</th><th>Fatura listesinde</th></tr></thead>
        <tbody>
          {tablo.map((k) => <tr key={k.kod}>
            <td><strong>{k.kod}</strong></td>
            <td>{k.ad}</td>
            <td>{k.oranlar.join(", ")}</td>
            <td><label className="check"><input type="checkbox" checked={!gizli.has(k.kod)} onChange={(e) => degistir(k.kod, e.target.checked)} /><span>{gizli.has(k.kod) ? <Badge variant="neutral">Gizli</Badge> : "Gösterilir"}</span></label></td>
          </tr>)}
          {!tablo.length && <tr><td colSpan={4}>Kod bulunamadı.</td></tr>}
        </tbody>
      </TableWrap>
      <p className="muted" style={{ padding: "0.8rem 1.25rem", margin: 0 }}>
        Oran ya da kod eksik veya hatalı görünüyorsa <Link href="/panel/ayarlar/mevzuat">Ayarlar &gt; Mevzuat</Link> sayfasından bildirin; doğrulanınca tüm firmalar için güncellenir.
        Kesinleşmiş faturalar sakladıkları oranla kalır, taslaklar bir sonraki kaydedişte belge tarihindeki oranla hesaplanır.
      </p>
    </Card>
  </div>;
}
