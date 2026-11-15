"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";

/* ─── API sözleşmesi (apps/api/src/fiyat-endeks/endeks-artis.*) ─────────── */
type Olcu = "yillik" | "oniki_ay_ortalama";
interface Kaynak { tur: "kira" | "tekrarlayan_fatura"; id: string; ad: string; bedel: string; dovizCinsi: string; aktif: boolean; adres: string }
interface Oneri {
  id: string; yil: number; seriKodu: string; olcu: Olcu; sonAy: string; hesaplananOran: string; uygulananOran: string;
  eskiBedel: string; yeniBedel: string; durum: "bekliyor" | "onaylandi" | "reddedildi"; kararAt: string | null; olusturuldu: string;
  hesap: { kullanilan?: { ay: string; deger: string }[]; ortalamalar?: { son12: string; onceki12: string }; kirpildi?: boolean; seriAdi?: string; eskiCarpan?: string; yeniCarpan?: string };
  kaynak?: Kaynak | null;
}
interface Kural {
  id: string; kaynak: Kaynak | null; seriKodu: string; olcu: Olcu; artisAyi: number; ustSinir: string | null; aktif: boolean;
  onizleme: { yil: number; sonAy: string; oran?: string; yeniBedel?: string | null; neden?: string };
  oneriler: Oneri[];
}
interface KurallarYaniti {
  kurallar: Kural[];
  seriler: { kod: string; ad: string; sonDonem: string | null }[];
  kaynaklar: { kira: { id: string; ad: string; bedel: string; dovizCinsi: string }[]; tekrarlayan: { id: string; ad: string; bedel: string; dovizCinsi: string; uygun: boolean }[] };
}

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const OLCU_ADI: Record<Olcu, string> = { yillik: "Yıllık değişim", oniki_ay_ortalama: "On iki aylık ortalamalara göre değişim" };
const para = (s: string | null | undefined, doviz = "TRY") => (s == null ? "—" : `${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doviz === "TRY" ? "TL" : doviz}`);
const yuzde = (s: string | null | undefined) => (s == null ? "—" : `%${Number(s).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const ayAdi = (ym: string) => { const [y, a] = ym.split("-").map(Number); return `${AYLAR[a - 1]} ${y}`; };
const kaynakAdi = (k: Kaynak | null | undefined) => (k ? `${k.tur === "kira" ? "Kira" : "Tekrarlayan fatura"} · ${k.ad}` : "Silinmiş kayıt");

/**
 * END-17: kira sözleşmesi ve tekrarlayan faturada endeksli artış. Kural kayıt
 * başına tektir; artış ayında öneri üretilir ve bildirilir. Bedel siz
 * onaylamadan değişmez; onaylanınca kira matrahı ya da tekrarlayan planın
 * fiyat çarpanı güncellenir.
 */
export default function EndeksliArtislar() {
  const [veri, setVeri] = useState<KurallarYaniti | null>(null);
  const [oneriler, setOneriler] = useState<Oneri[]>([]);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState(false);
  const [onayBekleyen, setOnayBekleyen] = useState<{ id: string; karar: "onayla" | "reddet" } | null>(null);

  const yukle = useCallback(async () => {
    try {
      const [k, o] = await Promise.all([api<KurallarYaniti>("/fiyat-endeks/artislar/kurallar"), api<Oneri[]>("/fiyat-endeks/artislar/oneriler")]);
      setVeri(k); setOneriler(o); setHata("");
    } catch (e) { setHata(e instanceof Error ? e.message : "Endeksli artışlar yüklenemedi."); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  async function karar(id: string, k: "onayla" | "reddet") {
    setIslem(true); setHata(""); setBasari("");
    try {
      await api(`/fiyat-endeks/artislar/oneriler/${id}/${k}`, { method: "POST" });
      setBasari(k === "onayla" ? "Öneri onaylandı; kayıt yeni bedelle güncellendi. Sonraki tahakkuk ve faturalar yeni bedeli kullanır." : "Öneri reddedildi; bedel değişmedi.");
      setOnayBekleyen(null);
      await yukle();
    } catch (e) { setHata(e instanceof Error ? e.message : "Karar kaydedilemedi."); }
    finally { setIslem(false); }
  }

  const bekleyen = oneriler.filter((o) => o.durum === "bekliyor");
  const gecmis = oneriler.filter((o) => o.durum !== "bekliyor");

  return <>
    <PageHeader title="Endeksli artışlar" subtitle="Kira sözleşmesi ve tekrarlayan faturada TÜFE/Yİ-ÜFE'ye bağlı yıllık artış. Artış ayında öneri gelir; siz onaylamadan bedel değişmez."
      actions={<><ButtonLabel as="a" href="/panel/masraflar/kiralar">Kira sözleşmeleri</ButtonLabel><ButtonLabel as="a" href="/panel/fatura/tekrarlayan">Tekrarlayan faturalar</ButtonLabel></>} />
    <Alert tone="error">{hata}</Alert>
    <Alert tone="success">{basari}</Alert>

    <Card title={`Onay bekleyen öneriler (${bekleyen.length})`} pad={false}>
      {bekleyen.length === 0 ? <p className="muted" style={{ padding: "1rem" }}>Onay bekleyen öneri yok. Öneriler kuralın artış ayında, endeks açıklanınca (genelde ayın 3'ü) oluşur.</p> : <TableWrap className="endeks-tablo">
        <thead><tr><th>Kayıt</th><th>Hesap</th><th className="num">Oran</th><th className="num">Bugünkü bedel</th><th className="num">Önerilen bedel</th><th>Karar</th></tr></thead>
        <tbody>{bekleyen.map((o) => (
          <tr key={o.id}>
            <td>{kaynakAdi(o.kaynak)}<div className="muted">{o.yil} artışı</div></td>
            <td>{o.hesap.seriAdi ?? o.seriKodu} · {OLCU_ADI[o.olcu]}<div className="muted">Son ay {ayAdi(o.sonAy)}</div><HesapAyrintisi o={o} /></td>
            <td className="num">{yuzde(o.uygulananOran)}{o.hesaplananOran !== o.uygulananOran && <div className="muted">hesaplanan {yuzde(o.hesaplananOran)}</div>}</td>
            <td className="num money">{para(o.eskiBedel, o.kaynak?.dovizCinsi)}</td>
            <td className="num money"><strong>{para(o.yeniBedel, o.kaynak?.dovizCinsi)}</strong></td>
            <td>{onayBekleyen?.id === o.id ? <div className="stack" style={{ gap: ".35rem" }}>
              <span>{onayBekleyen.karar === "onayla" ? `${o.kaynak?.tur === "kira" ? "Kira matrahı" : "Plan fiyatları"} ${para(o.yeniBedel, o.kaynak?.dovizCinsi)} olacak.` : "Bedel değişmeyecek."} Emin misiniz?</span>
              <div className="row" style={{ gap: ".35rem" }}><Button size="sm" variant="primary" disabled={islem} onClick={() => void karar(o.id, onayBekleyen.karar)}>Evet</Button><Button size="sm" disabled={islem} onClick={() => setOnayBekleyen(null)}>Vazgeç</Button></div>
            </div> : <div className="row" style={{ gap: ".35rem" }}>
              <Button size="sm" variant="primary" disabled={islem} onClick={() => setOnayBekleyen({ id: o.id, karar: "onayla" })}>Onayla</Button>
              <Button size="sm" disabled={islem} onClick={() => setOnayBekleyen({ id: o.id, karar: "reddet" })}>Reddet</Button>
            </div>}</td>
          </tr>
        ))}</tbody>
      </TableWrap>}
    </Card>

    {veri && <KuralFormu veri={veri} islem={islem} setIslem={setIslem} onKaydedildi={async (m) => { setBasari(m); await yukle(); }} onHata={setHata} />}

    {veri && <Card title="Kurallar" pad={false}>
      {veri.kurallar.length === 0 ? <p className="muted" style={{ padding: "1rem" }}>Henüz kural yok.</p> : <TableWrap className="endeks-tablo">
        <thead><tr><th>Kayıt</th><th>Endeks ve ölçü</th><th>Artış ayı</th><th className="num">Üst sınır</th><th>Bu yılın hesabı (önizleme)</th><th>Durum</th></tr></thead>
        <tbody>{veri.kurallar.map((k) => (
          <tr key={k.id}>
            <td>{kaynakAdi(k.kaynak)}<div className="muted">Bugünkü bedel {para(k.kaynak?.bedel, k.kaynak?.dovizCinsi)}</div></td>
            <td>{veri.seriler.find((s) => s.kod === k.seriKodu)?.ad ?? k.seriKodu}<div className="muted">{OLCU_ADI[k.olcu]}</div></td>
            <td>{AYLAR[k.artisAyi - 1]}</td>
            <td className="num">{k.ustSinir ? yuzde(k.ustSinir) : "Yok"}</td>
            <td>{k.onizleme.oran ? <>{yuzde(k.onizleme.oran)} → {para(k.onizleme.yeniBedel, k.kaynak?.dovizCinsi)}<div className="muted">{k.onizleme.yil}, son ay {ayAdi(k.onizleme.sonAy)}</div></> : <span className="muted">{k.onizleme.neden}</span>}</td>
            <td><Badge variant={k.aktif ? "success" : "neutral"}>{k.aktif ? "Etkin" : "Durduruldu"}</Badge></td>
          </tr>
        ))}</tbody>
      </TableWrap>}
    </Card>}

    {gecmis.length > 0 && <Card title="Geçmiş kararlar" pad={false}>
      <TableWrap className="endeks-tablo">
        <thead><tr><th>Kayıt</th><th>Yıl</th><th className="num">Oran</th><th className="num">Eski → yeni</th><th>Karar</th></tr></thead>
        <tbody>{gecmis.map((o) => (
          <tr key={o.id}><td>{kaynakAdi(o.kaynak)}</td><td>{o.yil}</td><td className="num">{yuzde(o.uygulananOran)}</td><td className="num money">{para(o.eskiBedel, o.kaynak?.dovizCinsi)} → {para(o.yeniBedel, o.kaynak?.dovizCinsi)}</td>
            <td><Badge variant={o.durum === "onaylandi" ? "success" : "neutral"}>{o.durum === "onaylandi" ? "Onaylandı" : "Reddedildi"}</Badge>{o.kararAt && <div className="muted">{new Date(o.kararAt).toLocaleString("tr-TR")}</div>}</td></tr>
        ))}</tbody>
      </TableWrap>
    </Card>}

    <details className="card card--pad">
      <summary className="card__title" style={{ cursor: "pointer" }}>Nasıl hesaplanır?</summary>
      <ul className="muted" style={{ paddingLeft: "1.1rem" }}>
        <li>Hesap, artış ayından önceki ayın endeksiyle yapılır (ör. Kasım artışında Ekim endeksi; TÜİK ayın 3'ünde açıklar).</li>
        <li>Yıllık değişim: son ay ÷ 12 ay önceki ay − 1. On iki aylık ortalamalara göre değişim: son 12 ayın ortalaması ÷ önceki 12 ayın ortalaması − 1.</li>
        <li>Üst sınır varsa oran onunla sınırlanır; oran eksiyse artış yapılmaz. Yeni bedel kuruşa yuvarlanır.</li>
        <li>Öneri artış ayında ve ertesi ayda üretilir; öneriden sonra bedel elle değiştirildiyse öneri uygulanmaz, reddedip yeni bedeli elle girin.</li>
        <li>Tekrarlayan faturada şablon değişmez; artış plan çarpanı olarak saklanır ve üretilen taslağın birim fiyatlarına uygulanır. Fiyatı güncel fiyat listesinden alan planlarda kullanılamaz (Fiyat Listeleri › endeks önerisi).</li>
      </ul>
    </details>
  </>;
}

function HesapAyrintisi({ o }: { o: Oneri }) {
  const k = o.hesap.kullanilan ?? [];
  if (!k.length) return null;
  return <details><summary className="muted" style={{ cursor: "pointer" }}>Kullanılan değerler</summary>
    <ul className="muted" style={{ paddingLeft: "1.1rem", margin: ".25rem 0" }}>
      {o.olcu === "yillik" ? k.map((x) => <li key={x.ay}>{ayAdi(x.ay.slice(0, 7))}: {Number(x.deger).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}</li>)
        : <><li>Son 12 ay ortalaması: {Number(o.hesap.ortalamalar?.son12).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}</li><li>Önceki 12 ay ortalaması: {Number(o.hesap.ortalamalar?.onceki12).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}</li><li>{k.length} ay ({ayAdi(k[0].ay.slice(0, 7))} – {ayAdi(k[k.length - 1].ay.slice(0, 7))})</li></>}
      {o.hesap.eskiCarpan && <li>Plan çarpanı {o.hesap.eskiCarpan} → {o.hesap.yeniCarpan}</li>}
    </ul>
  </details>;
}

function KuralFormu({ veri, islem, setIslem, onKaydedildi, onHata }: { veri: KurallarYaniti; islem: boolean; setIslem: (v: boolean) => void; onKaydedildi: (mesaj: string) => Promise<void>; onHata: (m: string) => void }) {
  const kimlik = useId();
  const [kaynak, setKaynak] = useState("");
  const [seri, setSeri] = useState(veri.seriler.find((s) => s.kod === "TUFE")?.kod ?? veri.seriler[0]?.kod ?? "");
  const [olcu, setOlcu] = useState<Olcu>("oniki_ay_ortalama");
  const [artisAyi, setArtisAyi] = useState(1);
  const [ustSinir, setUstSinir] = useState("");
  const [aktif, setAktif] = useState(true);

  // Seçilen kaydın mevcut kuralı varsa form onunla dolar.
  const sec = (deger: string) => {
    setKaynak(deger);
    const [tur, id] = deger.split(":");
    const k = veri.kurallar.find((x) => x.kaynak?.id === id && (tur === "kira" ? x.kaynak?.tur === "kira" : x.kaynak?.tur === "tekrarlayan_fatura"));
    if (k) { setSeri(k.seriKodu); setOlcu(k.olcu); setArtisAyi(k.artisAyi); setUstSinir(k.ustSinir ?? ""); setAktif(k.aktif); }
  };

  async function kaydet(e: FormEvent) {
    e.preventDefault();
    const [tur, id] = kaynak.split(":");
    setIslem(true); onHata("");
    try {
      await api("/fiyat-endeks/artislar/kurallar", { method: "PUT", body: JSON.stringify({ kaynakTur: tur, kaynakId: id, seriKodu: seri, olcu, artisAyi, ustSinir: ustSinir.trim() ? ustSinir.trim().replace(",", ".") : null, aktif }) });
      await onKaydedildi("Kural kaydedildi. Artış ayında öneri oluşur ve bildirim gelir.");
    } catch (e2) { onHata(e2 instanceof Error ? e2.message : "Kural kaydedilemedi."); }
    finally { setIslem(false); }
  }

  return <Card title="Kural ekle ya da değiştir">
    <form className="stack" onSubmit={kaydet}>
      <div className="form-grid">
        <Field label="Kayıt" htmlFor={`${kimlik}-kaynak`}>
          <Select id={`${kimlik}-kaynak`} value={kaynak} onChange={(e) => sec(e.target.value)} required>
            <option value="">— Seçin —</option>
            {veri.kaynaklar.kira.length > 0 && <optgroup label="Kira sözleşmeleri">{veri.kaynaklar.kira.map((k) => <option key={k.id} value={`kira:${k.id}`}>{k.ad} · {para(k.bedel, k.dovizCinsi)}</option>)}</optgroup>}
            {veri.kaynaklar.tekrarlayan.length > 0 && <optgroup label="Tekrarlayan faturalar">{veri.kaynaklar.tekrarlayan.map((t) => <option key={t.id} value={`tekrarlayan_fatura:${t.id}`} disabled={!t.uygun}>{t.ad} · {para(t.bedel, t.dovizCinsi)}{t.uygun ? "" : " (güncel fiyatlı plan, kullanılamaz)"}</option>)}</optgroup>}
          </Select>
        </Field>
        <Field label="Endeks" htmlFor={`${kimlik}-seri`}><Select id={`${kimlik}-seri`} value={seri} onChange={(e) => setSeri(e.target.value)}>{veri.seriler.map((s) => <option key={s.kod} value={s.kod}>{s.ad}{s.sonDonem ? ` (${s.sonDonem} açıklandı)` : ""}</option>)}</Select></Field>
        <Field label="Ölçü" htmlFor={`${kimlik}-olcu`}><Select id={`${kimlik}-olcu`} value={olcu} onChange={(e) => setOlcu(e.target.value as Olcu)}><option value="oniki_ay_ortalama">{OLCU_ADI.oniki_ay_ortalama}</option><option value="yillik">{OLCU_ADI.yillik}</option></Select></Field>
        <Field label="Artış ayı" htmlFor={`${kimlik}-ay`}><Select id={`${kimlik}-ay`} value={String(artisAyi)} onChange={(e) => setArtisAyi(Number(e.target.value))}>{AYLAR.map((a, i) => <option key={a} value={i + 1}>{a}</option>)}</Select></Field>
        <Field label="Üst sınır (%)" htmlFor={`${kimlik}-sinir`}><Input id={`${kimlik}-sinir`} inputMode="decimal" value={ustSinir} onChange={(e) => setUstSinir(e.target.value)} placeholder="Boş = sınırsız" maxLength={7} /></Field>
      </div>
      <label className="endeks-secim"><span><input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} /> Kural etkin</span></label>
      <div><Button type="submit" variant="primary" disabled={islem || !kaynak || !seri}>Kaydet</Button></div>
    </form>
  </Card>;
}
