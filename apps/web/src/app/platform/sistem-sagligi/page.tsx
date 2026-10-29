"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, PageHeader, Stat, StatGrid, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

interface Surec { basladiAt: string; sonNabizAt: string; rssMb: number | null; heapMb: number | null; heapSinirMb: number | null; makine?: string | null }
interface Is { isAdi: string; sonBaslangic: string | null; sonSureMs: number | null; sonBasariAt: string | null; sonHata: string | null; sonHataAt: string | null; ardisikHata: number; calismaSayisi: number }
interface OluIs { id: string; tenantId: string; unvan: string; isTuru: string; hata: string; zaman: string }
interface Alarm { anahtar: string; tur: string; acik: boolean; ozet: string; ilkAt: string; sonBildirimAt: string | null; kapandiAt: string | null }
interface Saglik {
  zaman: string;
  esikler: { workerNabizDk: number; saatlikYenidenBaslama: number; kursorSaat: number; ardisikHata: number };
  worker: { son: Surec | null; nabizGecikmesiDk: number | null; acilis24s: number; acilislar: { basladiAt: string; sonNabizAt: string; rssMb: number | null }[] };
  api: Surec | null;
  isler: Is[];
  kuyruk: { sayilar: Record<string, number>; firmalar: { tenantId: string; unvan: string; waiting?: number; active?: number; delayed?: number; failed?: number }[]; oluIsler: OluIs[] };
  gecikenKursorler: { tenantId: string; unvan: string; saglayici: string; sonCekimAt: string | null }[];
  taranan: number;
  baglantilar: { tenantId: string; unvan: string; aile: string; saglayici: string; durum: string; sonSenkron: string | null; hata: string | null; ardisikHata: number }[];
  alarmlar: Alarm[];
}

const zaman = (s: string | null) => (s ? new Date(s).toLocaleString("tr-TR") : "—");
const sure = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} sn`);

/**
 * PLT-17/18: sistem sağlığı. Yalnız sayı, durum ve hata metni; firma verisinin
 * içeriği görünmez. Alarmlar aynı kurallardan gelir (PLT-19).
 */
export default function PlatformSistemSagligi() {
  const [v, setV] = useState<Saglik | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState("");

  const yukle = useCallback(async () => setV(await platformApi<Saglik>("/platform/sistem-sagligi")), []);
  useEffect(() => {
    if (!platformTokenAl()) return;
    void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi"));
    const t = setInterval(() => void yukle().catch(() => undefined), 60_000);
    return () => clearInterval(t);
  }, [yukle]);

  async function yenidenDene(id: string) {
    setIslem(id); setHata(""); setBasari("");
    try { setBasari((await platformApi<{ mesaj: string }>(`/platform/sistem-sagligi/olu-isler/${encodeURIComponent(id)}/yeniden-dene`, { method: "POST" })).mesaj); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Yeniden kuyruğa alınamadı"); }
    finally { setIslem(""); }
  }

  const acikAlarmlar = v?.alarmlar.filter((a) => a.acik) ?? [];
  const nabizGec = v?.worker.nabizGecikmesiDk !== null && v?.worker.nabizGecikmesiDk !== undefined && v.worker.nabizGecikmesiDk > v.esikler.workerNabizDk;
  const bellekOrani = v?.worker.son?.heapMb && v.worker.son.heapSinirMb ? Math.round((v.worker.son.heapMb / v.worker.son.heapSinirMb) * 100) : null;

  return <>
    <PageHeader title="Sistem sağlığı" subtitle="Worker, zamanlayıcılar, e-belge kuyruğu, gelen taramaları ve bağlantılar. Sorunlar platform yöneticilerine e-postayla bildirilir; sayfa dakikada bir yenilenir." />
    <Alert tone="error">{hata}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    {v && <div className="stack">
      {acikAlarmlar.length > 0
        ? <Alert tone="warning"><strong>{acikAlarmlar.length} açık sorun:</strong><ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>{acikAlarmlar.map((a) => <li key={a.anahtar}>{a.ozet} <span className="subtle">({zaman(a.ilkAt)}’den beri)</span></li>)}</ul></Alert>
        : <Alert tone="success">Açık sorun yok.</Alert>}
      <StatGrid>
        <Stat label="Worker son nabız" value={v.worker.son ? `${v.worker.nabizGecikmesiDk} dk önce` : "Kayıt yok"} tone={nabizGec ? "danger" : undefined} />
        <Stat label="Worker açılışı (24 saat)" value={v.worker.acilis24s} tone={v.worker.acilis24s > 2 ? "accent" : undefined} />
        <Stat label="Worker belleği" value={v.worker.son ? `${v.worker.son.heapMb ?? "—"} / ${v.worker.son.heapSinirMb ?? "—"} MB` : "—"} tone={bellekOrani !== null && bellekOrani >= 85 ? "danger" : undefined} />
        <Stat label="Kuyruktan düşen iş" value={v.kuyruk.oluIsler.length} tone={v.kuyruk.oluIsler.length ? "danger" : undefined} />
        <Stat label="Geciken gelen tarama" value={`${v.gecikenKursorler.length} / ${v.taranan}`} tone={v.gecikenKursorler.length ? "accent" : undefined} />
      </StatGrid>

      {v.kuyruk.oluIsler.length > 0 && <Card title="Kuyruktan düşen işler" pad={false}>
        <TableWrap>
          <thead><tr><th>Zaman</th><th>Firma</th><th>İş</th><th>Hata</th><th /></tr></thead>
          <tbody>{v.kuyruk.oluIsler.map((o) => <tr key={o.id}><td className="subtle" style={{ whiteSpace: "nowrap" }}>{zaman(o.zaman)}</td><td>{o.unvan}</td><td className="mono">{o.isTuru}</td><td>{o.hata}</td><td><Button size="sm" disabled={Boolean(islem)} onClick={() => void yenidenDene(o.id)}>{islem === o.id ? "Alınıyor…" : "Yeniden kuyruğa al"}</Button></td></tr>)}</tbody>
        </TableWrap>
      </Card>}

      {v.gecikenKursorler.length > 0 && <Card title={`Gelen taraması ${v.esikler.kursorSaat} saatten uzun süredir bitmeyen firmalar`} pad={false}>
        <TableWrap>
          <thead><tr><th>Firma</th><th>Sağlayıcı</th><th>Son başarılı tarama</th></tr></thead>
          <tbody>{v.gecikenKursorler.map((k) => <tr key={k.tenantId}><td>{k.unvan}</td><td>{k.saglayici}</td><td>{k.sonCekimAt ? zaman(k.sonCekimAt) : <Badge variant="warning">Hiç tamamlanmadı</Badge>}</td></tr>)}</tbody>
        </TableWrap>
      </Card>}

      <Card title="Zamanlayıcılar" pad={false}>
        <TableWrap>
          <thead><tr><th>İş</th><th>Son çalışma</th><th className="num">Süre</th><th>Son başarı</th><th>Son hata</th><th className="num">Çalışma</th></tr></thead>
          <tbody>
            {v.isler.map((i) => <tr key={i.isAdi}>
              <td className="mono">{i.isAdi}{i.ardisikHata > 0 && <div style={{ marginTop: 4 }}><Badge variant={i.ardisikHata >= v.esikler.ardisikHata ? "danger" : "warning"}>{i.ardisikHata} ardışık hata</Badge></div>}</td>
              <td className="subtle" style={{ whiteSpace: "nowrap" }}>{zaman(i.sonBaslangic)}</td>
              <td className="num">{sure(i.sonSureMs)}</td>
              <td className="subtle" style={{ whiteSpace: "nowrap" }}>{zaman(i.sonBasariAt)}</td>
              <td>{i.sonHata ? <><span className="subtle">{zaman(i.sonHataAt)}</span><div style={{ fontSize: "0.85rem" }}>{i.sonHata}</div></> : "—"}</td>
              <td className="num">{i.calismaSayisi}</td>
            </tr>)}
            {!v.isler.length && <tr><td colSpan={6} className="empty">Henüz nabız kaydı yok.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="e-Belge kuyruğu" pad={false}>
        <div className="subtle" style={{ padding: "0.75rem 1rem 0" }}>Bekleyen {v.kuyruk.sayilar.waiting ?? 0} · çalışan {v.kuyruk.sayilar.active ?? 0} · ertelenen {v.kuyruk.sayilar.delayed ?? 0} · başarısız {v.kuyruk.sayilar.failed ?? 0}</div>
        <TableWrap>
          <thead><tr><th>Firma</th><th className="num">Bekleyen</th><th className="num">Çalışan</th><th className="num">Ertelenen</th><th className="num">Başarısız</th></tr></thead>
          <tbody>
            {v.kuyruk.firmalar.slice(0, 50).map((f) => <tr key={f.tenantId}><td>{f.unvan}</td><td className="num">{f.waiting ?? 0}</td><td className="num">{f.active ?? 0}</td><td className="num">{f.delayed ?? 0}</td><td className="num">{f.failed ?? 0}</td></tr>)}
            {!v.kuyruk.firmalar.length && <tr><td colSpan={5} className="empty">Kuyrukta iş yok.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>

      {v.baglantilar.length > 0 && <Card title="Hata veren bağlantılar" pad={false}>
        <TableWrap>
          <thead><tr><th>Firma</th><th>Bağlantı</th><th>Durum</th><th className="num">Ardışık hata</th><th>Son senkron</th><th>Hata</th></tr></thead>
          <tbody>{v.baglantilar.slice(0, 100).map((b, n) => <tr key={`${b.tenantId}-${b.aile}-${n}`}><td>{b.unvan}</td><td>{b.aile} · {b.saglayici}</td><td><Badge variant={b.durum === "hata" ? "danger" : "warning"}>{b.durum}</Badge></td><td className="num">{b.ardisikHata}</td><td className="subtle">{zaman(b.sonSenkron)}</td><td style={{ fontSize: "0.85rem" }}>{b.hata ?? "—"}</td></tr>)}</tbody>
        </TableWrap>
      </Card>}

      <Card title="Süreçler">
        <p className="subtle" style={{ margin: 0 }}>
          Worker: {v.worker.son ? `${zaman(v.worker.son.basladiAt)}'de başladı · RSS ${v.worker.son.rssMb ?? "—"} MB` : "kayıt yok"} · API: {v.api ? `${zaman(v.api.basladiAt)}'de başladı · son nabız ${zaman(v.api.sonNabizAt)}` : "kayıt yok"}
        </p>
        {v.worker.acilislar.length > 1 && <p className="subtle" style={{ margin: "0.5rem 0 0" }}>Son worker açılışları: {v.worker.acilislar.map((a) => zaman(a.basladiAt)).join(" · ")}</p>}
      </Card>
    </div>}
  </>;
}
