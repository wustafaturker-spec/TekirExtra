"use client";
import Link from "next/link";
import { Bell, Building2, LayoutPanelTop, Megaphone, PanelsTopLeft, Search, Users, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ROLLER } from "@tekirextra/shared";
import { Alert, Button, Card, Field, Input, Modal, Select, TableWrap } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { ROL_ADI } from "@/lib/rol-adlari";
import { DuyuruOnizleme } from "./duyuru-onizleme";
import { duyuruDurumu, type Duyuru, type DuyuruHedefi } from "@/lib/platform-duyurulari";
import type { PaketListesi } from "@/lib/platform-paketler";

interface Onizleme { id: string; firmaSayisi: number; kullaniciSayisi: number; sonOnayAt: string; baslangic: string | null; bitis: string }
interface Firma { tenantId: string; unvan: string }
interface Rapor {
  zaman: string; hedefPolitikasi: string; firma: number; kullanici: number; gosterim: number; okudum: number; tiklama: number; popupKapatildi: number; popupErtelendi: number;
  firmalar: { tenantId: string; unvan: string; hedef: number; gosterim: number; okudum: number; tiklama: number; popupKapatildi: number; popupErtelendi: number }[];
}
const GOSTERIM_YERLERI = [
  { kod: "merkez", ad: "Duyuru merkezi", aciklama: "Duyurular sayfasında okunabilir bir kart olarak gösterilir.", Simge: Megaphone },
  { kod: "ust_bant", ad: "Panel üst bandı", aciklama: "Panelin üst bölümünde görünür bir bilgilendirme bandı açılır.", Simge: LayoutPanelTop },
  { kod: "popup", ad: "Popup", aciklama: "Kullanıcının karşısına açılır bir duyuru penceresi çıkar.", Simge: Bell },
  { kod: "modul_karti", ad: "Modül içinde kart", aciklama: "Yalnız seçtiğiniz modüllerin içinde bir duyuru kartı gösterilir.", Simge: PanelsTopLeft },
] as const;
const TEKRAR_ADI = { her_zaman: "Her görüntülemede", bir_kez: "Bir kez", gunde_bir: "Günde bir", haftada_bir: "Haftada bir" };
const tarih = (v: string) => new Date(v).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
export function PlatformDuyuruYayini({ duyuru, onDegisti, kilitli }: { duyuru: Duyuru; onDegisti: (d: Duyuru, mesaj: string) => void; kilitli: boolean }) {
  const [hedef, setHedef] = useState<DuyuruHedefi>({ kapsam: "tum", firmaIds: [], haricFirmaIds: [], paketIds: [], durumlar: [], roller: ["yonetici"], yeniUygunlar: "katilmaz", gosterimYerleri: ["merkez"], modulYollari: [], tekrarPolitikasi:"her_zaman", popupOnceligi:50,popupTuru:"normal",ertelemeDakika:1440 });
  const [arama, setArama] = useState(""), [aranan, setAranan] = useState("");
  const [firmaSayfa, setFirmaSayfa] = useState(1), [paketSayfa, setPaketSayfa] = useState(1), [raporSayfa, setRaporSayfa] = useState(1);
  const [adlar, setAdlar] = useState<Record<string, string>>({});
  const [planli, setPlanli] = useState(false), [baslangic, setBaslangic] = useState(""), [bitis, setBitis] = useState("");
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null), [durdurOnayi, setDurdurOnayi] = useState(false);
  const [islem, setIslem] = useState(false), [hata, setHata] = useState("");
  const taslak = duyuru.durum === "taslak";
  const eksikler = [
    ...(!hedef.roller.length ? ["En az bir kullanıcı rolü seçin."] : []),
    ...(!hedef.gosterimYerleri.length ? ["En az bir gösterim yeri seçin."] : []),
    ...(hedef.kapsam === "secili" && !hedef.firmaIds.length ? ["En az bir firma seçin."] : []),
    ...(hedef.gosterimYerleri.includes("modul_karti") && !hedef.modulYollari.length ? ["Modül kartının gösterileceği en az bir modül seçin."] : []),
  ];
  const firmalar = usePlatformVerisi<{ kayitlar: Firma[]; toplam: number; sayfaBoyutu: number }>(taslak ? `/platform/firmalar/sayfali?arama=${encodeURIComponent(aranan)}&sayfa=${firmaSayfa}` : null);
  const paketler = usePlatformVerisi<PaketListesi>(taslak ? `/platform/paketler?sayfa=${paketSayfa}` : null);
  const rapor = usePlatformVerisi<Rapor>(duyuru.yayinSurumu ? `/platform/duyurular/${duyuru.id}/rapor?sayfa=${raporSayfa}` : null);
  const sec = <T extends string>(liste: T[], deger: T) => liste.includes(deger) ? liste.filter((v) => v !== deger) : [...liste, deger];
  function firmaAra() {
    const sorgu = arama.trim();
    if (sorgu === aranan && firmaSayfa === 1) firmalar.yenile();
    setAranan(sorgu); setFirmaSayfa(1);
  }
  function firmaSec(f: Firma, alan: "firmaIds" | "haricFirmaIds") {
    setAdlar({ ...adlar, [f.tenantId]: f.unvan });
    setHedef({ ...hedef, [alan]: sec(hedef[alan], f.tenantId) });
  }
  async function onizle(e: FormEvent) {
    e.preventDefault(); if (islem || kilitli) return;
    setIslem(true); setHata("");
    try {
      setOnizleme(await platformApi<Onizleme>(`/platform/duyurular/${duyuru.id}/hedef-onizle`, { method: "POST", body: JSON.stringify({
        surum: duyuru.surum, hedef, baslangic: planli ? new Date(`${baslangic}:00+03:00`).toISOString() : null, bitis: new Date(`${bitis}:00+03:00`).toISOString(),
      }) }));
    } catch (e) { setHata(e instanceof Error ? e.message : "Önizleme hazırlanamadı."); } finally { setIslem(false); }
  }
  async function yayinla() {
    if (!onizleme || islem || kilitli) return;
    setIslem(true); setHata("");
    try {
      const d = await platformApi<Duyuru>(`/platform/duyurular/${duyuru.id}/yayinla`, { method: "POST", body: JSON.stringify({ onizlemeId: onizleme.id }) });
      setOnizleme(null); onDegisti(d, `${duyuruDurumu(d)}: duyuru yayın kaydı oluşturuldu.`);
    } catch (e) { setOnizleme(null); setHata(e instanceof Error ? e.message : "Yayınlanamadı."); } finally { setIslem(false); }
  }
  async function durdur() {
    setIslem(true); setHata("");
    try { const d = await platformApi<Duyuru>(`/platform/duyurular/${duyuru.id}/durdur`, { method: "POST", body: JSON.stringify({ surum: duyuru.surum }) }); setDurdurOnayi(false); onDegisti(d, "Duyuru yayını durduruldu."); }
    catch (e) { setDurdurOnayi(false); setHata(e instanceof Error ? e.message : "Durdurulamadı."); } finally { setIslem(false); }
  }
  return <Card className="duyuru-yayin-paneli" id="duyuru-yayin-bolumu" tabIndex={-1}><div className="duyuru-bolum-basligi"><span className="duyuru-adim">02</span><div><h2>Hedefleme ve yayın</h2><p className="muted">Hedef kitlenizi, gösterim yerlerini ve yayın takvimini belirleyin.</p></div></div><Alert tone="error">{hata}</Alert>
    {!taslak && <section className="duyuru-yayin-durumu" aria-label="Yayın bilgileri">
      <div className="duyuru-durum-basligi"><div><span className="duyuru-kategori">Yayın durumu</span><p className={`duyuru-rozet duyuru-rozet--${duyuru.durum}`}>{duyuruDurumu(duyuru)}</p></div>{duyuru.durum === "yayinlandi" && <Button type="button" disabled={islem} onClick={() => setDurdurOnayi(true)}>Yayını durdur</Button>}</div>
      <dl className="duyuru-onay-detaylari">
        <div><dt>Başlangıç (Türkiye)</dt><dd>{duyuru.baslangic ? tarih(duyuru.baslangic) : "Yayın başlangıcı yok"}</dd></div>
        <div><dt>Bitiş (Türkiye)</dt><dd>{duyuru.bitis ? tarih(duyuru.bitis) : "Yayın bitişi yok"}</dd></div>
        <div><dt>Gösterim yerleri</dt><dd>{duyuru.hedef?.gosterimYerleri?.length ? duyuru.hedef.gosterimYerleri.map((yer) => <span className="duyuru-rozet" key={yer}>{GOSTERIM_YERLERI.find((g) => g.kod === yer)?.ad ?? yer}</span>) : "Gösterim yeri belirlenmemiş"}</dd></div>
        <div><dt>Otomatik gösterim</dt><dd>{duyuru.hedef ? TEKRAR_ADI[duyuru.hedef.tekrarPolitikasi] : "Belirlenmemiş"}</dd></div>
        {duyuru.hedef?.gosterimYerleri?.includes("popup") && <div><dt>Popup davranışı</dt><dd>{duyuru.hedef.popupTuru === "kritik" ? "Kritik" : "Normal"} · öncelik {duyuru.hedef.popupOnceligi} · erteleme {duyuru.hedef.ertelemeDakika} dk</dd></div>}
      </dl>
    </section>}
    {taslak && <><p>Önce içeriği kaydedin. Hedef kuralları, gösterim yeri ve zaman aralığı yayın onayıyla kaydedilir.</p>{kilitli && <Alert tone="warning">Yayın önizlemesi için içerikteki değişiklikleri kaydedin.</Alert>}
      <form onSubmit={(e) => void onizle(e)}><fieldset className="platform-editor-fieldset" disabled={islem || kilitli}>
        <section className="duyuru-yayin-bolumu" id="duyuru-hedef-kitle" tabIndex={-1} aria-labelledby="duyuru-kitle-basligi"><div className="duyuru-alt-baslik"><h3 id="duyuru-kitle-basligi">Hedef kitle</h3><p>Duyuruyu hangi firmaların ve kullanıcıların göreceğini seçin.</p></div><Field label="Firma kapsamı"><Select value={hedef.kapsam} onChange={(e) => setHedef({ ...hedef, kapsam: e.target.value as "tum" | "secili", firmaIds: [] })}><option value="tum">Tüm firmalar</option><option value="secili">Seçili firmalar</option></Select></Field>
        <div className="duyuru-firma-arama">
          <Field label="Firma ara" htmlFor="duyuru-firma-arama"><div className="duyuru-arama-kontrolu"><Search size={17} aria-hidden="true" /><Input id="duyuru-firma-arama" placeholder="Firma unvanıyla arayın" value={arama} maxLength={200} onChange={(e) => setArama(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); firmaAra(); } }} /></div></Field>
          <Button type="button" onClick={firmaAra}>Firmaları ara</Button>
          {(arama || aranan) && <Button type="button" onClick={() => { setArama(""); setAranan(""); setFirmaSayfa(1); }}>Aramayı temizle</Button>}
        </div>
        <div className="duyuru-firma-listesi" aria-busy={firmalar.yukleniyor}>
          <div className="duyuru-firma-liste-basligi"><strong>{hedef.kapsam === "secili" ? "Firmaları seçin" : "Hariç tutulacak firmaları seçin"}</strong><span>{firmalar.veri ? `${firmalar.veri.toplam.toLocaleString("tr-TR")} firma${aranan ? " bulundu" : " listelenebilir"}` : "Firma listesi"}</span></div>
          {firmalar.yukleniyor && <p className="duyuru-arama-bos" role="status">Firmalar yükleniyor…</p>}
          {firmalar.veri && !firmalar.veri.kayitlar.length && <p className="duyuru-arama-bos">{aranan ? "Aramanızla eşleşen firma bulunamadı. Farklı bir adla tekrar deneyin." : "Listelenecek firma bulunamadı."}</p>}
          {firmalar.hata && <Alert tone="error">{firmalar.hata}<Button type="button" onClick={firmalar.yenile}>Tekrar dene</Button></Alert>}
          {firmalar.veri?.kayitlar.map((f) => <div key={f.tenantId} className="duyuru-firma-satiri">
            <div className="duyuru-firma-kimlik"><Building2 size={18} aria-hidden="true" /><strong>{f.unvan}</strong></div>
            <div className="duyuru-firma-secimleri">{hedef.kapsam === "secili" && <label><input type="checkbox" checked={hedef.firmaIds.includes(f.tenantId)} disabled={hedef.haricFirmaIds.includes(f.tenantId)} onChange={() => firmaSec(f, "firmaIds")} /><span className="sr-only">Dahil et: {f.unvan}</span><span aria-hidden="true">Dahil et</span></label>}<label><input type="checkbox" checked={hedef.haricFirmaIds.includes(f.tenantId)} disabled={hedef.firmaIds.includes(f.tenantId)} onChange={() => firmaSec(f, "haricFirmaIds")} /><span className="sr-only">Hariç tut: {f.unvan}</span><span aria-hidden="true">Hariç tut</span></label></div>
          </div>)}
          <div className="duyuru-firma-sayfalama"><Button type="button" disabled={firmalar.yukleniyor || firmaSayfa === 1} onClick={() => setFirmaSayfa(firmaSayfa-1)}>Önceki firmalar</Button><span>Sayfa {firmaSayfa}</span><Button type="button" disabled={firmalar.yukleniyor || !firmalar.veri || firmaSayfa*firmalar.veri.sayfaBoyutu >= firmalar.veri.toplam} onClick={() => setFirmaSayfa(firmaSayfa+1)}>Sonraki firmalar</Button></div>
        </div>
        <div className="duyuru-secim-gruplari">{(["firmaIds", "haricFirmaIds"] as const).filter((alan) => alan !== "firmaIds" || hedef.kapsam === "secili").map((alan) => <div className="duyuru-secim-grubu" key={alan}>
          <div className="duyuru-secim-basligi"><strong>{alan === "firmaIds" ? "Dahil edilenler" : "Hariç tutulanlar"}<span className="duyuru-rozet">{hedef[alan].length}</span></strong>{hedef[alan].length > 0 && <Button type="button" size="sm" onClick={() => setHedef({ ...hedef, [alan]: [] })}>{alan === "firmaIds" ? "Dahil listesini temizle" : "Hariç listesini temizle"}</Button>}</div>
          {hedef[alan].length ? <ul className="duyuru-secim-etiketleri">{hedef[alan].map((id) => <li key={id}><span>{adlar[id] ?? id}</span><button type="button" aria-label={`${adlar[id] ?? id} firmasını ${alan === "firmaIds" ? "dahil" : "hariç"} listesinden kaldır`} onClick={() => setHedef({ ...hedef, [alan]: hedef[alan].filter((x) => x !== id) })}><X size={14} aria-hidden="true" /></button></li>)}</ul> : <p className="muted">{alan === "firmaIds" ? "Yayın için en az bir firma seçin." : "Hariç tutulan firma yok."}</p>}
        </div>)}</div>
        <fieldset><legend>Paketler (boş seçim tüm paketler)</legend>{paketler.hata && <Alert tone="error">{paketler.hata}<Button type="button" onClick={paketler.yenile}>Tekrar dene</Button></Alert>}{paketler.veri?.kayitlar.map((p) => <label key={p.id} style={{ display: "block" }}><input type="checkbox" checked={hedef.paketIds.includes(p.id)} onChange={() => { setAdlar({ ...adlar, [p.id]: p.sonSurum.ad }); setHedef({ ...hedef, paketIds: sec(hedef.paketIds,p.id) }); }} />{p.sonSurum.ad} ({p.kod})</label>)}<Button type="button" disabled={paketSayfa===1} onClick={() => setPaketSayfa(paketSayfa-1)}>Önceki paketler</Button><Button type="button" disabled={!paketler.veri || paketSayfa*25>=paketler.veri.toplam} onClick={() => setPaketSayfa(paketSayfa+1)}>Sonraki paketler</Button><p>Seçili paketler: {hedef.paketIds.length ? hedef.paketIds.map((id) => adlar[id] ?? id).join(", ") : "Tümü"}</p></fieldset>
        <fieldset><legend>Abonelik durumları (boş seçim tüm durumlar)</legend>{(["deneme","aktif","askida","iptal"] as const).map((d) => <label key={d} style={{ marginRight: 12 }}><input type="checkbox" checked={hedef.durumlar.includes(d)} onChange={() => setHedef({ ...hedef, durumlar: sec(hedef.durumlar,d) })} />{({ deneme:"Deneme",aktif:"Aktif",askida:"Askıda",iptal:"İptal" })[d]}</label>)}</fieldset>
        <fieldset><legend>Kullanıcı rolleri</legend>{ROLLER.map((r) => <label key={r} style={{ display: "inline-block", marginRight: 12 }}><input type="checkbox" checked={hedef.roller.includes(r)} onChange={() => setHedef({ ...hedef, roller: sec(hedef.roller,r) })} />{ROL_ADI[r]}</label>)}</fieldset>
        <Field label="Sonradan uygun hale gelenler"><Select value={hedef.yeniUygunlar} onChange={() => undefined}><option value="katilmaz">Bu yayına katılmaz; yeni yayın gerekir</option></Select></Field>
        </section><section className="duyuru-yayin-bolumu" id="duyuru-gosterim" tabIndex={-1} aria-labelledby="duyuru-yerlesim-basligi"><div className="duyuru-alt-baslik"><h3 id="duyuru-yerlesim-basligi">Gösterim ve davranış</h3><p>Duyurunuzun nerede ve ne sıklıkla görüneceğini belirleyin.</p></div><fieldset className="duyuru-yerlesim-alani"><legend>Gösterim yerleri</legend><div className="duyuru-yerlesim-kartlari">{GOSTERIM_YERLERI.map(({ kod, ad, aciklama, Simge }) => <label className="duyuru-yerlesim-karti" key={kod}><input type="checkbox" aria-label={ad} checked={hedef.gosterimYerleri.includes(kod)} onChange={() => setHedef({ ...hedef, gosterimYerleri: sec(hedef.gosterimYerleri, kod), modulYollari: kod === "modul_karti" && hedef.gosterimYerleri.includes(kod) ? [] : hedef.modulYollari })} /><Simge size={22} aria-hidden="true" /><span><strong>{ad}</strong><small>{aciklama}</small></span></label>)}</div></fieldset>
        {hedef.gosterimYerleri.includes("modul_karti") && <fieldset><legend>Kartın gösterileceği modüller</legend>{([ ["genel","Genel panel"],["finans","Finans"],["satis","Satış"],["satin_alma","Satın alma"],["stok","Stok"],["uretim","Üretim"],["raporlar","Raporlar"],["ayarlar","Ayarlar"],["ebelge","e-Belge"],["cari","Cari hesaplar"],["personel","Personel"],["crm","CRM"] ] as const).map(([key,label]) => <label key={key} style={{ display: "inline-block", marginRight: 12 }}><input type="checkbox" checked={hedef.modulYollari.includes(key)} onChange={() => setHedef({ ...hedef, modulYollari: sec(hedef.modulYollari, key) })} />{label}</label>)}</fieldset>}
        <Field label="Otomatik gösterim sıklığı"><Select value={hedef.tekrarPolitikasi} onChange={(e) => setHedef({ ...hedef, tekrarPolitikasi: e.target.value as DuyuruHedefi["tekrarPolitikasi"] })}><option value="her_zaman">Her görüntülemede</option><option value="bir_kez">Bir kez</option><option value="gunde_bir">Günde bir</option><option value="haftada_bir">Haftada bir</option></Select></Field>
        {hedef.gosterimYerleri.includes("popup") && <fieldset><legend>Popup davranışı</legend><Field label="Popup önceliği (1 düşük, 100 yüksek)"><Input type="number" min={1} max={100} required value={hedef.popupOnceligi} onChange={(e) => setHedef({ ...hedef, popupOnceligi: Number(e.target.value) })} /></Field><Field label="Popup türü"><Select value={hedef.popupTuru} onChange={(e) => setHedef({ ...hedef, popupTuru: e.target.value as "normal" | "kritik" })}><option value="normal">Normal; kapatılabilir</option><option value="kritik">Kritik; önemli bilgi</option></Select></Field><Field label="Erteleme süresi"><Select value={hedef.ertelemeDakika} onChange={(e) => setHedef({ ...hedef, ertelemeDakika: Number(e.target.value) as 60 | 1440 | 10080 })}><option value={60}>1 saat</option><option value={1440}>1 gün</option><option value={10080}>1 hafta</option></Select></Field></fieldset>}
        </section><section className="duyuru-yayin-bolumu" id="duyuru-takvim" tabIndex={-1} aria-labelledby="duyuru-takvim-basligi"><div className="duyuru-alt-baslik"><h3 id="duyuru-takvim-basligi">Yayın takvimi</h3><p>Tüm tarihler Türkiye saatine göre uygulanır.</p></div><Field label="Yayın başlangıcı"><Select value={planli ? "planli" : "hemen"} onChange={(e) => setPlanli(e.target.value === "planli")}><option value="hemen">Onaylandığında hemen</option><option value="planli">İleri tarih</option></Select></Field>
        {planli && <Field label="Başlangıç (Türkiye)"><Input type="datetime-local" required value={baslangic} onChange={(e) => setBaslangic(e.target.value)} /></Field>}
        <Field label="Bitiş (Türkiye)"><Input type="datetime-local" required value={bitis} onChange={(e) => setBitis(e.target.value)} /></Field>
        </section><aside className="duyuru-kitle-ozeti" aria-labelledby="duyuru-kitle-ozet-basligi"><div className="duyuru-kitle-ozet-basligi"><Users size={18} aria-hidden="true" /><h3 id="duyuru-kitle-ozet-basligi">Seçim özeti</h3></div><dl><div><dt>Firma kapsamı</dt><dd>{hedef.kapsam === "tum" ? "Tüm firmalar" : `${hedef.firmaIds.length} seçili firma`}{hedef.haricFirmaIds.length > 0 && ` · ${hedef.haricFirmaIds.length} firma hariç`}</dd></div><div><dt>Paket filtresi</dt><dd>{hedef.paketIds.length ? `${hedef.paketIds.length} paket` : "Tüm paketler"}</dd></div><div><dt>Kullanıcı rolleri</dt><dd>{hedef.roller.length ? hedef.roller.map((rol) => ROL_ADI[rol as keyof typeof ROL_ADI] ?? rol).join(" · ") : "Rol seçilmedi"}</dd></div></dl><p>Kesin firma ve kullanıcı sayıları yayın önizlemesinde hesaplanır.</p></aside>{eksikler.length > 0 && <div className="duyuru-eksik-secimler" id="duyuru-yayin-eksikleri"><strong>Önizleme için tamamlayın</strong><ul>{eksikler.map((eksik) => <li key={eksik}>{eksik}</li>)}</ul></div>}<div className="duyuru-yayin-onay"><p className="muted">Yayınlamadan önce hedef kitlenizi ve içeriğinizi son kez kontrol edeceksiniz.</p><Button type="submit" variant="primary" disabled={eksikler.length > 0} aria-describedby={eksikler.length ? "duyuru-yayin-eksikleri" : undefined}>Hedefi ve yayını önizle</Button></div>
      </fieldset></form></>}
    {Boolean(duyuru.yayinSurumu) && <section id="duyuru-rapor" tabIndex={-1} aria-label="Yayın raporu">{rapor.yukleniyor && <p role="status">Yayın raporu yükleniyor…</p>}{rapor.hata && <Alert tone="error">{rapor.hata}<Button type="button" onClick={rapor.yenile}>Tekrar dene</Button></Alert>}
    {rapor.veri && <><div className="duyuru-rapor-basligi"><div><h3>Yayın raporu</h3><p className="muted">Duyurunuzun erişimini ve kullanıcı etkileşimlerini takip edin.</p></div></div><dl className="duyuru-rapor-metrikleri">{([
      ["Hedef firma", rapor.veri.firma], ["Hedef kullanıcı", rapor.veri.kullanici], ["Benzersiz gösterim", rapor.veri.gosterim], ["Okudum", rapor.veri.okudum], ["Tıklama", rapor.veri.tiklama], ["Popup kapatma", rapor.veri.popupKapatildi], ["Popup erteleme", rapor.veri.popupErtelendi],
    ] as const).map(([ad, sayi]) => <div key={ad}><dt>{ad}</dt><dd>{(sayi ?? 0).toLocaleString("tr-TR")}</dd></div>)}</dl><p>{rapor.veri.hedefPolitikasi} Rapor zamanı: {tarih(rapor.veri.zaman)} (Türkiye). Okudum kaydı hukuki onay değildir.</p><Button type="button" onClick={rapor.yenile}>Raporu yenile</Button><TableWrap className="platform-responsive-table duyuru-firma-raporu"><caption className="sr-only">Duyuru etkileşimlerinin firma bazında dağılımı</caption><thead><tr><th scope="col">Firma</th><th scope="col">Hedef</th><th scope="col">Gösterim</th><th scope="col">Okudum</th><th scope="col">Tıklama</th><th scope="col">Popup kapatma</th><th scope="col">Popup erteleme</th></tr></thead><tbody>{!rapor.veri.firmalar.length && <tr><td colSpan={7}><div className="duyuru-bos"><h4>Bu sayfada firma raporu yok.</h4><p>Hedef firmaların etkileşimleri burada listelenir.</p></div></td></tr>}{rapor.veri.firmalar.map((f) => <tr key={f.tenantId}><td className="platform-cell-title" data-label="Firma"><Link href={`/platform/firmalar/${f.tenantId}`}>{f.unvan ?? "Firma detayını aç"}</Link></td><td data-label="Hedef">{(f.hedef ?? 0).toLocaleString("tr-TR")}</td><td data-label="Gösterim">{(f.gosterim ?? 0).toLocaleString("tr-TR")}</td><td data-label="Okudum">{(f.okudum ?? 0).toLocaleString("tr-TR")}</td><td data-label="Tıklama">{(f.tiklama ?? 0).toLocaleString("tr-TR")}</td><td data-label="Popup kapatma">{(f.popupKapatildi ?? 0).toLocaleString("tr-TR")}</td><td data-label="Popup erteleme">{(f.popupErtelendi ?? 0).toLocaleString("tr-TR")}</td></tr>)}</tbody></TableWrap><div className="duyuru-sayfalama"><Button type="button" disabled={rapor.yukleniyor || raporSayfa===1} onClick={() => setRaporSayfa(raporSayfa-1)}>Önceki rapor sayfası</Button><span>Rapor sayfası {raporSayfa}</span><Button type="button" disabled={rapor.yukleniyor || raporSayfa*25>=rapor.veri.firma} onClick={() => setRaporSayfa(raporSayfa+1)}>Sonraki rapor sayfası</Button></div></>}
    </section>}
    {onizleme && <Modal baslik="Duyuru yayın onayı" aciklama="İçeriği ve yayın bilgilerini kontrol ederek onaylayın." genis onKapat={() => { if (!islem) setOnizleme(null); }} altBilgi={<><Button type="button" disabled={islem} onClick={() => setOnizleme(null)}>Düzenlemeye dön</Button><Button type="button" disabled={islem || kilitli} variant="primary" onClick={() => void yayinla()}>{islem ? "Yayınlanıyor…" : "Duyuru yayınını onayla"}</Button></>}>
      <div className="duyuru-onay-ozeti"><span className="duyuru-kategori">Hedef kitle</span><p>{onizleme.firmaSayisi} firma · {onizleme.kullaniciSayisi} kullanıcı</p><small>Yayın onayında belirlenen alıcılara gösterilir.</small></div>
      <DuyuruOnizleme veri={duyuru} />
      <dl className="duyuru-onay-detaylari">
        <div><dt>Başlangıç (Türkiye)</dt><dd>{onizleme.baslangic ? tarih(onizleme.baslangic) : "Onaylandığında hemen"}</dd></div>
        <div><dt>Bitiş (Türkiye)</dt><dd>{tarih(onizleme.bitis)}</dd></div>
        <div><dt>Gösterim yerleri</dt><dd>{hedef.gosterimYerleri.map((v) => <span className="duyuru-rozet" key={v}>{v === "merkez" ? "Duyuru merkezi" : v === "ust_bant" ? "Panel üst bandı" : v === "popup" ? "Popup" : "Modül içi kart"}</span>)}</dd></div>
        <div><dt>Otomatik gösterim</dt><dd>{{ her_zaman: "Her görüntülemede", bir_kez: "Bir kez", gunde_bir: "Günde bir", haftada_bir: "Haftada bir" }[hedef.tekrarPolitikasi]}</dd></div>
        <div><dt>Kullanıcı rolleri</dt><dd>{hedef.roller.map((rol) => ROL_ADI[rol as keyof typeof ROL_ADI] ?? rol).join(" · ")}</dd></div>
        {hedef.gosterimYerleri.includes("popup") && <div><dt>Popup ayarı</dt><dd>{hedef.popupTuru === "kritik" ? "Kritik" : "Normal"} · öncelik {hedef.popupOnceligi} · {hedef.ertelemeDakika} dakika erteleme</dd></div>}
      </dl>
      <p className="duyuru-onay-notu">Sonradan uygun hale gelenler katılmaz. Önizleme {tarih(onizleme.sonOnayAt)} tarihine kadar geçerlidir. Hedef kitle değişirse yeniden önizleme gerekir.</p>
    </Modal>}
    {durdurOnayi && <Modal baslik="Duyuru yayınını durdur" onKapat={() => { if (!islem) setDurdurOnayi(false); }}><p>Duyuru kullanıcıların yeni okumalarında hemen gizlenir. Açık duyuru merkezi en geç 30 saniyede yenilenir.</p><Button type="button" disabled={islem} onClick={() => void durdur()}>Durdurmayı onayla</Button></Modal>}
  </Card>;
}
