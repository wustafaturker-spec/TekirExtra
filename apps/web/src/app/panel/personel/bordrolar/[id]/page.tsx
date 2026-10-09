"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir, ApiHata } from "@/lib/api";
import { bugunTR, paraBicimle } from "@tekirextra/shared";
import { Alert, Badge, Button, Card, EylemCubugu, EylemMenusu, Field, Input, Modal, ModalEylem, PageHeader, Para, Select, Stat, StatGrid, Table } from "@/components/ui";

type Durum = "hesaplandi" | "onay_bekliyor" | "onaylandi" | "kismen_odendi" | "reddedildi" | "odendi" | "iptal";
interface Kalem { id: string; tip: "kazanc" | "kesinti"; kod: string; aciklama: string; tutar: string; manuel: boolean }
interface Odeme { id: string; tutar: string; tarih: string; aciklama?: string | null; durum: "aktif" | "iptal"; iptalNedeni?: string | null; kasaId?: string | null; bankaHesapId?: string | null }
interface Bordro { id: string; donemYil: number; donemAy: number; brutMaas: string; netMaas: string; prim: string; kesinti: string; odenecekTutar: string; odenenTutar: string; kalanTutar: string; durum: Durum; retNedeni?: string | null; odemeTarihi?: string | null; kumulatifMatrah?: string | null; asgariKumulatifMatrah?: string | null; hesapOzeti?: Record<string, unknown> | null; mevzuatKaydi?: { id: string; yururlukBaslangic: string; yururlukBitis?: string | null; degisiklik: { no: number; baslik: string; dayanak: string } | null } | null; personel: { id: string; personelNo: string; ad: string; soyad: string; cariId?: string | null }; kalemler: Kalem[]; odemeler: Odeme[] }
interface Hesap { id: string; ad: string; dovizCinsi: string; aktif: boolean; bakiye: string; bankaAdi?: string }
interface Avans { id: string; kalanTutar: string; tarih: string; durum: string; aciklama?: string | null }

const DURUM: Record<Durum, [string, "info" | "warning" | "accent" | "success" | "danger" | "neutral"]> = { hesaplandi: ["Hesaplandı", "info"], onay_bekliyor: ["Onay bekliyor", "warning"], onaylandi: ["Onaylandı", "accent"], kismen_odendi: ["Kısmen ödendi", "info"], reddedildi: ["Reddedildi", "danger"], odendi: ["Ödendi", "success"], iptal: ["İptal", "neutral"] };
const gun = (v: string) => new Date(v).toLocaleDateString("tr-TR", { timeZone: "UTC" });

/** Tek bordro: kalemler, mevzuat hesap izi, onay akışı, ödemeler ve pusula. */
export default function BordroDetay() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [bordro, setBordro] = useState<Bordro | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);
  const [kalemAcik, setKalemAcik] = useState(false);
  const [mahsupAcik, setMahsupAcik] = useState(false);
  const [avanslar, setAvanslar] = useState<Avans[]>([]);
  const [mahsup, setMahsup] = useState({ avansId: "", tutar: "" });
  const [retAcik, setRetAcik] = useState(false);
  const [odemeAcik, setOdemeAcik] = useState(false);
  const [iptalEdilecek, setIptalEdilecek] = useState<Odeme | null>(null);
  const [iptalNedeni, setIptalNedeni] = useState("");
  const [kalem, setKalem] = useState({ tip: "kazanc" as "kazanc" | "kesinti", kod: "prim", aciklama: "", tutar: "" });
  const [retNedeni, setRetNedeni] = useState("");
  const [hesaplar, setHesaplar] = useState<{ kasalar: Hesap[]; bankalar: Hesap[] }>({ kasalar: [], bankalar: [] });
  const [odeme, setOdeme] = useState({ kaynak: "", tutar: "", odemeTarihi: bugunTR(), aciklama: "" });
  /** PRS-03: onayı geri al (yönetici) ya da bordroyu sil; ikisi de gerekçe ister. */
  const [duzeltme, setDuzeltme] = useState<{ tur: "geri_al" | "sil"; neden: string } | null>(null);

  const yukle = useCallback(async () => {
    try { setHata(null); setBordro(await api<Bordro>(`/personel/bordrolar/${id}`)); }
    catch (e) { setHata(e instanceof Error ? e.message : "Bordro alınamadı"); }
  }, [id]);
  useEffect(() => { void yukle(); }, [yukle]);
  const calistir = async (islem: () => Promise<unknown>) => {
    try { setIsleniyor(true); setHata(null); await islem(); await yukle(); return true; }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "İşlem tamamlanamadı"); return false; }
    finally { setIsleniyor(false); }
  };

  const kalemEkle = async (e: React.FormEvent) => { e.preventDefault(); if (await calistir(() => api(`/personel/bordrolar/${id}/kalemler`, { method: "POST", body: JSON.stringify(kalem) }))) { setKalemAcik(false); setKalem({ tip: "kazanc", kod: "prim", aciklama: "", tutar: "" }); } };
  const kalemSil = async (kalemId: string) => { await calistir(() => api(`/personel/bordrolar/${id}/kalemler/${kalemId}`, { method: "DELETE" })); };
  const mahsupAc = async () => {
    try {
      const kayitlar = await api<Avans[]>(`/personel/avanslar?personelId=${bordro?.personel.id}`);
      setAvanslar(kayitlar.filter((a) => ["odendi", "kismen_mahsup"].includes(a.durum) && Number(a.kalanTutar) > 0)); setMahsupAcik(true);
    } catch (e) { setHata(e instanceof Error ? e.message : "Avanslar alınamadı"); }
  };
  const mahsupEkle = async (e: React.FormEvent) => { e.preventDefault(); if (await calistir(() => api(`/personel/bordrolar/${id}/avans-mahsuplari`, { method: "POST", body: JSON.stringify(mahsup) }))) { setMahsupAcik(false); setMahsup({ avansId: "", tutar: "" }); } };
  const reddet = async (e: React.FormEvent) => { e.preventDefault(); if (await calistir(() => api(`/personel/bordrolar/${id}/reddet`, { method: "POST", body: JSON.stringify({ neden: retNedeni }) }))) setRetAcik(false); };
  const odemeAc = async () => {
    try {
      setHata(null);
      const [kasalar, bankalar] = await Promise.all([api<Hesap[]>("/kasa-banka/kasalar"), api<Hesap[]>("/kasa-banka/bankalar")]);
      setHesaplar({ kasalar: kasalar.filter((h) => h.aktif && h.dovizCinsi === "TRY"), bankalar: bankalar.filter((h) => h.aktif && h.dovizCinsi === "TRY") });
      setOdeme((o) => ({ ...o, tutar: bordro?.kalanTutar ?? "" })); setOdemeAcik(true);
    } catch (e) { setHata(e instanceof Error ? e.message : "Ödeme hesapları alınamadı"); }
  };
  const ode = async (e: React.FormEvent) => {
    e.preventDefault();
    const [tur, hesapId] = odeme.kaynak.split(":");
    if (await calistir(() => api(`/personel/bordrolar/${id}/odemeler`, { method: "POST", body: JSON.stringify({ [tur === "kasa" ? "kasaId" : "bankaHesapId"]: hesapId, tutar: odeme.tutar, odemeTarihi: odeme.odemeTarihi, aciklama: odeme.aciklama }) }))) setOdemeAcik(false);
  };
  const yenidenHesapla = async () => { if (window.confirm("Bordro güncel ücret, puantaj ve mevzuatla yeniden hesaplanacak; elle eklenen kalemler ve avans mahsupları korunur. Devam edilsin mi?")) await calistir(() => api(`/personel/bordrolar/${id}/yeniden-hesapla`, { method: "POST", body: "{}" })); };
  const duzeltmeKaydet = async (e: React.FormEvent) => {
    e.preventDefault(); if (!duzeltme) return;
    if (duzeltme.tur === "sil") {
      try { setIsleniyor(true); setHata(null); await api(`/personel/bordrolar/${id}`, { method: "DELETE", body: JSON.stringify({ neden: duzeltme.neden }) }); router.push("/panel/personel/bordrolar"); }
      catch (err) { setHata(err instanceof ApiHata ? err.message : "Bordro silinemedi"); setIsleniyor(false); }
      return;
    }
    if (await calistir(() => api(`/personel/bordrolar/${id}/onay-geri-al`, { method: "POST", body: JSON.stringify({ neden: duzeltme.neden }) }))) setDuzeltme(null);
  };
  const odemeIptal = async (e: React.FormEvent) => {
    e.preventDefault(); if (!iptalEdilecek) return;
    if (await calistir(() => api(`/personel/bordrolar/${id}/odemeler/${iptalEdilecek.id}/iptal`, { method: "POST", body: JSON.stringify({ neden: iptalNedeni }) }))) { setIptalEdilecek(null); setIptalNedeni(""); }
  };

  if (!bordro) return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel/bordrolar">← Bordrolara dön</Link>
      {hata ? <Alert tone="error">{hata}</Alert> : <p className="muted">Bordro yükleniyor…</p>}
    </div>
  );

  const duzenlenebilir = bordro.durum === "hesaplandi" || bordro.durum === "reddedildi";
  const onaysiz = duzenlenebilir || bordro.durum === "onay_bekliyor";
  const onayli = ["onaylandi", "kismen_odendi", "odendi"].includes(bordro.durum);
  const geriAlinabilir = bordro.durum === "onaylandi" && Number(bordro.odenenTutar) === 0;
  /** PRS-10: ücret hesap pusulası (İş K. m.37). */
  const pusulaIndir = () => void apiDosyaIndir(`/personel/pusulalar/${id}/pdf`, `pusula-${bordro.personel.personelNo}-${bordro.donemYil}-${String(bordro.donemAy).padStart(2, "0")}.pdf`).catch((e) => setHata(e instanceof Error ? e.message : "Pusula indirilemedi"));
  const pusulaGonder = async () => { if (window.confirm("Pusula personelin kart e-postasına gönderilecek. Devam edilsin mi?")) await calistir(() => api(`/personel/pusulalar/${id}/eposta`, { method: "POST", body: "{}" })); };

  return (
    <div className="stack">
      <Link className="back-link" href="/panel/personel/bordrolar">← Bordro çalışma alanına dön</Link>
      <PageHeader
        title={<>{bordro.personel.ad} {bordro.personel.soyad} <Badge variant={DURUM[bordro.durum][1]}>{DURUM[bordro.durum][0]}</Badge></>}
        subtitle={<><span className="mono">{bordro.personel.personelNo}</span> · {String(bordro.donemAy).padStart(2, "0")}/{bordro.donemYil} bordrosu</>}
      />
      <EylemCubugu etiket="Bordro işlemleri">
        {bordro.durum === "hesaplandi" && <Button variant="primary" disabled={isleniyor} onClick={() => void calistir(() => api(`/personel/bordrolar/${id}/onaya-gonder`, { method: "POST" }))}>Onaya gönder</Button>}
        {bordro.durum === "onay_bekliyor" && <>
          <Button variant="primary" disabled={isleniyor} onClick={() => void calistir(() => api(`/personel/bordrolar/${id}/onayla`, { method: "POST" }))}>Onayla</Button>
          <Button variant="danger" onClick={() => setRetAcik(true)}>Reddet</Button>
        </>}
        {(bordro.durum === "onaylandi" || bordro.durum === "kismen_odendi") && <Button variant="primary" onClick={() => void odemeAc()}>Ödeme yap</Button>}
        {duzenlenebilir && <>
          <Button onClick={() => setKalemAcik(true)}>Kalem ekle</Button>
          <Button onClick={() => void mahsupAc()}>Avans mahsup et</Button>
        </>}
        <Button onClick={pusulaIndir}>Pusula (PDF)</Button>
        {onayli && <Button disabled={isleniyor} onClick={() => void pusulaGonder()}>Pusulayı e-postala</Button>}
        {(onaysiz || geriAlinabilir) && (
          <EylemMenusu>
            {onaysiz && <Button size="sm" disabled={isleniyor} onClick={() => void yenidenHesapla()}>Yeniden hesapla</Button>}
            {onaysiz && <Button size="sm" variant="danger" onClick={() => setDuzeltme({ tur: "sil", neden: "" })}>Bordroyu sil</Button>}
            {geriAlinabilir && <Button size="sm" variant="danger" onClick={() => setDuzeltme({ tur: "geri_al", neden: "" })}>Onayı geri al</Button>}
          </EylemMenusu>
        )}
      </EylemCubugu>
      <Alert tone="error">{hata}</Alert>
      {bordro.retNedeni && <Alert tone="warning"><strong>Ret nedeni:</strong> {bordro.retNedeni}</Alert>}

      <StatGrid>
        <Stat label="Temel ücret" value={<Para deger={bordro.netMaas} />} />
        <Stat label="Prim / ek kazanç" value={<Para deger={bordro.prim} />} />
        <Stat label="Kesinti" value={<Para deger={bordro.kesinti} />} />
        <Stat label="Ödenen" value={<Para deger={bordro.odenenTutar} />} />
        <Stat label="Kalan" value={<Para deger={bordro.kalanTutar} />} tone="accent" />
      </StatGrid>

      {bordro.mevzuatKaydi && (
        <Card
          title={`Mevzuat hesap izi · ${bordro.mevzuatKaydi.degisiklik ? `#${bordro.mevzuatKaydi.degisiklik.no} ${bordro.mevzuatKaydi.degisiklik.baslik}` : "Bordro parametreleri (ilk dolum)"}`}
          actions={<small className="muted">Yürürlük {gun(bordro.mevzuatKaydi.yururlukBaslangic)}{bordro.mevzuatKaydi.yururlukBitis ? ` – ${gun(bordro.mevzuatKaydi.yururlukBitis)}` : ""}{bordro.mevzuatKaydi.degisiklik ? ` · ${bordro.mevzuatKaydi.degisiklik.dayanak}` : ""}</small>}
        >
          {bordro.hesapOzeti && <HesapIzi ozet={bordro.hesapOzeti} />}
        </Card>
      )}

      <Card title="Bordro kalemleri" pad={false}>
        <Table>
          <thead><tr><th>Tür</th><th>Açıklama</th><th className="num">Tutar</th><th /></tr></thead>
          <tbody>
            {bordro.kalemler.map((k) => (
              <tr key={k.id}>
                <td><Badge variant={k.tip === "kazanc" ? "success" : "danger"}>{k.tip === "kazanc" ? "Kazanç" : "Kesinti"}</Badge></td>
                <td><strong>{k.aciklama}</strong><div className="subtle mono">{k.kod}</div></td>
                <td className="num"><strong><Para deger={k.tutar} /></strong></td>
                <td className="num">{duzenlenebilir && k.manuel && <Button size="sm" variant="danger" disabled={isleniyor} onClick={() => void kalemSil(k.id)}>Kaldır</Button>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Ödeme geçmişi" pad={false}>
        <Table>
          <thead><tr><th>Tarih</th><th className="num">Tutar</th><th>Durum</th><th /></tr></thead>
          <tbody>
            {bordro.odemeler.map((o) => (
              <tr key={o.id}>
                <td>{gun(o.tarih)}</td>
                <td className="num"><strong><Para deger={o.tutar} /></strong></td>
                <td>{o.durum === "aktif" ? <Badge variant="success">Aktif</Badge> : <><Badge variant="danger">İptal</Badge> <small className="muted">{o.iptalNedeni}</small></>}</td>
                <td className="num">{o.durum === "aktif" && <Button size="sm" variant="danger" onClick={() => setIptalEdilecek(o)}>Ödemeyi iptal et</Button>}</td>
              </tr>
            ))}
            {!bordro.odemeler.length && <tr><td className="muted" colSpan={4}>Henüz ödeme yapılmadı.</td></tr>}
          </tbody>
        </Table>
      </Card>

      {kalemAcik && (
        <Modal baslik="Bordro kalemi ekle" onKapat={() => setKalemAcik(false)}>
          <form className="stack" onSubmit={kalemEkle}>
            <Field label="Tür"><Select value={kalem.tip} onChange={(e) => setKalem({ ...kalem, tip: e.target.value as "kazanc" | "kesinti" })}><option value="kazanc">Kazanç / Prim</option><option value="kesinti">Kesinti</option></Select></Field>
            <Field label="Kod"><Input required pattern="[a-z0-9_]+" title="Küçük harf, rakam ve alt çizgi" value={kalem.kod} onChange={(e) => setKalem({ ...kalem, kod: e.target.value })} /></Field>
            <Field label="Açıklama"><Input required value={kalem.aciklama} onChange={(e) => setKalem({ ...kalem, aciklama: e.target.value })} /></Field>
            <Field label="Tutar"><Input required min="0.01" step="0.01" type="number" value={kalem.tutar} onChange={(e) => setKalem({ ...kalem, tutar: e.target.value })} /></Field>
            <ModalEylem onVazgec={() => setKalemAcik(false)} isleniyor={isleniyor} metin="Kalemi ekle" />
          </form>
        </Modal>
      )}
      {mahsupAcik && (
        <Modal baslik="Avans mahsubu ekle" onKapat={() => setMahsupAcik(false)}>
          <form className="stack" onSubmit={mahsupEkle}>
            {!avanslar.length ? <Alert tone="warning">Mahsup edilebilecek ödenmiş avans bulunmuyor.</Alert> : <>
              <Field label="Avans">
                <Select required value={mahsup.avansId} onChange={(e) => { const a = avanslar.find((x) => x.id === e.target.value); setMahsup({ avansId: e.target.value, tutar: a?.kalanTutar ?? "" }); }}>
                  <option value="">Avans seçin</option>
                  {avanslar.map((a) => <option key={a.id} value={a.id}>{new Date(a.tarih).toLocaleDateString("tr-TR")} · Kalan {paraBicimle(a.kalanTutar)}</option>)}
                </Select>
              </Field>
              <Field label="Mahsup tutarı"><Input required type="number" min="0.01" step="0.01" value={mahsup.tutar} onChange={(e) => setMahsup({ ...mahsup, tutar: e.target.value })} /></Field>
              <ModalEylem onVazgec={() => setMahsupAcik(false)} isleniyor={isleniyor} metin="Mahsubu ekle" />
            </>}
          </form>
        </Modal>
      )}
      {duzeltme && (
        <Modal
          baslik={duzeltme.tur === "sil" ? "Bordroyu sil" : "Onayı geri al"}
          aciklama={duzeltme.tur === "sil" ? "Bordro ve kalemleri silinir, avans mahsupları avansa geri döner. Aynı ay için yeniden tahakkuk alınabilir." : "Yalnız yönetici yapabilir. Cari tahakkuku ters kayıtla kapanır; bordro “Hesaplandı”ya döner ve yeniden onaya girer."}
          onKapat={() => setDuzeltme(null)}
        >
          <form className="stack" onSubmit={duzeltmeKaydet}>
            <Field label="Gerekçe"><textarea className="textarea" required minLength={3} maxLength={500} rows={3} value={duzeltme.neden} onChange={(e) => setDuzeltme({ ...duzeltme, neden: e.target.value })} /></Field>
            <ModalEylem onVazgec={() => setDuzeltme(null)} isleniyor={isleniyor} metin={duzeltme.tur === "sil" ? "Sil" : "Onayı geri al"} tehlikeli />
          </form>
        </Modal>
      )}
      {retAcik && (
        <Modal baslik="Bordroyu reddet" onKapat={() => setRetAcik(false)}>
          <form className="stack" onSubmit={reddet}>
            <Field label="Ret nedeni"><textarea className="textarea" required minLength={3} maxLength={500} rows={4} value={retNedeni} onChange={(e) => setRetNedeni(e.target.value)} /></Field>
            <ModalEylem onVazgec={() => setRetAcik(false)} isleniyor={isleniyor} metin="Reddet" tehlikeli />
          </form>
        </Modal>
      )}
      {odemeAcik && (
        <Modal baslik="Bordro ödemesi" aciklama={<>Kalan bakiye: <strong><Para deger={bordro.kalanTutar} /></strong></>} onKapat={() => setOdemeAcik(false)}>
          <form className="stack" onSubmit={ode}>
            <Field label="Ödeme tutarı"><Input required type="number" min="0.01" max={bordro.kalanTutar} step="0.01" value={odeme.tutar} onChange={(e) => setOdeme({ ...odeme, tutar: e.target.value })} /></Field>
            <Field label="Kasa / banka">
              <Select required value={odeme.kaynak} onChange={(e) => setOdeme({ ...odeme, kaynak: e.target.value })}>
                <option value="">Hesap seçin</option>
                <optgroup label="Kasalar">{hesaplar.kasalar.map((h) => <option key={h.id} value={`kasa:${h.id}`}>{h.ad} · {paraBicimle(h.bakiye)}</option>)}</optgroup>
                <optgroup label="Banka hesapları">{hesaplar.bankalar.map((h) => <option key={h.id} value={`banka:${h.id}`}>{h.bankaAdi} / {h.ad} · {paraBicimle(h.bakiye)}</option>)}</optgroup>
              </Select>
            </Field>
            <Field label="Ödeme tarihi"><Input required type="date" value={odeme.odemeTarihi} onChange={(e) => setOdeme({ ...odeme, odemeTarihi: e.target.value })} /></Field>
            <Field label="Açıklama"><Input maxLength={250} value={odeme.aciklama} onChange={(e) => setOdeme({ ...odeme, aciklama: e.target.value })} /></Field>
            <ModalEylem onVazgec={() => setOdemeAcik(false)} isleniyor={isleniyor} metin="Ödemeyi kaydet" />
          </form>
        </Modal>
      )}
      {iptalEdilecek && (
        <Modal baslik="Ödemeyi iptal et" aciklama={<><strong><Para deger={iptalEdilecek.tutar} /></strong> için ters kasa/banka ve cari hareketi oluşturulur.</>} onKapat={() => setIptalEdilecek(null)}>
          <form className="stack" onSubmit={odemeIptal}>
            <Field label="İptal nedeni"><textarea className="textarea" required minLength={3} maxLength={500} rows={4} value={iptalNedeni} onChange={(e) => setIptalNedeni(e.target.value)} /></Field>
            <ModalEylem onVazgec={() => setIptalEdilecek(null)} isleniyor={isleniyor} metin="Ters kayıt oluştur" tehlikeli />
          </form>
        </Modal>
      )}
    </div>
  );
}

const HESAP_ETIKETLERI: Record<string, string> = {
  brutUcret: "Brüt ücret", ucretDisiOdeme: "Prim / ikramiye brüt", sgkDevredenUygulanan: "Önceki dönemden uygulanan SGK matrahı", sgkCariAyUcretDisiUygulanan: "Cari ayda SGK'ya tabi prim / ikramiye", sgkCariAyDevreden: "Sonraki aylara devreden SGK matrahı",
  primeEsasKazanc: "Prime esas kazanç", sgkIsci: "SGK çalışan", issizlikIsci: "İşsizlik çalışan", gelirVergisiMatrahiIndirimOncesi: "İndirim öncesi vergi matrahı", engellilikDerecesi: "Engellilik derecesi", engellilikIndirimi: "Engellilik indirimi",
  sahisSigortaPrimi: "Şahıs sigortası kesintisi", hayatSigortaPrimi: "Hayat sigortası kesintisi", toplamSigortaPrimi: "Toplam sigorta primi kesintisi", sahisSigortaIndirimi: "Şahıs/hayat sigortası indirimi",
  sendikaAidati: "Sendika aidatı nakit kesintisi", sendikaAidatiIndirimi: "Sendika aidatı matrah indirimi", toplamGelirVergisiMatrahIndirimi: "Toplam matrah indirimi", yeniKumulatifSigortaIndirimi: "Kümülatif sigorta indirimi",
  gelirVergisiMatrahi: "Vergi matrahı", gelirVergisiBrut: "Brüt gelir vergisi", asgariUcretGelirVergisiIstisnasi: "Gelir vergisi istisnası", gelirVergisi: "Kesilen gelir vergisi", damgaVergisiBrut: "Brüt damga vergisi",
  asgariUcretDamgaVergisiIstisnasi: "Damga vergisi istisnası", damgaVergisi: "Kesilen damga vergisi", netUcret: "Net ücret", yeniKumulatifMatrah: "Kümülatif matrah", yeniAsgariKumulatifMatrah: "Asgari kümülatif matrah",
  isverenSgk: "Brüt SGK işveren", sgkTesvikOrani: "Uygulanan teşvik oranı", isverenSgkTesvikIndirimi: "SGK teşvik indirimi", isverenSgkNet: "Net SGK işveren", isverenIssizlik: "İşsizlik işveren", isverenMaliyeti: "İşveren maliyeti",
};

function HesapIzi({ ozet }: { ozet: Record<string, unknown> }) {
  const satirlar = Object.keys(HESAP_ETIKETLERI).filter((k) => k in ozet && typeof ozet[k] !== "object").map((k) => [k, ozet[k]] as const);
  const yari = Math.ceil(satirlar.length / 2);
  const deger = (k: string, v: unknown) => k === "engellilikDerecesi" ? (v === "0" ? "Uygulanmadı" : `${String(v)}. derece`) : k === "sgkTesvikOrani" ? `%${String(v)}` : <Para deger={String(v)} />;
  const devirler = ozet.sgkMatrahDevirleri;
  return (
    <div className="stack">
      <div className="split split--even">
        {[satirlar.slice(0, yari), satirlar.slice(yari)].map((parca, i) => (
          <dl key={i} className="kv">
            {parca.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{HESAP_ETIKETLERI[k]}</dt><dd className="num" style={["netUcret", "isverenMaliyeti"].includes(k) ? { color: "var(--accent-text)", fontWeight: 700 } : undefined}>{deger(k, v)}</dd></div>)}
          </dl>
        ))}
      </div>
      {Array.isArray(devirler) && devirler.length > 0 && (
        <div>
          <p className="field-label">Sonraki dönemlere taşınacak SGK matrahı</p>
          <div className="row-tight">{devirler.map((d, i) => { const k = d as { tutar?: unknown; kalanAy?: unknown }; return <Badge key={i} variant="info"><Para deger={String(k.tutar ?? 0)} /> · {String(k.kalanAy)} ay kullanılabilir</Badge>; })}</div>
        </div>
      )}
    </div>
  );
}
