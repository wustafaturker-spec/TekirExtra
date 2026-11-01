"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Download, RefreshCw } from "lucide-react";
import { ayBasiTR, bugunTR, takvimGunuMu, yilBasiTR } from "@tekirextra/shared";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Para, Select, Stat, StatGrid, TableWrap, Tabs, Tarih } from "@/components/ui";
import { PlatformArama, PlatformListeDurumu } from "@/components/platform-liste";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { platformIndir } from "@/lib/platform-api";

/* ─── Türler (API: /platform/odeme-raporu) ───────────────────────────────── */
type Kanal = "elle" | "panel" | "eposta" | "otomatik" | "saglayici";
type FaturaDurumu = "yok" | "bekliyor" | "taslak" | "kesinlesti" | "tahsil_edildi" | "hata";
type Sekme = "odemeler" | "sorunlu" | "yaklasan";

interface Satir {
  odemeId: string; tenantId: string; unvan: string; vkn: string | null; zaman: string; aySayisi: number;
  toplam: string; matrah: string; kdv: string; kdvHesaplandi: boolean; kaynak: "elle" | "saglayici"; saglayici: string | null; kanal: Kanal;
  oncekiDonemSonu: string | null; yeniDonemSonu: string; not: string | null; kaydeden: string | null; fatura: { no: string | null; durum: string } | null;
}
interface Ozet { adet: number; toplam: string; matrah: string; kdv: string; hesaplananVar: boolean; kanallar: { kanal: Kanal; adet: number; toplam: string }[] }
interface Rapor {
  aralik: { baslangic: string; bitis: string };
  ozet: Ozet;
  onceki: { baslangic: string; bitis: string; ozet: Ozet };
  kayitlar: Satir[]; toplamKayit: number; sayfa: number; adet: number; saglayicilar: string[];
}
interface Aylik { aylar: { ay: string; adet: number; toplam: string; matrah: string }[] }
interface Sorunlu {
  denemeler: { id: string; tenantId: string; unvan: string; zaman: string; saglayici: string; ortam: string; kanal: string; aySayisi: number; toplam: string; durum: "basarisiz" | "sonuclanmadi"; hata: string | null }[];
  kartlar: { tenantId: string; unvan: string; saglayici: string; son4: string | null; kartMarkasi: string | null; otomatikYenileme: boolean; aySayisi: number; denemeSayisi: number; sonDeneme: string | null; sonHata: string | null }[];
}
interface Yaklasan {
  gun: number;
  kayitlar: {
    tenantId: string; unvan: string; planKodu: string; planAdi: string; durum: string; donemSonu: string; kalanGun: number;
    kart: { saglayici: string | null; son4: string | null; kartMarkasi: string | null; otomatikYenileme: boolean; aySayisi: number | null } | null;
    beklenen: { aySayisi: number; matrah: string; kdv: string; toplam: string } | null;
  }[];
}

const KANAL_ADI: Record<Kanal, string> = { elle: "Elle kayıt", panel: "Panelden kartla", eposta: "E-posta bağlantısı", otomatik: "Otomatik yenileme", saglayici: "Sağlayıcı" };
const FATURA: Record<FaturaDurumu, { ad: string; ton: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  yok: { ad: "Faturasız", ton: "neutral" },
  bekliyor: { ad: "Fatura bekliyor", ton: "warning" },
  taslak: { ad: "Taslak", ton: "info" },
  kesinlesti: { ad: "Tahsilat bekliyor", ton: "warning" },
  tahsil_edildi: { ad: "Tahsil edildi", ton: "success" },
  hata: { ad: "Hata", ton: "danger" },
};
const SAGLAYICI_ADI: Record<string, string> = { iyzico: "iyzico", paytr: "PayTR" };
const DURUM_ADI: Record<string, string> = { aktif: "Aktif", deneme: "Deneme", askida: "Askıda", iptal: "İptal" };
const AY_ADI = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const ADET = 50;

/* ─── Süzgeç (adres çubuğunda) ───────────────────────────────────────────── */
interface Filtre { sekme: Sekme; baslangic: string; bitis: string; arama: string; kanal: Kanal | ""; saglayici: string; faturaDurumu: FaturaDurumu | ""; sayfa: number; gun: number }
const varsayilan = (): Filtre => ({ sekme: "odemeler", baslangic: ayBasiTR(), bitis: bugunTR(), arama: "", kanal: "", saglayici: "", faturaDurumu: "", sayfa: 1, gun: 30 });

function filtreOku(p: Pick<URLSearchParams, "get">): Filtre {
  const v = varsayilan();
  const sekme = p.get("sekme");
  const gun = (x: string | null, yedek: string) => (x && takvimGunuMu(x) ? x : yedek);
  const kanal = p.get("kanal") ?? "";
  const fatura = p.get("fatura") ?? "";
  const sayfa = Number(p.get("sayfa") ?? "1");
  const yenilemeGunu = Number(p.get("gun") ?? "30");
  return {
    sekme: sekme === "sorunlu" || sekme === "yaklasan" ? sekme : "odemeler",
    baslangic: gun(p.get("baslangic"), v.baslangic),
    bitis: gun(p.get("bitis"), v.bitis),
    arama: (p.get("arama") ?? "").trim().slice(0, 100),
    kanal: kanal in KANAL_ADI ? (kanal as Kanal) : "",
    saglayici: (p.get("saglayici") ?? "").slice(0, 20),
    faturaDurumu: fatura in FATURA ? (fatura as FaturaDurumu) : "",
    sayfa: Number.isInteger(sayfa) && sayfa > 0 && sayfa <= 100000 ? sayfa : 1,
    gun: [30, 60, 90].includes(yenilemeGunu) ? yenilemeGunu : 30,
  };
}

const URL_ADI: Record<keyof Filtre, string> = { sekme: "sekme", baslangic: "baslangic", bitis: "bitis", arama: "arama", kanal: "kanal", saglayici: "saglayici", faturaDurumu: "fatura", sayfa: "sayfa", gun: "gun" };
function filtreYaz(ek: Partial<Filtre>) {
  const url = new URL(window.location.href);
  const yeni = { ...filtreOku(url.searchParams), ...ek };
  const v = varsayilan();
  for (const alan of Object.keys(URL_ADI) as (keyof Filtre)[]) {
    if (yeni[alan] === v[alan]) url.searchParams.delete(URL_ADI[alan]);
    else url.searchParams.set(URL_ADI[alan], String(yeni[alan]));
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Kısayollar: bu ay (bugüne kadar), geçen ay, bu yıl (bugüne kadar). */
function kisayol(tur: "buAy" | "gecenAy" | "buYil"): { baslangic: string; bitis: string } {
  const bugun = bugunTR();
  if (tur === "buAy") return { baslangic: ayBasiTR(), bitis: bugun };
  if (tur === "buYil") return { baslangic: yilBasiTR(), bitis: bugun };
  const [y, m] = bugun.split("-").map(Number);
  const onceki = new Date(Date.UTC(y, m - 2, 1));
  const son = new Date(Date.UTC(y, m - 1, 0));
  return { baslangic: onceki.toISOString().slice(0, 10), bitis: son.toISOString().slice(0, 10) };
}

const tl = (deger: string | number) => <Para deger={deger} dovizCinsi="TRY" />;
const gunGoster = (g: string) => `${g.slice(8, 10)}.${g.slice(5, 7)}.${g.slice(0, 4)}`;

/** Önceki döneme göre değişim (%); önceki 0 ise yalnız "yeni". */
function fark(simdi: string, onceki: string): { metin: string; ton: "success" | "danger" | "default" } {
  const a = Number(simdi), b = Number(onceki);
  if (b === 0) return { metin: a === 0 ? "değişim yok" : "önceki dönemde tahsilat yok", ton: "default" };
  const yuzde = ((a - b) / b) * 100;
  if (Math.abs(yuzde) < 0.05) return { metin: "değişim yok", ton: "default" };
  return { metin: `${yuzde > 0 ? "+" : "−"}%${Math.abs(yuzde).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`, ton: yuzde > 0 ? "success" : "danger" };
}

/* ─── Sayfa ──────────────────────────────────────────────────────────────── */
function OdemeRaporu() {
  const parametreler = useSearchParams();
  const filtre = filtreOku(parametreler);
  const [arama, setArama] = useState(filtre.arama);
  useEffect(() => { setArama(filtre.arama); }, [filtre.arama]);
  useEffect(() => {
    if (arama.trim() === filtre.arama) return;
    const t = setTimeout(() => filtreYaz({ arama: arama.trim().slice(0, 100), sayfa: 1 }), 300);
    return () => clearTimeout(t);
  }, [arama, filtre.arama]);
  const [hata, setHata] = useState("");
  const [indiriliyor, setIndiriliyor] = useState("");

  const aralikHatasi = filtre.bitis < filtre.baslangic ? "Bitiş tarihi başlangıçtan önce olamaz." : "";
  const suzgecSorgusu = new URLSearchParams({ baslangic: filtre.baslangic, bitis: filtre.bitis });
  if (filtre.arama) suzgecSorgusu.set("arama", filtre.arama);
  if (filtre.kanal) suzgecSorgusu.set("kanal", filtre.kanal);
  if (filtre.saglayici) suzgecSorgusu.set("saglayici", filtre.saglayici);
  if (filtre.faturaDurumu) suzgecSorgusu.set("faturaDurumu", filtre.faturaDurumu);
  const listeSorgusu = new URLSearchParams(suzgecSorgusu);
  listeSorgusu.set("sayfa", String(filtre.sayfa));
  listeSorgusu.set("adet", String(ADET));

  const rapor = usePlatformVerisi<Rapor>(filtre.sekme === "odemeler" && !aralikHatasi ? `/platform/odeme-raporu?${listeSorgusu}` : null);
  const aylik = usePlatformVerisi<Aylik>(filtre.sekme === "odemeler" ? "/platform/odeme-raporu/aylik" : null);
  const sorunlu = usePlatformVerisi<Sorunlu>(filtre.sekme === "sorunlu" && !aralikHatasi ? `/platform/odeme-raporu/sorunlu?baslangic=${filtre.baslangic}&bitis=${filtre.bitis}` : null);
  const yaklasan = usePlatformVerisi<Yaklasan>(filtre.sekme === "yaklasan" ? `/platform/odeme-raporu/yaklasan?gun=${filtre.gun}` : null);
  const sorunSayisi = sorunlu.veri ? sorunlu.veri.denemeler.length + sorunlu.veri.kartlar.length : null;

  async function indir(bicim: "xlsx" | "csv") {
    setHata("");
    setIndiriliyor(bicim);
    try {
      await platformIndir(`/platform/odeme-raporu/disari-aktar?${suzgecSorgusu}&bicim=${bicim}`, `platform-odemeleri.${bicim}`);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Dosya indirilemedi.");
    } finally {
      setIndiriliyor("");
    }
  }

  const yenile = () => { rapor.yenile(); aylik.yenile(); sorunlu.yenile(); yaklasan.yenile(); };
  const sekmeDegistir = (sekme: Sekme) => filtreYaz({ sekme, sayfa: 1 });

  return (
    <div className="stack platform-payment-report">
      <PageHeader
        title="Ödeme raporu"
        subtitle="Firmaların abonelik ödemeleri, sorunlu tahsilatlar ve yaklaşan yenilemeler. Tutarlar TL; elle girilen ödemelerde KDV toplamdan %20 ile ayrıştırılır."
        actions={
          <>
            {filtre.sekme === "odemeler" && (
              <>
                <Button disabled={Boolean(indiriliyor) || Boolean(aralikHatasi)} onClick={() => void indir("xlsx")}><Download size={16} aria-hidden="true" />{indiriliyor === "xlsx" ? "Hazırlanıyor…" : "Excel"}</Button>
                <Button disabled={Boolean(indiriliyor) || Boolean(aralikHatasi)} onClick={() => void indir("csv")}><Download size={16} aria-hidden="true" />{indiriliyor === "csv" ? "Hazırlanıyor…" : "CSV"}</Button>
              </>
            )}
            <Button aria-label="Yenile" onClick={yenile}><RefreshCw size={16} aria-hidden="true" /></Button>
          </>
        }
      />
      {hata && <Alert tone="error">{hata}</Alert>}

      <Tabs<Sekme>
        ariaLabel="Ödeme raporu bölümleri"
        idPrefix="odeme-raporu"
        value={filtre.sekme}
        onChange={sekmeDegistir}
        items={[
          { deger: "odemeler", baslik: "Ödemeler" },
          { deger: "sorunlu", baslik: <>Sorunlu tahsilatlar{sorunSayisi ? <> <Badge variant="warning">{sorunSayisi}</Badge></> : null}</> },
          { deger: "yaklasan", baslik: "Yaklaşan yenilemeler" },
        ]}
      />

      {filtre.sekme !== "yaklasan" && (
        <Card className="payment-report-filters">
          <div className="payment-report-filters__dates">
            <div className="payment-report-shortcuts" role="group" aria-label="Hazır dönemler">
              {([["buAy", "Bu ay"], ["gecenAy", "Geçen ay"], ["buYil", "Bu yıl"]] as const).map(([tur, ad]) => {
                const a = kisayol(tur);
                const secili = a.baslangic === filtre.baslangic && a.bitis === filtre.bitis;
                return <Button key={tur} size="sm" variant={secili ? "primary" : undefined} aria-pressed={secili} onClick={() => filtreYaz({ ...a, sayfa: 1 })}>{ad}</Button>;
              })}
            </div>
            <Field label="Başlangıç"><Input type="date" value={filtre.baslangic} max={filtre.bitis} onChange={(e) => e.target.value && filtreYaz({ baslangic: e.target.value, sayfa: 1 })} /></Field>
            <Field label="Bitiş"><Input type="date" value={filtre.bitis} min={filtre.baslangic} onChange={(e) => e.target.value && filtreYaz({ bitis: e.target.value, sayfa: 1 })} /></Field>
          </div>
          {filtre.sekme === "odemeler" && (
            <div className="payment-report-filters__fields">
              <PlatformArama etiket="Firma ara" deger={arama} onChange={setArama} placeholder="Firma adı veya VKN" />
              <Field label="Kaynak">
                <Select value={filtre.kanal} onChange={(e) => filtreYaz({ kanal: e.target.value as Kanal | "", sayfa: 1 })}>
                  <option value="">Tümü</option>
                  {(Object.keys(KANAL_ADI) as Kanal[]).map((k) => <option key={k} value={k}>{KANAL_ADI[k]}</option>)}
                </Select>
              </Field>
              <Field label="Sağlayıcı">
                <Select value={filtre.saglayici} onChange={(e) => filtreYaz({ saglayici: e.target.value, sayfa: 1 })}>
                  <option value="">Tümü</option>
                  {[...new Set([...(rapor.veri?.saglayicilar ?? []), ...(filtre.saglayici ? [filtre.saglayici] : [])])].map((s) => <option key={s} value={s}>{SAGLAYICI_ADI[s] ?? s}</option>)}
                </Select>
              </Field>
              <Field label="Fatura durumu">
                <Select value={filtre.faturaDurumu} onChange={(e) => filtreYaz({ faturaDurumu: e.target.value as FaturaDurumu | "", sayfa: 1 })}>
                  <option value="">Tümü</option>
                  {(Object.keys(FATURA) as FaturaDurumu[]).map((f) => <option key={f} value={f}>{FATURA[f].ad}</option>)}
                </Select>
              </Field>
            </div>
          )}
          {aralikHatasi && <Alert tone="error">{aralikHatasi}</Alert>}
        </Card>
      )}

      {filtre.sekme === "odemeler" && <OdemelerSekmesi rapor={rapor} aylik={aylik} sayfaDegistir={(sayfa) => filtreYaz({ sayfa })} />}
      {filtre.sekme === "sorunlu" && <SorunluSekmesi veri={sorunlu} />}
      {filtre.sekme === "yaklasan" && <YaklasanSekmesi veri={yaklasan} gun={filtre.gun} gunDegistir={(gun) => filtreYaz({ gun })} />}
    </div>
  );
}

type Veri<T> = { veri: T | null; yukleniyor: boolean; hata: string; yenile: () => void };

/* ─── PLT-32/34: ödemeler ────────────────────────────────────────────────── */
function OdemelerSekmesi({ rapor, aylik, sayfaDegistir }: { rapor: Veri<Rapor>; aylik: Veri<Aylik>; sayfaDegistir: (sayfa: number) => void }) {
  const r = rapor.veri;
  const degisim = r ? fark(r.ozet.toplam, r.onceki.ozet.toplam) : null;
  const sonSayfa = r ? Math.max(1, Math.ceil(r.toplamKayit / r.adet)) : 1;
  return (
    <div id="odeme-raporu-panel-odemeler" role="tabpanel" aria-labelledby="odeme-raporu-tab-odemeler" className="stack">
      <StatGrid>
        <Stat
          label="Tahsilat (KDV dahil)"
          tone="accent"
          value={r ? tl(r.ozet.toplam) : "…"}
          hint={r && degisim ? <>Önceki dönem ({gunGoster(r.onceki.baslangic)}–{gunGoster(r.onceki.bitis)}): {tl(r.onceki.ozet.toplam)} · <span className={degisim.ton === "default" ? undefined : `payment-report-delta is-${degisim.ton}`}>{degisim.metin}</span></> : undefined}
        />
        <Stat label="Matrah" value={r ? tl(r.ozet.matrah) : "…"} hint={r ? <>Önceki dönem: {tl(r.onceki.ozet.matrah)}</> : undefined} />
        <Stat label="KDV" value={r ? tl(r.ozet.kdv) : "…"} hint={r?.ozet.hesaplananVar ? "Elle girilen ödemelerden hesaplanan KDV içerir" : r ? <>Önceki dönem: {tl(r.onceki.ozet.kdv)}</> : undefined} />
        <Stat label="Ödeme sayısı" value={r ? r.ozet.adet.toLocaleString("tr-TR") : "…"} hint={r ? `Önceki dönem: ${r.onceki.ozet.adet.toLocaleString("tr-TR")}` : undefined} />
      </StatGrid>

      {r && r.ozet.kanallar.length > 0 && (
        <Card title="Kaynağa göre">
          <ul className="payment-report-channels">
            {r.ozet.kanallar.map((k) => {
              const pay = Number(r.ozet.toplam) > 0 ? (Number(k.toplam) / Number(r.ozet.toplam)) * 100 : 0;
              return (
                <li key={k.kanal}>
                  <span>{KANAL_ADI[k.kanal]}</span>
                  <span className="payment-report-channels__track" aria-hidden="true"><i style={{ width: `${Math.max(pay, 1)}%` }} /></span>
                  <strong>{tl(k.toplam)}</strong>
                  <small>{k.adet} ödeme · %{pay.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</small>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <AylikGrafik veri={aylik} />

      <Card pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Tarih</th><th>Firma</th><th>Kaynak</th><th>Süre / dönem sonu</th>
              <th className="num">Matrah</th><th className="num">KDV</th><th className="num">Toplam</th><th>Fatura</th><th>Kaydeden</th>
            </tr>
          </thead>
          <tbody>
            <PlatformListeDurumu sutun={9} yukleniyor={rapor.yukleniyor} hata={rapor.hata} bos={Boolean(r && r.kayitlar.length === 0)} baslik="Bu dönemde ödeme yok" aciklama="Tarih aralığını ya da süzgeçleri değiştirin." onTekrar={rapor.yenile} />
            {!rapor.yukleniyor && r?.kayitlar.map((s) => {
              const f = FATURA[(s.fatura?.durum ?? "yok") as FaturaDurumu] ?? { ad: s.fatura?.durum ?? "", ton: "neutral" as const };
              return (
                <tr key={s.odemeId}>
                  <td data-label="Tarih"><Tarih deger={s.zaman} saatli /></td>
                  <td data-label="Firma"><Link href={`/platform/firmalar?firma=${s.tenantId}`}><strong>{s.unvan}</strong></Link>{s.vkn && <small className="muted payment-report-sub">VKN {s.vkn}</small>}</td>
                  <td data-label="Kaynak">{KANAL_ADI[s.kanal]}{s.saglayici && <small className="muted payment-report-sub">{SAGLAYICI_ADI[s.saglayici] ?? s.saglayici}</small>}</td>
                  <td data-label="Süre / dönem sonu">{s.aySayisi} ay<small className="muted payment-report-sub">{s.oncekiDonemSonu ? <><Tarih deger={s.oncekiDonemSonu} /> → </> : null}<Tarih deger={s.yeniDonemSonu} /></small></td>
                  <td data-label="Matrah" className="num">{tl(s.matrah)}{s.kdvHesaplandi && <small className="muted payment-report-sub" title="Elle girilen toplamdan %20 KDV ile ayrıştırıldı">hesaplanan</small>}</td>
                  <td data-label="KDV" className="num">{tl(s.kdv)}</td>
                  <td data-label="Toplam" className="num"><strong>{tl(s.toplam)}</strong></td>
                  <td data-label="Fatura"><Badge variant={f.ton}>{f.ad}</Badge>{s.fatura?.no && <small className="muted payment-report-sub">{s.fatura.no}</small>}</td>
                  <td data-label="Kaydeden">{s.kaydeden ?? <span className="muted">—</span>}{s.not && <small className="muted payment-report-sub" title={s.not}>{s.not.length > 40 ? `${s.not.slice(0, 40)}…` : s.not}</small>}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        {r && r.toplamKayit > r.adet && (
          <div className="payment-report-pager">
            <span className="muted">{r.toplamKayit.toLocaleString("tr-TR")} ödemeden {((r.sayfa - 1) * r.adet + 1).toLocaleString("tr-TR")}–{Math.min(r.sayfa * r.adet, r.toplamKayit).toLocaleString("tr-TR")}</span>
            <div>
              <Button size="sm" disabled={r.sayfa <= 1} onClick={() => sayfaDegistir(r.sayfa - 1)}><ArrowLeft size={15} aria-hidden="true" />Önceki</Button>
              <Button size="sm" disabled={r.sayfa >= sonSayfa} onClick={() => sayfaDegistir(r.sayfa + 1)}>Sonraki<ArrowRight size={15} aria-hidden="true" /></Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** PLT-34: son 12 ayın tahsilatı — tek seri, tek renk; değer üzerine gelince görünür, ayrıca tablo olarak okunabilir. */
function AylikGrafik({ veri }: { veri: Veri<Aylik> }) {
  const aylar = veri.veri?.aylar ?? [];
  const enBuyuk = Math.max(0, ...aylar.map((a) => Number(a.toplam)));
  const [secili, setSecili] = useState<string | null>(null);
  const odak = aylar.find((a) => a.ay === secili) ?? aylar[aylar.length - 1];
  const ayAdi = (ay: string) => `${AY_ADI[Number(ay.slice(5, 7)) - 1]} ${ay.slice(2, 4)}`;
  return (
    <Card title="Son 12 ay tahsilat (KDV dahil, süzgeçten bağımsız)">
      {veri.hata ? <Alert tone="error">{veri.hata}</Alert> : veri.yukleniyor ? <p className="muted" role="status">Grafik yükleniyor…</p> : (
        <>
          <p className="payment-report-chart__readout" aria-live="polite">
            {odak ? <><strong>{ayAdi(odak.ay)}</strong> · {tl(odak.toplam)} · {odak.adet} ödeme</> : null}
          </p>
          <div className="payment-report-chart" role="img" aria-label={`Son 12 ay tahsilat: ${aylar.map((a) => `${ayAdi(a.ay)} ${Number(a.toplam).toLocaleString("tr-TR")} TL`).join(", ")}`} onMouseLeave={() => setSecili(null)}>
            {aylar.map((a) => {
              const oran = enBuyuk > 0 ? (Number(a.toplam) / enBuyuk) * 100 : 0;
              return (
                <button
                  key={a.ay}
                  type="button"
                  className={`payment-report-chart__col${odak?.ay === a.ay ? " is-active" : ""}`}
                  onMouseEnter={() => setSecili(a.ay)}
                  onFocus={() => setSecili(a.ay)}
                  aria-label={`${ayAdi(a.ay)}: ${Number(a.toplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL, ${a.adet} ödeme`}
                >
                  <span className="payment-report-chart__bar-area"><i style={{ height: `${Number(a.toplam) > 0 ? Math.max(oran, 1.5) : 0}%` }} /></span>
                  <small>{AY_ADI[Number(a.ay.slice(5, 7)) - 1]}<span className="payment-report-chart__year"> {a.ay.slice(2, 4)}</span></small>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/* ─── PLT-35: sorunlu tahsilatlar ────────────────────────────────────────── */
function SorunluSekmesi({ veri }: { veri: Veri<Sorunlu> }) {
  const v = veri.veri;
  return (
    <div id="odeme-raporu-panel-sorunlu" role="tabpanel" aria-labelledby="odeme-raporu-tab-sorunlu" className="stack">
      <Card pad={false} title={<span className="payment-report-card-title">Başarısız ve yarım kalan ödeme denemeleri</span>}>
        <p className="muted payment-report-note">Seçili dönemde başlatılan; başarısız olan ya da 1 saatten uzun süredir sonuçlanmayan (ödeme sayfası açılıp tamamlanmamış) denemeler.</p>
        <TableWrap>
          <thead><tr><th>Tarih</th><th>Firma</th><th>Kanal</th><th>Sağlayıcı</th><th className="num">Tutar</th><th>Durum</th><th>Hata</th></tr></thead>
          <tbody>
            <PlatformListeDurumu sutun={7} yukleniyor={veri.yukleniyor} hata={veri.hata} bos={Boolean(v && v.denemeler.length === 0)} baslik="Sorunlu deneme yok" onTekrar={veri.yenile} />
            {!veri.yukleniyor && v?.denemeler.map((d) => (
              <tr key={d.id}>
                <td data-label="Tarih"><Tarih deger={d.zaman} saatli /></td>
                <td data-label="Firma"><Link href={`/platform/firmalar?firma=${d.tenantId}`}>{d.unvan}</Link></td>
                <td data-label="Kanal">{KANAL_ADI[d.kanal as Kanal] ?? d.kanal}</td>
                <td data-label="Sağlayıcı">{SAGLAYICI_ADI[d.saglayici] ?? d.saglayici}{d.ortam === "test" && <> <Badge variant="neutral">test</Badge></>}</td>
                <td data-label="Tutar" className="num">{tl(d.toplam)}<small className="muted payment-report-sub">{d.aySayisi} ay</small></td>
                <td data-label="Durum"><Badge variant={d.durum === "basarisiz" ? "danger" : "warning"}>{d.durum === "basarisiz" ? "Başarısız" : "Sonuçlanmadı"}</Badge></td>
                <td data-label="Hata">{d.hata ?? <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
      <Card pad={false} title={<span className="payment-report-card-title">Otomatik yenilemesi başarısız kartlar</span>}>
        <p className="muted payment-report-note">Son otomatik çekimi başarısız olan kayıtlı kartlar. Dönem başına en çok 3 deneme yapılır.</p>
        <TableWrap>
          <thead><tr><th>Firma</th><th>Kart</th><th>Otomatik yenileme</th><th>Deneme</th><th>Son deneme</th><th>Son hata</th></tr></thead>
          <tbody>
            <PlatformListeDurumu sutun={6} yukleniyor={veri.yukleniyor} hata={veri.hata} bos={Boolean(v && v.kartlar.length === 0)} baslik="Başarısız kart yok" onTekrar={veri.yenile} />
            {!veri.yukleniyor && v?.kartlar.map((k) => (
              <tr key={k.tenantId}>
                <td data-label="Firma"><Link href={`/platform/firmalar?firma=${k.tenantId}`}>{k.unvan}</Link></td>
                <td data-label="Kart">{[k.kartMarkasi, k.son4 ? `**** ${k.son4}` : null].filter(Boolean).join(" ") || "—"}<small className="muted payment-report-sub">{SAGLAYICI_ADI[k.saglayici] ?? k.saglayici}</small></td>
                <td data-label="Otomatik yenileme">{k.otomatikYenileme ? `Açık · ${k.aySayisi} ay` : "Kapalı"}</td>
                <td data-label="Deneme"><Badge variant={k.denemeSayisi >= 3 ? "danger" : "warning"}>{k.denemeSayisi}/3</Badge></td>
                <td data-label="Son deneme">{k.sonDeneme ? <Tarih deger={k.sonDeneme} saatli /> : "—"}</td>
                <td data-label="Son hata">{k.sonHata ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

/* ─── PLT-36: yaklaşan yenilemeler ───────────────────────────────────────── */
function YaklasanSekmesi({ veri, gun, gunDegistir }: { veri: Veri<Yaklasan>; gun: number; gunDegistir: (gun: number) => void }) {
  const v = veri.veri;
  const beklenenToplam = v?.kayitlar.reduce((t, k) => t + Number(k.beklenen?.toplam ?? 0), 0) ?? 0;
  const fiyatsiz = v?.kayitlar.filter((k) => !k.beklenen).length ?? 0;
  const biten = v?.kayitlar.filter((k) => k.kalanGun < 0).length ?? 0;
  return (
    <div id="odeme-raporu-panel-yaklasan" role="tabpanel" aria-labelledby="odeme-raporu-tab-yaklasan" className="stack">
      <Card className="payment-report-filters">
        <div className="payment-report-filters__dates">
          <Field label="Dönem sonu">
            <Select value={String(gun)} onChange={(e) => gunDegistir(Number(e.target.value))}>
              {[30, 60, 90].map((g) => <option key={g} value={g}>Önümüzdeki {g} gün ve bitmiş olanlar</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      <StatGrid>
        <Stat label="Yenilenecek firma" value={v ? v.kayitlar.length.toLocaleString("tr-TR") : "…"} hint={v ? `${biten} firmanın dönemi bitmiş` : undefined} />
        <Stat label="Beklenen tahsilat (KDV dahil)" tone="accent" value={v ? tl(beklenenToplam) : "…"} hint={fiyatsiz ? `${fiyatsiz} firma fiyatsız planda (elle fiyatlanır)` : "Plan fiyatı × süre + %20 KDV"} />
        <Stat label="Kartla otomatik yenilenecek" value={v ? v.kayitlar.filter((k) => k.kart?.otomatikYenileme).length.toLocaleString("tr-TR") : "…"} />
      </StatGrid>
      <Card pad={false}>
        <TableWrap>
          <thead><tr><th>Firma</th><th>Plan</th><th>Durum</th><th>Dönem sonu</th><th>Kart / otomatik yenileme</th><th className="num">Beklenen tutar</th></tr></thead>
          <tbody>
            <PlatformListeDurumu sutun={6} yukleniyor={veri.yukleniyor} hata={veri.hata} bos={Boolean(v && v.kayitlar.length === 0)} baslik="Yaklaşan yenileme yok" onTekrar={veri.yenile} />
            {!veri.yukleniyor && v?.kayitlar.map((k) => (
              <tr key={k.tenantId}>
                <td data-label="Firma"><Link href={`/platform/firmalar?firma=${k.tenantId}`}>{k.unvan}</Link></td>
                <td data-label="Plan">{k.planAdi}</td>
                <td data-label="Durum"><Badge variant={k.durum === "askida" ? "danger" : k.durum === "deneme" ? "info" : "neutral"}>{DURUM_ADI[k.durum] ?? k.durum}</Badge></td>
                <td data-label="Dönem sonu"><Tarih deger={k.donemSonu} /><small className="muted payment-report-sub">{k.kalanGun < 0 ? <Badge variant="danger">{-k.kalanGun} gün geçti</Badge> : k.kalanGun === 0 ? "bugün" : `${k.kalanGun} gün kaldı`}</small></td>
                <td data-label="Kart / otomatik yenileme">
                  {k.kart ? <>{[k.kart.kartMarkasi, k.kart.son4 ? `**** ${k.kart.son4}` : null].filter(Boolean).join(" ") || "Kayıtlı kart"}<small className="muted payment-report-sub">{k.kart.otomatikYenileme ? `Otomatik yenileme açık · ${k.kart.aySayisi ?? 1} ay` : "Otomatik yenileme kapalı"}</small></> : <span className="muted">Kart yok — ödeme bağlantısı ya da elle tahsilat</span>}
                </td>
                <td data-label="Beklenen tutar" className="num">{k.beklenen ? <>{tl(k.beklenen.toplam)}<small className="muted payment-report-sub">{k.beklenen.aySayisi} ay · matrah {Number(k.beklenen.matrah).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</small></> : <span className="muted">Elle fiyatlanır</span>}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

export default function PlatformOdemeRaporu() {
  return <Suspense fallback={<p className="muted" role="status">Ödeme raporu yükleniyor…</p>}><OdemeRaporu /></Suspense>;
}
