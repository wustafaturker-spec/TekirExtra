"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Input, PageHeader, Para, Select, Stat, StatGrid, Table } from "@/components/ui";
import { paraBicimle } from "@tekirextra/shared";

interface Ozet {
  donem: { yil: number; ay: number }; toplamPersonel: number; aktifPersonel: number; aylikSozlesmeYuku: string;
  durumlar: { durum: string; adet: number }[];
  departmanlar: { ad: string; adet: number; ucretYuku: string; isverenMaliyeti: string }[];
  bordro: { acikAdet: number; acikTutar: string; donemIsverenMaliyeti: string; donemTesvikTasarrufu: string; trend: { yil: number; ay: number; tahakkuk: string; odeme: string; isverenMaliyeti: string; tesvik: string }[] };
  avans: { acikAdet: number; acikTutar: string };
  izin: { bekleyen: number; planliGun: string };
  belgeler: { suresiDolmus: number; yaklasan: { id: string; tur: string; gecerlilikTarihi: string; personel: { id: string; personelNo: string; ad: string; soyad: string }; ek: { dosyaAdi: string } }[] };
}

const AYLAR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const SERILER = [["tahakkuk", "Tahakkuk", "var(--viz-1)"], ["odeme", "Ödeme", "var(--viz-2)"], ["isverenMaliyeti", "İşveren maliyeti", "var(--viz-3)"]] as const;
const turAdi = (v: string) => v.replaceAll("_", " ").replace(/(^| )\p{L}/gu, (x) => x.toLocaleUpperCase("tr-TR"));
const tl = (v: string | number) => paraBicimle(v, { basamak: 0 });

/** İK kontrol merkezi: iş gücü, ücret yükü, bekleyen işler ve belge süreleri. */
export default function IkRaporlariSayfasi() {
  const [veri, setVeri] = useState<Ozet | null>(null);
  const [hata, setHata] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [tablo, setTablo] = useState(false);
  const [raporDonemi, setRaporDonemi] = useState({ yil: new Date().getFullYear(), ay: new Date().getMonth() + 1 });

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try { setHata(""); setVeri(await api<Ozet>("/personel/raporlar/ozet")); }
    catch (e) { setHata(e instanceof Error ? e.message : "Rapor alınamadı"); }
    finally { setYukleniyor(false); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);
  const azami = useMemo(() => Math.max(1, ...(veri?.bordro.trend.map((x) => Math.max(Number(x.tahakkuk), Number(x.odeme), Number(x.isverenMaliyeti))) ?? [])), [veri]);

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel">← Personel listesine dön</Link>
      <PageHeader
        title="İK kontrol merkezi"
        subtitle="İş gücü, ücret yükü ve bekleyen süreçleri tek ekrandan izleyin."
        actions={<>
          <Input aria-label="Rapor yılı" type="number" min="2020" max="2100" value={raporDonemi.yil} onChange={(e) => setRaporDonemi({ ...raporDonemi, yil: Number(e.target.value) })} style={{ width: "6rem" }} />
          <Select aria-label="Rapor ayı" value={raporDonemi.ay} onChange={(e) => setRaporDonemi({ ...raporDonemi, ay: Number(e.target.value) })} style={{ width: "auto" }}>{AYLAR.map((a, i) => <option key={a} value={i + 1}>{a}</option>)}</Select>
          <ButtonLabel as="a" href="/panel/personel/raporlar/maliyet">Maliyet detayı</ButtonLabel>
          <Button variant="primary" onClick={() => void apiDosyaIndir(`/personel/raporlar/maliyet.xlsx?yil=${raporDonemi.yil}&ay=${raporDonemi.ay}`, `personel-maliyet-${raporDonemi.yil}-${String(raporDonemi.ay).padStart(2, "0")}.xlsx`)}>Excel indir</Button>
          <Button disabled={yukleniyor} onClick={() => void yukle()}>{yukleniyor ? "Güncelleniyor…" : "↻ Yenile"}</Button>
        </>}
      />
      <Alert tone="error">{hata}</Alert>
      {!veri ? <Card><p className="muted" style={{ margin: 0 }}>İK göstergeleri hazırlanıyor…</p></Card> : <>
        <StatGrid>
          <Stat label="Aktif iş gücü" value={veri.aktifPersonel} hint={`${veri.toplamPersonel} toplam personel`} tone="accent" />
          <Stat label="Dönem işveren maliyeti" value={tl(veri.bordro.donemIsverenMaliyeti)} hint="Brüt ücret ve işveren payları" />
          <Stat label="SGK teşvik tasarrufu" value={tl(veri.bordro.donemTesvikTasarrufu)} hint="Dönem bordro hesap izleri" tone="success" />
          <Stat label="Aylık ücret yükü" value={tl(veri.aylikSozlesmeYuku)} hint="Aktif sözleşme net ücretleri" />
          <Stat label="Açık bordro" value={tl(veri.bordro.acikTutar)} hint={`${veri.bordro.acikAdet} bordro işlemi`} />
          <Stat label="Açık avans" value={tl(veri.avans.acikTutar)} hint={`${veri.avans.acikAdet} açık kayıt`} />
        </StatGrid>

        <div className="split split--wide-left">
          <Card title="6 aylık bordro görünümü" actions={<Button size="sm" onClick={() => setTablo((t) => !t)}>{tablo ? "Grafik" : "Tablo"}</Button>}>
            <p className="muted" style={{ marginTop: "-0.5rem" }}>Net tahakkuk, ödeme ve işveren maliyeti karşılaştırması</p>
            {tablo ? (
              <Table density="compact">
                <thead><tr><th>Dönem</th>{SERILER.map(([, ad]) => <th key={ad} className="num">{ad}</th>)}</tr></thead>
                <tbody>{veri.bordro.trend.map((x) => <tr key={`${x.yil}-${x.ay}`}><td>{AYLAR[x.ay - 1]} {x.yil}</td>{SERILER.map(([k]) => <td key={k} className="num"><Para deger={x[k]} /></td>)}</tr>)}</tbody>
              </Table>
            ) : (<>
              <div className="bar-chart" role="img" aria-label="Son altı ayın tahakkuk, ödeme ve işveren maliyeti">
                {veri.bordro.trend.map((x) => (
                  <div key={`${x.yil}-${x.ay}`} className="bar-chart__group">
                    <div className="bar-chart__bars">
                      {SERILER.map(([k, ad, renk]) => <span key={k} className="bar-chart__bar" title={`${AYLAR[x.ay - 1]} ${x.yil} · ${ad}: ${tl(x[k])}`} style={{ height: `${Math.max(2, (Number(x[k]) / azami) * 100)}%`, background: renk }} />)}
                    </div>
                    <span className="bar-chart__label">{AYLAR[x.ay - 1]} {String(x.yil).slice(-2)}</span>
                  </div>
                ))}
              </div>
              <div className="chart-legend">{SERILER.map(([k, ad, renk]) => <span key={k}><i style={{ background: renk }} />{ad}</span>)}</div>
            </>)}
          </Card>
          <Card title="Bekleyen işler">
            <ul className="list-plain">
              <Is href="/panel/personel/izinler" b="İzin onayı" d={`${veri.izin.bekleyen} talep`} uyari={veri.izin.bekleyen > 0} />
              <Is href="/panel/personel/bordrolar" b="Açık bordrolar" d={`${veri.bordro.acikAdet} işlem`} uyari={veri.bordro.acikAdet > 0} />
              <Is href="/panel/personel/avanslar" b="Açık avanslar" d={`${veri.avans.acikAdet} kayıt`} uyari={veri.avans.acikAdet > 0} />
              <Is href="#belgeler" b="Süresi dolan belge" d={`${veri.belgeler.suresiDolmus} belge`} uyari={veri.belgeler.suresiDolmus > 0} />
            </ul>
          </Card>
        </div>

        <div className="split split--even">
          <Card title="Departman dağılımı" pad={false}>
            <Table className="table--fit">
              <thead><tr><th>Departman</th><th className="num">İşveren maliyeti</th><th className="num">Net sözleşme</th></tr></thead>
              <tbody>
                {veri.departmanlar.map((d) => (
                  <tr key={d.ad}>
                    <td><div className="between"><strong>{d.ad}</strong><small className="muted">{d.adet} kişi</small></div><div className="meter" style={{ marginTop: "0.4rem" }}><span style={{ width: `${Math.max(4, (d.adet / Math.max(1, veri.aktifPersonel)) * 100)}%` }} /></div></td>
                    <td className="num"><Para deger={d.isverenMaliyeti} basamak={0} /></td>
                    <td className="num"><Para deger={d.ucretYuku} basamak={0} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card title="Yaklaşan belge süreleri" pad={false} id="belgeler">
            <Table className="table--fit">
              <thead><tr><th>Personel</th><th>Belge</th><th className="num">Son geçerlilik</th></tr></thead>
              <tbody>
                {veri.belgeler.yaklasan.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/panel/personel/${b.personel.id}`}><strong>{b.personel.ad} {b.personel.soyad}</strong></Link><div className="subtle">{b.personel.personelNo}</div></td>
                    <td>{turAdi(b.tur)}<div className="subtle">{b.ek.dosyaAdi}</div></td>
                    <td className="num"><Badge variant="warning">{new Date(b.gecerlilikTarihi).toLocaleDateString("tr-TR", { timeZone: "UTC" })}</Badge></td>
                  </tr>
                ))}
                {!veri.belgeler.yaklasan.length && <tr><td className="muted" colSpan={3}>Önümüzdeki 30 günde süresi dolacak belge yok.</td></tr>}
              </tbody>
            </Table>
          </Card>
        </div>
      </>}
    </div>
  );
}

function Is({ href, b, d, uyari }: { href: string; b: string; d: string; uyari: boolean }) {
  return <li><Link href={href} className="between card" style={{ padding: "0.75rem 1rem" }}><strong style={{ fontSize: "0.85rem" }}>{b}</strong><Badge variant={uyari ? "warning" : "success"}>{d}</Badge></Link></li>;
}
