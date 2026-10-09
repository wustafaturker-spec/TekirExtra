"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Input, PageHeader, Segmented, TableWrap } from "@/components/ui";
import { MEVZUAT_TUR_TANIMLARI, mevzuatTuruMu } from "@tekirextra/shared";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

type TalepDurumu = "acik" | "cozuldu" | "reddedildi";
interface Talep { id: string; kaynak: "kiraci_bildirimi" | "bilinmeyen_kod"; tur: string | null; anahtar: string | null; aciklama: string; gorulmeSayisi: number; durum: TalepDurumu; cozumNotu: string | null; createdAt: string }
const DURUM: Record<TalepDurumu, string> = { acik: "Açık", cozuldu: "Çözüldü", reddedildi: "Reddedildi" };

/**
 * MVZ-09/10: kiracıların "eksik / hatalı bildir" kayıtları ve gelen belgelerde
 * görülen bilinmeyen kodlar. Kiracı adı gösterilmez; talep içeriği yeterlidir.
 */
export default function PlatformTalepleri() {
  const [durum, setDurum] = useState<TalepDurumu>("acik");
  const [liste, setListe] = useState<Talep[]>([]);
  const [notlar, setNotlar] = useState<Record<string, string>>({});
  const [hata, setHata] = useState(""); const [islem, setIslem] = useState(false);

  const yukle = useCallback(async () => setListe(await platformApi<Talep[]>(`/platform/mevzuat/talepler?durum=${durum}`)), [durum]);
  useEffect(() => { if (platformTokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi")); }, [yukle]);

  async function kapat(t: Talep, yeni: TalepDurumu) {
    setIslem(true); setHata("");
    try { await platformApi(`/platform/mevzuat/talepler/${t.id}`, { method: "PATCH", body: JSON.stringify({ durum: yeni, cozumNotu: notlar[t.id] || null }) }); await yukle(); }
    catch (h) { setHata(h instanceof Error ? h.message : "Güncellenemedi"); } finally { setIslem(false); }
  }

  return <>
    <PageHeader title="Talepler" subtitle="Kiracıların bildirdiği eksik ya da hatalı mevzuat değerleri ve gelen belgelerde görülen bilinmeyen kodlar. Gerekirse yeni bir değişiklik hazırlayın, sonra talebi kapatın." />
    <Alert tone="error">{hata}</Alert>
    <Card title="Liste" pad={false} actions={<Segmented ariaLabel="Durum" value={durum} onChange={setDurum} items={(["acik", "cozuldu", "reddedildi"] as const).map((d) => ({ deger: d, baslik: DURUM[d] }))} />}>
      <TableWrap>
        <thead><tr><th>Tarih</th><th>Kaynak</th><th>Kalem</th><th>Açıklama</th>{durum === "acik" ? <th>Çözüm notu</th> : <th>Not</th>}{durum === "acik" && <th />}</tr></thead>
        <tbody>
          {liste.map((t) => <tr key={t.id}>
            <td>{new Date(t.createdAt).toLocaleString("tr-TR")}</td>
            <td><Badge variant={t.kaynak === "bilinmeyen_kod" ? "warning" : "info"}>{t.kaynak === "bilinmeyen_kod" ? `Bilinmeyen kod ×${t.gorulmeSayisi}` : "Kiracı bildirimi"}</Badge></td>
            <td>{t.tur && mevzuatTuruMu(t.tur) ? MEVZUAT_TUR_TANIMLARI[t.tur].ad : "—"}{t.anahtar ? ` ${t.anahtar}` : ""}</td>
            <td>{t.aciklama}</td>
            {durum === "acik"
              ? <td><Input aria-label="Çözüm notu" value={notlar[t.id] ?? ""} onChange={(e) => setNotlar({ ...notlar, [t.id]: e.target.value })} placeholder="ör. #4 ile eklendi" /></td>
              : <td className="muted">{t.cozumNotu ?? "—"}</td>}
            {durum === "acik" && <td><div className="row-tight"><Button size="sm" variant="primary" disabled={islem} onClick={() => void kapat(t, "cozuldu")}>Çözüldü</Button><Button size="sm" disabled={islem} onClick={() => void kapat(t, "reddedildi")}>Reddet</Button></div></td>}
          </tr>)}
          {!liste.length && <tr><td colSpan={6}>Kayıt yok.</td></tr>}
        </tbody>
      </TableWrap>
    </Card>
  </>;
}
