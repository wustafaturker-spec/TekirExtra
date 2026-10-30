"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

interface Alan { anahtar: string; etiket: string; gizli: boolean; dolu: boolean; deger?: string }
interface Saglayici { saglayici: "iyzico" | "paytr"; ad: string; bagli: boolean; ortam: "test" | "canli"; etkin: boolean; guncellendi: string | null; bildirimAdresi?: string | null; alanlar: Alan[] }

/**
 * PLT-11: abonelik bedelini tahsil eden ödeme sağlayıcısı. Gizli alanlar bir
 * kez girilir, sonra gösterilmez; boş bırakılırsa kayıtlı değer korunur.
 * Etkin sağlayıcı yoksa firmalar ödemeyi elle (PLT-09) yapar.
 */
export default function PlatformOdeme() {
  const [liste, setListe] = useState<Saglayici[] | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => setListe(await platformApi<Saglayici[]>("/platform/odeme-saglayicilari")), []);
  useEffect(() => { if (platformTokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi")); }, [yukle]);

  const etkin = liste?.find((s) => s.etkin);
  return <>
    <PageHeader title="Abonelik ödemesi" subtitle="Firmaların abonelik bedelini kartla ödediği sağlayıcı. Aynı anda tek sağlayıcı etkin olur; elle tahsilat (Firmalar ekranı) her zaman açıktır." />
    <Alert tone="error">{hata}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    {liste && !etkin && <Alert tone="warning">Etkin sağlayıcı yok: firmalar panelde çevrim içi ödeme göremez, hatırlatma e-postası ödeme bağlantısı taşımaz.</Alert>}
    <div className="stack">
      {liste?.map((s) => <SaglayiciKarti key={s.saglayici} s={s} onTamam={async (m) => { setBasari(m); setHata(""); await yukle(); }} onHata={(m) => { setHata(m); setBasari(""); }} />)}
      {liste && <FaturaKarti onBasari={(m) => { setBasari(m); setHata(""); }} onHata={(m) => { setHata(m); setBasari(""); }} />}
    </div>
  </>;
}

type HesapTuru = "kasa" | "banka" | "pos";
interface Hesap { tur: HesapTuru; id: string; ad: string; doviz: string }
interface Sorunlu { odemeId: string; firma: string; durum: "bekliyor" | "hata" | "kesinlesti"; faturaNo: string | null; hata: string | null; deneme: number; guncellendi: string }
interface FaturaAyari {
  faturalayan: { tenantId: string; unvan: string } | null;
  kartHesap: { tur: HesapTuru; id: string } | null;
  elleHesap: { tur: HesapTuru; id: string } | null;
  baslangicAt: string | null;
  hesaplar: Hesap[];
  sorunlu: Sorunlu[];
}
const HESAP_TURU: Record<HesapTuru, string> = { kasa: "Kasa", banka: "Banka", pos: "POS" };
const SORUN: Record<Sorunlu["durum"], string> = { bekliyor: "Fatura bekliyor", hata: "Fatura açılamadı", kesinlesti: "Tahsilat açılamadı" };
const hesapDegeri = (h: { tur: HesapTuru; id: string } | null) => (h ? `${h.tur}:${h.id}` : "");
const hesapAyir = (s: string) => (s ? { tur: s.split(":")[0] as HesapTuru, id: s.split(":")[1]! } : null);

/**
 * PLT-20…23: abonelik ödemeleri seçilen firmada (TekirExtra'nın kendi kiracısı)
 * taslak satış faturasına dönüşür; fatura orada kesinleşince seçilen hesaba
 * tahsilat açılır. Fatura açılamayan ya da tahsilatı açılamayan ödemeler
 * burada listelenir ve yeniden denenir.
 */
function FaturaKarti({ onBasari, onHata }: { onBasari: (m: string) => void; onHata: (m: string) => void }) {
  const [ayar, setAyar] = useState<FaturaAyari | null>(null);
  const [firmalar, setFirmalar] = useState<{ tenantId: string; unvan: string; vkn: string }[]>([]);
  const [firma, setFirma] = useState("");
  const [hesaplar, setHesaplar] = useState<Hesap[]>([]);
  const [kart, setKart] = useState("");
  const [elle, setElle] = useState("");
  const [islem, setIslem] = useState(false);
  const [yuklemeHatasi, setYuklemeHatasi] = useState("");

  const yukle = useCallback(async () => {
    const y = await platformApi<FaturaAyari>("/platform/abonelik-fatura");
    // Eksik yanıtta (ör. eski API) kart çökmesin.
    const a: FaturaAyari = { ...y, faturalayan: y?.faturalayan ?? null, kartHesap: y?.kartHesap ?? null, elleHesap: y?.elleHesap ?? null, baslangicAt: y?.baslangicAt ?? null, hesaplar: Array.isArray(y?.hesaplar) ? y.hesaplar : [], sorunlu: Array.isArray(y?.sorunlu) ? y.sorunlu : [] };
    setAyar(a);
    setFirma(a.faturalayan?.tenantId ?? "");
    setHesaplar(a.hesaplar);
    setKart(hesapDegeri(a.kartHesap));
    setElle(hesapDegeri(a.elleHesap));
  }, []);
  useEffect(() => {
    void yukle().catch((e) => setYuklemeHatasi(e instanceof Error ? e.message : "Fatura ayarı yüklenemedi"));
    void platformApi<{ tenantId: string; unvan: string; vkn: string }[]>("/platform/firmalar").then((l) => setFirmalar(Array.isArray(l) ? l : [])).catch(() => setFirmalar([]));
  }, [yukle]);

  async function firmaSec(tenantId: string) {
    setFirma(tenantId);
    setKart("");
    setElle("");
    const l = tenantId ? await platformApi<Hesap[]>(`/platform/abonelik-fatura/hesaplar/${tenantId}`).catch(() => []) : [];
    setHesaplar(Array.isArray(l) ? l : []);
  }

  async function calistir(is: () => Promise<{ mesaj: string }>) {
    setIslem(true);
    try { onBasari((await is()).mesaj); await yukle(); } catch (e) { onHata(e instanceof Error ? e.message : "İşlem tamamlanamadı"); } finally { setIslem(false); }
  }

  function kaydet() {
    const firmaDegisti = firma !== (ayar?.faturalayan?.tenantId ?? "");
    if (firmaDegisti && firma && !confirm("Bu tarihten sonraki abonelik ödemeleri için seçilen firmada taslak satış faturası açılsın mı? Geçmiş ödemeler faturalanmaz.")) return;
    if (firmaDegisti && !firma && !confirm("Otomatik abonelik faturası kapatılsın mı?")) return;
    void calistir(() => platformApi<{ mesaj: string }>("/platform/abonelik-fatura", { method: "PUT", body: JSON.stringify({ faturalayanTenantId: firma || null, kartHesap: firma ? hesapAyir(kart) : null, elleHesap: firma ? hesapAyir(elle) : null }) }));
  }

  if (!ayar) return yuklemeHatasi ? <Card title="Abonelik faturası"><Alert tone="error">{yuklemeHatasi}</Alert></Card> : null;
  const tlHesaplar = hesaplar.filter((h) => h.doviz === "TRY");
  const hesapSecimi = (deger: string, setDeger: (s: string) => void, etiket: string) => (
    <Field label={etiket}>
      <Select value={deger} disabled={!firma} onChange={(e) => setDeger(e.target.value)}>
        <option value="">— Seçilmedi (tahsilat açılmaz) —</option>
        {tlHesaplar.map((h) => <option key={`${h.tur}:${h.id}`} value={`${h.tur}:${h.id}`}>{HESAP_TURU[h.tur]} · {h.ad}</option>)}
      </Select>
    </Field>
  );

  return (
    <Card title="Abonelik faturası">
      <div className="stack">
        <div className="row-tight">
          {ayar.faturalayan ? <Badge variant="success">Açık · {ayar.faturalayan.unvan}</Badge> : <Badge variant="neutral">Kapalı</Badge>}
          {ayar.baslangicAt && <span className="subtle">{new Date(ayar.baslangicAt).toLocaleString("tr-TR")} sonrası ödemeler faturalanır</span>}
        </div>
        <p className="subtle" style={{ margin: 0 }}>Her ödemede seçilen firmada <strong>taslak</strong> satış faturası açılır; kesinleştirme ve gönderim o firmanın Faturalar ekranında yapılır. Fatura kesinleşince ödeme tutarı seçilen hesaba tahsilat olarak girer ve faturayı kapatır.</p>
        <div className="form-grid">
          <Field label="Faturalayan firma">
            <Select value={firma} onChange={(e) => void firmaSec(e.target.value)}>
              <option value="">— Kapalı —</option>
              {ayar.faturalayan && !firmalar.some((f) => f.tenantId === ayar.faturalayan!.tenantId) && <option value={ayar.faturalayan.tenantId}>{ayar.faturalayan.unvan}</option>}
              {firmalar.map((f) => <option key={f.tenantId} value={f.tenantId}>{f.unvan} · {f.vkn}</option>)}
            </Select>
          </Field>
          {hesapSecimi(kart, setKart, "Kartla alınan ödemelerin hesabı")}
          {hesapSecimi(elle, setElle, "Elle (havale) alınan ödemelerin hesabı")}
        </div>
        {firma && tlHesaplar.length === 0 && <Alert tone="warning">Seçilen firmada TL kasa, banka ya da POS hesabı yok; tahsilat açılamaz.</Alert>}
        <div className="row-tight"><Button variant="primary" disabled={islem} onClick={kaydet}>Kaydet</Button></div>
        {ayar.sorunlu.length > 0 && (
          <TableWrap>
            <thead><tr><th>Firma</th><th>Durum</th><th>Fatura</th><th>Ayrıntı</th><th className="num">Deneme</th><th /></tr></thead>
            <tbody>{ayar.sorunlu.map((s) => (
              <tr key={s.odemeId}>
                <td>{s.firma}</td>
                <td><Badge variant={s.durum === "hata" ? "danger" : "warning"}>{SORUN[s.durum]}</Badge></td>
                <td>{s.faturaNo ?? "—"}</td>
                <td className="subtle">{s.hata ?? "—"}<div style={{ fontSize: "0.8rem" }}>{new Date(s.guncellendi).toLocaleString("tr-TR")}</div></td>
                <td className="num">{s.deneme}</td>
                <td><Button size="sm" disabled={islem} onClick={() => void calistir(() => platformApi<{ mesaj: string }>(`/platform/abonelik-fatura/${s.odemeId}/yeniden-dene`, { method: "POST" }))}>Yeniden dene</Button></td>
              </tr>
            ))}</tbody>
          </TableWrap>
        )}
      </div>
    </Card>
  );
}

function SaglayiciKarti({ s, onTamam, onHata }: { s: Saglayici; onTamam: (m: string) => Promise<void>; onHata: (m: string) => void }) {
  const [ortam, setOrtam] = useState(s.ortam);
  const [alanlar, setAlanlar] = useState<Record<string, string>>(() => Object.fromEntries(s.alanlar.map((a) => [a.anahtar, a.gizli ? "" : a.deger ?? ""])));
  const [islem, setIslem] = useState(false);

  async function kaydet(etkin: boolean) {
    if (etkin && ortam === "canli" && !confirm(`${s.ad} canlı ortamda etkinleştirilsin mi? Firmaların kartından gerçek çekim yapılır.`)) return;
    setIslem(true);
    try {
      const r = await platformApi<{ mesaj: string }>(`/platform/odeme-saglayicilari/${s.saglayici}`, { method: "PUT", body: JSON.stringify({ ortam, etkin, alanlar }) });
      await onTamam(r.mesaj);
    } catch (e) {
      onHata(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setIslem(false);
    }
  }

  return (
    <Card title={s.ad}>
      <div className="stack">
        <div className="row-tight">
          {s.etkin ? <Badge variant="success">Etkin · {s.ortam === "canli" ? "canlı" : "test"}</Badge> : <Badge variant="neutral">Kapalı</Badge>}
          {!s.bagli && <Badge variant="warning">Abonelik tahsilatı henüz bağlı değil</Badge>}
          {s.guncellendi && <span className="subtle">Son değişiklik {new Date(s.guncellendi).toLocaleString("tr-TR")}</span>}
        </div>
        {s.saglayici === "paytr" && <p className="subtle" style={{ margin: 0 }}>PayTR mağaza panelinde Direkt API, Non3D ve tekrarlayan ödeme yetkileri açık olmalı; <strong>Bildirim URL</strong> olarak şunu girin: <code>{s.bildirimAdresi}</code></p>}
        <div className="form-grid">
          <Field label="Ortam"><Select value={ortam} onChange={(e) => setOrtam(e.target.value as "test" | "canli")}><option value="test">Test (sandbox)</option><option value="canli">Canlı</option></Select></Field>
          {s.alanlar.map((a) => (
            <Field key={a.anahtar} label={a.etiket}>
              <Input
                type={a.gizli ? "password" : "text"}
                autoComplete="off"
                value={alanlar[a.anahtar] ?? ""}
                placeholder={a.gizli && a.dolu ? "Kayıtlı — değiştirmek için yazın" : ""}
                onChange={(e) => setAlanlar((x) => ({ ...x, [a.anahtar]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <div className="row-tight">
          <Button disabled={islem} onClick={() => void kaydet(s.etkin)}>Kaydet</Button>
          {s.etkin
            ? <Button variant="danger" disabled={islem} onClick={() => void kaydet(false)}>Kapat</Button>
            : <Button variant="primary" disabled={islem || !s.bagli} onClick={() => void kaydet(true)}>Kaydet ve etkinleştir</Button>}
        </div>
      </div>
    </Card>
  );
}
