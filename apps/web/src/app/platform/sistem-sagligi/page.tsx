"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Activity } from "lucide-react";
import { Alert, Badge, Button, Card, PageHeader, Stat, StatGrid, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

interface Surec { basladiAt: string; sonNabizAt: string; rssMb: number | null; heapMb: number | null; heapSinirMb: number | null; makine?: string | null }
interface Is { isAdi: string; sonBaslangic: string | null; sonSureMs: number | null; sonBasariAt: string | null; sonHata: string | null; sonHataAt: string | null; ardisikHata: number; calismaSayisi: number; aralikMs: number | null; ardisikUzun: number; saatlikAtlama: number }
interface OluIs { id: string; tenantId: string; unvan: string; isTuru: string; hata: string; zaman: string }
/** PLT-120: gruplu uygulama hatası; firma kimliği gelmez, yalnız kaç firmada görüldüğü. */
interface HataGrubu { parmakIzi: string; kaynak: "api" | "web"; ad: string; mesaj: string; yigin: string | null; konum: string; sayi: number; saatSayi: number; ilkGorulme: string; sonGorulme: string; surum: string | null; sonIstekId: string | null; firmaSayisi: number; cozulduAt: string | null; acik: boolean }
interface Alarm { anahtar: string; tur: string; acik: boolean; ozet: string; ilkAt: string; sonBildirimAt: string | null; kapandiAt: string | null }
interface Saglik {
  zaman: string;
  esikler: { workerNabizDk: number; saatlikYenidenBaslama: number; kursorSaat: number; ardisikHata: number; turAsimOrani: number; ardisikUzunTur: number };
  worker: { son: Surec | null; nabizGecikmesiDk: number | null; acilis24s: number; acilislar: { basladiAt: string; sonNabizAt: string; rssMb: number | null }[] };
  api: Surec | null;
  isler: Is[];
  kuyruk: { sayilar: Record<string, number>; firmalar: { tenantId: string; unvan: string; waiting?: number; active?: number; delayed?: number; failed?: number }[]; oluIsler: OluIs[] };
  gecikenKursorler: { tenantId: string; unvan: string; saglayici: string; sonCekimAt: string | null }[];
  taranan: number;
  baglantilar: { tenantId: string; unvan: string; aile: string; saglayici: string; durum: string; sonSenkron: string | null; hata: string | null; ardisikHata: number }[];
  alarmlar: Alarm[];
  hatalar: HataGrubu[];
}

const zaman = (s: string | null) => (s ? new Date(s).toLocaleString("tr-TR") : "—");
const sure = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${ms} ms` : ms < 120_000 ? `${(ms / 1000).toFixed(1)} sn` : ms < 7_200_000 ? `${Math.round(ms / 60_000)} dk` : `${Math.round(ms / 3_600_000)} sa`);

/**
 * PLT-17/18: sistem sağlığı. Yalnız sayı, durum ve hata metni; firma verisinin
 * içeriği görünmez. Alarmlar aynı kurallardan gelir (PLT-19).
 */
export default function PlatformSistemSagligi() {
  const [v, setV] = useState<Saglik | null>(null);
  const [listeHatasi, setListeHatasi] = useState("");
  const [yenileniyor, setYenileniyor] = useState(true);
  const kontrol = useRef<AbortController | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState("");
  const [tumHatalar, setTumHatalar] = useState(false);

  const yukle = useCallback(async () => {
    kontrol.current?.abort();
    const istek = new AbortController();
    kontrol.current = istek;
    setYenileniyor(true);
    try {
      const sonuc = await platformApi<Saglik>("/platform/sistem-sagligi", { signal: istek.signal });
      if (!istek.signal.aborted) { setV(sonuc); setListeHatasi(""); }
    } catch (e) {
      if (!istek.signal.aborted) setListeHatasi(e instanceof Error ? e.message : "Sistem ölçümleri alınamadı.");
    } finally { if (!istek.signal.aborted) setYenileniyor(false); }
  }, []);
  useEffect(() => {
    if (!platformTokenAl()) return;
    void yukle();
    const t = setInterval(() => void yukle(), 60_000);
    return () => { clearInterval(t); kontrol.current?.abort(); };
  }, [yukle]);

  async function yenidenDene(id: string) {
    if (islem) return;
    setIslem(id); setHata(""); setBasari("");
    try { setBasari((await platformApi<{ mesaj: string }>(`/platform/sistem-sagligi/olu-isler/${encodeURIComponent(id)}/yeniden-dene`, { method: "POST" })).mesaj); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Yeniden kuyruğa alınamadı"); }
    finally { setIslem(""); }
  }

  async function hataCozuldu(parmakIzi: string) {
    if (islem) return;
    setIslem(parmakIzi); setHata(""); setBasari("");
    try { setBasari((await platformApi<{ mesaj: string }>(`/platform/sistem-sagligi/hatalar/${encodeURIComponent(parmakIzi)}/cozuldu`, { method: "POST" })).mesaj); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "Hata işaretlenemedi"); }
    finally { setIslem(""); }
  }

  const acikAlarmlar = v?.alarmlar.filter((a) => a.acik) ?? [];
  const hatalar = v?.hatalar ?? [];
  const acikHatalar = hatalar.filter((h) => h.acik);
  const gorunenHatalar = tumHatalar ? hatalar : acikHatalar;
  const nabizGec = v?.worker.nabizGecikmesiDk !== null && v?.worker.nabizGecikmesiDk !== undefined && v.worker.nabizGecikmesiDk > v.esikler.workerNabizDk;
  const bellekOrani = v?.worker.son?.heapMb !== null && v?.worker.son?.heapMb !== undefined && v.worker.son.heapSinirMb ? Math.round((v.worker.son.heapMb / v.worker.son.heapSinirMb) * 100) : null;

  return <>
    <PageHeader title="Sistem sağlığı" subtitle="Arka plan işlerini, e-belge kuyruğunu ve bağlantı sorunlarını izleyin. Sorunlar platform yöneticilerine e-postayla bildirilir." actions={<Button disabled={yenileniyor || Boolean(islem)} onClick={() => void yukle()}><RefreshCw size={16} aria-hidden="true" />{yenileniyor ? "Yenileniyor…" : "Şimdi yenile"}</Button>} />
    <div className="platform-health-status"><Activity size={16} aria-hidden="true" /><span>Son ölçüm: <strong>{v ? zaman(v.zaman) : "Henüz alınmadı"}</strong></span><span>60 saniyede bir yenilenir.</span></div>
    {listeHatasi && <Alert tone="error">{listeHatasi} <Button size="sm" disabled={yenileniyor} onClick={() => void yukle()}>Tekrar dene</Button></Alert>}
    {!v && !listeHatasi && <Card><div className="platform-empty" role="status"><Activity size={26} aria-hidden="true" /><strong>Sistem ölçümleri yükleniyor…</strong></div></Card>}
    <Alert tone="error">{hata}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    {v && <div className="stack platform-health">
      {listeHatasi ? <Alert tone="warning">Güncel ölçümler alınamadı. Aşağıdaki bilgiler son başarılı ölçüme aittir.</Alert> : acikAlarmlar.length > 0
        ? <Alert tone="warning"><strong>{acikAlarmlar.length} açık sorun:</strong><ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>{acikAlarmlar.map((a) => <li key={a.anahtar}>{a.ozet} <span className="subtle">({zaman(a.ilkAt)}’den beri)</span></li>)}</ul></Alert>
        : <Alert tone="success">Açık sorun yok.</Alert>}
      <StatGrid>
        <Stat label="Worker son nabız" value={v.worker.son && v.worker.nabizGecikmesiDk !== null ? `${v.worker.nabizGecikmesiDk} dk önce` : "Kayıt yok"} tone={nabizGec ? "danger" : undefined} />
        <Stat label="Worker açılışı (24 saat)" value={v.worker.acilis24s} tone={v.worker.acilis24s > 2 ? "accent" : undefined} />
        <Stat label="Worker belleği" value={v.worker.son ? `${v.worker.son.heapMb ?? "—"} / ${v.worker.son.heapSinirMb ?? "—"} MB` : "—"} tone={bellekOrani !== null && bellekOrani >= 85 ? "danger" : undefined} />
        <Stat label="Kuyruktan düşen iş" value={v.kuyruk.oluIsler.length} tone={v.kuyruk.oluIsler.length ? "danger" : undefined} />
        <Stat label="Geciken gelen tarama" value={`${v.gecikenKursorler.length} / ${v.taranan}`} tone={v.gecikenKursorler.length ? "accent" : undefined} />
        <Stat label="Açık uygulama hatası (7 gün)" value={acikHatalar.length} tone={acikHatalar.length ? "danger" : undefined} />
      </StatGrid>

      <Card title="Uygulama hataları" pad={false} actions={hatalar.length > acikHatalar.length ? <Button size="sm" onClick={() => setTumHatalar((d) => !d)}>{tumHatalar ? "Yalnız açıkları göster" : `Çözülenleri de göster (${hatalar.length - acikHatalar.length})`}</Button> : undefined}>
        <p className="subtle" style={{ padding: "0 1.25rem", margin: "0 0 0.75rem" }}>API'nin 500 yanıtları ve kullanıcı ekranlarındaki yakalanmamış hatalar, aynı hata tek satırda toplanarak. Mesajlarda e-posta, VKN/TCKN, IBAN ve telefon gizlenir. Son 7 gün; kayıtlar 90 gün saklanır.</p>
        <TableWrap className="platform-responsive-table platform-health-table">
          <thead><tr><th>Son görülme</th><th>Kaynak</th><th>Hata</th><th className="num">Tekrar</th><th className="num">Firma</th><th>İşlem</th></tr></thead>
          <tbody>
            {gorunenHatalar.map((h) => <tr key={h.parmakIzi}>
              <td data-label="Son görülme" className="subtle">{zaman(h.sonGorulme)}<div>ilk: {zaman(h.ilkGorulme)}</div></td>
              <td data-label="Kaynak"><Badge variant={h.kaynak === "api" ? "danger" : "warning"}>{h.kaynak === "api" ? "API" : "Tarayıcı"}</Badge></td>
              <td data-label="Hata">
                <div className="mono" style={{ fontSize: "0.8rem" }}>{h.konum}</div>
                <div><strong>{h.ad}</strong>: {h.mesaj}</div>
                {h.yigin && <details><summary className="subtle">Ayrıntı</summary><pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem", margin: "0.4rem 0 0" }}>{h.yigin}</pre></details>}
                <div className="subtle" style={{ fontSize: "0.8rem" }}>{h.surum ? `Sürüm ${h.surum}` : ""}{h.sonIstekId ? ` · son istek ${h.sonIstekId}` : ""}</div>
              </td>
              <td data-label="Tekrar" className="num">{h.sayi}{h.saatSayi > 1 ? <div className="subtle">son saat {h.saatSayi}</div> : null}</td>
              <td data-label="Firma" className="num">{h.firmaSayisi}</td>
              <td data-label="İşlem">{h.acik
                ? <Button size="sm" disabled={Boolean(islem)} onClick={() => void hataCozuldu(h.parmakIzi)}>{islem === h.parmakIzi ? "İşaretleniyor…" : "Çözüldü"}</Button>
                : <Badge variant="success">Çözüldü {h.cozulduAt ? zaman(h.cozulduAt) : ""}</Badge>}</td>
            </tr>)}
            {!gorunenHatalar.length && <tr><td colSpan={6} className="empty">{hatalar.length ? "Açık hata yok." : "Son 7 günde uygulama hatası kaydı yok."}</td></tr>}
          </tbody>
        </TableWrap>
      </Card>

      {v.kuyruk.oluIsler.length > 0 && <Card title="Kuyruktan düşen işler" pad={false}>
        <TableWrap className="platform-responsive-table platform-health-table">
          <thead><tr><th>Zaman</th><th>Firma</th><th>İş</th><th>Hata</th><th>İşlem</th></tr></thead>
          <tbody>{v.kuyruk.oluIsler.map((o) => <tr key={o.id}><td data-label="Zaman" className="subtle">{zaman(o.zaman)}</td><td data-label="Firma" className="platform-cell-title">{o.unvan}</td><td data-label="İş" className="mono">{o.isTuru}</td><td data-label="Hata">{o.hata}</td><td data-label="İşlem"><Button size="sm" disabled={Boolean(islem)} onClick={() => void yenidenDene(o.id)}>{islem === o.id ? "Alınıyor…" : "Yeniden kuyruğa al"}</Button></td></tr>)}</tbody>
        </TableWrap>
      </Card>}

      {v.gecikenKursorler.length > 0 && <Card title={`Gelen taraması ${v.esikler.kursorSaat} saatten uzun süredir bitmeyen firmalar`} pad={false}>
        <TableWrap className="platform-responsive-table platform-health-table">
          <thead><tr><th>Firma</th><th>Sağlayıcı</th><th>Son başarılı tarama</th></tr></thead>
          <tbody>{v.gecikenKursorler.map((k) => <tr key={k.tenantId}><td data-label="Firma" className="platform-cell-title">{k.unvan}</td><td data-label="Sağlayıcı">{k.saglayici}</td><td data-label="Son başarılı tarama">{k.sonCekimAt ? zaman(k.sonCekimAt) : <Badge variant="warning">Hiç tamamlanmadı</Badge>}</td></tr>)}</tbody>
        </TableWrap>
      </Card>}

      <Card title="Zamanlayıcılar" pad={false}>
        <TableWrap className="platform-responsive-table platform-health-table">
          <thead><tr><th>İş</th><th>Son çalışma</th><th className="num">Süre / aralık</th><th>Son başarı</th><th>Son hata</th><th className="num">Çalışma</th></tr></thead>
          <tbody>
            {v.isler.map((i) => <tr key={i.isAdi}>
              <td data-label="İş" className="mono platform-cell-title">{i.isAdi}{i.ardisikHata > 0 && <div style={{ marginTop: 4 }}><Badge variant={i.ardisikHata >= v.esikler.ardisikHata ? "danger" : "warning"}>{i.ardisikHata} ardışık hata</Badge></div>}{i.saatlikAtlama > 0 && <div style={{ marginTop: 4 }}><Badge variant="danger">Son 1 saatte {i.saatlikAtlama} tur atlandı</Badge></div>}{i.ardisikUzun > 0 && <div style={{ marginTop: 4 }}><Badge variant={i.ardisikUzun >= v.esikler.ardisikUzunTur ? "danger" : "warning"}>{i.ardisikUzun} turdur aralığın %{Math.round(v.esikler.turAsimOrani * 100)}'inden uzun</Badge></div>}</td>
              <td data-label="Son çalışma" className="subtle">{zaman(i.sonBaslangic)}</td>
              <td data-label="Süre / aralık" className="num">{sure(i.sonSureMs)}{i.aralikMs ? <div className="subtle">/ {sure(i.aralikMs)}</div> : null}</td>
              <td data-label="Son başarı" className="subtle">{zaman(i.sonBasariAt)}</td>
              <td data-label="Son hata">{i.sonHata ? <><span className="subtle">{zaman(i.sonHataAt)}</span><div style={{ fontSize: "0.85rem" }}>{i.sonHata}</div></> : "—"}</td>
              <td data-label="Çalışma" className="num">{i.calismaSayisi}</td>
            </tr>)}
            {!v.isler.length && <tr><td colSpan={6} className="empty">Henüz nabız kaydı yok.</td></tr>}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="e-Belge kuyruğu" pad={false}>
        <div className="subtle" style={{ padding: "0 1.25rem 1rem" }}>Bekleyen {v.kuyruk.sayilar.waiting ?? 0} · çalışan {v.kuyruk.sayilar.active ?? 0} · ertelenen {v.kuyruk.sayilar.delayed ?? 0} · başarısız {v.kuyruk.sayilar.failed ?? 0}</div>
        <TableWrap className="platform-responsive-table platform-health-table">
          <thead><tr><th>Firma</th><th className="num">Bekleyen</th><th className="num">Çalışan</th><th className="num">Ertelenen</th><th className="num">Başarısız</th></tr></thead>
          <tbody>
            {v.kuyruk.firmalar.slice(0, 50).map((f) => <tr key={f.tenantId}><td data-label="Firma" className="platform-cell-title">{f.unvan}</td><td data-label="Bekleyen" className="num">{f.waiting ?? 0}</td><td data-label="Çalışan" className="num">{f.active ?? 0}</td><td data-label="Ertelenen" className="num">{f.delayed ?? 0}</td><td data-label="Başarısız" className="num">{f.failed ?? 0}</td></tr>)}
            {!v.kuyruk.firmalar.length && <tr><td colSpan={5} className="empty">Kuyrukta iş yok.</td></tr>}
          </tbody>
        </TableWrap>
        {v.kuyruk.firmalar.length > 50 && <p className="platform-list-caption">{v.kuyruk.firmalar.length} firmadan ilk 50 kayıt gösteriliyor.</p>}
      </Card>

      {v.baglantilar.length > 0 && <Card title="Hata veren bağlantılar" pad={false}>
        <TableWrap className="platform-responsive-table platform-health-table">
          <thead><tr><th>Firma</th><th>Bağlantı</th><th>Durum</th><th className="num">Ardışık hata</th><th>Son senkron</th><th>Hata</th></tr></thead>
          <tbody>{v.baglantilar.slice(0, 100).map((b, n) => <tr key={`${b.tenantId}-${b.aile}-${n}`}><td data-label="Firma" className="platform-cell-title">{b.unvan}</td><td data-label="Bağlantı">{b.aile} · {b.saglayici}</td><td data-label="Durum"><Badge variant={b.durum === "hata" ? "danger" : "warning"}>{b.durum}</Badge></td><td data-label="Ardışık hata" className="num">{b.ardisikHata}</td><td data-label="Son senkron" className="subtle">{zaman(b.sonSenkron)}</td><td data-label="Hata">{b.hata ?? "—"}</td></tr>)}</tbody>
        </TableWrap>
        {v.baglantilar.length > 100 && <p className="platform-list-caption">{v.baglantilar.length} bağlantıdan ilk 100 kayıt gösteriliyor.</p>}
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
