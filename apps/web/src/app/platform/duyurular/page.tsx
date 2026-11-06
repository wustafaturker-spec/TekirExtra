"use client";

import Link from "next/link";
import { ArrowUpRight, Megaphone, Plus } from "lucide-react";
import { useState } from "react";
import { DuyuruYukleniyor } from "@/components/duyuru-yukleniyor";
import { Alert, Button, Card, Field, PageHeader, Select } from "@/components/ui";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { DUYURU_DURUMU, duyuruDurumu } from "@/lib/platform-duyurulari";
import type { DuyuruListesi } from "@/lib/platform-duyurulari";

export default function PlatformDuyurulari() {
  const [durum, setDurum] = useState(""); const [sayfa, setSayfa] = useState(1);
  const { veri, hata, yukleniyor, yenile } = usePlatformVerisi<DuyuruListesi>(`/platform/duyurular?sayfa=${sayfa}${durum ? `&durum=${durum}` : ""}`);
  return <div className="stack duyuru-sayfasi"><PageHeader title="Duyurular" subtitle="Doğru kitleye, doğru zamanda ulaşın. Duyurularınızı tek yerden yönetin." actions={<Link className="btn btn--primary" href="/platform/duyurular/yeni"><Plus size={16} aria-hidden="true" />Duyuru oluştur</Link>} /><Card className="duyuru-liste-paneli">
    <div className="duyuru-araclar"><div><h2>Duyuru arşivi</h2><p className="muted">{veri ? `${veri.toplam} duyuru` : "Taslaklar, planlanan ve yayınlanan duyurular"}</p></div><Field label="Durum"><Select value={durum} onChange={(e) => { setDurum(e.target.value); setSayfa(1); }}><option value="">Tümü</option>{Object.entries(DUYURU_DURUMU).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}</Select></Field></div>
    {yukleniyor && <DuyuruYukleniyor />}{hata && <Alert tone="error">{hata}<Button onClick={yenile}>Tekrar dene</Button></Alert>}
    {veri && !veri.kayitlar.length && <div className="duyuru-bos"><Megaphone size={32} aria-hidden="true" /><h3>Bu görünümde duyuru yok.</h3><p>Yeni bir duyuru hazırlayın veya durum filtresini değiştirin.</p></div>}
    {veri?.kayitlar.map((d) => <Link key={d.id} className="duyuru-liste-karti" href={`/platform/duyurular/${d.id}`}><span className="duyuru-simge"><Megaphone size={20} aria-hidden="true" /></span><div className="duyuru-liste-baslik"><strong>{d.baslik}</strong><span>Sürüm {d.surum} · Son güncelleme {new Date(d.updatedAt).toLocaleDateString("tr-TR")}</span></div><span className={`duyuru-rozet duyuru-rozet--${d.durum}`}>{duyuruDurumu(d)}</span><ArrowUpRight size={18} aria-hidden="true" /></Link>)}
    <div className="duyuru-sayfalama"><Button disabled={yukleniyor || sayfa === 1} onClick={() => setSayfa(sayfa - 1)}>Önceki</Button><span>Sayfa {sayfa}{veri ? ` · ${veri.toplam} duyuru` : ""}</span><Button disabled={yukleniyor || !veri || sayfa * 25 >= veri.toplam} onClick={() => setSayfa(sayfa + 1)}>Sonraki</Button></div>
  </Card></div>;
}
