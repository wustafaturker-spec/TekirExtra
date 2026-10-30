"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Field, Modal, PageHeader, Select, TableWrap } from "@/components/ui";
import { PlatformArama, PlatformListeDurumu } from "@/components/platform-liste";
import { OLAY_ADI } from "@/lib/mevzuat-gorunum";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";

interface Olay { id: string; olay: string; zaman: string; kullanici: string | null; degisiklikId: string | null; degisiklik: { no: number; baslik: string } | null; detay: Record<string, unknown> | null }
const zaman = (v: string) => new Date(v).toLocaleString("tr-TR");

/** Denetim kayıtları yalnız görüntülenir; arama, açık olan sayfanın kayıtlarında çalışır. */
export default function PlatformDenetimi() {
  const [sayfa, setSayfa] = useState(1);
  const [arama, setArama] = useState("");
  const [islem, setIslem] = useState("");
  const [secili, setSecili] = useState<Olay | null>(null);
  const { veri: olaylar, yukleniyor, hata, yenile } = usePlatformVerisi<Olay[]>(`/platform/mevzuat/olaylar?sayfa=${sayfa}`);
  const aranan = arama.trim().toLocaleLowerCase("tr-TR");
  const gorunen = (olaylar ?? []).filter((o) => (!islem || o.olay === islem) && `${o.kullanici ?? "Sistem"} ${OLAY_ADI[o.olay] ?? o.olay} ${o.degisiklik?.baslik ?? ""} ${JSON.stringify(o.detay)}`.toLocaleLowerCase("tr-TR").includes(aranan));

  return <>
    <PageHeader title="Denetim izi" subtitle="Platform işlemlerini kişi, işlem ve değişiklik bilgisiyle inceleyin. Denetim kayıtları silinemez ve değiştirilemez." actions={<Button disabled={yukleniyor} onClick={yenile}><RefreshCw size={16} aria-hidden="true" />Yenile</Button>} />
    <div className="platform-workflow"><ShieldCheck size={20} aria-hidden="true" /><div><strong>İşlem geçmişi korunur.</strong><span>Arama ve işlem filtresi yalnız açık olan sayfadaki en fazla 100 kayıt üzerinde çalışır.</span></div></div>
    <Card title="İşlem kayıtları" pad={false}>
      <div className="platform-filter-bar">
        <PlatformArama etiket="Denetim kaydı ara" deger={arama} onChange={setArama} placeholder="Kişi, değişiklik veya ayrıntı ara…" />
        <Field label="İşlem türü"><Select value={islem} onChange={(e) => setIslem(e.target.value)}><option value="">Tüm işlemler</option>{Object.entries(OLAY_ADI).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}</Select></Field>
      </div>
      <div className="platform-pagination"><span role="status">Sayfa {sayfa} · {yukleniyor ? "Yükleniyor…" : hata ? "Kayıtlar alınamadı" : `${gorunen.length} kayıt`}</span><div className="platform-row-actions"><Button size="sm" disabled={sayfa === 1 || yukleniyor} onClick={() => setSayfa((s) => s - 1)}><ChevronLeft size={14} aria-hidden="true" />Daha yeni</Button><Button size="sm" disabled={yukleniyor || Boolean(hata) || (olaylar?.length ?? 0) < 100} onClick={() => setSayfa((s) => s + 1)}>Daha eski<ChevronRight size={14} aria-hidden="true" /></Button></div></div>
      <TableWrap className="platform-responsive-table platform-audit-table">
        <thead><tr><th>Zaman</th><th>Kişi</th><th>İşlem</th><th>Değişiklik</th><th>Ayrıntı</th></tr></thead>
        <tbody>
          {!yukleniyor && !hata && gorunen.map((o) => <tr key={o.id}>
            <td data-label="Zaman">{zaman(o.zaman)}</td>
            <td data-label="Kişi">{o.kullanici ?? "Sistem"}</td>
            <td data-label="İşlem"><Badge variant={o.olay === "giris_basarisiz" ? "warning" : "neutral"}>{OLAY_ADI[o.olay] ?? o.olay}</Badge></td>
            <td data-label="Değişiklik">{o.degisiklik && o.degisiklikId ? <Link href={`/platform/degisiklik?id=${encodeURIComponent(o.degisiklikId)}`}>#{o.degisiklik.no} {o.degisiklik.baslik}</Link> : o.detay?.baslik ? `${String(o.detay.baslik)} (silindi)` : "—"}</td>
            <td data-label="Ayrıntı">{o.detay && Object.keys(o.detay).length ? <Button size="sm" onClick={() => setSecili(o)}>Ayrıntıları göster</Button> : <span className="muted">Ek ayrıntı yok</span>}</td>
          </tr>)}
          <PlatformListeDurumu sutun={5} yukleniyor={yukleniyor} hata={hata} bos={!gorunen.length} baslik={arama || islem ? "Bu sayfada eşleşen kayıt yok." : "Bu sayfada işlem kaydı yok."} aciklama="Arama ve filtreleri değiştirin veya diğer kayıt sayfalarını inceleyin." onTekrar={yenile} />
        </tbody>
      </TableWrap>
    </Card>
    {secili && <Modal baslik="İşlem ayrıntıları" aciklama={`${zaman(secili.zaman)} · ${secili.kullanici ?? "Sistem"} · ${OLAY_ADI[secili.olay] ?? secili.olay}`} onKapat={() => setSecili(null)}><dl className="platform-detail-list">{Object.entries(secili.detay ?? {}).map(([ad, deger]) => <div key={ad}><dt>{ad}</dt><dd>{typeof deger === "object" && deger !== null ? <pre>{JSON.stringify(deger, null, 2)}</pre> : String(deger ?? "—")}</dd></div>)}</dl></Modal>}
  </>;
}
