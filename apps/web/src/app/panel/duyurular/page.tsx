"use client";
import { useCallback, useEffect, useState } from "react";
import { Archive, ArrowUpRight, CalendarDays, CheckCheck, Megaphone, RefreshCw } from "lucide-react";
import { DuyuruYukleniyor } from "@/components/duyuru-yukleniyor";
import { api } from "@/lib/api";
import { Alert, Button, Card, PageHeader } from "@/components/ui";
import { DuyuruZenginIcerik } from "@/components/duyuru-zengin-icerik";

interface Duyuru { id: string; baslik: string; icerik: string; butonMetni: string | null; butonUrl: string | null; gosterimYerleri?: ("merkez" | "ust_bant" | "popup")[]; surum: number; baslangic: string; bitis: string; okundu: boolean }
interface Liste { kayitlar: Duyuru[]; toplam: number; sayfa: number; sayfaBoyutu: number }
const tarih = (v: string) => new Date(v).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

function DuyuruKarti({ duyuru, gecmis, onYenile }: { duyuru: Duyuru; gecmis: boolean; onYenile: () => void }) {
  const [hata, setHata] = useState(""), [islem, setIslem] = useState(false);
  useEffect(() => {
    if (gecmis) return;
    // Kart ekrana gerçekten girdiğinde kaydedilir; liste isteği gösterim sayılmaz.
    const eleman = document.getElementById(`duyuru-baslik-${duyuru.id}`);
    if (!eleman) return;
    const gozlem = new IntersectionObserver((kayitlar) => {
      if (!kayitlar.some((k) => k.isIntersecting && k.intersectionRatio >= 0.5)) return;
      gozlem.disconnect();
      void api(`/duyurular/${duyuru.id}/olay`, { method: "POST", body: JSON.stringify({ tur: "gosterim" }) }).catch(() => undefined);
    }, { threshold: 0.5 });
    gozlem.observe(eleman); return () => gozlem.disconnect();
  }, [duyuru.id, gecmis]);
  async function olay(tur: "okudum" | "tiklama") {
    if (islem) return;
    setIslem(true); setHata("");
    try {
      await api(`/duyurular/${duyuru.id}/olay`, { method: "POST", body: JSON.stringify({ tur }) });
      if (tur === "tiklama" && duyuru.butonUrl) {
        // Sunucu tıklama anında yayın/erişim koşullarını yeniden doğrulamıştır.
        window.location.assign(duyuru.butonUrl);
      } else onYenile();
    } catch (e) { setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı."); onYenile(); }
    finally { setIslem(false); }
  }
  return <Card className={`duyuru-okuma-karti${duyuru.okundu ? " is-read" : ""}${gecmis ? " is-expired" : ""}`}><article id={`duyuru-${duyuru.id}`} aria-labelledby={`duyuru-baslik-${duyuru.id}`}>
    <div className="duyuru-kart-ust"><span className="duyuru-kategori">TekirExtra · Bilgilendirme</span>{duyuru.okundu ? <span className="duyuru-okundu"><CheckCheck size={15} aria-hidden="true" />Okundu</span> : <span className={`duyuru-rozet${gecmis ? " duyuru-rozet--arsiv" : ""}`}>{gecmis ? "Süresi bitti" : "Yeni"}</span>}</div>
    <h2 id={`duyuru-baslik-${duyuru.id}`}>{duyuru.baslik}</h2>
    <dl className="duyuru-okuma-tarihleri"><div><dt><CalendarDays size={14} aria-hidden="true" />Yayın başlangıcı (Türkiye)</dt><dd><time dateTime={duyuru.baslangic}>{tarih(duyuru.baslangic)}</time></dd></div><div><dt>{gecmis ? "Yayın sona erdi (Türkiye)" : "Geçerlilik sonu (Türkiye)"}</dt><dd><time dateTime={duyuru.bitis}>{tarih(duyuru.bitis)}</time></dd></div></dl>
    <DuyuruZenginIcerik icerik={duyuru.icerik} />
    <Alert tone="error">{hata}</Alert>
    {!gecmis && (!duyuru.okundu || (duyuru.butonMetni && duyuru.butonUrl)) && <div className="duyuru-kart-alt duyuru-okuma-islemleri">{!duyuru.okundu && <Button disabled={islem} onClick={() => void olay("okudum")}><CheckCheck size={16} aria-hidden="true" />Okudum</Button>}{duyuru.butonMetni && duyuru.butonUrl && <Button variant="primary" disabled={islem} onClick={() => void olay("tiklama")}>{duyuru.butonMetni}<ArrowUpRight size={16} aria-hidden="true" /></Button>}</div>}
  </article></Card>;
}
export default function TenantDuyuruMerkezi() {
  const [sayfa, setSayfa] = useState(1), [gecmis, setGecmis] = useState(false), [tekrar, setTekrar] = useState(0);
  const [sonuc, setSonuc] = useState<{ anahtar: string; veri: Liste | null; hata: string }>({ anahtar: "", veri: null, hata: "" });
  const [yenileniyor, setYenileniyor] = useState(false);
  const anahtar = `${gecmis}:${sayfa}`;
  const yenile = useCallback(() => setTekrar((v) => v+1), []);
  useEffect(() => {
    let kapandi = false;
    let aktif: AbortController | null = null;
    async function yukle() {
      setYenileniyor(true);
      aktif?.abort();
      const kontrol = new AbortController(); aktif = kontrol;
      const sure = setTimeout(() => kontrol.abort(), 10000);
      try {
        const veri = await api<Liste>(`/duyurular?sayfa=${sayfa}&gecmis=${gecmis}`, { signal: kontrol.signal });
        if (!kapandi && aktif === kontrol && !kontrol.signal.aborted) setSonuc({ anahtar, veri, hata: "" });
      } catch (e) {
        // Süresi bitmiş/durdurulmuş içeriği hata sırasında ekranda tutmayız.
        if (!kapandi && aktif === kontrol) setSonuc({ anahtar, veri: null, hata: kontrol.signal.aborted ? "Duyurular güncellenemedi. Tekrar deneyin." : e instanceof Error ? e.message : "Duyurular yüklenemedi." });
      } finally { clearTimeout(sure); if (!kapandi && aktif === kontrol) setYenileniyor(false); }
    }
    void yukle(); const zamanlayici = setInterval(() => void yukle(), 15000);
    const gorunurluk = () => { if (document.visibilityState === "visible") { setSonuc({ anahtar: "", veri: null, hata: "" }); void yukle(); } };
    document.addEventListener("visibilitychange", gorunurluk);
    return () => { kapandi = true; aktif?.abort(); clearInterval(zamanlayici); document.removeEventListener("visibilitychange", gorunurluk); };
  }, [sayfa, gecmis, tekrar, anahtar]);
  const guncel = sonuc.anahtar === anahtar;
  const veri = guncel ? sonuc.veri : null, hata = guncel ? sonuc.hata : "";
  const kayitlar = veri?.kayitlar.filter((d) => (gecmis || new Date(d.bitis).getTime() > Date.now()) && (d.gosterimYerleri ?? ["merkez"]).includes("merkez")) ?? [];
  function gorunumuSec(gecmisSecildi: boolean) { setGecmis(gecmisSecildi); setSayfa(1); }
  return <div className="stack duyuru-sayfasi">
    <PageHeader title="Duyurular" subtitle="Firmanız ve kullanıcı rolünüz için yayınlanan duyurular." actions={<Button onClick={yenile} disabled={yenileniyor}><RefreshCw size={15} aria-hidden="true" className={yenileniyor ? "duyuru-yenile-donuyor" : undefined} />Yenile</Button>} />
    <Card className="duyuru-merkez-giris"><div className="duyuru-merkez-kimlik"><span className="duyuru-simge" aria-hidden="true"><Megaphone size={22} /></span><div><h2>Platformdan haberler</h2><p>Güncellemeler ve firmanıza özel bilgilendirmeler burada.</p></div></div><p className="muted">Okudum kaydı hukuki onay değildir.</p></Card>
    <div className="duyuru-gorunum-araclari"><div className="duyuru-gorunum-secimi" role="group" aria-label="Duyuru görünümü"><button type="button" aria-pressed={!gecmis} onClick={() => gorunumuSec(false)}><Megaphone size={16} aria-hidden="true" />Geçerli duyurular</button><button type="button" aria-pressed={gecmis} onClick={() => gorunumuSec(true)}><Archive size={16} aria-hidden="true" />Süresi biten duyurular</button></div>{veri && <span className="duyuru-sayfa-ozeti">Bu sayfada {kayitlar.length} duyuru{!gecmis && kayitlar.some((d) => !d.okundu) ? ` · ${kayitlar.filter((d) => !d.okundu).length} okunmamış` : ""}</span>}</div>
    {!guncel && <DuyuruYukleniyor />}
    {hata && <Alert tone="error">{hata}<Button onClick={yenile}>Tekrar dene</Button></Alert>}
    {veri && kayitlar.length === 0 && <Card className="duyuru-bos">{gecmis ? <Archive size={32} aria-hidden="true" /> : <Megaphone size={32} aria-hidden="true" />}<h2>Bu görünümde duyuru yok.</h2><p>{gecmis ? "Süresi biten duyurularınızı bu alanda bulabilirsiniz." : "Yeni duyurular yayınlandığında burada görünecek."}</p>{gecmis && <Button onClick={() => gorunumuSec(false)}>Geçerli duyurulara dön</Button>}</Card>}
    {kayitlar.map((d) => <DuyuruKarti key={d.id} duyuru={d} gecmis={gecmis} onYenile={yenile} />)}
    <div className="duyuru-sayfalama"><Button disabled={yenileniyor || sayfa === 1} onClick={() => setSayfa(sayfa-1)}>Önceki</Button><span>Sayfa {sayfa}{veri ? ` · ${veri.toplam} duyuru` : ""}</span><Button disabled={yenileniyor || !veri || sayfa * veri.sayfaBoyutu >= veri.toplam} onClick={() => setSayfa(sayfa+1)}>Sonraki</Button></div>
  </div>;
}
