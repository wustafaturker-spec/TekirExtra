"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api, ApiHata } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Select, TableWrap } from "@/components/ui";
import { odemeSozuListesiniDogrula, sozFaturalariniDogrula, sozGunuGecerli, sozParaBicimi, sozTutari, turkiyeGunu, type OdemeSozu, type OdemeSozuListesi, type SozDurumu, type SozFaturasi } from "@/lib/odeme-sozu";

const durumlar: Record<SozDurumu, string> = { aktif: "Aktif", kismen_gerceklesti: "Kısmen gerçekleşti", gerceklesti: "Gerçekleşti", gecikti: "Gecikti", iptal: "İptal edildi", revize: "Revize edildi", kaynak_gecersiz: "Fatura geçersiz" };
const gun = (v: string) => v.split("-").reverse().join(".");
type Islem = { tur: "yeni" } | { tur: "revize" | "iptal"; soz: OdemeSozu };

export function OdemeSozleri({ cariId, rol }: { cariId: string; rol: string | null }) {
  const [veri, setVeri] = useState<OdemeSozuListesi | null>(null), [hata, setHata] = useState(""), [bilgi, setBilgi] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true), [yenile, setYenile] = useState(0);
  const [islem, setIslem] = useState<Islem | null>(null), [kaydediliyor, setKaydediliyor] = useState(false);
  const okur = ["yonetici", "muhasebe", "mali_musavir", "salt_okunur"].includes(rol ?? "");
  useEffect(() => {
    let etkin = true; setVeri(null); setHata(""); setYukleniyor(true);
    if (!okur) { setYukleniyor(false); return; }
    void api<unknown>(`/cari/odeme-sozleri?${new URLSearchParams({ cariId })}`)
      .then((r) => odemeSozuListesiniDogrula(r, cariId))
      .then((r) => { if (etkin) setVeri(r); })
      .catch((e) => { if (etkin) setHata(e instanceof Error ? e.message : "Ödeme sözleri alınamadı."); })
      .finally(() => { if (etkin) setYukleniyor(false); });
    return () => { etkin = false; };
  }, [cariId, okur, yenile]);
  if (!okur) return null;
  const yazabilir = Boolean(veri && veri.kullanimModu !== "salt_okunur" && ["yonetici", "muhasebe"].includes(rol ?? ""));
  return <section aria-label="Ödeme sözleri" className="stack">
    <div className="between"><h2>Ödeme sözleri</h2><Button disabled={yukleniyor || kaydediliyor} onClick={() => setYenile((n) => n + 1)}>Sözleri yenile</Button></div>
    <p className="muted">Her söz bir satış faturasına bağlıdır. Söz kaydı nakit hareketi veya yeni alacak oluşturmaz.</p>
    <Alert tone="error">{hata}</Alert><Alert tone="success">{bilgi}</Alert>
    {yukleniyor && <p role="status">Ödeme sözleri yükleniyor…</p>}
    {veri && <>
      <p>Şirket modu: <strong>{{ salt_okunur: "Salt okunur", pilot: "Pilot", acik: "Açık" }[veri.kullanimModu]}</strong> · Güncellik: {new Date(veri.alindigiZaman).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p>
      <Alert tone="warning">{veri.uyari}</Alert>
      {!yazabilir && <p className="muted">Şirket modu veya rolünüz nedeniyle bu görünüm salt okunur.</p>}
      {yazabilir && <div><Button variant="primary" disabled={Boolean(islem) || kaydediliyor} onClick={() => { setBilgi(""); setIslem({ tur: "yeni" }); }}>Yeni ödeme sözü</Button></div>}
      {veri.sozler.length === 0 ? <p>Henüz ödeme sözü yok.</p> : <TableWrap>
        <caption>Ödeme sözü geçmişi</caption>
        <thead><tr><th>Fatura ve söz günü</th><th>Durum</th><th className="num">Söz tutarı</th><th className="num">Gerçekleşen</th><th className="num">Sözden kalan</th><th>Açıklama ve işlem</th></tr></thead>
        <tbody>{[...veri.sozler].reverse().map((s) => {
          const aktif = s.kayitDurumu === "aktif", durum = s.gerceklesme.durum;
          return <tr key={s.id}>
            <td><a href={`/panel/fatura?fatura=${s.faturaId}`}>{s.faturaNo ?? "Numarasız fatura"}</a><div>{gun(s.sozTarihi)}</div><small className="muted">Veriliş: {new Date(s.verildigiZaman).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</small></td>
            <td><Badge variant={durum === "gerceklesti" ? "success" : durum === "gecikti" || durum === "kaynak_gecersiz" ? "warning" : "neutral"}>{durumlar[durum]}</Badge>{s.oncekiSozId && <p className="muted">Önceki sözün revizyonu</p>}</td>
            <td className="num">{sozParaBicimi(s.tutar, s.dovizCinsi)}</td>
            <td className="num">{aktif && durum !== "kaynak_gecersiz" ? sozParaBicimi(s.gerceklesme.gerceklesen, s.dovizCinsi) : "—"}</td>
            <td className="num">{aktif && durum !== "kaynak_gecersiz" ? sozParaBicimi(s.gerceklesme.kalan, s.dovizCinsi) : "—"}</td>
            <td><p>{s.aciklama}</p>{s.sonlandirmaNedeni && <p>Gerekçe: {s.sonlandirmaNedeni}</p>}{durum === "kaynak_gecersiz" && <p>Hedef fatura kesin değil; gerçekleşme izlenmiyor.</p>}
              {yazabilir && aktif && <div className="row-tight"><Button size="sm" disabled={Boolean(islem)} onClick={() => setIslem({ tur: "revize", soz: s })}>Revize et</Button><Button size="sm" disabled={Boolean(islem)} onClick={() => setIslem({ tur: "iptal", soz: s })}>Sözü iptal et</Button></div>}
            </td>
          </tr>;
        })}</tbody>
      </TableWrap>}
      <p className="muted">İptal ve revize sözler geçmişte korunur. Bu satırlardaki söz tutarı tahsil edilecek yeni bakiye değildir.</p>
    </>}
    {islem && <OdemeSozuFormu key={islem.tur === "yeni" ? "yeni" : `${islem.tur}:${islem.soz.id}`} cariId={cariId} islem={islem} yazabilir={yazabilir} aktifHedefler={veri?.sozler.filter((s) => s.kayitDurumu === "aktif").map((s) => s.faturaId) ?? []}
      onMesgul={setKaydediliyor} onKapat={() => setIslem(null)} onKaydedildi={() => { setIslem(null); setBilgi("Ödeme sözü kaydedildi. Güncel gerçekleşme bilgisi yeniden okunuyor."); setYenile((n) => n + 1); }} />}
  </section>;
}

function OdemeSozuFormu({ cariId, islem, yazabilir, aktifHedefler, onMesgul, onKapat, onKaydedildi }: {
  cariId: string; islem: Islem; yazabilir: boolean; aktifHedefler: string[];
  onMesgul: (v: boolean) => void; onKapat: () => void; onKaydedildi: () => void;
}) {
  const s = islem.tur === "yeni" ? null : islem.soz;
  const formId = useId();
  const [faturalar, setFaturalar] = useState<SozFaturasi[]>([]), [imlec, setImlec] = useState<string | null>(null), [faturaId, setFaturaId] = useState("");
  const [faturaYukleniyor, setFaturaYukleniyor] = useState(islem.tur === "yeni"), [faturaHata, setFaturaHata] = useState("");
  const [tutar, setTutar] = useState(s?.tutar ?? ""), [sozTarihi, setSozTarihi] = useState(s?.sozTarihi ?? turkiyeGunu());
  const [aciklama, setAciklama] = useState(s?.aciklama ?? ""), [gerekce, setGerekce] = useState("");
  const [hata, setHata] = useState(""), [kaydediliyor, setKaydediliyor] = useState(false), [cakisma, setCakisma] = useState(false);
  const [sayfaSayisi, setSayfaSayisi] = useState(0);
  const etkin = useRef(false), mesgul = useRef(false), faturaIstek = useRef(0), sayfaImlecleri = useRef(new Set<string>());
  const tekrar = useRef<{ icerik: string; anahtar: string } | null>(null);
  useEffect(() => { etkin.current = true; return () => { etkin.current = false; faturaIstek.current++; }; }, []);
  async function faturayiYukle(sonraki: string | null = null) {
    const istek = ++faturaIstek.current; setFaturaYukleniyor(true); setFaturaHata("");
    try {
      const r = sozFaturalariniDogrula(await api<unknown>(`/fatura?${new URLSearchParams({ cariId, tip: "satis", durum: "kesin", adet: "50", ...(sonraki ? { imlec: sonraki } : {}) })}`), cariId);
      if (!etkin.current || istek !== faturaIstek.current) return;
      if (r.sonrakiImlec && (r.sonrakiImlec === sonraki || sayfaImlecleri.current.has(r.sonrakiImlec))) throw new Error("Fatura sayfalaması doğrulanamadı; yeniden deneyin.");
      if (!sonraki) sayfaImlecleri.current.clear();
      if (r.sonrakiImlec) sayfaImlecleri.current.add(r.sonrakiImlec);
      setFaturalar((eski) => sonraki ? [...new Map([...eski, ...r.faturalar].map((f) => [f.id, f])).values()] : r.faturalar); setImlec(r.sonrakiImlec);
      setSayfaSayisi((n) => sonraki ? n + 1 : 1);
    } catch (e) { if (etkin.current && istek === faturaIstek.current) setFaturaHata(e instanceof Error ? e.message : "Faturalar alınamadı."); }
    finally { if (etkin.current && istek === faturaIstek.current) setFaturaYukleniyor(false); }
  }
  useEffect(() => { if (islem.tur === "yeni") void faturayiYukle(); }, []); // Form cari kimliğiyle yeniden kurulur.
  const secenekler = faturalar.filter((f) => !aktifHedefler.includes(f.id));
  const hedef = secenekler.find((f) => f.id === faturaId);
  const durdur = kaydediliyor || !yazabilir || cakisma;
  async function kaydet(e: React.FormEvent) {
    e.preventDefault(); if (mesgul.current || durdur) return;
    setHata("");
    try {
      let govde: Record<string, unknown>;
      if (islem.tur === "iptal") {
        if (gerekce.trim().length < 2) throw new Error("İptal gerekçesi en az iki karakter olmalı.");
        govde = { beklenenSurum: s!.surum, gerekce: gerekce.trim() };
      } else {
        if (islem.tur === "yeni" && (!hedef || faturaHata || faturaYukleniyor)) throw new Error("Kalanı olan bir satış faturası seçin.");
        if (!sozGunuGecerli(sozTarihi) || sozTarihi < turkiyeGunu()) throw new Error("Söz tarihi bugünden önce olamaz.");
        if (aciklama.trim().length < 2) throw new Error("Söz açıklaması en az iki karakter olmalı.");
        if (islem.tur === "revize" && gerekce.trim().length < 2) throw new Error("Revizyon gerekçesi en az iki karakter olmalı.");
        const ortak = { tutar: sozTutari(tutar, hedef?.kalan), sozTarihi, aciklama: aciklama.trim() };
        govde = islem.tur === "yeni" ? { ...ortak, cariId, faturaId: hedef!.id, dovizCinsi: hedef!.dovizCinsi } : { ...ortak, beklenenSurum: s!.surum, gerekce: gerekce.trim() };
        const icerik = JSON.stringify(govde);
        if (tekrar.current?.icerik !== icerik) tekrar.current = { icerik, anahtar: crypto.randomUUID() };
        govde.istekAnahtari = tekrar.current.anahtar;
      }
      mesgul.current = true; setKaydediliyor(true); onMesgul(true);
      const yol = islem.tur === "yeni" ? "/cari/odeme-sozleri" : `/cari/odeme-sozleri/${s!.id}/${islem.tur}`;
      await api<unknown>(yol, { method: "POST", body: JSON.stringify(govde), ...(tekrar.current ? { headers: { "Idempotency-Key": tekrar.current.anahtar } } : {}) });
      if (etkin.current) onKaydedildi();
    } catch (e) {
      if (!etkin.current) return;
      if (e instanceof ApiHata && [403, 409].includes(e.durum)) setCakisma(true);
      setHata(e instanceof Error ? e.message : "Ödeme sözü kaydedilemedi.");
    } finally {
      mesgul.current = false;
      if (etkin.current) { setKaydediliyor(false); onMesgul(false); }
    }
  }
  return <Card><section aria-label="Ödeme sözü işlemi" className="stack">
    <h3>{islem.tur === "yeni" ? "Yeni ödeme sözü" : islem.tur === "revize" ? "Ödeme sözünü revize et" : "Ödeme sözünü iptal et"}</h3>
    {s && <p>{s.faturaNo ?? "Numarasız fatura"} · {sozParaBicimi(s.tutar, s.dovizCinsi)} · Söz günü: {gun(s.sozTarihi)}</p>}
    {islem.tur === "revize" && <p>Eski söz geçmişte korunur. Yeni veriliş zamanından önceki ödemeler yeni sözün gerçekleşmesi sayılmaz.</p>}
    {islem.tur === "iptal" && <p>İptal, bu sözün takibini sonlandırır. Fatura ve tahsilat kayıtları korunur.</p>}
    <Alert tone="error">{hata}</Alert>
    {cakisma && <Alert tone="warning">İşlem kaydı veya erişim değişmiş olabilir. Taslağınız korunuyor. Sözleri yenileyip güncel kaydı inceleyin; bu işlemi kapatıp yeniden açın.</Alert>}
    <form className="stack" onSubmit={(e) => void kaydet(e)}>
      {islem.tur === "yeni" && <>
        <Alert tone="error">{faturaHata}</Alert>
        <Field label="Satış faturası" htmlFor={`${formId}-fatura`}><Select id={`${formId}-fatura`} required value={faturaId} disabled={durdur || faturaYukleniyor} onChange={(e) => setFaturaId(e.target.value)}><option value="">Fatura seçin</option>{secenekler.map((f) => <option key={f.id} value={f.id}>{f.no ?? "Numarasız fatura"} · kalan {sozParaBicimi(f.kalan, f.dovizCinsi)}</option>)}</Select></Field>
        {faturaYukleniyor && <p role="status">Satış faturaları yükleniyor…</p>}
        {!faturaYukleniyor && !faturaHata && secenekler.length === 0 && <p>Yüklenen sayfalarda kalan borcu bulunan ve aktif sözü olmayan satış faturası yok.</p>}
        {faturaHata && <Button type="button" disabled={durdur || faturaYukleniyor} onClick={() => void faturayiYukle(imlec)}>Faturaları yeniden dene</Button>}
        {imlec && !faturaHata && sayfaSayisi < 20 && <Button type="button" disabled={durdur || faturaYukleniyor} onClick={() => void faturayiYukle(imlec)}>Daha fazla fatura</Button>}
        {imlec && sayfaSayisi >= 20 && <Alert tone="warning">Seçim ilk 1.000 faturayla sınırlı; daha eski faturalar bu listede yer almıyor.</Alert>}
        {hedef && <p>Fatura dövizi: {hedef.dovizCinsi} · Görüntülenen kalan: {sozParaBicimi(hedef.kalan, hedef.dovizCinsi)}</p>}
      </>}
      {islem.tur !== "iptal" && <>
        <Field label="Söz tutarı" htmlFor={`${formId}-tutar`}><Input id={`${formId}-tutar`} required inputMode="decimal" maxLength={16} placeholder="Örnek: 1250,50" value={tutar} disabled={durdur} onChange={(e) => setTutar(e.target.value)} /></Field>
        <p className="muted">Tutarı fatura dövizinde, binlik ayırıcı kullanmadan yazın. Güncel kalan kaydederken yeniden kontrol edilir.</p>
        <Field label="Söz tarihi" htmlFor={`${formId}-tarih`}><Input id={`${formId}-tarih`} required type="date" min={turkiyeGunu()} value={sozTarihi} disabled={durdur} onChange={(e) => setSozTarihi(e.target.value)} /></Field>
        <Field label="Söz açıklaması" htmlFor={`${formId}-aciklama`}><textarea id={`${formId}-aciklama`} className="textarea" required minLength={2} maxLength={2000} value={aciklama} disabled={durdur} onChange={(e) => setAciklama(e.target.value)} /></Field>
      </>}
      {islem.tur !== "yeni" && <Field label={islem.tur === "revize" ? "Revizyon gerekçesi" : "İptal gerekçesi"} htmlFor={`${formId}-gerekce`}><textarea id={`${formId}-gerekce`} className="textarea" required minLength={2} maxLength={2000} value={gerekce} disabled={durdur} onChange={(e) => setGerekce(e.target.value)} /></Field>}
      <div className="row-tight"><Button type="submit" variant={islem.tur === "iptal" ? "danger" : "primary"} disabled={durdur || (islem.tur === "yeni" && (!hedef || faturaYukleniyor || Boolean(faturaHata)))}>{kaydediliyor ? "Kaydediliyor…" : islem.tur === "yeni" ? "Sözü kaydet" : islem.tur === "revize" ? "Revizyonu kaydet" : "İptali onayla"}</Button><Button type="button" disabled={kaydediliyor} onClick={onKapat}>Vazgeç</Button></div>
    </form>
  </section></Card>;
}
