"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, PageHeader, TableWrap } from "@/components/ui";
import { OLAY_ADI } from "@/lib/mevzuat-gorunum";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

interface Olay { id: string; olay: string; zaman: string; kullanici: string | null; degisiklikId: string | null; degisiklik: { no: number; baslik: string } | null; detay: Record<string, unknown> | null }

/** MVZ-08: Mevzuat Merkezi'nin denetim izi; kayıtlar silinemez ve değiştirilemez. */
export default function PlatformDenetimi() {
  const [sayfa, setSayfa] = useState(1);
  const [olaylar, setOlaylar] = useState<Olay[]>([]);
  const [hata, setHata] = useState("");
  const yukle = useCallback(async () => setOlaylar(await platformApi<Olay[]>(`/platform/mevzuat/olaylar?sayfa=${sayfa}`)), [sayfa]);
  useEffect(() => { if (platformTokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi")); }, [yukle]);

  return <>
    <PageHeader title="Denetim izi" subtitle="Platform kullanıcılarının bütün işlemleri. Kayıtlar yalnız eklenir; veritabanı düzeyinde silme ve değiştirme yetkisi yoktur." />
    <Alert tone="error">{hata}</Alert>
    <Card pad={false} actions={<div className="row-tight"><Button size="sm" disabled={sayfa === 1} onClick={() => setSayfa((s) => s - 1)}>‹ Yeni</Button><Button size="sm" disabled={olaylar.length < 100} onClick={() => setSayfa((s) => s + 1)}>Eski ›</Button></div>} title={`Sayfa ${sayfa}`}>
      <TableWrap>
        <thead><tr><th>Zaman</th><th>Kişi</th><th>İşlem</th><th>Değişiklik</th><th>Ayrıntı</th></tr></thead>
        <tbody>
          {olaylar.map((o) => <tr key={o.id}>
            <td>{new Date(o.zaman).toLocaleString("tr-TR")}</td>
            <td>{o.kullanici ?? "Sistem"}</td>
            <td>{OLAY_ADI[o.olay] ?? o.olay}</td>
            <td>{o.degisiklik ? <Link href={`/platform/degisiklik?id=${o.degisiklikId}`}>#{o.degisiklik.no} {o.degisiklik.baslik}</Link> : o.detay?.baslik ? `${String(o.detay.baslik)} (silindi)` : "—"}</td>
            <td className="muted" style={{ maxWidth: "28rem", wordBreak: "break-word" }}>{o.detay ? JSON.stringify(o.detay).slice(0, 300) : ""}</td>
          </tr>)}
          {!olaylar.length && <tr><td colSpan={5}>Kayıt yok.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>
  </>;
}
