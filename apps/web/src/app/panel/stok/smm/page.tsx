"use client";
import { csvHucresi } from "@tekirextra/shared";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAdresDurumu } from "@/lib/adres-durumu";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Para, SearchInput, Segmented, Stat, StatGrid, Table, Tarih } from "@/components/ui";

type Yontem = "agirlikli_ortalama" | "fifo";
interface SmmDetay {
  faturaId: string; faturaNo: string; tarih: string; tip: "satis" | "satis_iade"; stokKod: string; stokAd: string; cariUnvan: string;
  satilanMiktar: number; satisNetTutar: number; birimMaliyet: number; toplamMaliyet: number; karTutar: number; karMarjiYuzde: number;
}
interface SmmRaporu { yontem: Yontem; toplamSatisCirosu: string; toplamSmmMaliyeti: string; brutKar: string; genelKarMarjiYuzde: number; detaylar: SmmDetay[] }

const ayBasi = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const bugun = () => new Date().toISOString().slice(0, 10);
const miktar = (v: number) => v.toLocaleString("tr-TR", { maximumFractionDigits: 3 });

/**
 * STK-32: satılan malın maliyeti ve brüt kâr. Ciro faturanın TL matrahından,
 * maliyet stok hareketlerinden (satış anındaki ortalama ya da FIFO); satış
 * iadeleri eksi satır olarak düşülür.
 */
export default function SmmRaporSayfasi() {
  // RPR-21: yöntem ve dönem adreste; bağlantı aynı görünümü açar.
  const [adres, adresGuncelle, adresHazir] = useAdresDurumu({ yontem: "agirlikli_ortalama", baslangic: ayBasi(), bitis: bugun() });
  const yontem: Yontem = adres.yontem === "fifo" ? "fifo" : "agirlikli_ortalama";
  const setYontem = (y: Yontem) => adresGuncelle({ yontem: y });
  const aralik = { baslangic: adres.baslangic, bitis: adres.bitis };
  const setAralik = (a: { baslangic: string; bitis: string }) => adresGuncelle(a);
  const [rapor, setRapor] = useState<SmmRaporu | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [arama, setArama] = useState("");

  const raporYukle = useCallback(async () => {
    setYukleniyor(true); setHata("");
    try {
      const q = new URLSearchParams({ yontem, ...(aralik.baslangic && { baslangic: aralik.baslangic }), ...(aralik.bitis && { bitis: aralik.bitis }) });
      setRapor(await api<SmmRaporu>(`/rapor/smm?${q.toString()}`));
    } catch (err) {
      setHata(err instanceof Error ? err.message : "SMM raporu yüklenemedi");
    } finally { setYukleniyor(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yontem, aralik.baslangic, aralik.bitis]);
  useEffect(() => { if (adresHazir) void raporYukle(); }, [raporYukle, adresHazir]);

  /** RPR-21: ekrandaki (aramayla süzülmüş) satırlar; başlıkta dönem ve yöntem. */
  const csvIndir = () => {
    if (!rapor) return;
    const q = (v: string) => csvHucresi(v);
    const s = (v: number) => v.toFixed(2).replace(".", ",");
    const satirlar = [
      [q("SMM ve kârlılık"), q(`${aralik.baslangic} – ${aralik.bitis}`), q(yontem === "fifo" ? "FIFO" : "Ağırlıklı ortalama"), arama ? q(`Arama: ${arama}`) : ""].join(";"),
      ["Fatura", "Tarih", "Tip", "Cari", "Ürün kodu", "Ürün", "Miktar", "Ciro (TL)", "Birim maliyet", "SMM", "Kâr", "Marj %"].map(q).join(";"),
      ...detaylar.map((d) => [q(d.faturaNo), d.tarih, d.tip === "satis_iade" ? "İade" : "Satış", q(d.cariUnvan), q(d.stokKod), q(d.stokAd),
        String(d.satilanMiktar).replace(".", ","), s(d.satisNetTutar), s(d.birimMaliyet), s(d.toplamMaliyet), s(d.karTutar), s(d.karMarjiYuzde)].join(";")),
      [q("Toplam"), "", "", "", "", "", "", s(detaylar.reduce((t, d) => t + d.satisNetTutar, 0)), "", s(detaylar.reduce((t, d) => t + d.toplamMaliyet, 0)), s(detaylar.reduce((t, d) => t + d.karTutar, 0)), ""].join(";"),
    ];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + satirlar.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `smm_${yontem}_${aralik.baslangic}_${aralik.bitis}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const detaylar = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr");
    return (rapor?.detaylar ?? []).filter((d) => !q || [d.faturaNo, d.stokAd, d.stokKod, d.cariUnvan].some((x) => x.toLocaleLowerCase("tr").includes(q)));
  }, [rapor, arama]);

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/stok">← Stok kartları</Link>
      <PageHeader
        title="SMM ve kârlılık"
        subtitle="Satılan malın maliyeti: ciro faturanın TL matrahından, maliyet stok hareketlerinden. Satış iadeleri ciro ve maliyetten düşülür; iptal edilen faturalar dahil edilmez."
        actions={<div className="row-tight"><Button onClick={() => void raporYukle()} disabled={yukleniyor}>{yukleniyor ? "Yükleniyor…" : "Yenile"}</Button><Button variant="primary" onClick={csvIndir} disabled={!rapor?.detaylar.length}>CSV indir</Button></div>}
      />
      <Alert tone="error">{hata}</Alert>
      <Card>
        <div className="form-grid">
          <Field label="Maliyet yöntemi">
            <Segmented<Yontem> ariaLabel="Maliyet yöntemi" items={[{ deger: "agirlikli_ortalama", baslik: "Ağırlıklı ortalama" }, { deger: "fifo", baslik: "FIFO" }]} value={yontem} onChange={setYontem} />
          </Field>
          <Field label="Başlangıç"><Input type="date" value={aralik.baslangic} onChange={(e) => setAralik({ ...aralik, baslangic: e.target.value })} /></Field>
          <Field label="Bitiş"><Input type="date" value={aralik.bitis} onChange={(e) => setAralik({ ...aralik, bitis: e.target.value })} /></Field>
        </div>
        <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.8rem" }}>
          {yontem === "fifo" ? "FIFO: her ürünün bütün giriş hareketleri (alış, üretim, açılış, sayım fazlası, iade) kuyruğa girer, çıkışlar en eskiden tüketir." : "Ağırlıklı ortalama: satış anında stok hareketine yazılan ortalama maliyet."}
        </p>
      </Card>
      {rapor && (
        <StatGrid>
          <Stat label="Net satış cirosu" value={<Para deger={rapor.toplamSatisCirosu} />} hint="İadeler düşülmüş, TL" />
          <Stat label="Satılan malın maliyeti" value={<Para deger={rapor.toplamSmmMaliyeti} />} hint={yontem === "fifo" ? "FIFO" : "Ağırlıklı ortalama"} />
          <Stat label="Brüt kâr" value={<Para deger={rapor.brutKar} />} hint={`Marj %${rapor.genelKarMarjiYuzde.toLocaleString("tr-TR")}`} tone="accent" />
        </StatGrid>
      )}
      <Card pad={false}>
        <div style={{ padding: "1rem 1.1rem" }}>
          <SearchInput aria-label="SMM satırı ara" placeholder="Fatura, ürün veya cari ara…" value={arama} onChange={(e) => setArama(e.target.value)} />
        </div>
        <Table>
          <thead><tr><th>Fatura</th><th>Tarih</th><th>Cari</th><th>Ürün</th><th className="num">Miktar</th><th className="num">Ciro</th><th className="num">Birim maliyet</th><th className="num">SMM</th><th className="num">Kâr</th><th className="num">Marj</th></tr></thead>
          <tbody>
            {detaylar.map((d, i) => (
              <tr key={`${d.faturaId}-${d.stokKod}-${i}`}>
                <td><Link href={`/panel/fatura/yeni?ac=${d.faturaId}`}><strong>{d.faturaNo}</strong></Link>{d.tip === "satis_iade" && <> <Badge variant="warning">İade</Badge></>}</td>
                <td><Tarih deger={d.tarih} /></td>
                <td>{d.cariUnvan}</td>
                <td><span className="mono subtle">{d.stokKod}</span> {d.stokAd}</td>
                <td className="num">{miktar(d.satilanMiktar)}</td>
                <td className="num"><Para deger={d.satisNetTutar} /></td>
                <td className="num"><Para deger={d.birimMaliyet} /></td>
                <td className="num"><Para deger={d.toplamMaliyet} /></td>
                <td className="num"><strong><Para deger={d.karTutar} /></strong></td>
                <td className="num">%{d.karMarjiYuzde.toLocaleString("tr-TR")}</td>
              </tr>
            ))}
            {!detaylar.length && <tr><td className="muted" colSpan={10}>{yukleniyor ? "Yükleniyor…" : "Seçilen aralıkta kesinleşmiş satış yok."}</td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
