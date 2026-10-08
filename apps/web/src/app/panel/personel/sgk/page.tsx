"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SGK_CIKIS_KODLARI } from "@tekirextra/shared";
import { api, apiDosyaIndir, ApiHata } from "@/lib/api";
import { Alert, Badge, Button, Card, EylemCubugu, Field, Input, Modal, ModalEylem, PageHeader, Para, Select, Stat, StatGrid, Table, Tabs, Tarih } from "@/components/ui";

type Sekme = "giris" | "cikis" | "muhsgk";
interface Isyeri { id: string; ad: string; sgkSicilNo?: string | null }
interface CikisDonemi { belgeTuru: string; hakEdilenUcret: string; primIkramiye: string; eksikGunSayisi: number; eksikGunNedeni: string | null }
interface BildirgeSatiri {
  istihdamId: string; personelId: string; personelNo: string; adSoyad: string; tcknMaskeli: string | null; isyeri: string | null; sgkSicilNo: string | null; tarih: string;
  belgeTuru: string; sigortaKolu: string | null; meslekKodu: string | null; kanunNo: string; cikisKodu: string | null; sonTarih: string;
  bildirgeTarihi: string | null; bildirgeNo: string | null; durum: "verildi" | "gecikti" | "bekliyor"; bulundugumuz: CikisDonemi | null; onceki: CikisDonemi | null; eksikler: string[]; xmlDisi: string | null;
}
interface HizmetSatiri {
  personelId: string; personelNo: string; adSoyad: string; tcknMaskeli: string | null; belgeTuru: string; kanunNo: string; primGunu: number; eksikGunSayisi: number; eksikGunKodu: string | null;
  girisTarihi: string | null; cikisTarihi: string | null; cikisKodu: string | null; hesapIzi: boolean; uyarilar: string[]; aphbDisi: string | null;
  pek: string; primIkramiye: string; gvMatrahi: string; kesilenGv: string; asgariGvIstisnasi: string; kesilenDv: string;
}
interface Muhsgk { ozet: Record<string, string | number> & { kisiSayisi: number }; uyarilar: string[]; satirlar: HizmetSatiri[] }

const DURUM: Record<BildirgeSatiri["durum"], [string, "success" | "danger" | "warning"]> = { verildi: ["Verildi", "success"], gecikti: ["Gecikti", "danger"], bekliyor: ["Bekliyor", "warning"] };
const ayIlki = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const aySonu = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10); };

/** PRS-25/26/28: SGK işe giriş/çıkış bildirge verisi ve MUHSGK ön dökümü; Excel, PDF ve yükleme XML'i. */
export default function SgkSayfasi() {
  const [sekme, setSekme] = useState<Sekme>("giris");
  const [isyerleri, setIsyerleri] = useState<Isyeri[]>([]);
  const [isyeriId, setIsyeriId] = useState("");
  const [aralik, setAralik] = useState({ baslangic: ayIlki(), bitis: aySonu() });
  const [yalnizVerilmemis, setYalnizVerilmemis] = useState(false);
  const [donem, setDonem] = useState({ yil: new Date().getFullYear(), ay: new Date().getMonth() + 1 });
  const [bildirgeler, setBildirgeler] = useState<BildirgeSatiri[]>([]);
  const [muhsgk, setMuhsgk] = useState<Muhsgk | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [isaret, setIsaret] = useState<{ satir: BildirgeSatiri; tarih: string; no: string } | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("sekme");
    if (s === "giris" || s === "cikis" || s === "muhsgk") setSekme(s);
    api<Isyeri[]>("/personel/organizasyon").then(setIsyerleri).catch(() => undefined);
  }, []);

  const bildirgeSorgusu = useCallback(() => new URLSearchParams({ tur: sekme, ...aralik, ...(isyeriId && { isyeriId }), ...(yalnizVerilmemis && { yalnizVerilmemis: "1" }) }).toString(), [sekme, aralik, isyeriId, yalnizVerilmemis]);
  const muhsgkSorgusu = useCallback(() => new URLSearchParams({ yil: String(donem.yil), ay: String(donem.ay), ...(isyeriId && { isyeriId }) }).toString(), [donem, isyeriId]);

  const yukle = useCallback(async () => {
    try {
      setYukleniyor(true); setHata(null);
      if (sekme === "muhsgk") setMuhsgk(await api<Muhsgk>(`/personel/sgk/muhsgk?${muhsgkSorgusu()}`));
      else setBildirgeler(await api<BildirgeSatiri[]>(`/personel/sgk/bildirgeler?${bildirgeSorgusu()}`));
    } catch (e) { setHata(e instanceof Error ? e.message : "Liste alınamadı"); }
    finally { setYukleniyor(false); }
  }, [sekme, bildirgeSorgusu, muhsgkSorgusu]);
  useEffect(() => { void yukle(); }, [yukle]);

  const indir = (bicim: "xlsx" | "pdf" | "xml") => {
    setHata(null);
    const [yol, ad] = sekme === "muhsgk"
      ? [`/personel/sgk/muhsgk/dosya/${bicim}?${muhsgkSorgusu()}`, bicim === "xml" ? `aphb-${donem.yil}-${String(donem.ay).padStart(2, "0")}.xml` : `muhsgk-on-dokum-${donem.yil}-${String(donem.ay).padStart(2, "0")}.${bicim}`]
      : [`/personel/sgk/bildirgeler/dosya/${bicim}?${bildirgeSorgusu()}`, `sgk-${sekme === "giris" ? "ise-giris" : "isten-cikis"}-${aralik.baslangic}_${aralik.bitis}.${bicim}`];
    void apiDosyaIndir(yol, ad).catch((e) => setHata(e instanceof Error ? e.message : "Dosya indirilemedi"));
  };

  const isaretKaydet = async (e: React.FormEvent) => {
    e.preventDefault(); if (!isaret) return;
    try {
      setIsleniyor(true); setHata(null);
      await api(`/personel/sgk/istihdam/${isaret.satir.istihdamId}/bildirge`, { method: "PUT", body: JSON.stringify({ tur: sekme, tarih: isaret.tarih, no: isaret.no.trim() || null }) });
      setIsaret(null); await yukle();
    } catch (e) { setHata(e instanceof ApiHata ? e.message : "Bildirge işaretlenemedi"); }
    finally { setIsleniyor(false); }
  };
  const isaretGeriAl = async (s: BildirgeSatiri) => {
    if (!window.confirm(`${s.adSoyad} için bildirge işareti kaldırılsın mı?`)) return;
    try { setHata(null); await api(`/personel/sgk/istihdam/${s.istihdamId}/bildirge/${sekme}`, { method: "DELETE" }); await yukle(); }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "İşaret kaldırılamadı"); }
  };
  const cikisKoduDegistir = async (s: BildirgeSatiri, kod: string) => {
    try { setHata(null); await api(`/personel/sgk/istihdam/${s.istihdamId}/cikis-kodu`, { method: "PUT", body: JSON.stringify({ kod }) }); await yukle(); }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "Çıkış kodu kaydedilemedi"); }
  };

  const secilenIsyeri = isyerleri.find((i) => i.id === isyeriId);
  const xmlEngeli = !isyeriId ? "XML için işyeri seçin (her işyerinin SGK dosyası ayrıdır)." : null;
  const giris = sekme === "giris";

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel">← Personel ve İK</Link>
      <PageHeader
        title="SGK ve MUHSGK"
        subtitle="İşe giriş ve işten çıkış bildirge verisi, bildirge süre takibi ve MUHSGK ön dökümü. XML dosyaları yalnız indirilir; yüklemeyi e-Bildirge / e-Beyanname oturumunuzda yaparsınız."
      />
      <Tabs<Sekme> items={[{ deger: "giris", baslik: "İşe giriş" }, { deger: "cikis", baslik: "İşten çıkış" }, { deger: "muhsgk", baslik: "MUHSGK" }]} value={sekme} onChange={setSekme} ariaLabel="SGK çıktıları" />
      <Alert tone="error">{hata}</Alert>

      <Card>
        <div className="form-grid">
          <Field label="İşyeri">
            <Select value={isyeriId} onChange={(e) => setIsyeriId(e.target.value)}>
              <option value="">Tüm işyerleri</option>
              {isyerleri.map((i) => <option key={i.id} value={i.id}>{i.ad}{i.sgkSicilNo ? "" : " (sicil no yok)"}</option>)}
            </Select>
          </Field>
          {sekme === "muhsgk" ? <>
            <Field label="Yıl"><Input type="number" min={2020} max={2100} value={donem.yil} onChange={(e) => setDonem({ ...donem, yil: Number(e.target.value) })} /></Field>
            <Field label="Ay"><Input type="number" min={1} max={12} value={donem.ay} onChange={(e) => setDonem({ ...donem, ay: Number(e.target.value) })} /></Field>
          </> : <>
            <Field label={giris ? "Giriş tarihi başı" : "Çıkış tarihi başı"}><Input type="date" value={aralik.baslangic} onChange={(e) => setAralik({ ...aralik, baslangic: e.target.value })} /></Field>
            <Field label="Bitiş"><Input type="date" value={aralik.bitis} onChange={(e) => setAralik({ ...aralik, bitis: e.target.value })} /></Field>
            <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={yalnizVerilmemis} onChange={(e) => setYalnizVerilmemis(e.target.checked)} /><span>Yalnız bildirgesi verilmemişler</span></label>
          </>}
        </div>
        <EylemCubugu etiket="Dışa aktar">
          <Button onClick={() => indir("xlsx")}>Excel</Button>
          <Button onClick={() => indir("pdf")}>PDF</Button>
          <Button variant="primary" disabled={Boolean(xmlEngeli)} title={xmlEngeli ?? undefined} onClick={() => indir("xml")}>{sekme === "muhsgk" ? "APHB XML" : giris ? "Toplu işe giriş XML" : "Toplu işten çıkış XML"}</Button>
        </EylemCubugu>
        <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.78rem" }}>
          {xmlEngeli ?? `${secilenIsyeri?.ad}: ${secilenIsyeri?.sgkSicilNo ? `sicil ${secilenIsyeri.sgkSicilNo}` : "SGK sicil no girilmemiş — Organizasyon ekranından ekleyin"}.`} Dosyalarda TCKN açık yazılır; her indirme denetim kaydına geçer.
          {sekme === "muhsgk" && " MUHSGK'nın gelir vergisi / damga vergisi bölümü için resmî dosya şeması yoktur; Excel/PDF ön dökümünden e-Beyanname'ye girilir."}
        </p>
      </Card>

      {sekme !== "muhsgk" ? (
        <Card pad={false}>
          <Table>
            <thead><tr><th>Personel</th><th>TCKN</th><th>İşyeri</th><th>{giris ? "Giriş" : "Çıkış"}</th><th>Belge</th><th>Meslek</th>{!giris && <><th>Çıkış kodu</th><th className="num">Çıkış ayı (hak edilen / prim)</th></>}<th>Son gün</th><th>Bildirge</th><th>Eksik</th><th /></tr></thead>
            <tbody>
              {bildirgeler.map((s) => (
                <tr key={s.istihdamId}>
                  <td><Link href={`/panel/personel/${s.personelId}`}><strong>{s.adSoyad}</strong></Link><br /><small className="mono subtle">{s.personelNo}</small></td>
                  <td className="mono">{s.tcknMaskeli ?? "—"}</td>
                  <td>{s.isyeri ?? "—"}</td>
                  <td><Tarih deger={s.tarih} /></td>
                  <td>{s.belgeTuru}{giris && <small className="muted"> · kol {s.sigortaKolu ?? "?"}</small>}<br /><small className="muted">kanun {s.kanunNo}</small></td>
                  <td className="mono">{s.meslekKodu ?? "—"}</td>
                  {!giris && <>
                    <td>
                      <Select aria-label="SGK çıkış kodu" value={s.cikisKodu ?? ""} onChange={(e) => void cikisKoduDegistir(s, e.target.value)} style={{ minWidth: "9rem" }}>
                        {!s.cikisKodu && <option value="">Seçin</option>}
                        {Object.entries(SGK_CIKIS_KODLARI).map(([kod, ad]) => <option key={kod} value={kod} title={ad}>{kod} — {ad.length > 40 ? `${ad.slice(0, 40)}…` : ad}</option>)}
                      </Select>
                    </td>
                    <td className="num">{s.bulundugumuz ? <><Para deger={s.bulundugumuz.hakEdilenUcret} /> / <Para deger={s.bulundugumuz.primIkramiye} />{s.bulundugumuz.eksikGunSayisi > 0 && <><br /><small className="muted">{s.bulundugumuz.eksikGunSayisi} eksik gün ({s.bulundugumuz.eksikGunNedeni ?? "?"})</small></>}</> : <small className="muted">onaylı bordro yok</small>}</td>
                  </>}
                  <td><Tarih deger={s.sonTarih} /></td>
                  <td><Badge variant={DURUM[s.durum][1]}>{DURUM[s.durum][0]}</Badge>{s.bildirgeTarihi && <><br /><small className="muted"><Tarih deger={s.bildirgeTarihi} />{s.bildirgeNo ? ` · ${s.bildirgeNo}` : ""}</small></>}</td>
                  <td>{s.eksikler.length ? <small style={{ color: "var(--warning)" }}>{s.eksikler.join(", ")}</small> : <small className="muted">—</small>}{s.xmlDisi && <><br /><small className="muted">XML'e girmez</small></>}</td>
                  <td className="num">{s.bildirgeTarihi
                    ? <Button size="sm" onClick={() => void isaretGeriAl(s)}>Geri al</Button>
                    : <Button size="sm" variant="primary" onClick={() => setIsaret({ satir: s, tarih: new Date().toISOString().slice(0, 10), no: "" })}>Verildi</Button>}</td>
                </tr>
              ))}
              {!bildirgeler.length && <tr><td className="muted" colSpan={giris ? 10 : 12}>{yukleniyor ? "Yükleniyor…" : `Seçilen aralıkta ${giris ? "işe giriş" : "işten çıkış"} yok.`}</td></tr>}
            </tbody>
          </Table>
        </Card>
      ) : muhsgk && <>
        {muhsgk.uyarilar.map((u) => <Alert key={u} tone="warning">{u}</Alert>)}
        <StatGrid>
          <Stat label="Hizmet satırı" value={muhsgk.ozet.kisiSayisi} hint={`${muhsgk.ozet.primGunu} prim günü · hesap izi olanlar`} />
          <Stat label="PEK toplamı" value={<Para deger={muhsgk.ozet.pek} />} hint="Prime esas kazanç" tone="accent" />
          <Stat label="Kesilen gelir vergisi" value={<Para deger={muhsgk.ozet.kesilenGv} />} hint={<>AÜ istisnası <Para deger={muhsgk.ozet.asgariGvIstisnasi} /></>} />
          <Stat label="Kesilen damga vergisi" value={<Para deger={muhsgk.ozet.kesilenDv} />} hint={<>İstisna <Para deger={muhsgk.ozet.dvIstisnasi} /></>} />
          <Stat label="SGK (işçi + işveren)" value={<Para deger={Number(muhsgk.ozet.sgkIsci) + Number(muhsgk.ozet.isverenSgkNet)} />} hint={<>Teşvik indirimi <Para deger={muhsgk.ozet.tesvikIndirimi} /></>} />
          <Stat label="İşsizlik (işçi + işveren)" value={<Para deger={Number(muhsgk.ozet.issizlikIsci) + Number(muhsgk.ozet.isverenIssizlik)} />} hint="" />
        </StatGrid>
        <Card pad={false}>
          <Table density="compact">
            <thead><tr><th>Personel</th><th>TCKN</th><th>Belge / kanun</th><th className="num">Gün</th><th>Eksik gün</th><th>Giriş / çıkış</th><th className="num">PEK</th><th className="num">Prim/ikramiye</th><th className="num">GV matrahı</th><th className="num">Kesilen GV</th><th className="num">Kesilen DV</th><th>Uyarı</th></tr></thead>
            <tbody>
              {muhsgk.satirlar.map((s) => (
                <tr key={s.personelId}>
                  <td><Link href={`/panel/personel/${s.personelId}`}><strong>{s.adSoyad}</strong></Link><br /><small className="mono subtle">{s.personelNo}</small></td>
                  <td className="mono">{s.tcknMaskeli ?? "—"}</td>
                  <td>{s.belgeTuru} / {s.kanunNo}</td>
                  <td className="num">{s.primGunu}</td>
                  <td>{s.eksikGunSayisi ? `${s.eksikGunSayisi} (${s.eksikGunKodu ?? "?"})` : "—"}</td>
                  <td>{s.girisTarihi && <>Giriş <Tarih deger={s.girisTarihi} /></>}{s.cikisTarihi && <>Çıkış <Tarih deger={s.cikisTarihi} /> · {s.cikisKodu ?? "kod yok"}</>}{!s.girisTarihi && !s.cikisTarihi && "—"}</td>
                  <td className="num"><Para deger={s.pek} /></td>
                  <td className="num"><Para deger={s.primIkramiye} /></td>
                  <td className="num"><Para deger={s.gvMatrahi} /></td>
                  <td className="num"><Para deger={s.kesilenGv} /></td>
                  <td className="num"><Para deger={s.kesilenDv} /></td>
                  <td>{s.uyarilar.length || s.aphbDisi ? <small style={{ color: "var(--warning)" }}>{[...s.uyarilar, ...(s.aphbDisi && s.hesapIzi ? [`APHB'ye girmez: ${s.aphbDisi}`] : [])].join("; ")}</small> : <small className="muted">—</small>}</td>
                </tr>
              ))}
              {!muhsgk.satirlar.length && <tr><td className="muted" colSpan={12}>{yukleniyor ? "Yükleniyor…" : "Dönemde onaylı bordro yok."}</td></tr>}
            </tbody>
          </Table>
        </Card>
      </>}

      {isaret && (
        <Modal baslik={`${giris ? "İşe giriş" : "İşten çıkış"} bildirgesi verildi`} aciklama={`${isaret.satir.adSoyad} — işlem denetim kaydına yazılır; gerekirse geri alınabilir.`} onKapat={() => setIsaret(null)}>
          <form className="stack" onSubmit={isaretKaydet}>
            <Field label="Bildirge tarihi"><Input required type="date" max={new Date().toISOString().slice(0, 10)} value={isaret.tarih} onChange={(e) => setIsaret({ ...isaret, tarih: e.target.value })} /></Field>
            <Field label="Referans / belge no (isteğe bağlı)"><Input maxLength={50} value={isaret.no} onChange={(e) => setIsaret({ ...isaret, no: e.target.value })} /></Field>
            <ModalEylem onVazgec={() => setIsaret(null)} isleniyor={isleniyor} metin="Kaydet" />
          </form>
        </Modal>
      )}
    </div>
  );
}
