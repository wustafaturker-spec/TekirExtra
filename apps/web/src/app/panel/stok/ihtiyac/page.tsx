"use client";

import { useEffect, useRef, useState } from "react";
import { ihtiyacEksigi, ihtiyacGirdisiOku, ihtiyacTalepYolu, type IhtiyacSonucu } from "@/lib/ihtiyac-talep";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, PageHeader, Select, ButtonLabel } from "@/components/ui";

type Kart = { id: string; kod: string; ad: string; tip: string; anaBirim: string; birimler?: { ad: string }[] };
type Depo = { id: string; kod: string; ad: string };
type Sonuc = IhtiyacSonucu & { uyarilar: string[] };
const miktarYaz = (v: string) => {
  const [tam, kesir = ""] = v.split(".");
  return `${tam.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${kesir.padEnd(3, "0")}`;
};
const bugun = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

export default function IhtiyacSayfasi() {
  const [arama, setArama] = useState("");
  const [kartlar, setKartlar] = useState<Kart[]>([]);
  const [kart, setKart] = useState<Kart | null>(null);
  const [depolar, setDepolar] = useState<Depo[]>([]);
  const [depoId, setDepoId] = useState("");
  const [miktar, setMiktar] = useState("");
  const [birim, setBirim] = useState("");
  const [tarih, setTarih] = useState(bugun);
  const [hesapTuru,setHesapTuru]=useState<'anlik'|'tarihli'>('anlik');
  const [sonuc, setSonuc] = useState<Sonuc | null>(null);
  const [hata, setHata] = useState("");
  const [bekliyor, setBekliyor] = useState(false);
  const [yetkili, setYetkili] = useState(false);
  const [planKaydediliyor,setPlanKaydediliyor]=useState(false),[kayitliPlanId,setKayitliPlanId]=useState(''),[planHatasi,setPlanHatasi]=useState(''),[planYenileGerekli,setPlanYenileGerekli]=useState(false);
  const planIstek=useRef<{kanit:string;anahtar:string}|null>(null),planYaziyor=useRef(false);
  const surum = useRef(0);
  const secim = useRef(0);
  function degisti() { surum.current++; setSonuc(null); setHata("");setKayitliPlanId('');setPlanHatasi('');setPlanYenileGerekli(false);planIstek.current=null; }
  useEffect(() => {
    api<{ rol: string }>("/auth/ben").then(async b => {
      if (!["yonetici", "muhasebe", "depo"].includes(b.rol)) throw new Error("Bu ekran için yetkiniz yok.");
      setYetkili(true);
      setDepolar(await api<Depo[]>("/depo?yalnizAktif=true"));
      const g=ihtiyacGirdisiOku(new URLSearchParams(window.location.search));
      if(g&&surum.current===0){const n=surum.current;const k=await api<Kart>(`/stok/${encodeURIComponent(g.stokId)}`);if(n===surum.current){setKart(k);setDepoId(g.depoId);setMiktar(g.miktar);setBirim(g.birim);setTarih(g.ihtiyacTarihi);setHesapTuru('tarihli');}}
    }).catch(e => setHata(e.message));
  }, []);
  useEffect(() => {
    if (!yetkili) return;
    let aktif = true;
    const timer = setTimeout(() => {
      api<{ kayitlar: Kart[] }>(`/stok?arama=${encodeURIComponent(arama)}&adet=50`).then(v => {
        if (aktif) setKartlar(v.kayitlar.filter(k => k.tip !== "hizmet"));
      }).catch(e => { if (aktif) setHata(e.message); });
    }, 300);
    return () => { aktif = false; clearTimeout(timer); };
  }, [arama, yetkili]);
  async function kartSec(id: string) {
    degisti(); setKart(null); setBirim(""); const s = ++secim.current;
    if (!id) return;
    try { const k = await api<Kart>(`/stok/${id}`); if (s === secim.current) { setKart(k); setBirim(k.anaBirim); } }
    catch (e) { if (s === secim.current) setHata(e instanceof Error ? e.message : "Ürün yüklenemedi"); }
  }
  async function hesapla(e: React.FormEvent) {
    e.preventDefault(); if (!kart || bekliyor) return;
    const s = ++surum.current; setBekliyor(true); setSonuc(null); setHata("");setKayitliPlanId('');setPlanHatasi('');setPlanYenileGerekli(false);planIstek.current=null;
    try {
      const sorgu = new URLSearchParams({ stokId: kart.id, depoId, miktar: miktar.replace(",", "."), birim, ihtiyacTarihi: tarih });
      const v = await api<Sonuc>(`/stok/ihtiyac-plani/${hesapTuru==='tarihli'?'tarihli-onizle':'onizle'}?${sorgu}`, { cache: "no-store" });
      if(hesapTuru==='tarihli'&&!v.tarihli)throw Error('Tarihli ihtiyaç sonucu alınamadı.');
      if (s === surum.current) setSonuc(v);
    } catch (e) { if (s === surum.current) setHata(e instanceof Error ? e.message : "Hesaplanamadı"); }
    finally { setBekliyor(false); }
  }
  async function planSakla(){
    if(!kart||!sonuc?.erisim?.yazabilir||!sonuc?.tarihli?.veriYeterli||!sonuc.sonucKaniti||planYaziyor.current||kayitliPlanId||planYenileGerekli)return;
    const n=surum.current,kanit=sonuc.sonucKaniti;
    if(!planIstek.current||planIstek.current.kanit!==kanit)planIstek.current={kanit,anahtar:crypto.randomUUID()};
    planYaziyor.current=true;setPlanKaydediliyor(true);setPlanHatasi('');
    try{const r=await api<{id:string}>('/stok/ihtiyac-plani/planlar',{method:'POST',body:JSON.stringify({istekAnahtari:planIstek.current.anahtar,beklenenSonucKaniti:kanit,girdi:{stokId:kart.id,depoId,miktar:miktar.replace(',','.'),birim,ihtiyacTarihi:tarih}})});if(n===surum.current)setKayitliPlanId(r.id);}
    catch(e){if(n===surum.current){setPlanHatasi(e instanceof Error?e.message:'Plan kaydının sonucu alınamadı. Aynı önizlemede tekrar deneyebilirsiniz.');if(e instanceof Error&&'durum' in e&&e.durum===409)setPlanYenileGerekli(true);}}
    finally{planYaziyor.current=false;setPlanKaydediliyor(false);}
  }
  let aktarimHatasi='',aktarimEksigi='0.000';
  if(sonuc){try{aktarimEksigi=ihtiyacEksigi(sonuc,hesapTuru==='tarihli'?'tarihli':undefined);}catch(e){aktarimHatasi=e instanceof Error?e.message:'Aktarım doğrulanamadı.';}}
  const kaynakYolu=(id:string)=>id.startsWith('uretim/')?`/panel/stok/uretim-talepleri?kalemId=${encodeURIComponent(id.split('/')[2])}`:`/panel/stok/giris-tarihleri?satirId=${encodeURIComponent(id)}`;
  const kaynakEtiketi=(id:string)=>id.startsWith('uretim/')?'Üretim ihtiyacını planla':'Giriş tarihini incele';
  const nedenler:Record<string,string>={kapali_kaynak:'Kapalı kaynak',kalan_yok:'Kalan miktar yok',tarih_dogrulanmadi:'Tarih veya güncel kaynak doğrulanmadı',gecikmis_kaynak:'Giriş günü geçmiş',ufuk_disinda:'İhtiyaç gününden sonra',rezervde_zaten_dusuldu:'Rezervde zaten düşüldü'};
  return <div>
    <PageHeader title="Stok ihtiyaç önizlemesi" subtitle="Yeni bir ihtiyacın seçili depodaki stokla karşılanma durumunu görün." actions={<ButtonLabel as="a" href="/panel/stok/ihtiyac-planlari">Kayıtlı planlar</ButtonLabel>} />
    <Alert tone="error">{hata}</Alert>
    <Card>
      <p>Henüz rezerv edilmemiş yeni bir ihtiyaç girin. Hesaplama stok veya satın alma kaydı oluşturmaz.</p>
      <form onSubmit={hesapla} style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <fieldset disabled={planKaydediliyor} style={{display:'contents'}}>
        <Field label="Ürün ara"><Input value={arama} onChange={e => setArama(e.target.value)} placeholder="Ürün adı veya kodu" disabled={!yetkili} /></Field>
        <Field label="Ürün"><Select required value={kart?.id ?? ""} disabled={!yetkili} onChange={e => void kartSec(e.target.value)}><option value="">Ürün seçin</option>{kart && !kartlar.some(k => k.id === kart.id) && <option value={kart.id}>{kart.kod} · {kart.ad}</option>}{kartlar.map(k => <option key={k.id} value={k.id}>{k.kod} · {k.ad}</option>)}</Select></Field>
        <Field label="Depo"><Select required value={depoId} onChange={e => { degisti(); setDepoId(e.target.value); }}><option value="">Depo seçin</option>{depolar.map(d => <option key={d.id} value={d.id}>{d.kod} · {d.ad}</option>)}</Select></Field>
        <Field label="İhtiyaç miktarı"><Input required inputMode="decimal" value={miktar} onChange={e => { degisti(); setMiktar(e.target.value); }} placeholder="Örn. 8" /></Field>
        <Field label="Birim"><Select required value={birim} onChange={e => { degisti(); setBirim(e.target.value); }}><option value="">Birim seçin</option>{Array.from(new Set(kart ? [kart.anaBirim, ...(kart.birimler ?? []).map(b => b.ad)] : [])).map(b => <option key={b}>{b}</option>)}</Select></Field>
        <Field label="İhtiyaç günü"><Input required type="date" min={bugun()} value={tarih} onChange={e => { degisti(); setTarih(e.target.value); }} /></Field>
        <Field label="Hesap kapsamı"><Select value={hesapTuru} onChange={e=>{degisti();setHesapTuru(e.target.value as 'anlik'|'tarihli');}}><option value="anlik">Yalnız mevcut stok</option><option value="tarihli">Doğrulanmış tarihli girişlerle</option></Select></Field>
        <div><Button variant="primary" type="submit" disabled={!yetkili || !kart || bekliyor}>{bekliyor ? "Hesaplanıyor…" : "İhtiyacı hesapla"}</Button></div>
        </fieldset>
      </form>
    </Card>
    {sonuc && <div aria-live="polite" style={{ marginTop: 20 }}>
      <Alert tone={sonuc.hesap.durum === "stok_yeterli" ? "success" : "warning"}>{sonuc.hesap.durum === "stok_yeterli" ? "Mevcut stok bu ihtiyacı karşılıyor." : "Bu ihtiyaç için tedarik gerekiyor."}</Alert>
      <Card><dl style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>{[["mevcut", "Mevcut stok"], ["rezerve", "Rezerve"], ["kullanilabilir", "Kullanılabilir"], ["talep", "İhtiyaç"], ["yoldaki", "Yoldaki (hesaba katılmadı)"], ["eksik", "Tedarik edilmesi gereken"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd style={{ margin: "8px 0", fontSize: 22, fontWeight: 600 }}>{miktarYaz(sonuc.hesap[key])} {sonuc.stok.anaBirim}</dd></div>)}</dl>
        {sonuc.tarihli && <section aria-label="Tarihli ihtiyaç sonucu" style={{marginTop:24}}>
          <h2>Tarihli ihtiyaç sonucu</h2>
          <Alert tone={sonuc.tarihli.durum==='donem_sonu_yeterli'&&sonuc.tarihli.donemIciEnBuyukAcik==='0.000'?'success':'warning'}>{sonuc.tarihli.durum==='dogrulanamadi'?'Tarihli ihtiyaç doğrulanamadı.':sonuc.tarihli.eksik==='0.000'?'Bilinen girişlerle dönem sonu miktarı yeterli.':'Bilinen girişlerle de tedarik gerekiyor.'} Teslim garantisi değildir.</Alert>
          <dl style={{display:'grid',gap:16,gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))'}}>{[['tarihliGiris','Zamanında doğrulanmış giriş'],['ekTalep','Rezerv dışı üretim ihtiyacı'],['donemSonu','İhtiyaç sonrası dönem sonu'],['eksik','Tarihli tedarik açığı'],['donemIciEnBuyukAcik','Dönem içindeki en büyük açık']].map(([k,label])=><div key={k}><dt>{label}</dt><dd>{miktarYaz(sonuc.tarihli![k as 'eksik'])} {sonuc.stok.anaBirim}</dd></div>)}</dl>
          {sonuc.tarihli.hareketler.length>0&&<div><h3>Hesaba katılan kaynaklar</h3><ul>{sonuc.tarihli.hareketler.map(o=><li key={o.kaynakId}>{o.gun} · {o.tur==='talep'?'Üretim ihtiyacı':'Beklenen giriş'}: {miktarYaz(o.miktar)} {sonuc.stok.anaBirim} · <a href={kaynakYolu(o.kaynakId)}>{kaynakEtiketi(o.kaynakId)}</a></li>)}</ul></div>}
          {sonuc.tarihli.dislananlar.length>0&&<div><h3>Hesaba katılmayan kaynaklar</h3><ul>{sonuc.tarihli.dislananlar.map((o,i)=><li key={o.kaynakId}>Kaynak {i+1}: {nedenler[o.neden]??'Doğrulanamadı'} · <a href={kaynakYolu(o.kaynakId)}>{kaynakEtiketi(o.kaynakId)}</a></li>)}</ul></div>}
        </section>}
        <Alert tone="warning">{aktarimHatasi}</Alert>
        {sonuc.tarihli&&<div style={{margin:'16px 0'}}><Alert tone="error">{planHatasi}</Alert>{kayitliPlanId?<div><Alert tone="success">İhtiyaç planı kaynak paylarıyla saklandı.</Alert><ButtonLabel as="a" href={'/panel/stok/ihtiyac-planlari?'+new URLSearchParams({plan:kayitliPlanId})}>Kayıtlı planı incele</ButtonLabel></div>:<Button disabled={!sonuc.erisim?.yazabilir||planKaydediliyor||planYenileGerekli||!sonuc.tarihli.veriYeterli||!sonuc.sonucKaniti} onClick={()=>void planSakla()}>{planKaydediliyor?'Plan saklanıyor…':'Planı sakla'}</Button>}<p>{sonuc.erisim?.mod==='salt_okunur'?'Şirket modu salt okunur; plan saklanamaz. ':''}Plan saklamak stok ayırmaz veya satın alma talebi oluşturmaz.{planYenileGerekli?' Kaynak değiştiği için yeniden hesaplayın.':''}</p></div>}
        {(hesapTuru!=='tarihli'||sonuc.erisim?.yazabilir) && !aktarimHatasi && aktarimEksigi!=='0.000' && kart && <div style={{ margin: "16px 0" }}><ButtonLabel as="a" href={ihtiyacTalepYolu({ stokId: kart.id, depoId, miktar: miktar.replace(",", "."), birim, ihtiyacTarihi: tarih,...(hesapTuru==='tarihli'?{hesapTuru:'tarihli' as const}:{}) })}>Eksik miktarla satın alma talebi hazırla</ButtonLabel><p>Talep formunda stok{hesapTuru==='tarihli'?' ve giriş tarihi doğrulamaları':''} yeniden kontrol edilir. Kaydetme ve onaya gönderme adımları satın alma ekranında tamamlanır.</p></div>}
        <p>Stok görünümü: {new Date(sonuc.alindigiZaman).toLocaleString("tr-TR")}</p>
        {sonuc.uyarilar.map(u => <p key={u}>{u}</p>)}
      </Card>
    </div>}
  </div>;
}
