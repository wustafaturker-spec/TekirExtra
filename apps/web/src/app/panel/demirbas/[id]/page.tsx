"use client";

/**
 * DMR-01/02/04/08/10: demirbaş kartı. Amortisman planı (kesin/plan), ilave
 * bedeller, zimmet geçmişi ve tutanağı, elden çıkarma ve dosyalar.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { bugunTR } from "@tekirextra/shared";
import { api, apiPdfAc, ApiHata, tokenAl } from "@/lib/api";
import { BelgeDosyalari, belgeDosyalariniYukle, KayitliEkSatiri, type KayitliEk } from "@/components/belge-dosyalari";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { Alert, Badge, Button, ButtonLabel, Card, EylemCubugu, EylemMenusu, Field, Input, PageHeader, Para, Select, Stat, StatGrid, TableWrap, Tarih } from "@/components/ui";
import { CIKIS_TURLERI, SINIFLAR, sayi, YONTEMLER, type CikisTuru, type FaturaSatirSecenegi, type Sinif } from "../ortak";

interface PlanSatiri { yil: number; tutar: string; kkeg: string; birikmisOnce: string; birikmisSonra: string; durum: "kesin" | "plan" }
interface Zimmet { id: string; personelId: string | null; personel: string | null; konum: string | null; baslangic: string; bitis: string | null; aciklama: string | null }
interface Kart {
  id: string; kod: string; ad: string; sinif: Sinif; hesapKodu: string | null; giderHesapKodu: string | null; listeKodu: string | null;
  faydaliOmur: number; yontem: "normal" | "azalan"; normaleGecisYili: number | null; binekOto: boolean; binekVergili: boolean; binekSinirYok: boolean;
  edinmeTarihi: string; edinmeBedeli: string; dovizCinsi: string; dovizTutari: string | null; kur: string | null; seriNo: string | null; konum: string | null; aciklama: string | null;
  durum: "kullanimda" | "elden_cikti"; acilis: boolean; acilisBirikmis: string; acilisSonYil: number | null;
  cikisTuru: CikisTuru | null; cikisTarihi: string | null; cikisBedeli: string | null; cikisGerekcesi: string | null; cikisBirikmis: string | null;
  bedel: string; birikmis: string; netDeger: string; binekSiniri: number | null; kesinYilVar: boolean;
  liste: { kod: string; ad: string; omur: number } | null; plan: PlanSatiri[];
  tedarikci: { id: string; unvan: string } | null;
  girisFaturasi: { faturaId: string; no: string | null; tarih: string; satir: string } | null;
  cikisFaturasi: { faturaId: string; no: string | null; tarih: string; satir: string } | null;
  zimmetler: Zimmet[];
  ilaveBedeller: Array<{ id: string; tarih: string; tutar: string; aciklama: string; faturaSatirId: string | null }>;
  cikisSonucu: { netDeger: string; fark: string } | null;
}
interface Personel { id: string; ad: string; soyad: string; personelNo: string; durum: string }
type Panel = null | "duzenle" | "zimmet" | "ilave" | "cikis" | "cikis-geri" | "dosyalar" | "gecis";

export default function DemirbasKarti() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [k, setK] = useState<Kart | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [mesaj, setMesaj] = useState<{ tur: "success" | "error" | "warning"; metin: string } | null>(null);

  const yukle = useCallback(async () => {
    try { setK(await api<Kart>(`/demirbas/${id}`)); }
    catch (e) { setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Kart yüklenemedi" }); }
  }, [id]);
  useEffect(() => { if (tokenAl()) void yukle(); }, [yukle]);

  async function islem(fn: () => Promise<unknown>, basari: string) {
    try {
      const sonuc = await fn() as { uyarilar?: string[] } | undefined;
      setPanel(null);
      setMesaj({ tur: sonuc?.uyarilar?.length ? "warning" : "success", metin: [basari, ...(sonuc?.uyarilar ?? [])].join(" ") });
      await yukle();
      return true;
    } catch (e) {
      setMesaj({ tur: "error", metin: e instanceof ApiHata ? e.message : "İşlem yapılamadı" });
      return false;
    }
  }
  async function sil() {
    if (!k || !confirm(`${k.kod} silinsin mi?`)) return;
    try { await api(`/demirbas/${k.id}`, { method: "DELETE" }); router.push("/panel/demirbas"); }
    catch (e) { setMesaj({ tur: "error", metin: e instanceof ApiHata ? e.message : "Silinemedi" }); }
  }

  if (!k) return <div>{mesaj ? <Alert tone="error">{mesaj.metin}</Alert> : <p className="muted">Yükleniyor…</p>}</div>;
  const acikZimmet = k.zimmetler.find((z) => !z.bitis);
  const kullanimda = k.durum === "kullanimda";
  const kkegVar = k.plan.some((p) => Number(p.kkeg) > 0);

  return (
    <div className="demirbas-page">
      <PageHeader
        title={`${k.kod} · ${k.ad}`}
        subtitle={<>{SINIFLAR[k.sinif]} · {YONTEMLER[k.yontem]}{k.normaleGecisYili ? ` (${k.normaleGecisYili}'den normal)` : ""} · {k.faydaliOmur} yıl{k.liste ? ` · VUK ${k.liste.kod}` : ""}
          {" "}{kullanimda ? <Badge variant="success">Kullanımda</Badge> : <Badge variant="warning">Elden çıktı{k.cikisTuru ? ` · ${CIKIS_TURLERI[k.cikisTuru]}` : ""}</Badge>}
          {k.acilis && <> <Badge variant="neutral">Açılış kaydı</Badge></>}</>}
        actions={<ButtonLabel as="a" href="/panel/demirbas">← Demirbaşlar</ButtonLabel>}
      />
      {mesaj && <Alert tone={mesaj.tur}>{mesaj.metin}</Alert>}

      <EylemCubugu etiket="Kart işlemleri">
        {kullanimda && <Button onClick={() => setPanel("zimmet")}>{acikZimmet ? "Zimmeti devret" : "Zimmetle"}</Button>}
        {kullanimda && <Button onClick={() => setPanel("cikis")}>Elden çıkar</Button>}
        {!kullanimda && <Button onClick={() => setPanel("cikis-geri")}>Çıkışı geri al</Button>}
        <Button onClick={() => setPanel("dosyalar")}>Dosyalar</Button>
        <EylemMenusu>
          <Button onClick={() => setPanel("duzenle")}>Düzenle</Button>
          {kullanimda && !k.acilis && !k.kesinYilVar && <Button onClick={() => setPanel("ilave")}>İlave bedel ekle</Button>}
          {kullanimda && k.yontem === "azalan" && k.normaleGecisYili == null && <Button onClick={() => setPanel("gecis")}>Normale geç</Button>}
          {kullanimda && !k.kesinYilVar && <Button variant="danger" onClick={() => void sil()}>Kartı sil</Button>}
        </EylemMenusu>
      </EylemCubugu>

      <StatGrid>
        <Stat label="Amortismana esas bedel" value={<Para deger={k.bedel} />} hint={k.ilaveBedeller.length ? `${k.ilaveBedeller.length} ilave bedel dahil` : undefined} />
        <Stat label="Birikmiş amortisman" value={<Para deger={k.cikisBirikmis ?? k.birikmis} />} />
        <Stat label="Net defter değeri" value={<Para deger={kullanimda ? k.netDeger : Number(k.bedel) - Number(k.cikisBirikmis ?? 0)} />} />
        {k.cikisSonucu && <Stat label={Number(k.cikisSonucu.fark) >= 0 ? "Satış kârı (679)" : "Zarar (689)"} value={<Para deger={Math.abs(Number(k.cikisSonucu.fark))} />} tone={Number(k.cikisSonucu.fark) >= 0 ? "success" : "danger"} />}
      </StatGrid>

      <div className="demirbas__duzen">
        <Card title="Bilgiler">
          <dl className="demirbas__bilgi">
            <dt>Edinme</dt><dd><Tarih deger={k.edinmeTarihi} /> · <Para deger={k.edinmeBedeli} />{k.dovizCinsi !== "TRY" && k.dovizTutari ? <> (<Para deger={k.dovizTutari} dovizCinsi={k.dovizCinsi} />, kur {k.kur})</> : null}</dd>
            {k.girisFaturasi && <><dt>Alış faturası</dt><dd><a href={`/panel/fatura/yeni?ac=${k.girisFaturasi.faturaId}`}>{k.girisFaturasi.no ?? "(numarasız)"}</a> · {k.girisFaturasi.satir}</dd></>}
            {k.tedarikci && <><dt>Tedarikçi</dt><dd><a href={`/panel/cari?id=${k.tedarikci.id}`}>{k.tedarikci.unvan}</a></dd></>}
            {k.acilis && <><dt>Açılış birikmişi</dt><dd><Para deger={k.acilisBirikmis} />{k.acilisSonYil ? ` · ${k.acilisSonYil} sonuna kadar` : ""}</dd></>}
            <dt>Seri no / plaka</dt><dd>{k.seriNo ?? "—"}</dd>
            <dt>Konum</dt><dd>{acikZimmet?.konum ?? k.konum ?? "—"}</dd>
            <dt>Zimmetli</dt><dd>{acikZimmet?.personel ?? "—"}</dd>
            <dt>Hesaplar</dt><dd>Varlık {k.hesapKodu ?? `sınıfın hesabı`} · gider {k.giderHesapKodu ?? "770"}</dd>
            {k.binekOto && <><dt>Binek oto</dt><dd>{k.binekSinirYok ? "Sınır uygulanmaz (kiralama/işletme)" : k.binekSiniri != null ? <>Sınır <Para deger={k.binekSiniri} />{k.binekVergili ? " (vergiler maliyette / ikinci el)" : ""}</> : "Edinme yılı için sınır kaydı yok"}</dd></>}
            {!kullanimda && <><dt>Çıkış</dt><dd>{k.cikisTuru ? CIKIS_TURLERI[k.cikisTuru] : ""} · <Tarih deger={k.cikisTarihi} />{k.cikisFaturasi ? <> · <a href={`/panel/fatura/yeni?ac=${k.cikisFaturasi.faturaId}`}>{k.cikisFaturasi.no}</a> (<Para deger={k.cikisBedeli ?? 0} />)</> : null}<br /><small className="muted">{k.cikisGerekcesi}</small></dd></>}
            {k.aciklama && <><dt>Açıklama</dt><dd>{k.aciklama}</dd></>}
          </dl>
        </Card>

        <Card title="Amortisman planı">
          <TableWrap>
            <table className="table">
              <thead><tr><th>Yıl</th><th className="num">Önceki birikmiş</th><th className="num">Amortisman</th>{kkegVar && <th className="num">KKEG</th>}<th className="num">Birikmiş</th><th className="num">Net değer</th><th /></tr></thead>
              <tbody>
                {k.acilis && Number(k.acilisBirikmis) > 0 && <tr className="muted"><td>…{k.acilisSonYil}</td><td /><td className="num"><Para deger={k.acilisBirikmis} /></td>{kkegVar && <td />}<td className="num"><Para deger={k.acilisBirikmis} /></td><td className="num"><Para deger={Number(k.bedel) - Number(k.acilisBirikmis)} /></td><td><Badge variant="neutral">açılış</Badge></td></tr>}
                {k.plan.length === 0 && <tr><td colSpan={7} className="muted">{kullanimda ? "Ayrılacak amortisman kalmadı." : "Çıkış yılından önce kesinleşen amortisman yok."}</td></tr>}
                {k.plan.map((p) => (
                  <tr key={p.yil}>
                    <td>{p.yil}</td>
                    <td className="num"><Para deger={p.birikmisOnce} /></td>
                    <td className="num"><Para deger={p.tutar} /></td>
                    {kkegVar && <td className="num"><Para deger={p.kkeg} /></td>}
                    <td className="num"><Para deger={p.birikmisSonra} /></td>
                    <td className="num"><Para deger={Number(k.bedel) - Number(p.birikmisSonra)} /></td>
                    <td>{p.durum === "kesin" ? <Badge variant="success">kesin</Badge> : <Badge variant="neutral">plan</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="muted">Kesin yıllar yıl sonu çalıştırmasından gelir (<a href="/panel/demirbas/amortisman">Amortisman</a>); plan yılları kalan değerden hesaplanır, kuruş farkı son yılda kapanır.</p>
        </Card>

        {k.ilaveBedeller.length > 0 && (
          <Card title="İlave bedeller">
            <TableWrap><table className="table"><thead><tr><th>Tarih</th><th>Açıklama</th><th className="num">Tutar</th><th /></tr></thead>
              <tbody>{k.ilaveBedeller.map((i) => <tr key={i.id}><td><Tarih deger={i.tarih} /></td><td>{i.aciklama}{i.faturaSatirId ? " · faturadan" : ""}</td><td className="num"><Para deger={i.tutar} /></td>
                <td>{!k.kesinYilVar && kullanimda && <Button size="sm" onClick={() => void islem(() => api(`/demirbas/ilave-bedel/${i.id}/sil`, { method: "POST" }), "İlave bedel silindi.")}>Sil</Button>}</td></tr>)}</tbody></table></TableWrap>
          </Card>
        )}

        <Card title="Zimmet geçmişi">
          {k.zimmetler.length === 0 ? <p className="muted">Zimmet kaydı yok.</p> : (
            <TableWrap><table className="table"><thead><tr><th>Personel</th><th>Konum</th><th>Başlangıç</th><th>İade</th><th /></tr></thead>
              <tbody>{k.zimmetler.map((z) => (
                <tr key={z.id}>
                  <td>{z.personel ?? "—"}</td><td>{z.konum ?? "—"}</td><td><Tarih deger={z.baslangic} /></td><td>{z.bitis ? <Tarih deger={z.bitis} /> : <Badge variant="info">açık</Badge>}</td>
                  <td className="row-tight">
                    <Button size="sm" onClick={() => void apiPdfAc(`/demirbas/zimmet/${z.id}/tutanak`).catch((e) => setMesaj({ tur: "error", metin: e instanceof Error ? e.message : "Tutanak açılamadı" }))}>Tutanak</Button>
                    {!z.bitis && <ZimmetIade zimmet={z} onIade={(bitis) => islem(() => api(`/demirbas/zimmet/${z.id}/iade`, { method: "POST", body: JSON.stringify({ bitis }) }), "Zimmet iade alındı.")} />}
                  </td>
                </tr>
              ))}</tbody></table></TableWrap>
          )}
        </Card>
      </div>

      {panel === "zimmet" && <ZimmetPaneli onKapat={() => setPanel(null)} onKaydet={(g) => islem(() => api(`/demirbas/${k.id}/zimmet`, { method: "POST", body: JSON.stringify(g) }), "Zimmet kaydedildi.")} />}
      {panel === "ilave" && <IlavePaneli onKapat={() => setPanel(null)} onKaydet={(g) => islem(() => api(`/demirbas/${k.id}/ilave-bedel`, { method: "POST", body: JSON.stringify(g) }), "İlave bedel eklendi.")} />}
      {panel === "cikis" && <CikisPaneli kart={k} onKapat={() => setPanel(null)} onKaydet={(g) => islem(() => api(`/demirbas/${k.id}/cikis`, { method: "POST", body: JSON.stringify(g) }), "Kart elden çıkarıldı.")} />}
      {panel === "cikis-geri" && <GerekcePaneli baslik="Çıkışı geri al" metin="Çıkış geri alınır, kart yeniden kullanımda olur. Çıkıştan sonra kesinleşmiş amortisman yılı varsa geri alınamaz." onKapat={() => setPanel(null)} onKaydet={(gerekce) => islem(() => api(`/demirbas/${k.id}/cikis-geri-al`, { method: "POST", body: JSON.stringify({ gerekce }) }), "Çıkış geri alındı.")} />}
      {panel === "gecis" && <GecisPaneli kart={k} onKapat={() => setPanel(null)} onKaydet={(yil) => islem(() => api(`/demirbas/${k.id}/normale-gecis`, { method: "POST", body: JSON.stringify({ yil }) }), `${yil} yılından itibaren normal yönteme geçildi.`)} />}
      {panel === "duzenle" && <DuzenlePaneli kart={k} onKapat={() => setPanel(null)} onKaydet={(g) => islem(() => api(`/demirbas/${k.id}`, { method: "PATCH", body: JSON.stringify(g) }), "Kart güncellendi.")} />}
      {panel === "dosyalar" && <DosyaPaneli kartId={k.id} baslik={k.kod} onKapat={() => setPanel(null)} />}
    </div>
  );
}

function ZimmetIade({ zimmet, onIade }: { zimmet: Zimmet; onIade: (bitis: string) => Promise<boolean> }) {
  const [acik, setAcik] = useState(false);
  const [bitis, setBitis] = useState(bugunTR());
  if (!acik) return <Button size="sm" onClick={() => setAcik(true)}>İade al</Button>;
  return <span className="row-tight"><Input type="date" min={zimmet.baslangic} value={bitis} onChange={(e) => setBitis(e.target.value)} aria-label="İade tarihi" /><Button size="sm" variant="primary" onClick={() => void onIade(bitis)}>Kaydet</Button></span>;
}

function ZimmetPaneli({ onKapat, onKaydet }: { onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [f, setF] = useState({ personelId: "", konum: "", baslangic: bugunTR(), aciklama: "" });
  useEffect(() => {
    void api<{ kayitlar: Personel[] }>("/personel?adet=200").then((r) => setPersoneller(r.kayitlar.filter((p) => p.durum !== "isten_ayrildi"))).catch(() => setPersoneller([]));
  }, []);
  return (
    <HizliKayitPaneli baslik="Zimmet" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet({ personelId: f.personelId || null, konum: f.konum || null, baslangic: f.baslangic, aciklama: f.aciklama || null }); }}>
        <p className="muted">Açık zimmet varsa yeni zimmetin başlangıcında kapanır. Tutanak zimmet satırından basılır.</p>
        <Field label="Personel"><Select value={f.personelId} onChange={(e) => setF({ ...f, personelId: e.target.value })}><option value="">— (yalnız konum)</option>{personeller.map((p) => <option key={p.id} value={p.id}>{p.ad} {p.soyad} · {p.personelNo}</option>)}</Select></Field>
        <Field label="Konum"><Input value={f.konum} onChange={(e) => setF({ ...f, konum: e.target.value })} placeholder="ör. Merkez ofis, 2. kat" /></Field>
        <Field label="Teslim tarihi"><Input type="date" required value={f.baslangic} onChange={(e) => setF({ ...f, baslangic: e.target.value })} /></Field>
        <Field label="Açıklama"><Input value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /></Field>
        <Button type="submit" variant="primary" disabled={!f.personelId && !f.konum.trim()}>Kaydet</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function SatirSecici({ tip, onSec }: { tip: "alis" | "satis"; onSec: (s: { id: string; tutarTl: string; kalan: number; tarih: string; ad: string }) => void }) {
  const [no, setNo] = useState("");
  const [faturalar, setFaturalar] = useState<FaturaSatirSecenegi[] | null>(null);
  const [secili, setSecili] = useState("");
  const [hata, setHata] = useState("");
  async function ara() {
    setHata("");
    try { setFaturalar(await api<FaturaSatirSecenegi[]>(`/demirbas/fatura-satirlari?tip=${tip}&no=${encodeURIComponent(no)}`)); }
    catch (e) { setHata(e instanceof ApiHata ? e.message : "Fatura aranamadı"); }
  }
  return (
    <div className="stack">
      <div className="row-tight"><Field label={`Kesin ${tip === "alis" ? "alış" : "satış"} faturası no`}><Input value={no} onChange={(e) => setNo(e.target.value)} /></Field><Button type="button" disabled={no.trim().length < 3} onClick={() => void ara()}>Ara</Button></div>
      {hata && <Alert tone="error">{hata}</Alert>}
      {faturalar?.length === 0 && <p className="muted">Bulunamadı.</p>}
      {faturalar?.map((f) => f.satirlar.map((s) => {
        const bagli = s.bagliKartlar.reduce((t, b) => t + Number(b.cikisBedeli ?? 0), 0);
        const kalan = Math.round((Number(s.tutarTl) - bagli) * 100) / 100;
        const kapali = tip === "alis" ? s.bagliKartlar.length > 0 : kalan <= 0;
        return (
          <label key={s.id} className={`demirbas__satir${kapali ? " is-kapali" : ""}`}>
            <input type="radio" name="satir" disabled={kapali} checked={secili === s.id} onChange={() => { setSecili(s.id); onSec({ id: s.id, tutarTl: s.tutarTl, kalan, tarih: f.tarih, ad: s.stokAdi }); }} />
            <span>{f.no} · {f.tarih} · {s.stokAdi} · <Para deger={s.tutarTl} />{tip === "satis" && bagli > 0 ? <> (kalan <Para deger={kalan} />)</> : null}{kapali ? " · bağlı" : ""}</span>
          </label>
        );
      }))}
    </div>
  );
}

function IlavePaneli({ onKapat, onKaydet }: { onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const [kaynak, setKaynak] = useState<"fatura" | "elle">("fatura");
  const [satirId, setSatirId] = useState("");
  const [f, setF] = useState({ tarih: bugunTR(), tutar: "", aciklama: "" });
  return (
    <HizliKayitPaneli baslik="İlave bedel" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet(kaynak === "fatura" ? { faturaSatirId: satirId, aciklama: f.aciklama } : { tarih: f.tarih, tutar: sayi(f.tutar), aciklama: f.aciklama }); }}>
        <p className="muted">Nakliye, montaj gibi edinme bedeline eklenen giderler. Yalnız ilk amortisman kesinleşmeden önce eklenir; faturadan eklenen satır muhasebede kartın hesabına yazılır.</p>
        <Select value={kaynak} onChange={(e) => setKaynak(e.target.value as "fatura" | "elle")} aria-label="Kaynak"><option value="fatura">Alış faturası satırından</option><option value="elle">Elle</option></Select>
        {kaynak === "fatura" ? <SatirSecici tip="alis" onSec={(s) => { setSatirId(s.id); setF({ ...f, aciklama: f.aciklama || s.ad }); }} /> : <>
          <Field label="Tarih"><Input type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} /></Field>
          <Field label="Tutar (TL)"><Input inputMode="decimal" value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} /></Field>
        </>}
        <Field label="Açıklama"><Input required value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /></Field>
        <Button type="submit" variant="primary" disabled={!f.aciklama.trim() || (kaynak === "fatura" ? !satirId : sayi(f.tutar) <= 0)}>Ekle</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function CikisPaneli({ kart, onKapat, onKaydet }: { kart: Kart; onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const [tur, setTur] = useState<CikisTuru>("satis");
  const [satir, setSatir] = useState<{ id: string; kalan: number; tarih: string } | null>(null);
  const [bedel, setBedel] = useState("");
  const [tarih, setTarih] = useState(bugunTR());
  const [gerekce, setGerekce] = useState("");
  const net = Number(kart.netDeger);
  const satisBedeli = tur === "satis" ? (bedel ? sayi(bedel) : satir?.kalan ?? 0) : 0;
  const fark = satisBedeli - net;
  return (
    <HizliKayitPaneli baslik="Elden çıkar" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet(tur === "satis" ? { tur, faturaSatirId: satir?.id, bedel: bedel ? sayi(bedel) : undefined, gerekce } : { tur, tarih, gerekce }); }}>
        <p className="muted">Çıkış yılında amortisman ayrılmaz. Önceki yıllar kesinleşmiş olmalıdır. Satış faturasının bağlı satırı muhasebede gelir yerine varlık hesabına yazılır; fark 679/689'a gider.</p>
        <Field label="Çıkış türü"><Select value={tur} onChange={(e) => setTur(e.target.value as CikisTuru)}>{Object.entries(CIKIS_TURLERI).map(([k2, ad]) => <option key={k2} value={k2}>{ad}</option>)}</Select></Field>
        {tur === "satis" ? <>
          <SatirSecici tip="satis" onSec={(s) => setSatir(s)} />
          {satir && <Field label={`Bu karta düşen satış bedeli (TL, boşsa satırın kalanı ${satir.kalan.toLocaleString("tr-TR")})`}><Input inputMode="decimal" value={bedel} onChange={(e) => setBedel(e.target.value)} /></Field>}
        </> : <Field label="Çıkış tarihi"><Input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} /></Field>}
        <Field label="Gerekçe"><Input required value={gerekce} onChange={(e) => setGerekce(e.target.value)} /></Field>
        <p>Net defter değeri <Para deger={net} /> · {tur === "satis" && !satir ? "satış satırını seçin" : <>{fark >= 0 ? "kâr" : "zarar"} <strong><Para deger={Math.abs(fark)} /></strong></>}</p>
        {tur !== "satis" && <Alert tone="warning">Bağış, hurda ya da kayıpta alışta indirilen KDV'nin düzeltilmesi gerekebilir; mali müşavirinize danışın.</Alert>}
        <Button type="submit" variant="danger" disabled={gerekce.trim().length < 3 || (tur === "satis" && !satir)}>Elden çıkar</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function GerekcePaneli({ baslik, metin, onKapat, onKaydet }: { baslik: string; metin: string; onKapat: () => void; onKaydet: (gerekce: string) => Promise<boolean> }) {
  const [gerekce, setGerekce] = useState("");
  return (
    <HizliKayitPaneli baslik={baslik} onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet(gerekce); }}>
        <p className="muted">{metin}</p>
        <Field label="Gerekçe"><Input required value={gerekce} onChange={(e) => setGerekce(e.target.value)} /></Field>
        <Button type="submit" variant="danger" disabled={gerekce.trim().length < 3}>{baslik}</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function GecisPaneli({ kart, onKapat, onKaydet }: { kart: Kart; onKapat: () => void; onKaydet: (yil: number) => Promise<boolean> }) {
  const ilkPlan = kart.plan.find((p) => p.durum === "plan")?.yil ?? Number(bugunTR().slice(0, 4));
  const [yil, setYil] = useState(String(ilkPlan));
  return (
    <HizliKayitPaneli baslik="Normal yönteme geçiş" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet(Number(yil)); }}>
        <p className="muted">Azalan bakiyelerden normale bir kez geçilir; geçiş yılından itibaren kalan değer kalan yıllara eşit bölünür (DMR-04).</p>
        <Field label="Geçiş yılı"><Input type="number" min={ilkPlan} value={yil} onChange={(e) => setYil(e.target.value)} /></Field>
        <Button type="submit" variant="primary">Geç</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function DuzenlePaneli({ kart, onKapat, onKaydet }: { kart: Kart; onKapat: () => void; onKaydet: (g: object) => Promise<boolean> }) {
  const kilitli = kart.kesinYilVar || kart.durum === "elden_cikti";
  const [f, setF] = useState({
    kod: kart.kod, ad: kart.ad, sinif: kart.sinif, faydaliOmur: String(kart.faydaliOmur), seriNo: kart.seriNo ?? "", konum: kart.konum ?? "", aciklama: kart.aciklama ?? "",
    hesapKodu: kart.hesapKodu ?? "", giderHesapKodu: kart.giderHesapKodu ?? "", edinmeTarihi: kart.edinmeTarihi, edinmeBedeli: kart.edinmeBedeli,
    acilisBirikmis: kart.acilisBirikmis, acilisSonYil: String(kart.acilisSonYil ?? ""),
  });
  function govde() {
    if (kart.durum === "elden_cikti") return { ad: f.ad, aciklama: f.aciklama || null };
    const g: Record<string, unknown> = { kod: f.kod, ad: f.ad, sinif: f.sinif, seriNo: f.seriNo || null, konum: f.konum || null, aciklama: f.aciklama || null, hesapKodu: f.hesapKodu || null, giderHesapKodu: f.giderHesapKodu || null };
    if (!kilitli) {
      g.faydaliOmur = Number(f.faydaliOmur);
      if (!kart.girisFaturasi) { g.edinmeTarihi = f.edinmeTarihi; g.edinmeBedeli = sayi(f.edinmeBedeli); }
      if (kart.acilis) { g.acilisBirikmis = sayi(f.acilisBirikmis); g.acilisSonYil = f.acilisSonYil ? Number(f.acilisSonYil) : null; }
    }
    return g;
  }
  return (
    <HizliKayitPaneli baslik="Kartı düzenle" onKapat={onKapat}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onKaydet(govde()); }}>
        {kilitli && <p className="muted">{kart.durum === "elden_cikti" ? "Elden çıkmış kartta yalnız ad ve açıklama değişir." : "Kesin amortismanı olan kartta bedel, tarih, ömür ve yöntem değişmez (DMR-04)."}</p>}
        <Field label="Ad"><Input required value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} /></Field>
        {kart.durum === "kullanimda" && <>
          <Field label="Kod"><Input required value={f.kod} onChange={(e) => setF({ ...f, kod: e.target.value })} /></Field>
          <Field label="Sınıf"><Select value={f.sinif} onChange={(e) => setF({ ...f, sinif: e.target.value as Sinif })}>{Object.entries(SINIFLAR).map(([k2, ad]) => <option key={k2} value={k2}>{ad}</option>)}</Select></Field>
          <Field label="Faydalı ömür"><Input type="number" disabled={kilitli} value={f.faydaliOmur} onChange={(e) => setF({ ...f, faydaliOmur: e.target.value })} /></Field>
          {!kart.girisFaturasi && <>
            <Field label="Edinme tarihi"><Input type="date" disabled={kilitli} value={f.edinmeTarihi} onChange={(e) => setF({ ...f, edinmeTarihi: e.target.value })} /></Field>
            <Field label="Bedel (TL)"><Input inputMode="decimal" disabled={kilitli} value={f.edinmeBedeli} onChange={(e) => setF({ ...f, edinmeBedeli: e.target.value })} /></Field>
          </>}
          {kart.acilis && <>
            <Field label="Açılış birikmişi (TL)"><Input inputMode="decimal" disabled={kilitli} value={f.acilisBirikmis} onChange={(e) => setF({ ...f, acilisBirikmis: e.target.value })} /></Field>
            <Field label="Birikmişin son yılı"><Input type="number" disabled={kilitli} value={f.acilisSonYil} onChange={(e) => setF({ ...f, acilisSonYil: e.target.value })} /></Field>
          </>}
          <Field label="Seri no / plaka"><Input value={f.seriNo} onChange={(e) => setF({ ...f, seriNo: e.target.value })} /></Field>
          <Field label="Konum"><Input value={f.konum} onChange={(e) => setF({ ...f, konum: e.target.value })} /></Field>
          <Field label="Varlık hesabı"><Input value={f.hesapKodu} onChange={(e) => setF({ ...f, hesapKodu: e.target.value })} placeholder="boşsa sınıfın hesabı" /></Field>
          <Field label="Amortisman gider hesabı"><Input value={f.giderHesapKodu} onChange={(e) => setF({ ...f, giderHesapKodu: e.target.value })} placeholder="boşsa 770" /></Field>
        </>}
        <Field label="Açıklama"><Input value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /></Field>
        <Button type="submit" variant="primary">Kaydet</Button>
      </form>
    </HizliKayitPaneli>
  );
}

function DosyaPaneli({ kartId, baslik, onKapat }: { kartId: string; baslik: string; onKapat: () => void }) {
  const [ekler, setEkler] = useState<KayitliEk[]>([]);
  const [dosyalar, setDosyalar] = useState<File[]>([]);
  const [hata, setHata] = useState("");
  const [islemde, setIslemde] = useState(false);
  const yenile = useCallback(async () => { try { setEkler(await api<KayitliEk[]>(`/ekler?sahipTur=demirbas&sahipId=${kartId}`)); } catch (e) { setHata(e instanceof Error ? e.message : "Ekler yüklenemedi"); } }, [kartId]);
  useEffect(() => { void yenile(); }, [yenile]);
  async function ekle() { setIslemde(true); setHata(""); try { await belgeDosyalariniYukle("demirbas", kartId, dosyalar); setDosyalar([]); await yenile(); } catch (e) { setHata(e instanceof Error ? e.message : "Dosyalar yüklenemedi"); } finally { setIslemde(false); } }
  async function sil(ek: KayitliEk) { if (!confirm(`${ek.dosyaAdi} silinsin mi?`)) return; try { await api(`/ekler/${ek.id}`, { method: "DELETE" }); await yenile(); } catch (e) { setHata(e instanceof Error ? e.message : "Dosya silinemedi"); } }
  return (
    <HizliKayitPaneli baslik={`Dosyalar · ${baslik}`} onKapat={onKapat}>
      {hata && <Alert tone="error">{hata}</Alert>}
      <p className="muted">Fatura, garanti belgesi, ruhsat, fotoğraf.</p>
      <BelgeDosyalari dosyalar={dosyalar} onChange={setDosyalar} />
      <Button variant="primary" disabled={!dosyalar.length || islemde} onClick={() => void ekle()}>{islemde ? "Yükleniyor…" : "Seçilen dosyaları yükle"}</Button>
      <div className="document-attachments__saved"><h4>Kayıtlı dosyalar</h4>{ekler.length === 0 ? <p className="muted">Henüz dosya eklenmemiş.</p> : ekler.map((ek) => <KayitliEkSatiri ek={ek} key={ek.id} onSil={(s) => void sil(s)} />)}</div>
    </HizliKayitPaneli>
  );
}
