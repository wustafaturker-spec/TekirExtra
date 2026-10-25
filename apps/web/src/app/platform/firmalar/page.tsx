"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, StatGrid, TableWrap } from "@/components/ui";
import { platformApi, platformTokenAl } from "@/lib/platform-api";

interface Firma {
  tenantId: string; unvan: string; vkn: string; kayitTarihi: string;
  planKodu: string; planAdi: string; durum: string; donemSonu: string | null; iptalTarihi: string | null;
  aktifKullanici: number; sonGiris: string | null; ebelgeSaglayici: string | null;
  bekleyenTalep: { id: string; istenenPlan: string; istenenPlanAdi: string } | null;
  /** PLT-09: dönem sonundan 15 gün geçti, ödeme işaretlenmedi (otomatik askı yok). */
  askiyaAlinacak?: boolean;
  sonOdemeAt?: string | null;
}
interface Gecmis {
  degisiklikler: { zaman: string; oncekiPlan: string | null; yeniPlan: string; oncekiDurum: string | null; yeniDurum: string; neden: string | null }[];
  talepler: { id: string; zaman: string; mevcutPlan: string; istenenPlan: string; durum: string; aciklama: string | null; kararNotu: string | null }[];
}
type Suzgec = "hepsi" | "talep" | "askiyaAlinacak" | "askida" | "iptal";
const ODEME_SURELERI = [1, 3, 6, 12] as const;

const PLANLAR = [{ kod: "baslangic", ad: "Başlangıç" }, { kod: "profesyonel", ad: "Profesyonel" }, { kod: "kurumsal", ad: "Kurumsal" }];
const DURUM: Record<string, { ad: string; ton: "success" | "danger" | "neutral" | "warning" }> = {
  aktif: { ad: "Aktif", ton: "success" }, deneme: { ad: "Deneme", ton: "neutral" }, askida: { ad: "Askıda", ton: "danger" }, iptal: { ad: "İptal", ton: "warning" },
};
const TALEP_DURUMU: Record<string, string> = { bekliyor: "Bekliyor", onaylandi: "Onaylandı", reddedildi: "Reddedildi", geri_cekildi: "Geri çekildi" };
const GORUNEN_EN_COK = 200;
const tarih = (s: string | null) => (s ? new Date(s).toLocaleDateString("tr-TR") : "—");

/**
 * Platform P0-1 / P1-1: firmalar ve abonelikleri. Liste yalnız yönetim için
 * gereken sayıları ve durumları içerir; firma verisinin içeriği görünmez.
 */
export default function PlatformFirmalar() {
  const [firmalar, setFirmalar] = useState<Firma[] | null>(null);
  const [arama, setArama] = useState("");
  const [suzgec, setSuzgec] = useState<Suzgec>("hepsi");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [secili, setSecili] = useState<Firma | null>(null);

  const yukle = useCallback(async () => {
    setFirmalar(await platformApi<Firma[]>("/platform/firmalar"));
  }, []);
  useEffect(() => { if (platformTokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Yüklenemedi")); }, [yukle]);

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

  async function tamamlandi(mesaj: string) {
    setBasari(mesaj);
    setHata("");
    setSecili(null);
    await yukle();
  }

  return <>
    <PageHeader title="Firmalar" subtitle="Firmaların planı, abonelik durumu ve kullanımı. Plan talepleri burada onaylanır; ödemesi olmayan firma askıya alınır (askıdaki firma salt okunurdur)." />
    <Alert tone="error">{hata}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    <StatGrid>
      <Stat label="Firma" value={sayilar.toplam} />
      <Stat label="Bekleyen plan talebi" value={sayilar.talep} tone={sayilar.talep ? "info" : undefined} />
      <Stat label="Askıya alınacak" value={sayilar.askiyaAlinacak} tone={sayilar.askiyaAlinacak ? "accent" : undefined} />
      <Stat label="Askıda" value={sayilar.askida} tone={sayilar.askida ? "danger" : undefined} />
      <Stat label="İptal" value={sayilar.iptal} />
    </StatGrid>
    <Card>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 220 }}><Field label="Ara"><Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Unvan ya da VKN" /></Field></div>
        <div style={{ minWidth: 200 }}><Field label="Göster"><Select value={suzgec} onChange={(e) => setSuzgec(e.target.value as Suzgec)}>
          <option value="hepsi">Tüm firmalar</option>
          <option value="talep">Bekleyen plan talebi</option>
          <option value="askiyaAlinacak">Askıya alınacaklar (ödeme 15 günden fazla gecikti)</option>
          <option value="askida">Askıda</option>
          <option value="iptal">İptal</option>
        </Select></Field></div>
      </div>
    </Card>
    <Card pad={false}>
      <TableWrap>
        <thead><tr><th>Firma</th><th>Plan</th><th>Durum</th><th className="num">Kullanıcı</th><th>Son giriş</th><th>e-Belge</th><th>Talep</th><th /></tr></thead>
        <tbody>
          {suzulen.slice(0, GORUNEN_EN_COK).map((f) => (
            <tr key={f.tenantId}>
              <td><strong>{f.unvan}</strong><div className="subtle mono" style={{ fontSize: "0.8rem" }}>{f.vkn}</div></td>
              <td>{f.planAdi}{f.donemSonu && <div className="subtle" style={{ fontSize: "0.8rem" }}>Dönem sonu {tarih(f.donemSonu)}</div>}</td>
              <td><Badge variant={DURUM[f.durum]?.ton ?? "neutral"}>{DURUM[f.durum]?.ad ?? f.durum}</Badge>{f.askiyaAlinacak && <div style={{ marginTop: 4 }}><Badge variant="warning">Ödeme gecikti</Badge></div>}</td>
              <td className="num">{f.aktifKullanici}</td>
              <td className="subtle">{f.sonGiris ? new Date(f.sonGiris).toLocaleString("tr-TR") : "Hiç"}</td>
              <td>{f.ebelgeSaglayici ?? <span className="subtle">—</span>}</td>
              <td>{f.bekleyenTalep ? <Badge variant="info">{f.bekleyenTalep.istenenPlanAdi} istiyor</Badge> : <span className="subtle">—</span>}</td>
              <td><Button size="sm" onClick={() => setSecili(f)}>Yönet</Button></td>
            </tr>
          ))}
          {firmalar && suzulen.length === 0 && <tr><td colSpan={8} className="empty">Eşleşen firma yok.</td></tr>}
        </tbody>
      </TableWrap>
      {suzulen.length > GORUNEN_EN_COK && <p className="subtle" style={{ padding: "0.75rem 1rem", margin: 0 }}>{suzulen.length} firmadan ilk {GORUNEN_EN_COK} tanesi gösteriliyor; aramayı daraltın.</p>}
    </Card>
    {secili && <FirmaYonet firma={secili} onKapat={() => setSecili(null)} onTamam={(m) => void tamamlandi(m)} />}
  </>;
}

function FirmaYonet({ firma, onKapat, onTamam }: { firma: Firma; onKapat: () => void; onTamam: (mesaj: string) => void }) {
  const [gecmis, setGecmis] = useState<Gecmis | null>(null);
  const [hata, setHata] = useState("");
  const [islem, setIslem] = useState(false);
  const [kararNotu, setKararNotu] = useState("");
  const [neden, setNeden] = useState("");
  const [plan, setPlan] = useState(firma.planKodu === "v1" ? "profesyonel" : firma.planKodu);
  const [aySayisi, setAySayisi] = useState<(typeof ODEME_SURELERI)[number]>(1);
  const [tutar, setTutar] = useState("");
  const [odemeNotu, setOdemeNotu] = useState("");
  const tutarSayi = Number(tutar.replace(",", "."));

  useEffect(() => {
    void platformApi<Gecmis>(`/platform/firmalar/${firma.tenantId}/gecmis`).then(setGecmis).catch((e) => setHata(e instanceof Error ? e.message : "Geçmiş yüklenemedi"));
  }, [firma.tenantId]);

  async function calistir(is: () => Promise<{ mesaj: string }>) {
    setIslem(true);
    setHata("");
    try { onTamam((await is()).mesaj); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı"); } finally { setIslem(false); }
  }
  const post = (yol: string, govde: unknown) => platformApi<{ mesaj: string }>(yol, { method: "POST", body: JSON.stringify(govde) });
  const askida = firma.durum === "askida";

  return (
    <Modal genis baslik={firma.unvan} aciklama={`VKN ${firma.vkn} · ${firma.planAdi} · ${DURUM[firma.durum]?.ad ?? firma.durum} · kayıt ${tarih(firma.kayitTarihi)}`} onKapat={onKapat}>
      <div className="stack">
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
              <Button variant="primary" disabled={islem || !tutar.trim() || !Number.isFinite(tutarSayi) || tutarSayi < 0} onClick={() => void calistir(() => post(`/platform/firmalar/${firma.tenantId}/odeme`, { aySayisi, tutar: tutarSayi, not: odemeNotu || null }))}>Ödemeyi kaydet</Button>
            </div>
          </div>
        </Card>
        <Card title="Abonelik işlemi">
          <div className="stack">
            <Field label="Neden (zorunlu, geçmişe yazılır)"><Input value={neden} onChange={(e) => setNeden(e.target.value)} maxLength={500} placeholder="Örn. Ekim ödemesi 30 gün gecikti" /></Field>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div style={{ minWidth: 180 }}><Field label="Plan"><Select value={plan} onChange={(e) => setPlan(e.target.value)}>{PLANLAR.map((p) => <option key={p.kod} value={p.kod}>{p.ad}</option>)}</Select></Field></div>
              <Button disabled={islem || neden.trim().length < 5} onClick={() => void calistir(() => post(`/platform/firmalar/${firma.tenantId}/plan`, { planKodu: plan, neden }))}>Planı değiştir</Button>
              <Button variant={askida ? "primary" : "danger"} disabled={islem || neden.trim().length < 5} onClick={() => void calistir(() => post(`/platform/firmalar/${firma.tenantId}/durum`, { durum: askida ? "aktif" : "askida", neden }))}>
                {askida ? "Askıdan çıkar" : "Askıya al (salt okunur)"}
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Geçmiş" pad={false}>
          <TableWrap>
            <thead><tr><th>Zaman</th><th>Değişiklik</th><th>Neden / not</th></tr></thead>
            <tbody>
              {[
                ...(gecmis?.degisiklikler ?? []).map((d) => ({ zaman: d.zaman, ne: `${d.oncekiPlan ?? "—"} → ${d.yeniPlan} · ${d.oncekiDurum ?? "—"} → ${d.yeniDurum}`, not: d.neden })),
                ...(gecmis?.talepler ?? []).map((t) => ({ zaman: t.zaman, ne: `Talep ${t.mevcutPlan} → ${t.istenenPlan}: ${TALEP_DURUMU[t.durum] ?? t.durum}`, not: t.kararNotu ?? t.aciklama })),
              ].sort((a, b) => b.zaman.localeCompare(a.zaman)).map((s, i) => (
                <tr key={i}><td className="subtle" style={{ whiteSpace: "nowrap" }}>{new Date(s.zaman).toLocaleString("tr-TR")}</td><td>{s.ne}</td><td>{s.not ?? "—"}</td></tr>
              ))}
              {gecmis && !gecmis.degisiklikler.length && !gecmis.talepler.length && <tr><td colSpan={3} className="empty">Abonelik geçmişi yok.</td></tr>}
            </tbody>
          </TableWrap>
        </Card>
      </div>
    </Modal>
  );
}
