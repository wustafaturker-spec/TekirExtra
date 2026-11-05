"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { AbonelikIadeFormu } from "@/components/abonelik-iade-formu";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, TableWrap } from "@/components/ui";
import { PlatformListeDurumu } from "@/components/platform-liste";
import { platformApi } from "@/lib/platform-api";
import { type Firma, type Gecmis, ODEME_SURELERI, PLANLAR, DURUM, TALEP_DURUMU, FATURA_DURUMU, FATURALAYAN_DURUMU, tarih, tl } from "@/lib/platform-firmalar";

const anahtarUret = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

export function FirmaYonet({ firma, onKapat, onTamam, sayfada = false }: { firma: Firma; onKapat: () => void; onTamam: (mesaj: string) => void; sayfada?: boolean }) {
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
  // PLT-42: satırın altında açılan iade formu (firma kartı zaten bir pencere).
  const [iadeOdemeId, setIadeOdemeId] = useState<string | null>(null);
  // PLT-27: bu ödeme formunun işlem anahtarı; yanıt kaybolup yeniden denenirse aynısı gider, ikinci ödeme oluşmaz.
  const [islemAnahtari, setIslemAnahtari] = useState(anahtarUret);
  // "1.500,50" / "1500,5" / "1500.50" → "1500.50"; kuruştan fazla ondalık ya da geçersiz metin null.
  const tutarMetni = ((v: string) => { const t = v.trim().replace(/\s/g, ""); const n = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t; return /^\d{1,8}(\.\d{1,2})?$/.test(n) ? n : null; })(tutar);

  async function calistir(is: () => Promise<{ mesaj: string }>, odemeIslemi = false) {
    setIslem(true);
    setHata("");
    try {
      const sonuc = await is();
      if (odemeIslemi) { setIslemAnahtari(anahtarUret()); setTutar(""); setOdemeNotu(""); }
      onTamam(sonuc.mesaj);
    } catch (e) { setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı"); } finally { setIslem(false); }
  }
  const post = (yol: string, govde: unknown) => platformApi<{ mesaj: string }>(yol, { method: "POST", body: JSON.stringify(govde) });
  const askida = firma.durum === "askida";

  const icerik = (
      <div className="stack platform-firma-modal">
        {!sayfada && <Link className="btn btn--ghost" href={`/platform/firmalar/${firma.tenantId}`}>Firma detayını aç</Link>}
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
              <Button variant="primary" disabled={islem || tutarMetni === null} onClick={() => void calistir(() => post(`/platform/firmalar/${firma.tenantId}/odeme`, { aySayisi, tutar: tutarMetni, not: odemeNotu || null, islemAnahtari }), true)}>Ödemeyi kaydet</Button>
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
              <thead><tr><th>Zaman</th><th>Yöntem</th><th>Süre</th><th className="num">Toplam</th><th>Yeni dönem sonu</th><th>Fatura</th><th>Not</th><th>İade</th></tr></thead>
              <tbody>{gecmis.odemeler.map((o, i) => {
                const iadeToplami = (o.iadeler ?? []).reduce((t, x) => t + Number(x.tutar), 0);
                const iadeEdilebilir = Boolean(o.id) && Number(o.tutar) - iadeToplami > 0.004;
                return <Fragment key={o.id ?? i}>
                <tr><td className="subtle" style={{ whiteSpace: "nowrap" }}>{new Date(o.zaman).toLocaleString("tr-TR")}</td><td>{o.kaynak === "saglayici" ? <Badge variant="info">{o.saglayici === "paytr" ? "PayTR" : "iyzico"}</Badge> : "Elle"}</td><td>{o.aySayisi} ay</td><td className="num">{tl(o.tutar)} TL{o.kdv !== null && <div className="subtle" style={{ fontSize: "0.8rem" }}>KDV {tl(o.kdv)}</div>}</td><td>{tarih(o.yeniDonemSonu)}</td>
                  <td>{o.fatura ? <><Badge variant={FATURA_DURUMU[o.fatura.durum]?.ton ?? "neutral"}>{FATURA_DURUMU[o.fatura.durum]?.ad ?? o.fatura.durum}</Badge>{o.fatura.no && <div className="subtle" style={{ fontSize: "0.8rem" }}>{o.fatura.no}</div>}{o.fatura.hata && <div className="subtle" style={{ fontSize: "0.8rem" }}>{o.fatura.hata}</div>}</> : <span className="subtle">—</span>}</td>
                  <td>{o.not ?? "—"}</td>
                  <td>
                    {(o.iadeler ?? []).map((x) => <div key={x.id} className="subtle" style={{ fontSize: "0.8rem" }} title={`${x.neden}${x.faturalayanHata ? ` — ${x.faturalayanHata}` : ""}`}>
                      <Badge variant={x.faturalayanDurumu === "hata" ? "danger" : "info"}>İade {tl(x.tutar)} TL</Badge> {new Date(x.zaman).toLocaleDateString("tr-TR")} · {x.saglayiciyaGonderildi ? `${o.saglayici === "paytr" ? "PayTR" : "iyzico"} üzerinden` : "elle"} · {FATURALAYAN_DURUMU[x.faturalayanDurumu] ?? x.faturalayanDurumu}
                    </div>)}
                    {iadeEdilebilir && iadeOdemeId !== o.id && <Button size="sm" onClick={() => setIadeOdemeId(o.id!)}>İade et</Button>}
                    {!iadeEdilebilir && iadeToplami > 0 && <span className="subtle" style={{ fontSize: "0.8rem" }}>Tamamı iade edildi</span>}
                  </td></tr>
                {iadeOdemeId === o.id && o.id && <tr><td colSpan={8}>
                  <AbonelikIadeFormu
                    odeme={{ id: o.id, unvan: firma.unvan, tutar: o.tutar, iade: iadeToplami, kaynak: o.kaynak ?? "elle", saglayici: o.saglayici ?? null, aySayisi: o.aySayisi }}
                    onVazgec={() => setIadeOdemeId(null)}
                    onTamam={(mesaj) => { setIadeOdemeId(null); gecmisYenile(); onTamam(mesaj); }}
                  />
                </td></tr>}
                </Fragment>;
              })}</tbody>
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
  );
  return sayfada ? icerik : (
    <Modal genis baslik={firma.unvan} aciklama={`VKN ${firma.vkn} · ${firma.planAdi} · ${DURUM[firma.durum]?.ad ?? firma.durum} · kayıt ${tarih(firma.kayitTarihi)}`} onKapat={onKapat}>{icerik}</Modal>
  );
}
