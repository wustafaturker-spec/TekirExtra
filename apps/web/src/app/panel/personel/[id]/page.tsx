"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useEkranKaydi } from "@/lib/asistan-baglami";
import { api, ApiHata } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";
import { PersonelBelgeleri } from "@/components/personel-belgeleri";
import { PersonelSelfServis } from "@/components/personel-self-servis";
import { PersonelSgkAlanlari, sgkAlanlariGovdesi, sgkAlanlariKaydindan, type SgkAlanlari } from "@/components/personel-sgk-alanlari";
import { CIKIS_NEDENI_SGK_KODU, OGRENIM_DURUMLARI, SGK_BELGE_TURLERI, SGK_CIKIS_KODLARI } from "@tekirextra/shared";
import { Alert, Avatar, Badge, Button, Card, EylemCubugu, Field, Input, Modal, ModalEylem, PageHeader, Para, Select, Stat, StatGrid, Table } from "@/components/ui";
import { ZimmetUyarisi } from "@/components/zimmet-uyarisi";

interface Bordro {
  id: string;
  donemYil: number;
  donemAy: number;
  odenecekTutar: string;
  odendi: boolean;
  odemeTarihi?: string | null;
}

interface Avans {
  id: string;
  tutar: string;
  tarih: string;
  aciklama?: string | null;
  odendi: boolean;
}

interface IstihdamDonemi { id: string; baslangicTarihi: string; bitisTarihi?: string | null; iseGirisBildirgeTarihi?: string | null; iseGirisBildirgeNo?: string | null; istenCikisBildirgeTarihi?: string | null; istenCikisBildirgeNo?: string | null; sgkCikisKodu?: string | null }

interface UcretKaydi { id: string; yururlukTarihi: string; tip: "net" | "brut"; tutar: string; neden?: string | null }

interface PersonelDetay {
  id: string;
  personelNo: string;
  ad: string;
  soyad: string;
  tckn?: string | null;
  eposta?: string | null;
  telefon?: string | null;
  adres?: string | null;
  departman?: string | null;
  unvan?: string | null;
  calismaTipi: string;
  girisTarihi: string;
  cikisTarihi?: string | null;
  ayrilisNedeni?: string | null;
  netMaas: string;
  brutMaas?: string | null;
  sgkTesvikOrani?: string;
  engellilikDerecesi?: number | null;
  dogumTarihi?: string | null;
  iban?: string | null;
  sgkBelgeTuru?: string; meslekKodu?: string | null; ogrenimDurumu?: number | null; mezuniyetYili?: number | null; mezuniyetBolumu?: string | null; eskiHukumlu?: boolean; tesvikKanunNo?: string | null;
  istihdamDonemleri?: IstihdamDonemi[];
  durum: "taslak" | "aktif" | "askida" | "uzun_sureli_izin" | "isten_ayrildi";
  cari?: { id: string; kod: string; unvan: string } | null;
  bordrolar: Bordro[];
  avanslar: Avans[];
  ucretler: UcretKaydi[];
}

const DURUM: Record<PersonelDetay["durum"], [string, "neutral" | "success" | "warning" | "info"]> = { taslak: ["Taslak", "neutral"], aktif: ["Aktif", "success"], askida: ["Askıda", "warning"], uzun_sureli_izin: ["Uzun süreli izin", "info"], isten_ayrildi: ["İşten ayrıldı", "neutral"] };
const CALISMA_TIPI: Record<string, string> = { tam_zamanli: "Tam zamanlı", yari_zamanli: "Yarı zamanlı", sozlesmeli: "Sözleşmeli" };
const tarih = (deger?: string | null) => deger
  ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(deger))
  : "—";
const bugun = () => bugunTR();

/** Personel kartı: özlük, ücret geçmişi, bordrolar, çıkış hesabı, self-servis ve belgeler. */
export default function PersonelDetaySayfasi() {
  const { id } = useParams<{ id: string }>();
  const [personel, setPersonel] = useState<PersonelDetay | null>(null);
  // AI-113: açık personel kartı asistanın ekran kaydıdır (sunucu ücret ve kimlik bilgisini bağlama almaz).
  useEkranKaydi(personel ? { tur: "personel", id: personel.id, etiket: `${personel.ad} ${personel.soyad}` } : null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [isleniyor, setIsleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [ayrilisAcik, setAyrilisAcik] = useState(false);
  const [yenidenAcik, setYenidenAcik] = useState(false);
  const [hassas, setHassas] = useState<{ tckn: string | null; iban: string | null } | null>(null);
  const [ayrilis, setAyrilis] = useState({ cikisTarihi: bugun(), ayrilisNedeni: "" });
  /** PRS-24: boşsa yasal çıkış nedeninden önerilen kod gönderilir. */
  const [sgkCikisKodu, setSgkCikisKodu] = useState("");
  /** PRS-18: çıkış hesabı (kıdem, ihbar, izin ücreti); boş alan = sistemin önerisi. */
  const [cikisForm, setCikisForm] = useState<CikisFormu>({ cikisNedeni: "", yanOdemeler: "", gerekce: "" });
  const [cikisOnizleme, setCikisOnizleme] = useState<CikisOnizleme | null>(null);
  const [cikisUyari, setCikisUyari] = useState<string | null>(null);
  const [yeniGirisTarihi, setYeniGirisTarihi] = useState(bugun());
  const [duzenleme, setDuzenleme] = useState<DuzenlemeFormu | null>(null);
  /** PRS-06: yürürlük tarihli ücret değişikliği. */
  const [ucretFormu, setUcretFormu] = useState<{ yururlukTarihi: string; tip: "net" | "brut"; tutar: string; neden: string } | null>(null);

  const yukle = useCallback(async () => {
    try {
      setHata(null);
      setPersonel(await api<PersonelDetay>(`/personel/${id}`));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Personel bilgileri alınamadı");
    } finally {
      setYukleniyor(false);
    }
  }, [id]);

  useEffect(() => { void yukle(); }, [yukle]);

  const cikisGovdesi = useCallback(() => cikisForm.cikisNedeni ? {
    cikisNedeni: cikisForm.cikisNedeni,
    ...(cikisForm.kidemHakki !== undefined && { kidemHakki: cikisForm.kidemHakki }),
    ...(cikisForm.ihbarDurumu && { ihbarDurumu: cikisForm.ihbarDurumu }),
    ...(cikisForm.sonBrut && { sonBrut: Number(cikisForm.sonBrut) }),
    ...(cikisForm.izinGunu && { izinGunu: Number(cikisForm.izinGunu) }),
    yanOdemeler: Number(cikisForm.yanOdemeler || cikisOnizleme?.oneri.yanOdemeler || 0),
    ...(cikisForm.gerekce && { gerekce: cikisForm.gerekce }),
  } : null, [cikisForm, cikisOnizleme?.oneri.yanOdemeler]);

  useEffect(() => {
    const govde = cikisGovdesi();
    if (!ayrilisAcik || !govde || !ayrilis.cikisTarihi) { setCikisOnizleme(null); return; }
    const zamanlayici = setTimeout(() => {
      api<CikisOnizleme>(`/personel/${id}/cikis-onizleme`, { method: "POST", body: JSON.stringify({ ...govde, cikisTarihi: ayrilis.cikisTarihi }) })
        .then(setCikisOnizleme).catch((e) => setHata(e instanceof Error ? e.message : "Çıkış hesabı yapılamadı"));
    }, 300);
    return () => clearTimeout(zamanlayici);
  }, [ayrilisAcik, ayrilis.cikisTarihi, cikisGovdesi, id]);

  const istenCikar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsleniyor(true); setHata(null);
      const govde = cikisGovdesi();
      const kod = sgkCikisKodu || (cikisForm.cikisNedeni ? CIKIS_NEDENI_SGK_KODU[cikisForm.cikisNedeni as keyof typeof CIKIS_NEDENI_SGK_KODU] : "");
      const r = await api<{ uyari: string | null }>(`/personel/${id}/isten-cikar`, { method: "POST", body: JSON.stringify({ ...ayrilis, ...(govde && { cikisHesabi: govde }), ...(kod && { sgkCikisKodu: kod }) }) });
      setCikisUyari(r.uyari);
      setAyrilisAcik(false);
      await yukle();
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "İşten çıkış kaydedilemedi");
    } finally { setIsleniyor(false); }
  };

  const yenidenBaslat = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsleniyor(true); setHata(null);
      await api(`/personel/${id}/yeniden-baslat`, { method: "POST", body: JSON.stringify({ girisTarihi: yeniGirisTarihi }) });
      setYenidenAcik(false);
      await yukle();
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Personel yeniden başlatılamadı");
    } finally { setIsleniyor(false); }
  };

  /** P0-6: kart düzenleme. TCKN/IBAN maskeli geldiği için boş bırakılırsa değişmez. */
  const duzenlemeAc = () => {
    if (!personel) return;
    setDuzenleme({
      ad: personel.ad, soyad: personel.soyad, eposta: personel.eposta ?? "", telefon: personel.telefon ?? "", adres: personel.adres ?? "",
      calismaTipi: personel.calismaTipi, girisTarihi: personel.girisTarihi.slice(0, 10),
      engellilikDerecesi: personel.engellilikDerecesi ? String(personel.engellilikDerecesi) : "",
      dogumTarihi: personel.dogumTarihi?.slice(0, 10) ?? "",
      sgkTesvikOrani: String(Number(personel.sgkTesvikOrani ?? 0)), tckn: "", iban: "", ibanKaldir: false,
      sgk: sgkAlanlariKaydindan(personel),
    });
  };

  const duzenlemeKaydet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!duzenleme) return;
    try {
      setIsleniyor(true); setHata(null);
      const sayi = (v: string) => Number(v.replace(",", "."));
      await api(`/personel/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          ad: duzenleme.ad, soyad: duzenleme.soyad, eposta: duzenleme.eposta.trim() || null, telefon: duzenleme.telefon.trim() || null, adres: duzenleme.adres.trim() || null,
          calismaTipi: duzenleme.calismaTipi, girisTarihi: duzenleme.girisTarihi,
          engellilikDerecesi: duzenleme.engellilikDerecesi ? Number(duzenleme.engellilikDerecesi) : null,
          dogumTarihi: duzenleme.dogumTarihi || null,
          sgkTesvikOrani: sayi(duzenleme.sgkTesvikOrani || "0"),
          ...sgkAlanlariGovdesi(duzenleme.sgk),
          ...(duzenleme.tckn.trim() && { tckn: duzenleme.tckn.trim() }),
          ...(duzenleme.ibanKaldir ? { iban: null } : duzenleme.iban.trim() ? { iban: duzenleme.iban } : {}),
        }),
      });
      setDuzenleme(null); setHassas(null);
      await yukle();
    } catch (e) {
      setHata(e instanceof ApiHata ? e.message : "Personel bilgileri kaydedilemedi");
    } finally { setIsleniyor(false); }
  };

  /** PRS-04: carisi olmayan personel ödenemez; cari açılınca onaylı bordroların eksik tahakkuku yazılır. */
  const cariBagla = async () => {
    if (!window.confirm("Personele yeni bir cari hesap açılacak; onaylı bordroların eksik tahakkukları dönem sonu tarihiyle cariye yazılacak. Devam edilsin mi?")) return;
    try {
      setIsleniyor(true); setHata(null);
      await api(`/personel/${id}/cari-bagla`, { method: "POST", body: "{}" });
      await yukle();
    } catch (e) { setHata(e instanceof ApiHata ? e.message : "Cari bağlanamadı"); }
    finally { setIsleniyor(false); }
  };

  const ucretKaydet = async (e: React.FormEvent) => {
    e.preventDefault(); if (!ucretFormu) return;
    try {
      setIsleniyor(true); setHata(null);
      await api(`/personel/${id}/ucretler`, { method: "POST", body: JSON.stringify({ ...ucretFormu, tutar: Number(ucretFormu.tutar.replace(",", ".")), neden: ucretFormu.neden.trim() || null }) });
      setUcretFormu(null); await yukle();
    } catch (e) { setHata(e instanceof ApiHata ? e.message : "Ücret kaydedilemedi"); }
    finally { setIsleniyor(false); }
  };
  const ucretSil = async (u: UcretKaydi) => {
    if (!window.confirm(`${tarih(u.yururlukTarihi)} tarihli ücret kaydı silinsin mi?`)) return;
    try { setHata(null); await api(`/personel/${id}/ucretler/${u.id}`, { method: "DELETE" }); await yukle(); }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "Ücret kaydı silinemedi"); }
  };

  const hassasGoster = async () => {
    try { setHata(null); setHassas(await api(`/personel/${id}/hassas-veriler`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Hassas bilgiler görüntülenemedi"); }
  };

  if (yukleniyor) return <p className="muted">Personel bilgileri yükleniyor…</p>;

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel">← Personel listesine dön</Link>
      <Alert tone="error">{hata}</Alert>

      {!personel ? <Card><p className="muted" style={{ margin: 0 }}>Personel kaydı görüntülenemedi.</p></Card> : <>
        <PageHeader
          title={<span className="row-tight"><Avatar isim={personel.ad} />{personel.ad} {personel.soyad} <Badge variant={DURUM[personel.durum][1]}>{DURUM[personel.durum][0]}</Badge></span>}
          subtitle={<><span className="mono">{personel.personelNo}</span> · {personel.departman || "Departman belirtilmedi"} · {personel.unvan || "Unvan belirtilmedi"}</>}
        />
        <EylemCubugu etiket="Personel işlemleri">
          <Button variant="primary" onClick={duzenlemeAc}>Düzenle</Button>
          <Button onClick={() => setUcretFormu({ yururlukTarihi: bugun(), tip: personel.brutMaas ? "brut" : "net", tutar: "", neden: "" })}>Ücret değiştir</Button>
          {personel.durum === "isten_ayrildi"
            ? <Button onClick={() => setYenidenAcik(true)}>Yeniden işe başlat</Button>
            : <Button variant="danger" onClick={() => setAyrilisAcik(true)}>İşten çıkış işlemi</Button>}
        </EylemCubugu>
        <Alert tone="warning">{cikisUyari}</Alert>

        <StatGrid>
          {personel.brutMaas
            ? <Stat label="Brüt ücret" value={<Para deger={personel.brutMaas} />} hint="Brüt anlaşılan aylık ücret" tone="accent" />
            : <Stat label="Net ücret" value={<Para deger={personel.netMaas} />} hint="Net anlaşılan; bordro mevzuatıyla her ay brüte çevrilir" tone="accent" />}
          {Number(personel.sgkTesvikOrani) > 0 && <Stat label="SGK teşviki" value={`%${Number(personel.sgkTesvikOrani).toLocaleString("tr-TR")}`} hint="Mevzuat azamisiyle sınırlandırılır" />}
          <Stat label="İşe giriş" value={tarih(personel.girisTarihi)} hint={CALISMA_TIPI[personel.calismaTipi] ?? personel.calismaTipi} />
          <Stat label="Bordrolar" value={personel.bordrolar.length} hint={`${personel.bordrolar.filter((b) => !b.odendi).length} açık ödeme`} />
          <Stat label="Avans toplamı" value={<Para deger={personel.avanslar.reduce((t, a) => t + Number(a.tutar), 0)} />} hint={`${personel.avanslar.length} işlem`} />
        </StatGrid>

        <div className="split">
          <Card title="Özlük ve iletişim" actions={<Button size="sm" onClick={() => hassas ? setHassas(null) : void hassasGoster()} title="Görüntüleme işlemi denetim kaydına yazılır">{hassas ? "Hassas bilgileri gizle" : "Hassas bilgileri göster"}</Button>}>
            <dl className="kv">
              <dt>E-posta</dt><dd>{personel.eposta || "—"}</dd>
              <dt>Telefon</dt><dd>{personel.telefon || "—"}</dd>
              <dt>Adres</dt><dd>{personel.adres || "—"}</dd>
              <dt>TCKN</dt><dd className="mono">{hassas?.tckn || personel.tckn || "—"}</dd>
              <dt>IBAN</dt><dd className="mono">{hassas?.iban || personel.iban || "—"}</dd>
              <dt>Cari hesap</dt>
              <dd>
                {personel.cari?.kod || <span style={{ color: "var(--warning)" }}>Bağlı değil — maaş ve avans ödenemez</span>}
                {!personel.cari && <div style={{ marginTop: "0.4rem" }}><Button size="sm" disabled={isleniyor} onClick={() => void cariBagla()}>Cari aç ve bağla</Button></div>}
              </dd>
              <dt>Çıkış tarihi</dt><dd>{tarih(personel.cikisTarihi)}</dd>
            </dl>
            <p className="subtle" style={{ fontSize: "0.75rem", margin: "1rem 0 0" }}>Hassas bilgilerin görüntülenmesi denetim kaydına yazılır.</p>
            {personel.ayrilisNedeni && <Alert tone="warning"><strong>Ayrılış nedeni:</strong> {personel.ayrilisNedeni}</Alert>}
          </Card>

          <Card title="Son bordrolar" pad={false}>
            <Table className="table--fit">
              <thead><tr><th>Dönem</th><th className="num">Tutar</th><th>Durum</th><th>Ödeme</th></tr></thead>
              <tbody>
                {personel.bordrolar.slice(0, 12).map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/panel/personel/bordrolar/${b.id}`}><strong>{String(b.donemAy).padStart(2, "0")}/{b.donemYil}</strong></Link></td>
                    <td className="num"><Para deger={b.odenecekTutar} /></td>
                    <td><Badge variant={b.odendi ? "success" : "warning"}>{b.odendi ? "Ödendi" : "Ödeme bekliyor"}</Badge></td>
                    <td className="muted">{tarih(b.odemeTarihi)}</td>
                  </tr>
                ))}
                {!personel.bordrolar.length && <tr><td className="muted" colSpan={4}>Henüz bordro tahakkuku bulunmuyor.</td></tr>}
              </tbody>
            </Table>
          </Card>
        </div>

        <Card title="Ücret geçmişi" pad={false}>
          <Table>
            <thead><tr><th>Yürürlük</th><th>Tip</th><th className="num">Tutar</th><th>Neden</th><th /></tr></thead>
            <tbody>
              {(personel.ucretler ?? []).map((u) => (
                <tr key={u.id}>
                  <td><strong>{tarih(u.yururlukTarihi)}</strong></td>
                  <td>{u.tip === "net" ? "Net" : "Brüt"}</td>
                  <td className="num"><Para deger={u.tutar} /></td>
                  <td className="muted">{u.neden || "—"}</td>
                  <td className="num">{personel.ucretler.length > 1 && <Button size="sm" variant="danger" onClick={() => void ucretSil(u)}>Sil</Button>}</td>
                </tr>
              ))}
              {!(personel.ucretler ?? []).length && <tr><td className="muted" colSpan={5}>Ücret kaydı yok.</td></tr>}
            </tbody>
          </Table>
        </Card>
        <Card title="SGK bilgileri" actions={<Link className="btn btn--ghost btn--sm" href="/panel/personel/sgk">SGK ekranı</Link>}>
          <dl className="kv">
            <dt>Belge türü</dt><dd>{personel.sgkBelgeTuru ?? "1"} — {SGK_BELGE_TURLERI[personel.sgkBelgeTuru ?? "1"] ?? "elle girilen kod"}</dd>
            <dt>Meslek kodu</dt><dd className="mono">{personel.meslekKodu || <span style={{ color: "var(--warning)" }}>Girilmedi — bildirge XML'ine alınmaz</span>}</dd>
            <dt>Öğrenim</dt><dd>{personel.ogrenimDurumu == null ? "—" : `${OGRENIM_DURUMLARI[personel.ogrenimDurumu]}${personel.mezuniyetYili ? ` (${personel.mezuniyetYili}${personel.mezuniyetBolumu ? `, ${personel.mezuniyetBolumu}` : ""})` : ""}`}</dd>
            <dt>Teşvik kanun no</dt><dd className="mono">{personel.tesvikKanunNo || `${Number(personel.sgkTesvikOrani ?? 0) > 0 ? "05510" : "00000"} (öneri)`}</dd>
            {personel.eskiHukumlu && <><dt>Eski hükümlü</dt><dd>Evet</dd></>}
          </dl>
          {(personel.istihdamDonemleri ?? []).length > 0 && (
            <Table density="compact" className="table--fit">
              <thead><tr><th>İstihdam</th><th>İşe giriş bildirgesi</th><th>İşten çıkış bildirgesi</th></tr></thead>
              <tbody>
                {personel.istihdamDonemleri!.map((d) => (
                  <tr key={d.id}>
                    <td>{tarih(d.baslangicTarihi)} – {d.bitisTarihi ? tarih(d.bitisTarihi) : "devam ediyor"}</td>
                    <td>{d.iseGirisBildirgeTarihi ? <Badge variant="success">Verildi {tarih(d.iseGirisBildirgeTarihi)}</Badge> : <Badge variant="warning">Verilmedi</Badge>}</td>
                    <td>{!d.bitisTarihi ? "—" : <>{d.istenCikisBildirgeTarihi ? <Badge variant="success">Verildi {tarih(d.istenCikisBildirgeTarihi)}</Badge> : <Badge variant="warning">Verilmedi</Badge>}{d.sgkCikisKodu && <small className="muted"> · kod {d.sgkCikisKodu}</small>}</>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <PersonelSelfServis personelId={personel.id} eposta={personel.eposta} aktifPersonel={personel.durum !== "isten_ayrildi"} />
        <PersonelBelgeleri personelId={personel.id} />
      </>}

      {ayrilisAcik && personel && (
        <Modal genis baslik="İşten çıkış işlemi" aciklama="Bu işlem personeli gelecek tahakkukların dışında bırakır. Çıkış hesabı seçilirse kıdem, ihbar ve kullanılmamış izin ücreti çıkış ayının bordrosuna kalem olarak girer." onKapat={() => setAyrilisAcik(false)}>
          <form className="stack" onSubmit={istenCikar}>
            <ZimmetUyarisi personelId={personel.id} />
            <div className="form-grid form-grid--2">
              <Field label="Çıkış tarihi"><Input required type="date" value={ayrilis.cikisTarihi} onChange={(e) => setAyrilis({ ...ayrilis, cikisTarihi: e.target.value })} /></Field>
              <Field label="Yasal çıkış nedeni">
                <Select value={cikisForm.cikisNedeni} onChange={(e) => setCikisForm({ ...cikisForm, cikisNedeni: e.target.value, kidemHakki: undefined, ihbarDurumu: undefined })}>
                  <option value="">Çıkış hesabı yapma</option>
                  {CIKIS_NEDENLERI.map(([k, ad]) => <option key={k} value={k}>{ad}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="SGK işten çıkış kodu">
              <Select value={sgkCikisKodu} onChange={(e) => setSgkCikisKodu(e.target.value)}>
                <option value="">{cikisForm.cikisNedeni ? `Önerilen: ${CIKIS_NEDENI_SGK_KODU[cikisForm.cikisNedeni as keyof typeof CIKIS_NEDENI_SGK_KODU]} — ${SGK_CIKIS_KODLARI[CIKIS_NEDENI_SGK_KODU[cikisForm.cikisNedeni as keyof typeof CIKIS_NEDENI_SGK_KODU]]}` : "Seçilmedi (SGK ekranından da girilebilir)"}</option>
                {Object.entries(SGK_CIKIS_KODLARI).map(([kod, ad]) => <option key={kod} value={kod}>{kod} — {ad}</option>)}
              </Select>
            </Field>
            <Field label="Ayrılış nedeni (açıklama)"><textarea className="textarea" required minLength={3} maxLength={500} rows={2} value={ayrilis.ayrilisNedeni} onChange={(e) => setAyrilis({ ...ayrilis, ayrilisNedeni: e.target.value })} /></Field>
            {cikisForm.cikisNedeni && cikisOnizleme && (
              <fieldset className="form-section">
                <legend>Çıkış hesabı</legend>
                <div className="stack">
                  <div className="form-grid">
                    <label className="check"><input type="checkbox" checked={cikisOnizleme.girdiler.kidemHakki} onChange={(e) => setCikisForm({ ...cikisForm, kidemHakki: e.target.checked })} /><span>Kıdem tazminatı hakkı</span></label>
                    <Field label="İhbar"><Select value={cikisOnizleme.girdiler.ihbarDurumu} onChange={(e) => setCikisForm({ ...cikisForm, ihbarDurumu: e.target.value as CikisFormu["ihbarDurumu"] })}><option value="yok">Ödenmez (önel verildi / hak yok)</option><option value="isveren_oder">İşveren öder</option><option value="isci_oder">İşçi önelsiz ayrıldı (kesinti)</option></Select></Field>
                    <Field label="Kullanılmamış izin (gün)"><Input type="number" min={0} step="0.5" placeholder={String(cikisOnizleme.oneri.izinGunu)} value={cikisForm.izinGunu ?? ""} onChange={(e) => setCikisForm({ ...cikisForm, izinGunu: e.target.value })} /></Field>
                    <Field label="Son brüt ücret (aylık)"><Input type="number" min={0} step="0.01" placeholder={cikisOnizleme.oneri.sonBrut.toFixed(2)} value={cikisForm.sonBrut ?? ""} onChange={(e) => setCikisForm({ ...cikisForm, sonBrut: e.target.value })} /></Field>
                    <Field label="Düzenli yan ödemeler (aylık)"><Input type="number" min={0} step="0.01" placeholder={cikisOnizleme.oneri.yanOdemeler.toFixed(2)} value={cikisForm.yanOdemeler} onChange={(e) => setCikisForm({ ...cikisForm, yanOdemeler: e.target.value })} /></Field>
                  </div>
                  {cikisOnizleme.oneridenFarkli && <Field label="Gerekçe (hak, nedenin önerisinden farklı)"><Input required minLength={3} maxLength={500} value={cikisForm.gerekce} onChange={(e) => setCikisForm({ ...cikisForm, gerekce: e.target.value })} /></Field>}
                  <Table density="compact" className="table--fit">
                    <tbody>
                      <tr><td className="muted">Hizmet süresi</td><td className="num">{cikisOnizleme.hizmetGunu} gün ({cikisOnizleme.girdiler.girisTarihi} – {cikisOnizleme.girdiler.cikisTarihi})</td></tr>
                      <tr><td className="muted">Giydirilmiş brüt / kıdem esası ({cikisOnizleme.kidemTavani === null ? "tavan yayınlanmadı" : <>tavan <Para deger={cikisOnizleme.kidemTavani} /></>})</td><td className="num"><Para deger={cikisOnizleme.giydirilmisBrut} /> / <Para deger={cikisOnizleme.kidemEsasi} /></td></tr>
                      <tr><td>Kıdem tazminatı <small className="muted">(yalnız damga vergisi)</small></td><td className="num"><strong><Para deger={cikisOnizleme.kidemTutari} /></strong></td></tr>
                      <tr><td>İhbar tazminatı · {cikisOnizleme.ihbarHaftasi} hafta <small className="muted">(GV + DV){cikisOnizleme.ihbarDurumu === "isci_oder" ? " — işçiden kesilir" : ""}</small></td><td className="num"><strong><Para deger={cikisOnizleme.ihbarTutari} /></strong></td></tr>
                      <tr><td>Kullanılmamış izin ücreti · {cikisOnizleme.izinGunu} gün <small className="muted">(SGK + GV + DV)</small></td><td className="num"><strong><Para deger={cikisOnizleme.izinUcreti} /></strong></td></tr>
                    </tbody>
                  </Table>
                  {cikisOnizleme.kidemUyari && <Alert tone="warning">{cikisOnizleme.kidemUyari}</Alert>}
                  <p className="muted" style={{ margin: 0, fontSize: "0.78rem" }}>Tutarlar brüttür; kesintiler çıkış ayının bordrosunda hesaplanır. Hizmet süresi son istihdam dönemidir; önceki dönemlerin birleştirilmesi gerekiyorsa tutarı elle değerlendirin.</p>
                </div>
              </fieldset>
            )}
            <ModalEylem onVazgec={() => setAyrilisAcik(false)} isleniyor={isleniyor} metin="İşten çıkışı kaydet" tehlikeli />
          </form>
        </Modal>
      )}

      {duzenleme && personel && (
        <Modal genis baslik="Personel bilgilerini düzenle" aciklama="Bağlı cari kartı da güncellenir. Ücret değişikliği için “Ücret değiştir”i kullanın." onKapat={() => setDuzenleme(null)}>
          <form className="stack" onSubmit={duzenlemeKaydet}>
            <div className="form-grid form-grid--2">
              <Field label="Ad"><Input required minLength={2} maxLength={50} value={duzenleme.ad} onChange={(e) => setDuzenleme({ ...duzenleme, ad: e.target.value })} /></Field>
              <Field label="Soyad"><Input required minLength={2} maxLength={50} value={duzenleme.soyad} onChange={(e) => setDuzenleme({ ...duzenleme, soyad: e.target.value })} /></Field>
              <Field label="E-posta"><Input type="email" value={duzenleme.eposta} onChange={(e) => setDuzenleme({ ...duzenleme, eposta: e.target.value })} /></Field>
              <Field label="Telefon"><Input maxLength={30} value={duzenleme.telefon} onChange={(e) => setDuzenleme({ ...duzenleme, telefon: e.target.value })} /></Field>
              <Field label="Adres"><Input maxLength={500} value={duzenleme.adres} onChange={(e) => setDuzenleme({ ...duzenleme, adres: e.target.value })} /></Field>
              <Field label="Çalışma tipi"><Select value={duzenleme.calismaTipi} onChange={(e) => setDuzenleme({ ...duzenleme, calismaTipi: e.target.value })}><option value="tam_zamanli">Tam zamanlı</option><option value="yari_zamanli">Yarı zamanlı</option><option value="sozlesmeli">Sözleşmeli</option></Select></Field>
              <Field label="İşe giriş tarihi"><Input required type="date" value={duzenleme.girisTarihi} onChange={(e) => setDuzenleme({ ...duzenleme, girisTarihi: e.target.value })} /></Field>
              <Field label="Doğum tarihi (yıllık izin yaş kuralı)"><Input type="date" max={bugun()} value={duzenleme.dogumTarihi} onChange={(e) => setDuzenleme({ ...duzenleme, dogumTarihi: e.target.value })} /></Field>
              <Field label="Engellilik derecesi"><Select value={duzenleme.engellilikDerecesi} onChange={(e) => setDuzenleme({ ...duzenleme, engellilikDerecesi: e.target.value })}><option value="">Yok</option><option value="1">1. derece</option><option value="2">2. derece</option><option value="3">3. derece</option></Select></Field>
              <Field label="SGK teşvik oranı (%)"><Input inputMode="decimal" value={duzenleme.sgkTesvikOrani} onChange={(e) => setDuzenleme({ ...duzenleme, sgkTesvikOrani: e.target.value })} /></Field>
              <Field label={`Yeni TCKN (şu an ${personel.tckn ?? "yok"})`}><Input inputMode="numeric" maxLength={11} value={duzenleme.tckn} onChange={(e) => setDuzenleme({ ...duzenleme, tckn: e.target.value })} placeholder="Değişmeyecekse boş bırakın" /></Field>
              <Field label={`Yeni IBAN (şu an ${personel.iban ?? "yok"})`}><Input disabled={duzenleme.ibanKaldir} value={duzenleme.iban} onChange={(e) => setDuzenleme({ ...duzenleme, iban: e.target.value })} placeholder="TR…" /></Field>
            </div>
            <PersonelSgkAlanlari deger={duzenleme.sgk} onChange={(sgk) => setDuzenleme({ ...duzenleme, sgk })} />
            {personel.iban && <label className="check"><input type="checkbox" checked={duzenleme.ibanKaldir} onChange={(e) => setDuzenleme({ ...duzenleme, ibanKaldir: e.target.checked, iban: "" })} /><span>IBAN'ı kaldır</span></label>}
            <ModalEylem onVazgec={() => setDuzenleme(null)} isleniyor={isleniyor} metin="Kaydet" />
          </form>
        </Modal>
      )}

      {ucretFormu && personel && (
        <Modal baslik="Ücret değiştir" aciklama="Değişiklik yürürlük tarihinden itibaren geçerli olur; ay içindeki değişiklik günlere bölünür. Onaylanmamış bordroları “Yeniden hesapla” ile güncelleyin." onKapat={() => setUcretFormu(null)}>
          <form className="stack" onSubmit={ucretKaydet}>
            <Field label="Yürürlük tarihi"><Input required type="date" value={ucretFormu.yururlukTarihi} onChange={(e) => setUcretFormu({ ...ucretFormu, yururlukTarihi: e.target.value })} /></Field>
            <Field label="Ücret tipi"><Select value={ucretFormu.tip} onChange={(e) => setUcretFormu({ ...ucretFormu, tip: e.target.value as "net" | "brut" })}><option value="net">Net anlaşıldı (bordro mevzuatıyla brüte çevrilir)</option><option value="brut">Brüt anlaşıldı</option></Select></Field>
            <Field label="Aylık tutar (TL)"><Input required inputMode="decimal" value={ucretFormu.tutar} onChange={(e) => setUcretFormu({ ...ucretFormu, tutar: e.target.value })} /></Field>
            <Field label="Neden (isteğe bağlı)"><Input maxLength={250} value={ucretFormu.neden} onChange={(e) => setUcretFormu({ ...ucretFormu, neden: e.target.value })} placeholder="Örn. Yıllık zam" /></Field>
            <ModalEylem onVazgec={() => setUcretFormu(null)} isleniyor={isleniyor} metin="Kaydet" />
          </form>
        </Modal>
      )}

      {yenidenAcik && personel && (
        <Modal baslik="Yeniden işe başlat" aciklama="Yeni istihdam başlangıç tarihini girin." onKapat={() => setYenidenAcik(false)}>
          <form className="stack" onSubmit={yenidenBaslat}>
            <Field label="Yeni işe giriş tarihi"><Input required type="date" value={yeniGirisTarihi} onChange={(e) => setYeniGirisTarihi(e.target.value)} /></Field>
            <ModalEylem onVazgec={() => setYenidenAcik(false)} isleniyor={isleniyor} metin="Personeli aktifleştir" />
          </form>
        </Modal>
      )}
    </div>
  );
}

interface DuzenlemeFormu {
  ad: string; soyad: string; eposta: string; telefon: string; adres: string; calismaTipi: string; girisTarihi: string;
  engellilikDerecesi: string; dogumTarihi: string; sgkTesvikOrani: string; tckn: string; iban: string; ibanKaldir: boolean; sgk: SgkAlanlari;
}
type CikisFormu = { cikisNedeni: string; kidemHakki?: boolean; ihbarDurumu?: "yok" | "isveren_oder" | "isci_oder"; sonBrut?: string; yanOdemeler: string; izinGunu?: string; gerekce: string };
interface CikisOnizleme {
  oneri: { kidemHakki: boolean; ihbarDurumu: string; sonBrut: number; yanOdemeler: number; izinGunu: number };
  girdiler: { girisTarihi: string; cikisTarihi: string; kidemHakki: boolean; ihbarDurumu: "yok" | "isveren_oder" | "isci_oder" };
  oneridenFarkli: boolean; hizmetGunu: number; giydirilmisBrut: number; kidemTavani: number | null; kidemEsasi: number; kidemTutari: number; kidemUyari: string | null;
  ihbarHaftasi: number; ihbarTutari: number; ihbarDurumu: string; izinGunu: number; izinUcreti: number;
}
const CIKIS_NEDENLERI: [string, string][] = [["isveren_fesih", "İşveren feshi (haklı neden olmadan)"], ["istifa", "İstifa"], ["emeklilik", "Emeklilik / yaşlılık aylığı"], ["askerlik", "Muvazzaf askerlik"], ["evlilik", "Evlilik (kadın, 1 yıl içinde)"], ["isci_hakli_fesih", "İşçinin haklı feshi (m.24)"], ["isveren_saglik_zorlayici", "İşveren feshi — sağlık / zorlayıcı neden"], ["ahlak_iyiniyet", "İşveren feshi — ahlak ve iyiniyet ihlali"], ["deneme_suresi", "Deneme süresinde fesih"], ["belirli_sure_bitimi", "Belirli süreli sözleşmenin bitimi"], ["olum", "Ölüm"], ["diger", "Diğer"]];
