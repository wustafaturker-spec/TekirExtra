"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Select, TableWrap } from "@/components/ui";
import { api } from "@/lib/api";

type IsDurumu = "waiting" | "active" | "delayed" | "failed" | "dead-letter" | "completed";
type IsTuru = "ebelge-gonder" | "ebelge-durum-sorgula" | "gelen-belge-cek" | "earsiv-raporla";
interface KuyrukIsi { id: string; isTuru: IsTuru; faturaId: string | null; durum: IsDurumu; deneme: number; azamiDeneme: number; hata: string | null; kuyrugaAlinmaZamani: string; islenmeZamani: string | null; tamamlanmaZamani: string | null }
interface Sayilar { waiting: number; active: number; delayed: number; failed: number; "dead-letter": number; completed: number }
/** `calisanWorker` kuyruğu dinleyen worker sayısı; null ise okunamadı (EBLG-48). */
interface Ozet { sayilar: Sayilar; calisanWorker: number | null }

const DURUM: Record<IsDurumu, { ad: string; aciklama: string; ton: "neutral" | "info" | "warning" | "danger" | "success" }> = {
  waiting: { ad: "Bekliyor", aciklama: "Worker tarafından alınmayı bekliyor", ton: "info" },
  active: { ad: "İşleniyor", aciklama: "Entegratör işlemi devam ediyor", ton: "warning" },
  delayed: { ad: "Yeniden denenecek", aciklama: "Geçici hata sonrası zamanlandı", ton: "warning" },
  failed: { ad: "Müdahale gerekli", aciklama: "Tüm otomatik denemeler başarısız", ton: "danger" },
  "dead-letter": { ad: "Dead-letter", aciklama: "İnceleme ve güvenli yeniden deneme gerekli", ton: "danger" },
  completed: { ad: "Tamamlandı", aciklama: "Operasyon başarıyla tamamlandı", ton: "success" },
};
const tarihSaat = (deger: string | null) => deger ? new Date(deger).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—";
const IS_TURU: Record<IsTuru, { ad: string; aciklama: string; yol: string }> = {
  "ebelge-gonder": { ad: "Belge gönderimi", aciklama: "Fatura entegratöre iletiliyor", yol: "/panel/fatura" },
  "ebelge-durum-sorgula": { ad: "Durum sorgulama", aciklama: "Entegratör sonucu güncelleniyor", yol: "/panel/fatura" },
  "gelen-belge-cek": { ad: "Gelen belge senkronu", aciklama: "Gelen kutusu güncelleniyor", yol: "/panel/fatura/gelen-kutusu" },
  "earsiv-raporla": { ad: "e-Arşiv rapor sorgusu", aciklama: "GİB rapor durumu kontrol ediliyor", yol: "/panel/fatura/earsiv-raporlari" },
};

export default function EbelgeKuyrukSayfasi() {
  const [isler, setIsler] = useState<KuyrukIsi[]>([]); const [ozet, setOzet] = useState<Ozet>({ sayilar: { waiting: 0, active: 0, delayed: 0, failed: 0, "dead-letter": 0, completed: 0 }, calisanWorker: null });
  const [filtre, setFiltre] = useState<IsDurumu | "">(""); const [yukleniyor, setYukleniyor] = useState(true); const [islemde, setIslemde] = useState(""); const [hata, setHata] = useState(""); const [basari, setBasari] = useState(""); const [sonYenileme, setSonYenileme] = useState<Date | null>(null);
  const yukle = useCallback(async (sessiz = false) => { if (!sessiz) setYukleniyor(true); try { const [liste, sayilar] = await Promise.all([api<KuyrukIsi[]>("/ebelge/kuyruk"), api<Ozet>("/ebelge/kuyruk/ozet")]); setIsler(liste); setOzet(sayilar); setSonYenileme(new Date()); if (!sessiz) setHata(""); } catch (e) { setHata(e instanceof Error ? e.message : "Kuyruk bilgileri alınamadı"); } finally { if (!sessiz) setYukleniyor(false); } }, []);
  useEffect(() => { void yukle(); const zamanlayici = window.setInterval(() => void yukle(true), 10_000); return () => window.clearInterval(zamanlayici); }, [yukle]);
  const filtreli = useMemo(() => filtre ? isler.filter((is) => is.durum === filtre) : isler, [isler, filtre]);
  // Worker düştüğünde "active" işler de ilerlemediği için bekleyen sayılır.
  const bekleyenIs = ozet.sayilar.waiting + ozet.sayilar.active + ozet.sayilar.delayed;
  async function yenidenDene(is: KuyrukIsi) { setIslemde(is.id); setHata(""); setBasari(""); try { await api(`/ebelge/kuyruk/${encodeURIComponent(is.id)}/yeniden-dene`, { method: "POST" }); setBasari("İş yeniden kuyruğa alındı. Otomatik durum takibi devam ediyor."); await yukle(true); } catch (e) { setHata(e instanceof Error ? e.message : "İş yeniden başlatılamadı"); } finally { setIslemde(""); } }

  return <div className="queue-page">
    <header className="queue-hero"><div><span>E-BELGE OPERASYON MERKEZİ</span><h1>Entegrasyon kuyruğu</h1><p>Gönderim, durum sorgulama ve gelen belge senkronizasyonlarını tek merkezden izleyin.</p></div><div><small>{sonYenileme ? `Son güncelleme ${sonYenileme.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Henüz güncellenmedi"}</small><Button disabled={yukleniyor} onClick={() => void yukle()}>{yukleniyor ? "Yükleniyor…" : "↻ Şimdi yenile"}</Button></div></header>
    {hata && <Alert tone="error">{hata}</Alert>}{basari && <Alert tone="success">{basari}</Alert>}
    {ozet.calisanWorker === 0 && <Alert tone="warning">e-Belge worker'ı çalışmıyor: kuyruğu dinleyen süreç yok. {bekleyenIs > 0 ? `${bekleyenIs} iş kuyrukta bekliyor ve ` : "Yeni gönderimler kuyruğa yazılır, "}worker başlatılana kadar hiçbiri ilerlemez; sistem yöneticinize bildirin.</Alert>}
    <section className="queue-kpis"><button className={!filtre ? "is-selected" : ""} onClick={() => setFiltre("")}><span>Toplam görünür iş</span><strong>{Object.values(ozet.sayilar).reduce((a, b) => a + b, 0)}</strong><small>Tüm durumlar</small></button>{(["active", "waiting", "delayed", "dead-letter"] as IsDurumu[]).map((durum) => <button className={`${filtre === durum ? "is-selected" : ""} ${durum === "dead-letter" && ozet.sayilar["dead-letter"] ? "is-danger" : ""}`} key={durum} onClick={() => setFiltre(durum)}><span>{DURUM[durum].ad}</span><strong>{ozet.sayilar[durum]}</strong><small>{DURUM[durum].aciklama}</small></button>)}</section>
    <Card className="queue-register" pad={false} title={<div className="queue-register__title"><div><span>CANLI İŞ AKIŞI</span><h2>Tüm e-Belge operasyonları</h2></div><Select aria-label="Kuyruk durumu filtresi" value={filtre} onChange={(e) => setFiltre(e.target.value as IsDurumu | "")}><option value="">Tüm durumlar</option>{Object.entries(DURUM).map(([kod, d]) => <option key={kod} value={kod}>{d.ad}</option>)}</Select></div>}>
      <TableWrap><thead><tr><th>Operasyon / İş</th><th>Durum</th><th>Deneme</th><th>Zaman çizelgesi</th><th>Hata ayrıntısı</th><th>İşlem</th></tr></thead><tbody>{filtreli.map((is) => { const tur = IS_TURU[is.isTuru] ?? IS_TURU["ebelge-gonder"]; return <tr className={is.durum === "failed" || is.durum === "dead-letter" ? "is-failed" : ""} key={is.id}><td><Link href={tur.yol}><strong>{tur.ad}</strong></Link><small>{tur.aciklama}</small>{is.faturaId && <small title={is.faturaId}>Ref: {is.faturaId.slice(0, 8)}…</small>}<small className="mono" title={is.id}>{is.id}</small></td><td><Badge variant={DURUM[is.durum].ton}>{DURUM[is.durum].ad}</Badge><small>{DURUM[is.durum].aciklama}</small></td><td><strong>{Math.min(is.deneme + (is.durum === "active" ? 1 : 0), is.azamiDeneme)} / {is.azamiDeneme}</strong><small>{is.durum === "delayed" ? "Backoff bekleniyor" : "İşlem denemesi"}</small></td><td><span>Kuyruk: {tarihSaat(is.kuyrugaAlinmaZamani)}</span><small>Başlama: {tarihSaat(is.islenmeZamani)}</small><small>Bitiş: {tarihSaat(is.tamamlanmaZamani)}</small></td><td>{is.hata ? <p className="queue-error" title={is.hata}>{is.hata}</p> : <span className="queue-ok">Kayıtlı hata yok</span>}</td><td>{is.durum === "failed" || is.durum === "dead-letter" ? <Button size="sm" variant="primary" disabled={islemde === is.id} onClick={() => void yenidenDene(is)}>{islemde === is.id ? "Başlatılıyor…" : "Güvenle yeniden dene"}</Button> : <span className="queue-managed">Otomatik yönetiliyor</span>}</td></tr>; })}{!yukleniyor && filtreli.length === 0 && <tr><td colSpan={6}><div className="queue-empty"><strong>Bu durumda iş bulunmuyor</strong><span>Kuyruk her 10 saniyede otomatik güncellenir.</span></div></td></tr>}{yukleniyor && isler.length === 0 && <tr><td colSpan={6}><div className="queue-empty">Kuyruk bilgileri yükleniyor…</div></td></tr>}</tbody></TableWrap>
    </Card>
  </div>;
}
