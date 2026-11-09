"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAdresDurumu } from "@/lib/adres-durumu";
import { Alert, Badge, Button, Card, Field, Input, Modal, ModalEylem, PageHeader, Para, Segmented, Select, Stat, StatGrid, TableSkeleton, TableWrap, Tarih } from "@/components/ui";

/** VTK: kendi kayıtlarımızdan ön hesap; beyannameye esas değildir, para hareketi üretmez. */
type Durum = "bekliyor" | "kismi" | "odendi" | "gecikti" | "yok";
interface Odeme { id: string; tarih: string; tutar: number; not: string | null; hareketId: string | null; hareketAciklama: string | null }
interface Satir {
  yukumluluk: string; ad: string; yil: number; ay: number; sonTarih: string | null; oncekiSonTarih: string | null;
  hesaplanan: number; beyanTutari: number | null; beyanDevreden: number | null; beyanNotu: string | null;
  tutar: number; odenen: number; kalan: number; durum: Durum; donemSuruyor: boolean; uyarilar: string[];
  devredenGiren: number | null; devredenCikan: number | null; odemeler: Odeme[];
}
interface Ayar { baslangicYil: number; baslangicAy: number; devredenKdv: number; muhtasarDonemi: "aylik" | "uc_aylik" }
interface Yanit { yil: number; bugun: string; ayar: Ayar | null; ucAylikAcik: boolean; yazabilir: boolean; satirlar: Satir[] }
interface Hareket { id: string; tarih: string; tutar: number; aciklama: string | null; hesap: string | null }

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DURUM: Record<Durum, { ad: string; rozet: "neutral" | "warning" | "success" | "danger" | "info" }> = {
  bekliyor: { ad: "Bekliyor", rozet: "info" }, kismi: { ad: "Kısmi", rozet: "warning" }, odendi: { ad: "Ödendi", rozet: "success" }, gecikti: { ad: "Gecikti", rozet: "danger" }, yok: { ad: "Ödenecek yok", rozet: "neutral" },
};
const KAYNAK: Record<string, { href: string; ad: string }> = {
  kdv1: { href: "/panel/mali-musavir", ad: "KDV ön analizi" }, kdv2: { href: "/panel/mali-musavir", ad: "KDV ön analizi" },
  muhtasar: { href: "/panel/personel/sgk?sekme=muhsgk", ad: "MUHSGK ön dökümü" }, muhtasar3: { href: "/panel/personel/sgk?sekme=muhsgk", ad: "MUHSGK ön dökümü" }, sgk: { href: "/panel/personel/sgk?sekme=muhsgk", ad: "MUHSGK ön dökümü" },
};
const gunKaydir = (t: string, g: number) => new Date(Date.parse(`${t}T00:00:00Z`) + g * 86_400_000).toISOString().slice(0, 10);
const para = (s: string) => Number(s.replace(",", "."));

export default function VergiTakvimiSayfasi() {
  const buYil = new Date().getFullYear();
  const [adres, adresGuncelle, adresHazir] = useAdresDurumu({ yil: String(buYil) });
  const yil = Number(adres.yil) || buYil;
  const [veri, setVeri] = useState<Yanit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState(""); const [isleniyor, setIsleniyor] = useState(false);
  const [suzgec, setSuzgec] = useState<"acik" | "hepsi">("acik");
  const [acik, setAcik] = useState<string | null>(null);
  const [ayarAcik, setAyarAcik] = useState(false);
  const [ayar, setAyar] = useState({ baslangicYil: String(buYil), baslangicAy: String(new Date().getMonth() + 1), devredenKdv: "0", muhtasarDonemi: "aylik" as Ayar["muhtasarDonemi"] });
  const [beyan, setBeyan] = useState({ tutar: "", devreden: "", not: "" });
  const [odeme, setOdeme] = useState({ tarih: "", tutar: "", hareket: "", not: "" });
  const [hareketler, setHareketler] = useState<Hareket[]>([]);

  const yukle = useCallback(async () => {
    setYukleniyor(true); setHata("");
    try { setVeri(await api<Yanit>(`/rapor/vergi-takvimi?yil=${yil}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Vergi takvimi yüklenemedi"); }
    finally { setYukleniyor(false); }
  }, [yil]);
  useEffect(() => { if (adresHazir) void yukle(); }, [yukle, adresHazir]);

  const kimlik = (s: Satir) => `${s.yukumluluk}:${s.yil}-${s.ay}`;
  const secili = veri?.satirlar.find((s) => kimlik(s) === acik) ?? null;
  const bugunAyi = veri ? veri.bugun.slice(0, 7) : "";
  const gorunen = useMemo(() => (veri?.satirlar ?? [])
    .filter((s) => `${s.yil}-${String(s.ay).padStart(2, "0")}` <= bugunAyi || s.odenen > 0 || s.beyanTutari !== null)
    .filter((s) => suzgec === "hepsi" || s.kalan > 0)
    .sort((a, b) => (a.sonTarih ?? "9999").localeCompare(b.sonTarih ?? "9999") || a.ay - b.ay), [veri, suzgec, bugunAyi]);
  const toplam = useMemo(() => {
    const s = veri?.satirlar ?? [], ufuk = veri ? gunKaydir(veri.bugun, 30) : "";
    return { gecikmis: s.filter((x) => x.durum === "gecikti").reduce((t, x) => t + x.kalan, 0), yaklasan: s.filter((x) => x.durum !== "gecikti" && x.kalan > 0 && x.sonTarih && x.sonTarih <= ufuk).reduce((t, x) => t + x.kalan, 0), odenen: s.reduce((t, x) => t + x.odenen, 0), tarihsiz: s.filter((x) => !x.sonTarih && x.kalan > 0 && `${x.yil}-${String(x.ay).padStart(2, "0")}` <= (veri?.bugun.slice(0, 7) ?? "")).length };
  }, [veri]);

  function ac(s: Satir) {
    setAcik(kimlik(s)); setHata("");
    setBeyan({ tutar: s.beyanTutari === null ? "" : String(s.beyanTutari), devreden: s.beyanDevreden === null ? "" : String(s.beyanDevreden), not: s.beyanNotu ?? "" });
    setOdeme({ tarih: veri?.bugun ?? "", tutar: s.kalan > 0 ? String(s.kalan) : "", hareket: "", not: "" });
    setHareketler([]);
    if (veri?.yazabilir) {
      const merkez = s.sonTarih ?? veri.bugun;
      void api<Hareket[]>(`/rapor/vergi-takvimi/hareketler?${new URLSearchParams({ baslangic: gunKaydir(merkez, -45), bitis: gunKaydir(merkez, 45) })}`).then(setHareketler).catch(() => setHareketler([]));
    }
  }
  function ayarAc() {
    if (veri?.ayar) setAyar({ baslangicYil: String(veri.ayar.baslangicYil), baslangicAy: String(veri.ayar.baslangicAy), devredenKdv: String(veri.ayar.devredenKdv), muhtasarDonemi: veri.ayar.muhtasarDonemi });
    setAyarAcik(true);
  }
  async function calis(is: () => Promise<unknown>, mesaj: string, sonra?: () => void) {
    setIsleniyor(true); setHata(""); setBilgi("");
    try { await is(); setBilgi(mesaj); sonra?.(); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem başarısız"); }
    finally { setIsleniyor(false); }
  }
  const ayarKaydet = (e: FormEvent) => { e.preventDefault(); void calis(() => api("/rapor/vergi-takvimi/ayar", { method: "PUT", body: JSON.stringify({ baslangicYil: Number(ayar.baslangicYil), baslangicAy: Number(ayar.baslangicAy), devredenKdv: para(ayar.devredenKdv || "0"), muhtasarDonemi: ayar.muhtasarDonemi }) }), "Takip başlangıcı kaydedildi.", () => setAyarAcik(false)); };
  const donemi = (s: Satir) => ({ yukumluluk: s.yukumluluk, yil: s.yil, ay: s.ay });
  const beyanKaydet = (e: FormEvent, s: Satir) => {
    e.preventDefault();
    const tutar = beyan.tutar.trim() === "" ? null : para(beyan.tutar);
    void calis(() => api("/rapor/vergi-takvimi/beyan", { method: "PUT", body: JSON.stringify({ ...donemi(s), beyanTutari: tutar, beyanDevreden: s.yukumluluk === "kdv1" && beyan.devreden.trim() !== "" ? para(beyan.devreden) : null, beyanNotu: beyan.not.trim() || null }) }), tutar === null ? "Beyan tutarı kaldırıldı." : "Beyan tutarı kaydedildi.");
  };
  const odemeEkle = (e: FormEvent, s: Satir) => {
    e.preventDefault();
    void calis(() => api("/rapor/vergi-takvimi/odeme", { method: "POST", body: JSON.stringify({ ...donemi(s), tarih: odeme.tarih, tutar: para(odeme.tutar), kasaBankaHareketId: odeme.hareket || null, not: odeme.not.trim() || null }) }), "Ödeme işaretlendi.", () => setAcik(null));
  };
  const odemeSil = (o: Odeme) => { if (window.confirm("Ödeme işareti geri alınsın mı? Kasa/banka hareketi değişmez.")) void calis(() => api(`/rapor/vergi-takvimi/odeme/${o.id}`, { method: "DELETE" }), "Ödeme işareti geri alındı."); };

  const yazabilir = Boolean(veri?.yazabilir);
  return <div>
    <PageHeader title="Vergi ve SGK Takvimi" subtitle="Tutarlar kendi kayıtlarınızdan ön hesaptır, beyannameye esas değildir." actions={<div className="row-tight">{yazabilir && <Button onClick={ayarAc}>Takip başlangıcı</Button>}<Select aria-label="Yıl" value={yil} onChange={(e) => adresGuncelle({ yil: e.target.value })}>{[buYil + 1, buYil, buYil - 1, buYil - 2].map((y) => <option key={y} value={y}>{y}</option>)}</Select></div>} />
    <Alert tone="error">{hata}</Alert><Alert tone="success">{bilgi}</Alert>
    {veri && !veri.ayar && <Alert tone="warning">Takip başlangıcı girilmedi. Devreden KDV hesaba katılmıyor ve geçmiş dönemler gecikmiş sayılmıyor.{yazabilir && <div style={{ marginTop: "0.5rem" }}><Button size="sm" onClick={ayarAc}>Şimdi girin</Button></div>}</Alert>}
    {toplam.tarihsiz > 0 && <Alert tone="warning">{toplam.tarihsiz} kalemin son tarihi henüz yayınlanmadı. Bu kalemler için hatırlatma yapılmaz.</Alert>}
    {veri && <StatGrid><Stat label="Gecikmiş" value={<Para deger={toplam.gecikmis} />} tone={toplam.gecikmis > 0 ? "danger" : "default"} /><Stat label="30 gün içinde" value={<Para deger={toplam.yaklasan} />} /><Stat label={`${yil} ödenen`} value={<Para deger={toplam.odenen} />} /></StatGrid>}
    <Card pad={false} title="Yükümlülükler" actions={<Segmented ariaLabel="Süzgeç" items={[{ deger: "acik", baslik: "Açık" }, { deger: "hepsi", baslik: "Tümü" }]} value={suzgec} onChange={setSuzgec} />}>
      {yukleniyor && !veri ? <TableSkeleton /> : <TableWrap><table className="table">
        <thead><tr><th>Dönem</th><th>Yükümlülük</th><th>Son tarih</th><th className="num">Hesaplanan</th><th className="num">Beyan</th><th className="num">Ödenen</th><th className="num">Kalan</th><th>Durum</th></tr></thead>
        <tbody>
          {gorunen.map((s) => <tr key={kimlik(s)} className="row-link" tabIndex={0} role="button" aria-label={`${s.ad} ${AYLAR[s.ay - 1]} ${s.yil} ayrıntısı`} onClick={() => ac(s)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ac(s); } }}>
            <td>{AYLAR[s.ay - 1]} {s.yil}{s.donemSuruyor && <div className="muted" style={{ fontSize: "0.78rem" }}>Dönem sürüyor</div>}</td>
            <td>{s.ad}{s.uyarilar.length > 0 && <div style={{ fontSize: "0.78rem" }} className="is-negative">{s.uyarilar[0]}{s.uyarilar.length > 1 ? ` +${s.uyarilar.length - 1}` : ""}</div>}</td>
            <td>{s.sonTarih ? <Tarih deger={s.sonTarih} /> : <span className="muted">Yayınlanmadı</span>}{s.oncekiSonTarih && <div><Badge variant="info">Uzatıldı</Badge></div>}</td>
            <td className="num"><Para deger={s.hesaplanan} /></td>
            <td className="num">{s.beyanTutari === null ? "—" : <Para deger={s.beyanTutari} />}</td>
            <td className="num"><Para deger={s.odenen} /></td>
            <td className="num"><Para deger={s.kalan} /></td>
            <td><Badge variant={DURUM[s.durum].rozet}>{DURUM[s.durum].ad}</Badge></td>
          </tr>)}
          {!gorunen.length && <tr><td colSpan={8} className="muted">{suzgec === "acik" ? "Açık yükümlülük yok." : "Bu yıl için kayıt yok."}</td></tr>}
        </tbody>
      </table></TableWrap>}
    </Card>

    {secili && <Modal genis baslik={`${secili.ad} · ${AYLAR[secili.ay - 1]} ${secili.yil}`} aciklama={secili.sonTarih ? <>Son tarih <Tarih deger={secili.sonTarih} />{secili.oncekiSonTarih && <> (uzatıldı, eski <Tarih deger={secili.oncekiSonTarih} />)</>}</> : "Son tarih henüz yayınlanmadı."} onKapat={() => setAcik(null)}>
      <Alert tone="error">{hata}</Alert>
      {secili.uyarilar.length > 0 && <Alert tone="warning"><ul style={{ margin: 0, paddingLeft: "1.1rem" }}>{secili.uyarilar.map((u) => <li key={u}>{u}</li>)}</ul></Alert>}
      <p>Hesaplanan <strong><Para deger={secili.hesaplanan} /></strong>. Kaynak: <Link href={KAYNAK[secili.yukumluluk]?.href ?? "/panel/raporlar"}>{KAYNAK[secili.yukumluluk]?.ad ?? "Rapor"}</Link>{secili.yukumluluk === "muhtasar" || secili.yukumluluk === "muhtasar3" ? <>, <Link href="/panel/raporlar/kdv-disi-vergiler">kestiğimiz stopaj</Link></> : null}.</p>
      {secili.devredenGiren !== null && <p className="muted">Önceki dönemden devreden <Para deger={secili.devredenGiren} />, sonraki döneme devreden <Para deger={secili.devredenCikan ?? 0} />.</p>}
      {yazabilir ? <form className="form-grid" onSubmit={(e) => beyanKaydet(e, secili)}>
        <Field label="Beyan tutarı"><Input inputMode="decimal" value={beyan.tutar} onChange={(e) => setBeyan((o) => ({ ...o, tutar: e.target.value }))} placeholder="Boş bırakılırsa hesaplanan esas alınır" /></Field>
        {secili.yukumluluk === "kdv1" && <Field label="Sonraki döneme devreden"><Input inputMode="decimal" value={beyan.devreden} onChange={(e) => setBeyan((o) => ({ ...o, devreden: e.target.value }))} placeholder="Beyannamedeki tutar" /></Field>}
        <Field label="Not"><Input value={beyan.not} maxLength={500} onChange={(e) => setBeyan((o) => ({ ...o, not: e.target.value }))} /></Field>
        <div><Button type="submit" disabled={isleniyor}>Beyanı kaydet</Button></div>
      </form> : secili.beyanTutari !== null && <p>Beyan tutarı <Para deger={secili.beyanTutari} /></p>}
      <h3 style={{ marginTop: "1.2rem" }}>Ödemeler</h3>
      {secili.odemeler.length > 0 ? <TableWrap><table className="table table--fit"><thead><tr><th>Tarih</th><th className="num">Tutar</th><th>Hareket</th><th>Not</th>{yazabilir && <th />}</tr></thead><tbody>
        {secili.odemeler.map((o) => <tr key={o.id}><td><Tarih deger={o.tarih} /></td><td className="num"><Para deger={o.tutar} /></td><td>{o.hareketId ? o.hareketAciklama ?? "Bağlı hareket" : <span className="muted">Bağlı değil</span>}</td><td>{o.not ?? ""}</td>{yazabilir && <td><Button size="sm" disabled={isleniyor} onClick={() => odemeSil(o)}>Geri al</Button></td>}</tr>)}
      </tbody></table></TableWrap> : <p className="muted">Ödeme işaretlenmedi.</p>}
      {yazabilir && <form className="form-grid" style={{ marginTop: "0.8rem" }} onSubmit={(e) => odemeEkle(e, secili)}>
        <Field label="Ödeme tarihi"><Input type="date" required value={odeme.tarih} onChange={(e) => setOdeme((o) => ({ ...o, tarih: e.target.value }))} /></Field>
        <Field label="Tutar"><Input inputMode="decimal" required value={odeme.tutar} onChange={(e) => setOdeme((o) => ({ ...o, tutar: e.target.value }))} /></Field>
        <Field label="Kasa/banka hareketi (isteğe bağlı)"><Select value={odeme.hareket} onChange={(e) => { const h = hareketler.find((x) => x.id === e.target.value); setOdeme((o) => ({ ...o, hareket: e.target.value, ...(h ? { tarih: h.tarih, tutar: String(h.tutar) } : {}) })); }}><option value="">Bağlama</option>{hareketler.map((h) => <option key={h.id} value={h.id}>{h.tarih.split("-").reverse().join(".")} · {h.tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL · {h.hesap ?? ""} · {(h.aciklama ?? "").slice(0, 40)}</option>)}</Select></Field>
        <Field label="Not"><Input value={odeme.not} maxLength={500} onChange={(e) => setOdeme((o) => ({ ...o, not: e.target.value }))} /></Field>
        <div><Button type="submit" variant="primary" disabled={isleniyor}>Ödendi olarak işaretle</Button></div>
        <p className="muted" style={{ gridColumn: "1 / -1" }}>Bu işaret para hareketi ya da muhasebe fişi üretmez.</p>
      </form>}
    </Modal>}

    {ayarAcik && <Modal baslik="Takip başlangıcı" aciklama="Devreden KDV bu dönemden itibaren zincirlenir, öncesi hesaplanmaz." onKapat={() => setAyarAcik(false)}>
      <form className="form-grid" onSubmit={ayarKaydet}>
        <Field label="Başlangıç ayı"><Select value={ayar.baslangicAy} onChange={(e) => setAyar((o) => ({ ...o, baslangicAy: e.target.value }))}>{AYLAR.map((a, i) => <option key={a} value={i + 1}>{a}</option>)}</Select></Field>
        <Field label="Başlangıç yılı"><Input type="number" min={2000} max={2100} required value={ayar.baslangicYil} onChange={(e) => setAyar((o) => ({ ...o, baslangicYil: e.target.value }))} /></Field>
        <Field label="Bu döneme devreden KDV"><Input inputMode="decimal" required value={ayar.devredenKdv} onChange={(e) => setAyar((o) => ({ ...o, devredenKdv: e.target.value }))} /></Field>
        <Field label="Muhtasar dönemi"><Select value={ayar.muhtasarDonemi} onChange={(e) => setAyar((o) => ({ ...o, muhtasarDonemi: e.target.value as Ayar["muhtasarDonemi"] }))}><option value="aylik">Aylık</option><option value="uc_aylik" disabled={!veri?.ucAylikAcik}>Üç aylık{veri?.ucAylikAcik ? "" : " (tarihler yayınlanmadı)"}</option></Select></Field>
        <div style={{ gridColumn: "1 / -1" }}><ModalEylem onVazgec={() => setAyarAcik(false)} isleniyor={isleniyor} metin="Kaydet" /></div>
      </form>
    </Modal>}
  </div>;
}
