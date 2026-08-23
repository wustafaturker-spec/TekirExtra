"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Badge, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";
import { api, tokenAl } from "@/lib/api";

interface Satir { emirId: string; no: string; tarih: string; durum: string; stok: { kod: string; ad: string }; planlananMiktar: string; uretilenMiktar: string; kalemler: { malzeme: Kalem; operasyon: Kalem }; toplamlar: Kalem & { sapmaYuzdesi: string } }
interface Kalem { planlanan: string; gerceklesen: string; sapma: string }
interface Rapor { toplamlar: Kalem & { sapmaYuzdesi: string }; emirler: Satir[] }
const bugun = () => new Date().toISOString().slice(0, 10); const ayBasi = () => bugun().slice(0, 8) + "01";
const sayi = (v: string | number) => Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function UretimMaliyetRaporu() {
  const [baslangic, setBaslangic] = useState(ayBasi()); const [bitis, setBitis] = useState(bugun()); const [rapor, setRapor] = useState<Rapor | null>(null); const [hata, setHata] = useState("");
  useEffect(() => { if (tokenAl()) void api<Rapor>(`/uretim/maliyet-raporu?baslangic=${baslangic}&bitis=${bitis}`).then(setRapor).catch((e) => setHata(e instanceof Error ? e.message : "Maliyet raporu yüklenemedi")); }, [baslangic, bitis]);
  return <div className="production-page"><PageHeader title="Üretim Maliyet Sapması" subtitle="Planlanan standart maliyeti gerçek sarf ve fiilî operasyon süresiyle karşılaştırın." />
    <Alert tone="error">{hata}</Alert><Card className="production-filter-card" title="Rapor dönemi"><div className="production-filter-grid production-filter-grid--dates"><Field label="Başlangıç"><Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} /></Field><Field label="Bitiş"><Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} /></Field><div className="production-filter-note"><strong>Standart / fiilî karşılaştırma</strong><small>Seçilen dönemdeki tüm üretim maliyetleri.</small></div></div></Card>
    {rapor && <><section className="production-summary"><article><span>Planlanan</span><strong>{sayi(rapor.toplamlar.planlanan)} TL</strong><small>Dönem standart maliyeti</small></article><article><span>Gerçekleşen</span><strong>{sayi(rapor.toplamlar.gerceklesen)} TL</strong><small>Fiilî üretim maliyeti</small></article><article><span>Sapma</span><strong>{sayi(rapor.toplamlar.sapma)} TL</strong><small>%{sayi(rapor.toplamlar.sapmaYuzdesi)}</small></article></section><Card pad={false}><TableWrap><thead><tr><th>Emir</th><th>Ürün</th><th className="num">Planlanan</th><th className="num">Gerçekleşen</th><th className="num">Malzeme</th><th className="num">Operasyon</th><th>Sapma</th></tr></thead><tbody>{rapor.emirler.map((e) => <tr key={e.emirId}><td><Link href={`/panel/uretim/emirler/${e.emirId}`}><strong>{e.no}</strong></Link><br /><small>{new Date(e.tarih).toLocaleDateString("tr-TR")}</small></td><td>{e.stok.kod} — {e.stok.ad}</td><td className="num">{sayi(e.toplamlar.planlanan)} TL</td><td className="num">{sayi(e.toplamlar.gerceklesen)} TL</td><td className="num">{sayi(e.kalemler.malzeme.gerceklesen)} TL</td><td className="num">{sayi(e.kalemler.operasyon.gerceklesen)} TL</td><td><Badge variant={Number(e.toplamlar.sapma) > 0 ? "danger" : "success"}>{sayi(e.toplamlar.sapma)} TL · %{sayi(e.toplamlar.sapmaYuzdesi)}</Badge></td></tr>)}{!rapor.emirler.length && <tr><td colSpan={7}>Seçilen dönemde üretim emri yok.</td></tr>}</tbody></TableWrap></Card></>}
  </div>;
}
