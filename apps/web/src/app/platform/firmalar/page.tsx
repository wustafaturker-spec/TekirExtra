"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PlatformArama, PlatformListeDurumu } from "@/components/platform-liste";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, TableWrap } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";

interface Firma {
  tenantId: string; unvan: string; vkn: string; kayitTarihi: string;
  planKodu: string; planAdi: string; durum: string; donemSonu: string | null; iptalTarihi: string | null;
  aktifKullanici: number; sonGiris: string | null; ebelgeSaglayici: string | null;
  bekleyenTalep: { id: string; istenenPlan: string; istenenPlanAdi: string } | null;
  /** PLT-09: dönem sonundan 15 gün geçti, ödeme işaretlenmedi (otomatik askı yok). */
  askiyaAlinacak?: boolean;
  sonOdemeAt?: string | null;
  /** PLT-10: firma KLN-24 ile destek izni verdiyse. */
  destek?: { izinBitis: string; acikOturum: { id: string; bitis: string; kisi: string } | null } | null;
}
interface Gecmis {
  degisiklikler: { zaman: string; oncekiPlan: string | null; yeniPlan: string; oncekiDurum: string | null; yeniDurum: string; neden: string | null }[];
  talepler: { id: string; zaman: string; mevcutPlan: string; istenenPlan: string; durum: string; aciklama: string | null; kararNotu: string | null }[];
  /** PLT-15: elle (PLT-09) ve sağlayıcıyla alınan ödemeler, başarısız denemeler. */
  odemeler?: { id?: string; zaman: string; aySayisi: number; tutar: number; kdv: number | null; kaynak?: "elle" | "saglayici"; saglayici?: string | null; not: string | null; yeniDonemSonu: string; fatura?: AbonelikFaturasi | null }[];
  basarisizDenemeler?: { zaman: string; saglayici: string; kaynak: string; aySayisi: number; toplam: number; hata: string | null }[];
  askiNedeni?: "odeme" | "diger" | null;
  /** PLT-14: otomatik yenileme kartı (anahtarlar dönmez). */
  kart?: { saglayici: string; son4: string | null; kartMarkasi: string | null; otomatikYenileme: boolean; aySayisi: number; denemeSayisi: number; sonDeneme: string | null; sonHata: string | null } | null;
}
/** PLT-23: ödemenin faturalayan firmadaki faturası. */
interface AbonelikFaturasi { no: string | null; durum: "bekliyor" | "taslak" | "kesinlesti" | "tahsil_edildi" | "hata"; hata: string | null }
const FATURA_DURUMU: Record<AbonelikFaturasi["durum"], { ad: string; ton: "success" | "danger" | "neutral" | "warning" }> = {
  bekliyor: { ad: "Fatura bekliyor", ton: "warning" }, taslak: { ad: "Taslak", ton: "neutral" }, kesinlesti: { ad: "Kesin, tahsilat yok", ton: "warning" },
  tahsil_edildi: { ad: "Kesin, tahsil edildi", ton: "success" }, hata: { ad: "Fatura açılamadı", ton: "danger" },
};
type Suzgec = "hepsi" | "talep" | "askiyaAlinacak" | "askida" | "iptal";
const ODEME_SURELERI = [1, 3, 6, 12] as const;

const PLANLAR = [{ kod: "baslangic", ad: "Başlangıç" }, { kod: "profesyonel", ad: "Profesyonel" }, { kod: "kurumsal", ad: "Kurumsal" }];
const DURUM: Record<string, { ad: string; ton: "success" | "danger" | "neutral" | "warning" }> = {
  aktif: { ad: "Aktif", ton: "success" }, deneme: { ad: "Deneme", ton: "neutral" }, askida: { ad: "Askıda", ton: "danger" }, iptal: { ad: "İptal", ton: "warning" },
};
const TALEP_DURUMU: Record<string, string> = { bekliyor: "Bekliyor", onaylandi: "Onaylandı", reddedildi: "Reddedildi", geri_cekildi: "Geri çekildi" };
const GORUNEN_EN_COK = 200;
const tarih = (s: string | null) => (s ? new Date(s).toLocaleDateString("tr-TR") : "—");
const tl = (x: number | string) => Number(x).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Platform P0-1 / P1-1: firmalar ve abonelikleri. Liste yalnız yönetim için
 * gereken sayıları ve durumları içerir; firma verisinin içeriği görünmez.
 */
function PlatformFirmalarIcerigi() {
  const parametreler = useSearchParams();
  const { veri: firmalar, yukleniyor, hata: listeHatasi, yenile: yukle } = usePlatformVerisi<Firma[]>("/platform/firmalar");
  const [destekIslem, setDestekIslem] = useState(false);
  const [arama, setArama] = useState("");
  const [suzgec, setSuzgec] = useState<Suzgec>("hepsi");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [secili, setSecili] = useState<Firma | null>(null);

  useEffect(() => {
    const secim = parametreler.get("goster");
    setSuzgec(secim === "talep" || secim === "askiyaAlinacak" || secim === "askida" || secim === "iptal" ? secim : "hepsi");
  }, [parametreler]);

  // PLT-32: ödeme raporundan gelen `?firma=<id>` o firmanın kartını açar.
  const istenenFirma = parametreler.get("firma");
  useEffect(() => {
    if (!istenenFirma || !firmalar) return;
    const bulunan = firmalar.find((f) => f.tenantId === istenenFirma);
    if (bulunan) setSecili(bulunan);
  }, [istenenFirma, firmalar]);

  const sayilar = useMemo(() => ({
    toplam: firmalar?.length ?? 0,
    talep: firmalar?.filter((f) => f.bekleyenTalep).length ?? 0,
    askiyaAlinacak: firmalar?.filter((f) => f.askiyaAlinacak).length ?? 0,
    askida: firmalar?.filter((f) => f.durum === "askida").length ?? 0,
    iptal: firmalar?.filter((f) => f.durum === "iptal").length ?? 0,
  }), [firmalar]);

  const aranan = arama.trim().toLocaleLowerCase("tr-TR");
  const suzulen = (firmalar ?? []).filter((f) =>
    (suzgec === "hepsi" || (suzgec === "talep" ? f.bekleyenTalep : suzgec === "askiyaAlinacak" ? f.askiyaAlinacak : f.durum === suzgec))
    && (!aranan || f.unvan.toLocaleLowerCase("tr-TR").includes(aranan) || f.vkn.includes(aranan)));

  /**
   * PLT-10: izinli firmanın paneli yeni sekmede salt okunur açılır. Sekme
   * tıklamayla hemen açılır (açılır pencere engeline takılmasın), token gelince
   * adres # ile verilir; sunucuya gitmez.
   */
  async function destekAc(f: Firma) {
    if (destekIslem) return;
    setDestekIslem(true);
    setHata("");
    setBasari("");
    const sekme = window.open("", "_blank");
    try {
      const s = await platformApi<{ token: string; bitis: string }>(`/platform/firmalar/${f.tenantId}/destek-oturumu`, { method: "POST" });
      if (sekme) {
        sekme.opener = null;
        sekme.location.href = `/destek#t=${encodeURIComponent(s.token)}`;
      }
      setBasari(`${f.unvan} için destek oturumu açıldı; ${new Date(s.bitis).toLocaleTimeString("tr-TR")} saatinde kapanır.`);
      yukle();
    } catch (e) {
      sekme?.close();
      setHata(e instanceof Error ? e.message : "Destek oturumu açılamadı");
    } finally { setDestekIslem(false); }
  }

  async function destekKapat(oturumId: string) {
    if (destekIslem) return;
    setDestekIslem(true); setHata(""); setBasari("");
    try {
      setBasari((await platformApi<{ mesaj: string }>(`/platform/firmalar/destek-oturumlari/${oturumId}/kapat`, { method: "POST" })).mesaj);
      yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Destek oturumu kapatılamadı");
    } finally { setDestekIslem(false); }
  }

  function tamamlandi(mesaj: string) {
    setBasari(mesaj);
    setHata("");
    setSecili(null);
    yukle();
  }

  return <>
    <PageHeader title="Firmalar" subtitle="Abonelikleri izleyin, plan taleplerini değerlendirin ve izinli destek oturumlarını yönetin." actions={<Button disabled={yukleniyor} onClick={yukle}><RefreshCw size={16} aria-hidden="true" />Yenile</Button>} />
    <Alert tone="error">{hata}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    <div className="platform-overview platform-firma-overview" aria-label="Firma durumları">
      {([
        ["hepsi", "Tüm firmalar", sayilar.toplam], ["talep", "Bekleyen plan talebi", sayilar.talep],
        ["askiyaAlinacak", "Ödemesi geciken", sayilar.askiyaAlinacak], ["askida", "Askıda", sayilar.askida], ["iptal", "İptal", sayilar.iptal],
      ] as const).map(([deger, ad, sayi]) => <button key={deger} className={`platform-metric${suzgec === deger ? " is-active" : ""}`} aria-pressed={suzgec === deger} onClick={() => setSuzgec(deger)}><span>{ad}</span><strong>{yukleniyor || listeHatasi ? "—" : sayi}</strong></button>)}
    </div>
    <Card title="Firma listesi" pad={false}>
      <div className="platform-filter-bar">
        <PlatformArama etiket="Firma ara" deger={arama} onChange={setArama} placeholder="Unvan veya VKN ile ara…" />
        <div style={{ minWidth: 200 }}><Field label="Göster"><Select value={suzgec} onChange={(e) => setSuzgec(e.target.value as Suzgec)}>
          <option value="hepsi">Tüm firmalar</option>
          <option value="talep">Bekleyen plan talebi</option>
          <option value="askiyaAlinacak">Ödemesi 15+ gün gecikenler</option>
          <option value="askida">Askıda</option>
          <option value="iptal">İptal</option>
        </Select></Field></div>
      </div>
      <div className="platform-list-caption" role="status">{yukleniyor ? "Firma listesi yükleniyor…" : listeHatasi ? "Firma listesi alınamadı" : `${suzulen.length} firma${suzulen.length > GORUNEN_EN_COK ? ` · İlk ${GORUNEN_EN_COK} kayıt gösteriliyor` : ""}`}</div>
      <TableWrap className="platform-responsive-table platform-firma-table">
        <thead><tr><th>Firma</th><th>Plan</th><th>Durum</th><th className="num">Kullanıcı</th><th>Son giriş</th><th>e-Belge</th><th>Talep</th><th>Destek</th><th>İşlem</th></tr></thead>
        <tbody>
          {(!yukleniyor && !listeHatasi ? suzulen : []).slice(0, GORUNEN_EN_COK).map((f) => (
            <tr key={f.tenantId}>
              <td data-label="Firma" className="platform-cell-title"><strong>{f.unvan}</strong><div className="subtle mono" style={{ fontSize: "0.8rem" }}>{f.vkn}</div></td>
              <td data-label="Plan">{f.planAdi}{f.donemSonu && <div className="subtle" style={{ fontSize: "0.8rem" }}>Dönem sonu {tarih(f.donemSonu)}</div>}</td>
              <td data-label="Durum"><Badge variant={DURUM[f.durum]?.ton ?? "neutral"}>{DURUM[f.durum]?.ad ?? f.durum}</Badge>{f.askiyaAlinacak && <div style={{ marginTop: 4 }}><Badge variant="warning">Ödeme gecikti</Badge></div>}</td>
              <td data-label="Kullanıcı" className="num">{f.aktifKullanici}</td>
              <td data-label="Son giriş" className="subtle">{f.sonGiris ? new Date(f.sonGiris).toLocaleString("tr-TR") : "Hiç"}</td>
              <td data-label="e-Belge">{f.ebelgeSaglayici ?? <span className="subtle">—</span>}</td>
              <td data-label="Plan talebi">{f.bekleyenTalep ? <Badge variant="info">{f.bekleyenTalep.istenenPlanAdi} istiyor</Badge> : <span className="subtle">—</span>}</td>
              <td data-label="Destek" className="platform-support-cell">
                {f.destek ? (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="subtle" style={{ fontSize: "0.8rem" }}>İzin {new Date(f.destek.izinBitis).toLocaleString("tr-TR")}&apos;e kadar</span>
                    {f.destek.acikOturum
                      ? <div className="row-tight"><Badge variant="warning">Bağlı: {f.destek.acikOturum.kisi}</Badge><Button size="sm" disabled={destekIslem} onClick={() => void destekKapat(f.destek!.acikOturum!.id)}>Kapat</Button></div>
                      : <Button size="sm" disabled={destekIslem} onClick={() => void destekAc(f)}>Destek oturumu aç</Button>}
                  </div>
                ) : <span className="subtle">İzin yok</span>}
              </td>
              <td data-label="İşlem"><Button size="sm" onClick={() => setSecili(f)}>Yönet</Button></td>
            </tr>
          ))}
          <PlatformListeDurumu sutun={9} yukleniyor={yukleniyor} hata={listeHatasi} bos={!suzulen.length} baslik={firmalar?.length ? "Eşleşen firma yok." : "Henüz firma yok."} aciklama={firmalar?.length ? "Arama metnini veya durum filtresini değiştirin." : "Firma kayıtları oluşturulduğunda burada listelenir."} onTekrar={yukle} />
        </tbody>
      </TableWrap>
      {suzulen.length > GORUNEN_EN_COK && <p className="subtle" style={{ padding: "0.75rem 1rem", margin: 0 }}>{suzulen.length} firmadan ilk {GORUNEN_EN_COK} tanesi gösteriliyor; aramayı daraltın.</p>}
    </Card>
    {secili && <FirmaYonet firma={secili} onKapat={() => setSecili(null)} onTamam={tamamlandi} />}
  </>;
}

function FirmaYonet({ firma, onKapat, onTamam }: { firma: Firma; onKapat: () => void; onTamam: (mesaj: string) => void }) {
  const { veri: gecmis, yukleniyor: gecmisYukleniyor, hata: gecmisHatasi, yenile: gecmisYenile } = usePlatformVerisi<Gecmis>(`/platform/firmalar/${firma.tenantId}/gecmis`);
  const [hata, setHata] = useState("");
  const [islem, setIslem] = useState(false);
  const [kararNotu, setKararNotu] = useState("");
  const [neden, setNeden] = useState("");
  const [askiNedeni, setAskiNedeni] = useState<"odeme" | "diger">(firma.askiyaAlinacak ? "odeme" : "diger");
  const [plan, setPlan] = useState(firma.planKodu === "v1" ? "profesyonel" : firma.planKodu);
  const [aySayisi, setAySayisi] = useState<(typeof ODEME_SURELERI)[number]>(1);
  const [tutar, setTutar] = useState("");
  const [odemeNotu, setOdemeNotu] = useState("");
  // PLT-27: bu ödeme formunun işlem anahtarı; yanıt kaybolup yeniden denenirse aynısı gider, ikinci ödeme oluşmaz.
  const [islemAnahtari] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));
  // "1.500,50" / "1500,5" / "1500.50" → "1500.50"; kuruştan fazla ondalık ya da geçersiz metin null.
  const tutarMetni = ((v: string) => { const t = v.trim().replace(/\s/g, ""); const n = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t; return /^\d{1,8}(\.\d{1,2})?$/.test(n) ? n : null; })(tutar);

  async function calistir(is: () => Promise<{ mesaj: string }>) {
    setIslem(true);
    setHata("");
    try { onTamam((await is()).mesaj); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı"); } finally { setIslem(false); }
  }
  const post = (yol: string, govde: unknown) => platformApi<{ mesaj: string }>(yol, { method: "POST", body: JSON.stringify(govde) });
  const askida = firma.durum === "askida";

  return (
    <Modal genis baslik={firma.unvan} aciklama={`VKN ${firma.vkn} · ${firma.planAdi} · ${DURUM[firma.durum]?.ad ?? firma.durum} · kayıt ${tarih(firma.kayitTarihi)}`} onKapat={onKapat}>
      <div className="stack platform-firma-modal">
        <Alert tone="error">{hata}</Alert>
        {firma.bekleyenTalep && (
          <Card title={`Plan talebi: ${firma.planAdi} → ${firma.bekleyenTalep.istenenPlanAdi}`}>
            <div className="stack">
              {gecmis?.talepler.find((t) => t.id === firma.bekleyenTalep?.id)?.aciklama && <p style={{ margin: 0 }}>“{gecmis.talepler.find((t) => t.id === firma.bekleyenTalep?.id)?.aciklama}”</p>}
              <Field label="Karar notu (firmaya görünür)"><Input value={kararNotu} onChange={(e) => setKararNotu(e.target.value)} maxLength={500} placeholder="Örn. ödeme alındı / fiyat teklifi gönderildi" /></Field>
              <div className="row-tight">
                <Button variant="primary" disabled={islem} onClick={() => void calistir(() => post(`/platform/firmalar/talepler/${firma.bekleyenTalep!.id}/karar`, { onay: true, not: kararNotu || null }))}>Onayla</Button>
                <Button variant="danger" disabled={islem} onClick={() => void calistir(() => post(`/platform/firmalar/talepler/${firma.bekleyenTalep!.id}/karar`, { onay: false, not: kararNotu || null }))}>Reddet</Button>
              </div>
            </div>
          </Card>
        )}
        <Card title="Ödeme alındı">
          <div className="stack">
            <p className="subtle" style={{ margin: 0 }}>
              {firma.donemSonu ? `Dönem sonu ${tarih(firma.donemSonu)}; seçilen süre bu tarihe eklenir.` : "Dönem tanımlı değil; dönem bugünden başlar."}
              {" "}Firmanın durumu değişmez{askida ? " — askıdan çıkarmak için aşağıdaki işlemi ayrıca yapın" : ""}.
            </p>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ minWidth: 140 }}><Field label="Süre"><Select value={aySayisi} onChange={(e) => setAySayisi(Number(e.target.value) as (typeof ODEME_SURELERI)[number])}>{ODEME_SURELERI.map((a) => <option key={a} value={a}>{a} ay</option>)}</Select></Field></div>
              <div style={{ minWidth: 140 }}><Field label="Tutar (TL)"><Input inputMode="decimal" value={tutar} onChange={(e) => setTutar(e.target.value)} placeholder="0,00" /></Field></div>
              <div style={{ flex: 1, minWidth: 200 }}><Field label="Not"><Input value={odemeNotu} onChange={(e) => setOdemeNotu(e.target.value)} maxLength={500} placeholder="Örn. havale, dekont no" /></Field></div>
              <Button variant="primary" disabled={islem || tutarMetni === null} onClick={() => void calistir(() => post(`/platform/firmalar/${firma.tenantId}/odeme`, { aySayisi, tutar: tutarMetni, not: odemeNotu || null, islemAnahtari }))}>Ödemeyi kaydet</Button>
            </div>
          </div>
        </Card>
        {askida && gecmis?.askiNedeni && <Alert tone="warning">{gecmis.askiNedeni === "odeme" ? "Ödeme beklendiği için askıda: firma kartla ödeyince kendiliğinden açılır." : "Ödeme dışı bir nedenle askıda: ödeme gelse de yalnız platform açar."}</Alert>}
        <Card title="Abonelik işlemi">
          <div className="stack">
            <Field label="Neden (zorunlu, geçmişe yazılır)"><Input value={neden} onChange={(e) => setNeden(e.target.value)} maxLength={500} placeholder="Örn. Ekim ödemesi 30 gün gecikti" /></Field>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ minWidth: 180 }}><Field label="Plan"><Select value={plan} onChange={(e) => setPlan(e.target.value)}>{PLANLAR.map((p) => <option key={p.kod} value={p.kod}>{p.ad}</option>)}</Select></Field></div>
              <Button disabled={islem || neden.trim().length < 5} onClick={() => void calistir(() => post(`/platform/firmalar/${firma.tenantId}/plan`, { planKodu: plan, neden }))}>Planı değiştir</Button>
              {!askida && <div style={{ minWidth: 220 }}><Field label="Askı nedeni"><Select value={askiNedeni} onChange={(e) => setAskiNedeni(e.target.value as "odeme" | "diger")}>
                <option value="odeme">Ödeme yok (ödeyince kendiliğinden açılır)</option>
                <option value="diger">Diğer (yalnız platform açar)</option>
              </Select></Field></div>}
              <Button variant={askida ? "primary" : "danger"} disabled={islem || neden.trim().length < 5} onClick={() => void calistir(() => post(`/platform/firmalar/${firma.tenantId}/durum`, askida ? { durum: "aktif", neden } : { durum: "askida", neden, askiNedeni }))}>
                {askida ? "Askıdan çıkar" : "Askıya al (salt okunur)"}
              </Button>
            </div>
          </div>
        </Card>
        {gecmis?.kart && (
          <Alert tone={gecmis.kart.sonHata ? "warning" : "success"}>
            Kayıtlı kart: {gecmis.kart.kartMarkasi ?? ""} {gecmis.kart.son4 ? `**** ${gecmis.kart.son4}` : ""} ({gecmis.kart.saglayici}) · otomatik yenileme {gecmis.kart.otomatikYenileme ? `açık, ${gecmis.kart.aySayisi} ay` : "kapalı"}
            {gecmis.kart.sonHata ? ` · son deneme başarısız (${gecmis.kart.denemeSayisi}/3): ${gecmis.kart.sonHata}` : ""}
          </Alert>
        )}
        {gecmis?.odemeler?.length ? (
          <Card title="Ödemeler" pad={false}>
            <TableWrap>
              <thead><tr><th>Zaman</th><th>Yöntem</th><th>Süre</th><th className="num">Toplam</th><th>Yeni dönem sonu</th><th>Fatura</th><th>Not</th></tr></thead>
              <tbody>{gecmis.odemeler.map((o, i) => (
                <tr key={o.id ?? i}><td className="subtle" style={{ whiteSpace: "nowrap" }}>{new Date(o.zaman).toLocaleString("tr-TR")}</td><td>{o.kaynak === "saglayici" ? <Badge variant="info">{o.saglayici === "paytr" ? "PayTR" : "iyzico"}</Badge> : "Elle"}</td><td>{o.aySayisi} ay</td><td className="num">{tl(o.tutar)} TL{o.kdv !== null && <div className="subtle" style={{ fontSize: "0.8rem" }}>KDV {tl(o.kdv)}</div>}</td><td>{tarih(o.yeniDonemSonu)}</td>
                  <td>{o.fatura ? <><Badge variant={FATURA_DURUMU[o.fatura.durum]?.ton ?? "neutral"}>{FATURA_DURUMU[o.fatura.durum]?.ad ?? o.fatura.durum}</Badge>{o.fatura.no && <div className="subtle" style={{ fontSize: "0.8rem" }}>{o.fatura.no}</div>}{o.fatura.hata && <div className="subtle" style={{ fontSize: "0.8rem" }}>{o.fatura.hata}</div>}</> : <span className="subtle">—</span>}</td>
                  <td>{o.not ?? "—"}</td></tr>
              ))}</tbody>
            </TableWrap>
          </Card>
        ) : null}
        <Card title="Geçmiş" pad={false}>
          <TableWrap>
            <thead><tr><th>Zaman</th><th>Değişiklik</th><th>Neden / not</th></tr></thead>
            <tbody>
              {[
                ...(gecmis?.degisiklikler ?? []).map((d) => ({ zaman: d.zaman, ne: `${d.oncekiPlan ?? "—"} → ${d.yeniPlan} · ${d.oncekiDurum ?? "—"} → ${d.yeniDurum}`, not: d.neden })),
                ...(gecmis?.talepler ?? []).map((t) => ({ zaman: t.zaman, ne: `Talep ${t.mevcutPlan} → ${t.istenenPlan}: ${TALEP_DURUMU[t.durum] ?? t.durum}`, not: t.kararNotu ?? t.aciklama })),
                ...(gecmis?.basarisizDenemeler ?? []).map((d) => ({ zaman: d.zaman, ne: `Başarısız ödeme denemesi (${d.saglayici}, ${d.kaynak === "eposta" ? "e-posta bağlantısı" : d.kaynak === "otomatik" ? "otomatik yenileme" : "panel"}): ${d.aySayisi} ay, ${tl(d.toplam)} TL`, not: d.hata })),
              ].sort((a, b) => b.zaman.localeCompare(a.zaman)).map((s, i) => (
                <tr key={i}><td className="subtle" style={{ whiteSpace: "nowrap" }}>{new Date(s.zaman).toLocaleString("tr-TR")}</td><td>{s.ne}</td><td>{s.not ?? "—"}</td></tr>
              ))}
              <PlatformListeDurumu sutun={3} yukleniyor={gecmisYukleniyor} hata={gecmisHatasi} bos={Boolean(gecmis && !gecmis.degisiklikler.length && !gecmis.talepler.length && !gecmis.basarisizDenemeler?.length)} baslik="Abonelik geçmişi yok." onTekrar={gecmisYenile} />
            </tbody>
          </TableWrap>
        </Card>
      </div>
    </Modal>
  );
}

export default function PlatformFirmalar() {
  return <Suspense fallback={<p className="muted" role="status">Firmalar yükleniyor…</p>}><PlatformFirmalarIcerigi /></Suspense>;
}
