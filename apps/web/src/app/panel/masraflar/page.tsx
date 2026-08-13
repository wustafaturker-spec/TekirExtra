"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, Select, Stat, StatGrid, TableWrap } from "@/components/ui";
import { BelgeDosyalari, belgeDosyalariniYukle } from "@/components/belge-dosyalari";
import { MasrafEkPaneli } from "@/components/masraf-ek-paneli";

interface Kategori { id: string; ad: string; varsayilanKdvOrani: string | null; ustId: string | null; ust: { id: string; ad: string } | null; _count: { altlar: number; masraflar: number } }
interface Cari { id: string; unvan: string }
interface Hesap { id: string; ad: string; dovizCinsi: string }
interface Masraf { id: string; tarih: string; belgeTuru: string; belgeNo: string | null; saticiUnvan: string | null; vknTckn?: string | null; aciklama?: string | null; matrah: string; kdvOrani: string; kdvTutari: string; toplam: string; dovizCinsi: string; durum: "taslak" | "onaylandi" | "iptal"; odemeDurumu: "odenmedi" | "odendi"; kategori: Kategori; cari: Cari | null }

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
  const [odenecekMasraf, setOdenecekMasraf] = useState<Masraf | null>(null); const [odemeHesabi, setOdemeHesabi] = useState(""); const [odemeTarihi, setOdemeTarihi] = useState(bugun()); const [odemeKaydediliyor, setOdemeKaydediliyor] = useState(false);
  const [hata, setHata] = useState(""); const [basari, setBasari] = useState("");
  const [kategoriId, setKategoriId] = useState(""); const [cariId, setCariId] = useState("");
  const [belgeTuru, setBelgeTuru] = useState("fis"); const [belgeNo, setBelgeNo] = useState("");
  const [tarih, setTarih] = useState(bugun()); const [saticiUnvan, setSaticiUnvan] = useState("");
  const [vknTckn, setVknTckn] = useState(""); const [aciklama, setAciklama] = useState("");
  const [toplamBedel, setToplamBedel] = useState(""); const [kdvOrani, setKdvOrani] = useState("20");
  const [dosyalar, setDosyalar] = useState<File[]>([]);

  const matrah = useMemo(() => {
    const toplam = Number(toplamBedel || 0); const oran = Number(kdvOrani || 0);
    return (oran === 0 ? toplam : toplam / (1 + oran / 100)).toFixed(2);
  }, [toplamBedel, kdvOrani]);
  const kdvTutari = useMemo(() => (Number(toplamBedel || 0) - Number(matrah)).toFixed(2), [toplamBedel, matrah]);
  const toplam = useMemo(() => Number(toplamBedel || 0).toFixed(2), [toplamBedel]);
  const ozet = useMemo(() => ({ toplam: masraflar.filter((m) => m.durum !== "iptal").reduce((t, m) => t + Number(m.toplam), 0), odenmemis: masraflar.filter((m) => m.durum !== "iptal" && m.odemeDurumu === "odenmedi").reduce((t, m) => t + Number(m.toplam), 0), kira: masraflar.filter((m) => m.durum !== "iptal" && m.belgeTuru === "kira").reduce((t, m) => t + Number(m.toplam), 0) }), [masraflar]);

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
    setOdenecekMasraf(m); setOdemeHesabi(uygunKasa ? `kasa:${uygunKasa.id}` : uygunBanka ? `banka:${uygunBanka.id}` : ""); setOdemeTarihi(bugun()); setHata("");
  }

  async function odemeYap(e: React.FormEvent) {
    e.preventDefault();
    if (!odenecekMasraf || !odemeHesabi) return;
    const [tur, id] = odemeHesabi.split(":"); setOdemeKaydediliyor(true); setHata("");
    try {
      await api(`/masraflar/${odenecekMasraf.id}/ode`, { method: "POST", body: JSON.stringify({ kasaId: tur === "kasa" ? id : null, bankaHesapId: tur === "banka" ? id : null, odemeTarihi }) });
      setOdenecekMasraf(null); setBasari("Masraf ödemesi kaydedildi."); await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Ödeme kaydedilemedi"); }
    finally { setOdemeKaydediliyor(false); }
  }

  return <div className={yeniSayfasi ? "create-page" : undefined}>
    <PageHeader title={yeniSayfasi ? "Yeni Masraf" : "Masraflar"} subtitle={yeniSayfasi ? "Fiş, fatura veya gider belgesini kaydedin." : "Fiş, fatura ve kira giderlerini cari hesap olmadan da yönetin."} actions={yeniSayfasi ? <Button onClick={() => router.push("/panel/masraflar")}>Listeye dön</Button> : <><ButtonLabel as="a" href="/panel/masraflar/kategoriler">Kategorileri yönet</ButtonLabel><ButtonLabel as="a" variant="primary" href="/panel/masraflar/yeni">Yeni masraf</ButtonLabel></>} />
    {hata && <Alert tone="error">{hata}</Alert>}{basari && <Alert tone="success">{basari}</Alert>}
    <StatGrid><Stat label="Toplam masraf" value={para(ozet.toplam)} /><Stat label="Ödenmemiş" value={para(ozet.odenmemis)} tone="danger" /><Stat label="Kira giderleri" value={para(ozet.kira)} tone="info" /></StatGrid>
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
    <Card title="Masraf kayıtları" pad={false} style={{ marginTop: "1rem" }}><TableWrap><thead><tr><th>Tarih</th><th>Belge</th><th>Satıcı / Cari</th><th>Kategori</th><th>Toplam</th><th>Durum</th><th>Ödeme</th><th></th></tr></thead><tbody>{masraflar.map((m) => <tr key={m.id}><td>{new Date(m.tarih).toLocaleDateString("tr-TR")}</td><td>{m.belgeTuru.replaceAll("_", " ")} {m.belgeNo && `#${m.belgeNo}`}</td><td>{m.cari?.unvan ?? m.saticiUnvan}</td><td>{m.kategori.ad}</td><td>{para(m.toplam, m.dovizCinsi)}</td><td><Badge variant={m.durum === "onaylandi" ? "success" : m.durum === "iptal" ? "danger" : "warning"}>{m.durum}</Badge></td><td><Badge variant={m.odemeDurumu === "odendi" ? "success" : "neutral"}>{m.odemeDurumu}</Badge></td><td><div className="row">{m.durum === "taslak" && <><Button size="sm" onClick={() => router.push(`/panel/masraflar/yeni?duzenle=${m.id}`)}>Düzenle</Button><Button size="sm" onClick={() => void islem(m.id, "onayla")}>Onayla</Button></>}{m.durum === "onaylandi" && m.odemeDurumu === "odenmedi" && <Button size="sm" variant="primary" onClick={() => odemeModaliniAc(m)}>Öde</Button>}<Button size="sm" onClick={() => setEkleriAcikMasraf(m)}>📎 Ekler</Button>{m.durum !== "iptal" && m.odemeDurumu === "odenmedi" && <Button size="sm" variant="danger" onClick={() => void islem(m.id, "iptal")}>İptal</Button>}</div></td></tr>)}</tbody></TableWrap></Card>
    {ekleriAcikMasraf && <MasrafEkPaneli masrafId={ekleriAcikMasraf.id} baslik={ekleriAcikMasraf.belgeNo ?? ekleriAcikMasraf.saticiUnvan ?? "Masraf"} onKapat={() => setEkleriAcikMasraf(null)} />}
    {odenecekMasraf && <div className="feedback-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !odemeKaydediliyor) setOdenecekMasraf(null); }}><section aria-labelledby="expense-payment-title" aria-modal="true" className="feedback-dialog expense-payment" role="dialog"><div className="feedback-dialog__head"><div><strong id="expense-payment-title">Masraf ödemesi</strong><small>Ödeme finans hareketlerine tediye olarak kaydedilir.</small></div><button aria-label="Ödeme penceresini kapat" disabled={odemeKaydediliyor} onClick={() => setOdenecekMasraf(null)} type="button">×</button></div><form className="feedback-form" onSubmit={odemeYap}>
      <div className="expense-payment__summary"><div><span>Alıcı</span><strong>{odenecekMasraf.cari?.unvan ?? odenecekMasraf.saticiUnvan}</strong></div><div><span>Ödenecek tutar</span><strong>{para(odenecekMasraf.toplam, odenecekMasraf.dovizCinsi)}</strong></div></div>
      <Field label="Ödeme hesabı"><Select autoFocus required value={odemeHesabi} onChange={(e) => setOdemeHesabi(e.target.value)}><option value="">Kasa veya banka seçin</option>{kasalar.filter((k) => k.dovizCinsi === odenecekMasraf.dovizCinsi).length > 0 && <optgroup label="Kasalar">{kasalar.filter((k) => k.dovizCinsi === odenecekMasraf.dovizCinsi).map((k) => <option key={k.id} value={`kasa:${k.id}`}>{k.ad} · {k.dovizCinsi}</option>)}</optgroup>}{bankalar.filter((b) => b.dovizCinsi === odenecekMasraf.dovizCinsi).length > 0 && <optgroup label="Banka hesapları">{bankalar.filter((b) => b.dovizCinsi === odenecekMasraf.dovizCinsi).map((b) => <option key={b.id} value={`banka:${b.id}`}>{b.ad} · {b.dovizCinsi}</option>)}</optgroup>}</Select></Field>
      <Field label="Ödeme tarihi"><Input required type="date" value={odemeTarihi} onChange={(e) => setOdemeTarihi(e.target.value)} /></Field>
      {!odemeHesabi && <p className="expense-payment__hint">Bu para birimine uygun bir kasa veya banka hesabı seçin.</p>}
      <div className="feedback-form__actions"><Button disabled={odemeKaydediliyor} onClick={() => setOdenecekMasraf(null)} type="button">Vazgeç</Button><Button disabled={odemeKaydediliyor || !odemeHesabi} variant="primary" type="submit">{odemeKaydediliyor ? "Kaydediliyor…" : "Ödemeyi kaydet"}</Button></div>
    </form></section></div>}
  </div>;
}
