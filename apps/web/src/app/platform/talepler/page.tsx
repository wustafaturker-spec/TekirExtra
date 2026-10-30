"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Card, PageHeader, Segmented, TableWrap } from "@/components/ui";
import { PlatformArama, PlatformListeDurumu } from "@/components/platform-liste";
import { MEVZUAT_TUR_TANIMLARI, mevzuatTuruMu } from "@tekirextra/shared";
import { platformApi } from "@/lib/platform-api";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";

type TalepDurumu = "acik" | "cozuldu" | "reddedildi";
interface Talep { id: string; kaynak: "kiraci_bildirimi" | "bilinmeyen_kod"; tur: string | null; anahtar: string | null; aciklama: string; gorulmeSayisi: number; durum: TalepDurumu; cozumNotu: string | null; createdAt: string }
const DURUM: Record<TalepDurumu, string> = { acik: "Açık", cozuldu: "Çözüldü", reddedildi: "Reddedildi" };
const kalemAdi = (t: Talep) => `${t.tur && mevzuatTuruMu(t.tur) ? MEVZUAT_TUR_TANIMLARI[t.tur].ad : "—"}${t.anahtar ? ` ${t.anahtar}` : ""}`;

/** Mevzuat bildirimlerinin inceleme ve çözüm çalışma alanı. */
export default function PlatformTalepleri() {
  const [durum, setDurum] = useState<TalepDurumu>("acik");
  const { veri, yukleniyor, hata: listeHatasi, yenile } = usePlatformVerisi<Talep[]>(`/platform/mevzuat/talepler?durum=${durum}`);
  const [arama, setArama] = useState("");
  const [notlar, setNotlar] = useState<Record<string, string>>({});
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState<string | null>(null);
  const aranan = arama.trim().toLocaleLowerCase("tr-TR");
  const liste = (veri ?? []).filter((t) => `${t.aciklama} ${kalemAdi(t)} ${t.cozumNotu ?? ""}`.toLocaleLowerCase("tr-TR").includes(aranan));

  async function kapat(t: Talep, yeni: TalepDurumu) {
    if (islem) return;
    setIslem(t.id); setHata(""); setBasari("");
    try {
      await platformApi(`/platform/mevzuat/talepler/${t.id}`, { method: "PATCH", body: JSON.stringify({ durum: yeni, cozumNotu: notlar[t.id] || null }) });
      setBasari(yeni === "cozuldu" ? "Talep çözüldü olarak işaretlendi." : "Talep reddedildi.");
      yenile();
    } catch (h) { setHata(h instanceof Error ? h.message : "Talep güncellenemedi."); }
    finally { setIslem(null); }
  }

  return <>
    <PageHeader title="Talepler" subtitle="Eksik veya hatalı mevzuat bildirimlerini inceleyin. Gerekli düzenlemeyi hazırladıktan sonra çözüm notuyla talebi kapatın." actions={<Button disabled={yukleniyor || Boolean(islem)} onClick={yenile}><RefreshCw size={16} aria-hidden="true" />Yenile</Button>} />
    <Alert tone="error">{hata}</Alert>
    <Alert tone="success">{basari}</Alert>
    <Card title="Mevzuat bildirimleri" className="platform-requests" pad={false} actions={<Segmented ariaLabel="Talep durumu" value={durum} onChange={(v) => { setDurum(v); setHata(""); setBasari(""); }} items={(["acik", "cozuldu", "reddedildi"] as const).map((d) => ({ deger: d, baslik: DURUM[d] }))} />}>
      <div className="platform-list-tools">
        <PlatformArama etiket="Talep ara" deger={arama} onChange={setArama} placeholder="Açıklama, kalem veya çözüm notu ara…" />
        <span className="muted" role="status">{yukleniyor ? "Yükleniyor…" : listeHatasi ? "Liste alınamadı" : `${liste.length} talep${veri?.length === 300 ? " · Son 300 kayıt" : ""}`}</span>
      </div>
      <TableWrap className="platform-responsive-table platform-request-table">
        <thead><tr><th>Tarih</th><th>Kaynak</th><th>Kalem</th><th>Açıklama</th><th>{durum === "acik" ? "Çözüm notu" : "Not"}</th>{durum === "acik" && <th>İşlem</th>}</tr></thead>
        <tbody>
          {!yukleniyor && !listeHatasi && liste.map((t) => <tr key={t.id}>
            <td data-label="Tarih">{new Date(t.createdAt).toLocaleString("tr-TR")}</td>
            <td data-label="Kaynak"><Badge variant={t.kaynak === "bilinmeyen_kod" ? "warning" : "info"}>{t.kaynak === "bilinmeyen_kod" ? `Bilinmeyen kod ×${t.gorulmeSayisi}` : "Kiracı bildirimi"}</Badge></td>
            <td data-label="Kalem">{kalemAdi(t)}</td>
            <td data-label="Açıklama" className="platform-request-description">{t.aciklama}</td>
            <td data-label={durum === "acik" ? "Çözüm notu" : "Not"}>{durum === "acik"
              ? <textarea className="input platform-request-note" aria-label="Çözüm notu" disabled={islem === t.id} value={notlar[t.id] ?? ""} onChange={(e) => setNotlar((v) => ({ ...v, [t.id]: e.target.value }))} rows={2} placeholder="Yapılan düzenlemeyi veya karar gerekçesini yazın." />
              : <span className="muted">{t.cozumNotu ?? "—"}</span>}</td>
            {durum === "acik" && <td data-label="İşlem"><div className="platform-row-actions"><Button size="sm" variant="primary" disabled={Boolean(islem)} onClick={() => void kapat(t, "cozuldu")}>{islem === t.id ? "Kaydediliyor…" : "Çözümü kaydet"}</Button><Button size="sm" disabled={Boolean(islem)} onClick={() => void kapat(t, "reddedildi")}>Reddet</Button></div></td>}
          </tr>)}
          <PlatformListeDurumu sutun={durum === "acik" ? 6 : 5} yukleniyor={yukleniyor} hata={listeHatasi} bos={!liste.length} baslik={aranan ? "Aramanıza uygun talep yok." : `${DURUM[durum]} talep yok.`} aciklama={aranan ? "Farklı bir açıklama veya kalemle aramayı deneyin." : "Başka bir durumu seçerek diğer bildirimleri inceleyebilirsiniz."} onTekrar={yenile} />
        </tbody>
      </TableWrap>
    </Card>
  </>;
}
