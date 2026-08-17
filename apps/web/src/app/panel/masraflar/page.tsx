"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { BelgeDosyalari, belgeDosyalariniYukle } from "@/components/belge-dosyalari";
import { MasrafEkPaneli } from "@/components/masraf-ek-paneli";

interface Kategori { id: string; ad: string; varsayilanKdvOrani: string | null; ustId: string | null; ust: { id: string; ad: string } | null; _count: { altlar: number; masraflar: number } }
interface Cari { id: string; unvan: string }
interface Hesap { id: string; ad: string; dovizCinsi: string }
interface MasrafOdeme { id: string; tutar: string; odemeTarihi: string; aciklama: string | null; kasa: { ad: string } | null; bankaHesap: { ad: string } | null }
interface Masraf { id: string; tarih: string; belgeTuru: string; belgeNo: string | null; saticiUnvan: string | null; vknTckn?: string | null; aciklama?: string | null; matrah: string; kdvOrani: string; kdvTutari: string; toplam: string; stopajTutari?: string | null; odenenTutar: string; dovizCinsi: string; durum: "taslak" | "onaylandi" | "iptal"; odemeDurumu: "odenmedi" | "kismi_odendi" | "odendi"; kategori: Kategori; cari: Cari | null; odemeler: MasrafOdeme[] }

const bugun = () => new Date().toISOString().slice(0, 10);
const para = (n: string | number, d = "TRY") => Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + d;

export default function MasraflarSayfasi() {
  const pathname = usePathname(); const router = useRouter(); const yeniSayfasi = pathname.endsWith("/yeni");
  const [masraflar, setMasraflar] = useState<Masraf[]>([]);
  const [kategoriler, setKategoriler] = useState<Kategori[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [kasalar, setKasalar] = useState<Hesap[]>([]);
  const [bankalar, setBankalar] = useState<Hesap[]>([]);
  const [formAcik, setFormAcik] = useState(yeniSayfasi);
  const [duzenlenenId, setDuzenlenenId] = useState<string | null>(null); const [ekleriAcikMasraf, setEkleriAcikMasraf] = useState<Masraf | null>(null);
  const [odenecekMasraf, setOdenecekMasraf] = useState<Masraf | null>(null); const [odemeHesabi, setOdemeHesabi] = useState(""); const [odemeTarihi, setOdemeTarihi] = useState(bugun()); const [odemeTutari, setOdemeTutari] = useState(""); const [odemeAciklama, setOdemeAciklama] = useState(""); const [odemeKaydediliyor, setOdemeKaydediliyor] = useState(false);
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState("");
  const [kategoriId, setKategoriId] = useState(""); const [cariId, setCariId] = useState("");
  const [belgeTuru, setBelgeTuru] = useState("fis"); const [belgeNo, setBelgeNo] = useState("");
  const [tarih, setTarih] = useState(bugun()); const [saticiUnvan, setSaticiUnvan] = useState("");
  const [vknTckn, setVknTckn] = useState(""); const [aciklama, setAciklama] = useState("");
  const [toplamBedel, setToplamBedel] = useState(""); const [kdvOrani, setKdvOrani] = useState("20");
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [arama, setArama] = useState(""); const [durumFiltresi, setDurumFiltresi] = useState("aktif"); const [kategoriFiltresi, setKategoriFiltresi] = useState("");

  const matrah = useMemo(() => {
    const toplam = Number(toplamBedel || 0); const oran = Number(kdvOrani || 0);
    return (oran === 0 ? toplam : toplam / (1 + oran / 100)).toFixed(2);
  }, [toplamBedel, kdvOrani]);
  const kdvTutari = useMemo(() => (Number(toplamBedel || 0) - Number(matrah)).toFixed(2), [toplamBedel, matrah]);
  const toplam = useMemo(() => Number(toplamBedel || 0).toFixed(2), [toplamBedel]);
  const ozet = useMemo(() => { const gecerli = masraflar.filter((m) => m.durum !== "iptal" && m.dovizCinsi === "TRY"); return { toplam: gecerli.reduce((t, m) => t + Number(m.toplam), 0), odenmemis: gecerli.reduce((t, m) => t + Math.max(0, Number(m.toplam) - Number(m.stopajTutari || 0) - Number(m.odenenTutar || 0)), 0), kira: gecerli.filter((m) => m.belgeTuru === "kira").reduce((t, m) => t + Number(m.toplam), 0), taslak: gecerli.filter((m) => m.durum === "taslak").length }; }, [masraflar]);
  const filtreliMasraflar = useMemo(() => masraflar.filter((m) => { const metin = `${m.cari?.unvan ?? m.saticiUnvan ?? ""} ${m.belgeNo ?? ""} ${m.aciklama ?? ""} ${m.kategori.ad}`.toLocaleLowerCase("tr-TR"); const durumUygun = durumFiltresi === "tumu" || (durumFiltresi === "aktif" ? m.durum !== "iptal" : durumFiltresi === "odenmedi" ? m.durum !== "iptal" && m.odemeDurumu !== "odendi" : m.durum === durumFiltresi); return metin.includes(arama.toLocaleLowerCase("tr-TR")) && durumUygun && (!kategoriFiltresi || m.kategori.id === kategoriFiltresi); }), [masraflar, arama, durumFiltresi, kategoriFiltresi]);

  const yukle = useCallback(async () => {
    const [m, k, c, ks, bs] = await Promise.all([api<Masraf[]>("/masraflar"), api<Kategori[]>("/masraflar/kategoriler"), tumSayfalariAl<Cari>("/cari"), api<Hesap[]>("/kasa-banka/kasalar"), api<Hesap[]>("/kasa-banka/bankalar")]);
    setMasraflar(m); setKategoriler(k); setCariler(c); setKasalar(ks); setBankalar(bs); setKategoriId((x) => x || k.find((a) => a.ustId || a._count.altlar === 0)?.id || "");
  }, []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Masraflar yüklenemedi")); }, [yukle]);
  useEffect(() => { setFormAcik(yeniSayfasi); }, [yeniSayfasi]);
  useEffect(() => {
    if (!yeniSayfasi) return; const id = new URLSearchParams(window.location.search).get("duzenle"); if (!id) return;
    void api<Masraf>(`/masraflar/${id}`).then((m) => { if (m.durum !== "taslak") throw new Error("Yalnızca taslak masraf düzenlenebilir"); setDuzenlenenId(m.id); setKategoriId(m.kategori.id); setCariId(m.cari?.id ?? ""); setBelgeTuru(m.belgeTuru); setBelgeNo(m.belgeNo ?? ""); setTarih(m.tarih.slice(0, 10)); setSaticiUnvan(m.saticiUnvan ?? ""); setVknTckn(m.vknTckn ?? ""); setAciklama(m.aciklama ?? ""); setToplamBedel(m.toplam); setKdvOrani(m.kdvOrani); }).catch((e) => setHata(e instanceof Error ? e.message : "Masraf açılamadı"));
  }, [yeniSayfasi]);
  useEffect(() => {
    if (!odenecekMasraf) return;
    const oncekiTasme = document.body.style.overflow; document.body.style.overflow = "hidden";
    const kapat = (e: KeyboardEvent) => { if (e.key === "Escape" && !odemeKaydediliyor) setOdenecekMasraf(null); };
    document.addEventListener("keydown", kapat);
    return () => { document.body.style.overflow = oncekiTasme; document.removeEventListener("keydown", kapat); };
  }, [odenecekMasraf, odemeKaydediliyor]);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault(); setHata(""); setBasari("");
    try {
      const kayit = await api<Masraf>(duzenlenenId ? `/masraflar/${duzenlenenId}` : "/masraflar", { method: duzenlenenId ? "PATCH" : "POST", body: JSON.stringify({ kategoriId, cariId: cariId || null, belgeTuru, belgeNo: belgeNo || null, tarih, saticiUnvan: cariId ? null : saticiUnvan, vknTckn: vknTckn || null, aciklama: aciklama || null, matrah, kdvOrani, kdvTutari, toplam, dovizCinsi: "TRY" }) });
      if (dosyalar.length) await belgeDosyalariniYukle("masraf", kayit.id, dosyalar);
      setBasari(duzenlenenId ? "Masraf güncellendi." : "Masraf taslak olarak kaydedildi."); setFormAcik(false); setToplamBedel(""); setBelgeNo(""); setSaticiUnvan(""); setAciklama(""); setDosyalar([]); await yukle(); if (yeniSayfasi) router.push("/panel/masraflar");
    } catch (e) { setHata(e instanceof Error ? e.message : "Masraf kaydedilemedi"); }
  }

  async function islem(id: string, yol: string, body?: object) {
    setHata(""); setBasari("");
    try { await api(`/masraflar/${id}/${yol}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }); setBasari("İşlem tamamlandı."); await yukle(); }
    catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); }
  }

  function odemeModaliniAc(m: Masraf) {
    const uygunKasa = kasalar.find((k) => k.dovizCinsi === m.dovizCinsi);
    const uygunBanka = bankalar.find((b) => b.dovizCinsi === m.dovizCinsi);
    setOdenecekMasraf(m); setOdemeHesabi(uygunKasa ? `kasa:${uygunKasa.id}` : uygunBanka ? `banka:${uygunBanka.id}` : ""); setOdemeTarihi(bugun()); setOdemeTutari(String(Math.max(0, Number(m.toplam) - Number(m.stopajTutari || 0) - Number(m.odenenTutar || 0)))); setOdemeAciklama(""); setHata("");
  }

  async function odemeYap(e: React.FormEvent) {
    e.preventDefault();
    if (!odenecekMasraf || !odemeHesabi) return;
    const [tur, id] = odemeHesabi.split(":"); setOdemeKaydediliyor(true); setHata("");
    try {
      await api(`/masraflar/${odenecekMasraf.id}/ode`, { method: "POST", body: JSON.stringify({ kasaId: tur === "kasa" ? id : null, bankaHesapId: tur === "banka" ? id : null, odemeTarihi, tutar: odemeTutari, aciklama: odemeAciklama || null }) });
      setOdenecekMasraf(null); setBasari("Masraf ödemesi kaydedildi."); await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Ödeme kaydedilemedi"); }
    finally { setOdemeKaydediliyor(false); }
  }

  return <div className={yeniSayfasi ? "create-page" : "expense-page"}>
    {yeniSayfasi ? <PageHeader title="Yeni Masraf" subtitle="Fiş, fatura veya gider belgesini kaydedin." actions={<Button onClick={() => router.push("/panel/masraflar")}>Listeye dön</Button>} /> : <header className="expense-hero"><div><span>GİDER YÖNETİM MERKEZİ</span><h1>Masraflar</h1><p>Giderlerinizi kaydedin, onaylayın ve ödeme durumunu tek ekrandan yönetin.</p></div><div><ButtonLabel as="a" href="/panel/masraflar/raporlar">Ayrıntılı raporlar</ButtonLabel><ButtonLabel as="a" href="/panel/masraflar/kategoriler">Kategoriler</ButtonLabel><ButtonLabel as="a" variant="primary" href="/panel/masraflar/yeni">+ Yeni masraf</ButtonLabel></div></header>}
    {hata && <Alert tone="error">{hata}</Alert>}{basari && <Alert tone="success">{basari}</Alert>}
    {!yeniSayfasi && <section className="expense-summary"><div className="expense-summary__lead"><span>Toplam gider</span><strong>{para(ozet.toplam)}</strong><small>İptal kayıtlar hariç · TRY</small></div><div className={ozet.odenmemis ? "is-danger" : ""}><span>Ödenecek bakiye</span><strong>{para(ozet.odenmemis)}</strong><small>Stopaj sonrası net ödeme</small></div><div><span>Kira giderleri</span><strong>{para(ozet.kira)}</strong><small>Toplam gider içindeki pay %{ozet.toplam ? Math.round(ozet.kira / ozet.toplam * 100) : 0}</small></div><div className={ozet.taslak ? "is-warning" : ""}><span>Onay bekleyen</span><strong>{ozet.taslak}</strong><small>Taslak masraf kaydı</small></div></section>}
    {formAcik && <Card className="expense-entry" title={<span><span className="expense-entry__eyebrow">{duzenlenenId ? "DÜZENLEME" : "YENİ KAYIT"}</span>Masraf bilgileri</span>} style={{ marginTop: "1rem" }}><form onSubmit={kaydet}>
      <div className="expense-entry__layout">
        <section className="expense-entry__section">
          <div className="expense-entry__section-head"><span className="expense-entry__step">01</span><div><h3>Belge ve kategori</h3><p>Masrafın temel kayıt bilgileri</p></div></div>
          <div className="expense-entry__grid expense-entry__grid--2">
            <Field label="Belge türü"><Select value={belgeTuru} onChange={(e) => setBelgeTuru(e.target.value)}><option value="fis">Fiş</option><option value="fatura">Fatura</option><option value="kira">Kira</option><option value="dekont">Dekont</option><option value="serbest_meslek_makbuzu">Serbest meslek makbuzu</option><option value="diger">Diğer</option></Select></Field>
            <Field label="Kategori"><Select required value={kategoriId} onChange={(e) => { setKategoriId(e.target.value); const k = kategoriler.find((x) => x.id === e.target.value); if (k?.varsayilanKdvOrani) setKdvOrani(k.varsayilanKdvOrani); }}>{kategoriler.filter((k) => !k.ustId).map((grup) => grup._count.altlar > 0 ? <optgroup key={grup.id} label={grup.ad}>{kategoriler.filter((k) => k.ustId === grup.id).map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}</optgroup> : <option key={grup.id} value={grup.id}>{grup.ad}</option>)}</Select></Field>
            <Field label="Belge tarihi"><Input required type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} /></Field>
            <Field label="Belge numarası"><Input value={belgeNo} onChange={(e) => setBelgeNo(e.target.value)} placeholder="Varsa belge numarası" /></Field>
          </div>
        </section>
        <section className="expense-entry__section">
          <div className="expense-entry__section-head"><span className="expense-entry__step">02</span><div><h3>Satıcı bilgileri</h3><p>Cari seçmek zorunlu değildir</p></div></div>
          <div className="expense-entry__grid expense-entry__grid--2">
            <Field label="Cari hesap"><Select value={cariId} onChange={(e) => setCariId(e.target.value)}><option value="">Cari kullanmadan devam et</option>{cariler.map((c) => <option key={c.id} value={c.id}>{c.unvan}</option>)}</Select></Field>
            {!cariId && <Field label="Satıcı / kiraya veren"><Input required value={saticiUnvan} onChange={(e) => setSaticiUnvan(e.target.value)} placeholder="Firma veya kişi adı" /></Field>}
            <Field label="VKN / TCKN"><Input value={vknTckn} onChange={(e) => setVknTckn(e.target.value)} placeholder="İsteğe bağlı" /></Field>
            <Field label="Açıklama"><Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Masrafa ilişkin kısa not" /></Field>
          </div>
        </section>
        <section className="expense-entry__section expense-entry__section--amount">
          <div className="expense-entry__section-head"><span className="expense-entry__step">03</span><div><h3>Tutar ve belge</h3><p>Toplam bedelden matrah ve KDV otomatik ayrılır</p></div></div>
          <div className="expense-entry__grid expense-entry__grid--amount">
            <Field label="Toplam bedel (KDV dâhil)"><Input required min="0.01" step="0.01" type="number" value={toplamBedel} onChange={(e) => setToplamBedel(e.target.value)} placeholder="0,00" autoFocus /></Field>
            <Field label="KDV oranı"><Select value={kdvOrani} onChange={(e) => setKdvOrani(e.target.value)}><option value="0">%0</option><option value="1">%1</option><option value="10">%10</option><option value="20">%20</option></Select></Field>
            <Field label="Matrah"><Input readOnly value={matrah} /></Field>
            <Field label="KDV tutarı"><Input readOnly value={kdvTutari} /></Field>
            <div className="expense-entry__total"><span>KDV dâhil toplam</span><strong>{para(toplam)}</strong></div>
            <div className="expense-entry__file"><BelgeDosyalari dosyalar={dosyalar} onChange={setDosyalar} /></div>
          </div>
        </section>
      </div>
      <div className="expense-entry__actions"><span>{duzenlenenId ? "Yalnızca taslak masraflar düzenlenebilir." : "Kayıt önce taslak olarak oluşturulur."}</span><div className="row-tight"><Button type="button" onClick={() => yeniSayfasi ? router.push("/panel/masraflar") : setFormAcik(false)}>Vazgeç</Button><Button variant="primary" type="submit">{duzenlenenId ? "Değişiklikleri kaydet" : "Masrafı kaydet"}</Button></div></div>
    </form></Card>}
    {!yeniSayfasi && <><div className="expense-toolbar"><div><Input aria-label="Masraflarda ara" value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Satıcı, belge no, açıklama veya kategori ara…" /></div><Select aria-label="Durum filtresi" value={durumFiltresi} onChange={(e) => setDurumFiltresi(e.target.value)}><option value="aktif">Aktif kayıtlar</option><option value="odenmedi">Bakiyesi olanlar</option><option value="taslak">Taslaklar</option><option value="onaylandi">Onaylananlar</option><option value="iptal">İptaller</option><option value="tumu">Tüm kayıtlar</option></Select><Select aria-label="Kategori filtresi" value={kategoriFiltresi} onChange={(e) => setKategoriFiltresi(e.target.value)}><option value="">Tüm kategoriler</option>{kategoriler.filter((k) => !k.ustId || k._count.altlar === 0).map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}</Select><span>{filtreliMasraflar.length} kayıt</span></div><Card className="expense-register" title={<div className="expense-register__title"><div><span>KAYIT DEFTERİ</span><h2>Masraf hareketleri</h2></div><small>En yeni kayıtlar önce gösterilir</small></div>} pad={false}><TableWrap><thead><tr><th>Tarih / Belge</th><th>Satıcı / Cari</th><th>Kategori</th><th>Matrah & KDV</th><th>Toplam / Bakiye</th><th>İşlem durumu</th><th></th></tr></thead><tbody>{filtreliMasraflar.length === 0 ? <tr><td colSpan={7}><div className="expense-empty"><strong>Kayıt bulunamadı</strong><span>Arama veya filtre ölçütlerini değiştirin.</span></div></td></tr> : filtreliMasraflar.map((m) => <tr className={m.durum === "iptal" ? "is-cancelled" : ""} key={m.id}><td><strong>{new Date(m.tarih).toLocaleDateString("tr-TR")}</strong><small>{m.belgeTuru.replaceAll("_", " ")}{m.belgeNo ? ` · #${m.belgeNo}` : ""}</small></td><td><strong>{m.cari?.unvan ?? m.saticiUnvan ?? "—"}</strong><small>{m.aciklama || m.vknTckn || "Açıklama bulunmuyor"}</small></td><td><span className="expense-category">{m.kategori.ad}</span></td><td><strong>{para(m.matrah, m.dovizCinsi)}</strong><small>KDV %{m.kdvOrani} · {para(m.kdvTutari, m.dovizCinsi)}</small></td><td><strong className="expense-amount">{para(m.toplam, m.dovizCinsi)}</strong><small>Ödenen {para(m.odenenTutar || 0, m.dovizCinsi)} · Kalan {para(Math.max(0, Number(m.toplam) - Number(m.stopajTutari || 0) - Number(m.odenenTutar || 0)), m.dovizCinsi)}</small></td><td><div className="expense-status"><Badge variant={m.durum === "onaylandi" ? "success" : m.durum === "iptal" ? "danger" : "warning"}>{m.durum === "onaylandi" ? "Onaylandı" : m.durum === "iptal" ? "İptal" : "Taslak"}</Badge><Badge variant={m.odemeDurumu === "odendi" ? "success" : m.odemeDurumu === "kismi_odendi" ? "warning" : "neutral"}>{m.odemeDurumu === "odendi" ? "Ödendi" : m.odemeDurumu === "kismi_odendi" ? "Kısmi ödendi" : "Ödenmedi"}</Badge></div></td><td><div className="expense-actions">{m.durum === "taslak" && <><Button size="sm" onClick={() => router.push(`/panel/masraflar/yeni?duzenle=${m.id}`)}>Düzenle</Button><Button size="sm" onClick={() => void islem(m.id, "onayla")}>Onayla</Button></>}{m.durum === "onaylandi" && m.odemeDurumu !== "odendi" && <Button size="sm" variant="primary" onClick={() => odemeModaliniAc(m)}>{m.odemeDurumu === "kismi_odendi" ? "Ödemeye devam" : "Öde"}</Button>}<Button size="sm" onClick={() => setEkleriAcikMasraf(m)}>📎</Button>{m.durum !== "iptal" && m.odemeDurumu === "odenmedi" && <Button size="sm" variant="danger" onClick={() => void islem(m.id, "iptal")}>İptal</Button>}</div></td></tr>)}</tbody></TableWrap></Card></>}
    {ekleriAcikMasraf && <MasrafEkPaneli masrafId={ekleriAcikMasraf.id} baslik={ekleriAcikMasraf.belgeNo ?? ekleriAcikMasraf.saticiUnvan ?? "Masraf"} onKapat={() => setEkleriAcikMasraf(null)} />}
    {odenecekMasraf && <div className="feedback-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !odemeKaydediliyor) setOdenecekMasraf(null); }}><section aria-labelledby="expense-payment-title" aria-modal="true" className="feedback-dialog expense-payment" role="dialog"><div className="feedback-dialog__head"><div><strong id="expense-payment-title">Masraf ödemesi</strong><small>Ödeme finans hareketlerine tediye olarak kaydedilir.</small></div><button aria-label="Ödeme penceresini kapat" disabled={odemeKaydediliyor} onClick={() => setOdenecekMasraf(null)} type="button">×</button></div><form className="feedback-form" onSubmit={odemeYap}>
      <div className="expense-payment__summary"><div><span>Alıcı</span><strong>{odenecekMasraf.cari?.unvan ?? odenecekMasraf.saticiUnvan}</strong></div><div><span>Kalan bakiye</span><strong>{para(Math.max(0, Number(odenecekMasraf.toplam) - Number(odenecekMasraf.stopajTutari || 0) - Number(odenecekMasraf.odenenTutar || 0)), odenecekMasraf.dovizCinsi)}</strong><small>Ödenen {para(odenecekMasraf.odenenTutar || 0, odenecekMasraf.dovizCinsi)} · Net {para(Number(odenecekMasraf.toplam) - Number(odenecekMasraf.stopajTutari || 0), odenecekMasraf.dovizCinsi)}</small></div></div>
      <Field label="Ödeme hesabı"><Select autoFocus required value={odemeHesabi} onChange={(e) => setOdemeHesabi(e.target.value)}><option value="">Kasa veya banka seçin</option>{kasalar.filter((k) => k.dovizCinsi === odenecekMasraf.dovizCinsi).length > 0 && <optgroup label="Kasalar">{kasalar.filter((k) => k.dovizCinsi === odenecekMasraf.dovizCinsi).map((k) => <option key={k.id} value={`kasa:${k.id}`}>{k.ad} · {k.dovizCinsi}</option>)}</optgroup>}{bankalar.filter((b) => b.dovizCinsi === odenecekMasraf.dovizCinsi).length > 0 && <optgroup label="Banka hesapları">{bankalar.filter((b) => b.dovizCinsi === odenecekMasraf.dovizCinsi).map((b) => <option key={b.id} value={`banka:${b.id}`}>{b.ad} · {b.dovizCinsi}</option>)}</optgroup>}</Select></Field>
      <Field label="Ödeme tarihi"><Input required type="date" value={odemeTarihi} onChange={(e) => setOdemeTarihi(e.target.value)} /></Field>
      <Field label="Ödenecek tutar"><Input required type="number" min="0.01" step="0.01" max={Math.max(0, Number(odenecekMasraf.toplam) - Number(odenecekMasraf.stopajTutari || 0) - Number(odenecekMasraf.odenenTutar || 0))} value={odemeTutari} onChange={(e) => setOdemeTutari(e.target.value)} /></Field>
      <Field label="Açıklama (isteğe bağlı)"><Input value={odemeAciklama} onChange={(e) => setOdemeAciklama(e.target.value)} placeholder="Örn. ilk taksit" /></Field>
      {odenecekMasraf.odemeler?.length > 0 && <div className="expense-payment__history"><strong>Ödeme geçmişi</strong>{odenecekMasraf.odemeler.map((o) => <div key={o.id}><span>{new Date(o.odemeTarihi).toLocaleDateString("tr-TR")} · {o.kasa?.ad ?? o.bankaHesap?.ad ?? "Finans hesabı"}</span><b>{para(o.tutar, odenecekMasraf.dovizCinsi)}</b></div>)}</div>}
      {!odemeHesabi && <p className="expense-payment__hint">Bu para birimine uygun bir kasa veya banka hesabı seçin.</p>}
      <div className="feedback-form__actions"><Button disabled={odemeKaydediliyor} onClick={() => setOdenecekMasraf(null)} type="button">Vazgeç</Button><Button disabled={odemeKaydediliyor || !odemeHesabi || Number(odemeTutari) <= 0} variant="primary" type="submit">{odemeKaydediliyor ? "Kaydediliyor…" : "Ödemeyi kaydet"}</Button></div>
    </form></section></div>}
  </div>;
}
