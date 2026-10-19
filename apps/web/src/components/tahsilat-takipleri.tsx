"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CariSecModali } from "@/components/cari-sec-modali";
import { api, ApiHata } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Select, TableWrap } from "@/components/ui";
import { sozGunuGecerli, turkiyeGunu } from "@/lib/odeme-sozu";
import { ArrowUpRight, CalendarDays, CheckCircle2, ChevronRight, ListChecks, MessageSquare, RefreshCw, Search, UserRound } from "lucide-react";
import { sorumlulariDogrula, takipUuid, takipAktif, takipDetayiniDogrula, takipDurumAdi, takipListesiniDogrula, type TakipDetayi, type TakipListesi, type TahsilatTakibi, type TakipDurumu } from "@/lib/tahsilat-takibi";
const gun = (v: string | null) => v ? v.split("-").reverse().join(".") : "—";
const kanalAdi: Record<string,string> = { telefon:"Telefon",eposta:"E-posta",ziyaret:"Ziyaret",not:"Not" };
export function TahsilatTakipleri({ cariId, rol, benId, baslangicTakipId }: { cariId?: string; rol: string | null; benId?: string; baslangicTakipId?: string | null }) {
  const [gorunum, setGorunum] = useState(cariId ? "tum" : "bugun"), [benim, setBenim] = useState(false), [imlec, setImlec] = useState<string | null>(null);
  const [veri, setVeri] = useState<TakipListesi | null>(null), [hata, setHata] = useState(""), [bilgi, setBilgi] = useState("");
  const [yenile, setYenile] = useState(0), [yuk, setYuk] = useState(true), [mesgul, setMesgul] = useState(false), [yeni, setYeni] = useState(false), [secili, setSecili] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const [cariSec, setCariSec] = useState(false), [yeniCari, setYeniCari] = useState<{id:string;unvan:string}|null>(null);
  const okur = ["yonetici", "muhasebe", "mali_musavir", "salt_okunur"].includes(rol ?? "");
  useEffect(() => {
    if (cariId || !okur) return;
    if (baslangicTakipId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(baslangicTakipId)) { setSecili(baslangicTakipId); setGorunum("tum"); }
    else setSecili(null);
  }, [cariId, okur, baslangicTakipId]);
  const sorumluUserId = benim ? benId : undefined;
  useEffect(() => {
    let etkin = true; setVeri(null); setHata(""); setYuk(true); if (!okur) { setYuk(false); return; }
    const kapsam = { cariId, gorunum, sorumluUserId };
    const sorgu = new URLSearchParams({ gorunum, ...(cariId ? { cariId } : {}), ...(sorumluUserId ? { sorumluUserId } : {}), ...(imlec ? { imlec } : {}) });
    void api<unknown>(`/cari/tahsilat-takipleri?${sorgu}`).then((r) => takipListesiniDogrula(r, kapsam)).then((r) => { if (etkin) setVeri(r); }).catch((e) => { if (etkin) setHata(e instanceof Error ? e.message : "Takipler alınamadı"); }).finally(() => { if (etkin) setYuk(false); });
    return () => { etkin = false; };
  }, [cariId, gorunum, sorumluUserId, imlec, yenile, okur]);
  if (!okur) return null;
  const yazabilir = Boolean(veri && veri.kullanimModu !== "salt_okunur" && ["yonetici", "muhasebe"].includes(rol ?? ""));
  const gorunen = veri?.kayitlar.filter(s => `${s.cari.unvan} ${s.konu} ${s.sorumlu.adSoyad}`.toLocaleLowerCase("tr-TR").includes(arama.trim().toLocaleLowerCase("tr-TR"))) ?? [];
  function tazele() { setImlec(null); setYenile((n) => n + 1); }
  return <Card pad={false} className="collection-panel"><section aria-label="Tahsilat takipleri" className="stack collection-followups">
    <div className="collection-panel__head"><div className="collection-heading"><span className="collection-heading__icon"><ListChecks size={20} aria-hidden="true"/></span><div><h2>{cariId ? "Takip ve görüşmeler" : "Günlük tahsilat işleri"}</h2><p>Sonraki adımı planlayın, sorumluyu belirleyin, görüşmeleri kaydedin.</p></div></div><Button disabled={mesgul || yuk || yeni} onClick={tazele}><RefreshCw size={15} aria-hidden="true"/>Takipleri yenile</Button></div>
    <div className="collection-toolbar">
    {!cariId && <div className="collection-filter-controls"><label className="collection-select-label">Görünüm<Select aria-label="İş listesi" value={gorunum} disabled={mesgul || yeni} onChange={(e) => { setGorunum(e.target.value); setImlec(null); setSecili(null); setArama(""); }}><option value="bugun">Bugün ve gecikenler</option><option value="itiraz">Açık itirazlar</option><option value="tum">Tüm takipler</option></Select></label>{benId && <label className="collection-checkbox"><input type="checkbox" checked={benim} disabled={mesgul || yeni} onChange={(e) => { setBenim(e.target.checked); setImlec(null); setSecili(null); }} /> Yalnız bana atananlar</label>}</div>}
    <label className="collection-search"><Search size={16} aria-hidden="true"/><Input aria-label="Bu sayfadaki takiplerde ara" placeholder="Cari, konu veya sorumlu ara…" value={arama} onChange={e => setArama(e.target.value)}/></label></div>
    <div className="collection-feedback">
    <Alert tone="error">{hata}</Alert><Alert tone="success">{bilgi}</Alert>
    {yuk && <p role="status">Tahsilat takipleri yükleniyor…</p>}
    </div>
    {veri && <>
      <div className="collection-list-meta"><span><strong>{veri.toplam}</strong> takip <span className="collection-meta-divider">/</span> {gun(veri.bugun)}</span><div className="row-tight"><Badge>{veri.kullanimModu === "salt_okunur" ? "Salt okunur" : veri.kullanimModu === "pilot" ? "Pilot" : "Açık"}</Badge>{yazabilir && <Button variant="primary" disabled={yeni || Boolean(secili) || mesgul || Boolean(imlec) || Boolean(cariId && veri.kayitlar.some(takipAktif))} onClick={() => { if(cariId) setYeni(true); else setCariSec(true); setBilgi(""); }}>Yeni tahsilat takibi</Button>}</div></div>
      {!yazabilir && <p className="collection-readonly">Bu görünüm salt okunur.</p>}
      {gorunen.length === 0 ? <div className="collection-empty"><span><CheckCircle2 size={26} aria-hidden="true"/></span><h3>{arama ? "Aramanıza uygun takip bulunamadı" : "Bu görünümde tahsilat takibi yok."}</h3><p>{arama ? "Bu sayfadaki kayıtlar için farklı bir cari, konu veya sorumlu arayın." : "Diğer takipleri görmek için görünümü değiştirin. Yeni tahsilat takibi düğmesiyle bir cari seçip sonraki adımı planlayabilirsiniz."}</p>{arama && <Button onClick={() => setArama("")}>Aramayı temizle</Button>}</div> : <TableWrap><caption>Tahsilat iş listesi</caption><thead><tr><th>Cari ve konu</th><th>Sorumlu</th><th>Durum</th><th>Sonraki işlem</th><th>İşlem</th></tr></thead><tbody>{gorunen.map((s) => <tr key={s.id} className={takipAktif(s) && s.sonrakiIslemTarihi && s.sonrakiIslemTarihi < veri.bugun ? "collection-row--overdue" : ""}>
        <td data-label="Cari ve konu"><div className="collection-customer"><span className="collection-avatar" aria-hidden="true">{s.cari.unvan.trim().slice(0,2).toLocaleUpperCase("tr-TR")}</span><div><a href={`/panel/cari/${s.cari.id}`}>{s.cari.unvan}<ArrowUpRight size={13} aria-hidden="true"/></a><p>{s.konu}</p>{s.neden === "itiraz" && <Badge variant="warning">İtiraz</Badge>}</div></div></td>
        <td data-label="Sorumlu"><span className="collection-assignee"><UserRound size={15} aria-hidden="true"/>{s.sorumlu.adSoyad}</span>{!s.sorumlu.aktif && <p className="muted">Sorumlu pasif</p>}</td><td data-label="Durum"><Badge variant={s.durum === "tamamlandi" ? "success" : s.durum === "acik" ? "info" : "neutral"}>{takipDurumAdi[s.durum]}</Badge></td>
        <td data-label="Sonraki işlem"><span className="collection-date"><CalendarDays size={15} aria-hidden="true"/>{gun(s.sonrakiIslemTarihi)}</span>{s.sonrakiIslem && <p>{s.sonrakiIslem}</p>}{takipAktif(s) && s.sonrakiIslemTarihi && s.sonrakiIslemTarihi < veri.bugun && <Badge variant="warning">İşlem günü geçti</Badge>}</td>
        <td data-label="İşlem"><Button size="sm" disabled={yeni || mesgul} aria-label={`Takibi incele: ${s.cari.unvan}`} onClick={() => setSecili(s.id)}>İncele<ChevronRight size={14} aria-hidden="true"/></Button></td>
      </tr>)}</tbody></TableWrap>}
      <footer className="collection-footer"><span>{gorunen.length} kayıt gösteriliyor<small>Arama bu sayfadaki takipleri kapsar.</small></span><div className="row-tight">{imlec && <Button disabled={mesgul || yeni} onClick={tazele}>Liste başına dön</Button>}{veri.sonrakiImlec && <Button disabled={mesgul || yeni} onClick={() => { setImlec(veri.sonrakiImlec); setSecili(null); setArama(""); }}>Sonraki takipler<ChevronRight size={14} aria-hidden="true"/></Button>}</div></footer>
    </>}
    {cariSec && <CariSecModali baslik="Takip oluşturulacak cariyi seçin" onKapat={() => setCariSec(false)} onSec={c => { setYeniCari(c); setCariSec(false); setYeni(true); }}/>}
    {yeni && yeniCari && <p className="collection-readonly">Takip oluşturulan cari: <strong>{yeniCari.unvan}</strong></p>}
    {yeni && (cariId || yeniCari) && <TakipFormu tur="yeni" cariId={(cariId ?? yeniCari!.id)} yazabilir={yazabilir} onMesgul={setMesgul} onKapat={() => setYeni(false)} onKaydedildi={(id) => { setYeni(false); setYeniCari(null); setBilgi("Takip kaydedildi."); if(!cariId){setGorunum("tum");setBenim(false);setArama("");if(id)setSecili(id);} tazele(); }} />}
    {secili && <TakipDetay key={secili} id={secili} cariId={cariId} rol={rol} izin={yazabilir} onMesgul={setMesgul} onDegisti={tazele} onKapat={() => setSecili(null)} />}
    {hata && imlec && <Button disabled={mesgul} onClick={tazele}>Listeyi baştan yükle</Button>}
  </section></Card>;
}

function TakipDetay({ id, cariId, rol, izin, onMesgul, onDegisti, onKapat }: { id: string; cariId?: string; rol: string | null; izin: boolean; onMesgul: (v: boolean) => void; onDegisti: () => void; onKapat: () => void }) {
  const detayRef = useRef<HTMLElement>(null);
  const [veri, setVeri] = useState<TakipDetayi | null>(null), [hata, setHata] = useState(""), [yenile, setYenile] = useState(0), [mesgul, setMesgul] = useState(false);
  const [form, setForm] = useState<{ tur: "guncelle" | "gorusme"; kayit: TahsilatTakibi } | null>(null);
  useEffect(() => { detayRef.current?.focus({ preventScroll: true }); detayRef.current?.scrollIntoView({ block: "nearest" }); }, [id]);
  useEffect(() => { let etkin = true; setVeri(null); setHata(""); void api<unknown>(`/cari/tahsilat-takipleri/${id}`).then((r) => takipDetayiniDogrula(r,id,cariId)).then((r) => { if (etkin) setVeri(r); }).catch((e) => { if (etkin) setHata(e instanceof Error ? e.message : "Takip alınamadı"); }); return () => { etkin = false; }; }, [id,cariId,yenile]);
  const yazabilir = Boolean(izin && veri && veri.kullanimModu !== "salt_okunur" && ["yonetici","muhasebe"].includes(rol ?? ""));
  return <section ref={detayRef} tabIndex={-1} aria-label="Tahsilat takip detayı" className="stack collection-detail">
    <div className="collection-detail__top"><span className="collection-eyebrow"><MessageSquare size={14} aria-hidden="true"/>TAKİP DETAYI</span><div className="row-tight"><Button size="sm" disabled={mesgul} onClick={() => setYenile((n) => n+1)}><RefreshCw size={14} aria-hidden="true"/>Takip detayını yenile</Button><Button size="sm" disabled={mesgul} onClick={onKapat}>Detayı kapat</Button></div></div>
    <Alert tone="error">{hata}</Alert>
    {!veri && !hata && <p role="status">Takip detayı yükleniyor…</p>}
    {veri && <>
      <div className="collection-detail__identity"><div><h3>{veri.kayit.cari.unvan}</h3><p>{veri.kayit.konu}</p></div><Badge variant={veri.kayit.durum === "tamamlandi" ? "success" : "info"}>{takipDurumAdi[veri.kayit.durum]}</Badge></div>
      <dl className="collection-detail__facts"><div><dt>Sorumlu</dt><dd><UserRound size={15} aria-hidden="true"/>{veri.kayit.sorumlu.adSoyad}</dd></div><div><dt>Sonraki işlem günü</dt><dd><CalendarDays size={15} aria-hidden="true"/>{gun(veri.kayit.sonrakiIslemTarihi)}</dd></div><div><dt>Planlanan işlem</dt><dd>{veri.kayit.sonrakiIslem ?? "Planlanan işlem yok"}</dd></div></dl>
      {yazabilir && takipAktif(veri.kayit) && !form && <div className="row-tight collection-detail__actions"><Button variant="primary" onClick={() => setForm({ tur:"gorusme",kayit:veri.kayit })}><MessageSquare size={15} aria-hidden="true"/>Görüşme ekle</Button><Button onClick={() => setForm({ tur:"guncelle",kayit:veri.kayit })}>Takibi düzenle</Button></div>}
      <div className="collection-timeline"><h4>Görüşmeler <span>{veri.gorusmeler.length} / {veri.gorusmeSayisi}</span></h4>
      {veri.gorusmeler.length === 0 ? <div className="collection-timeline__empty"><MessageSquare size={20} aria-hidden="true"/><div><strong>Henüz görüşme kaydı yok.</strong><p>Müşteriyle yaptığınız görüşmeleri buradan kaydederek takibin geçmişini oluşturun.</p></div></div> : veri.gorusmeler.map((g) => <article key={g.id} className="collection-timeline__entry"><span className="collection-timeline__dot" aria-hidden="true"/><div className="between"><strong>{kanalAdi[g.kanal]}</strong><time>{gun(g.gorusmeTarihi)}</time></div><p style={{ whiteSpace:"pre-wrap" }}>{g.not}</p></article>)}
      </div><details className="collection-audit"><summary>İşlem geçmişi ({veri.olaylar.length} / {veri.olaySayisi})</summary>{veri.olaylar.length === 0 && <p>Henüz işlem geçmişi yok.</p>}{veri.olaylar.map((o) => <p key={o.id}><time>{new Date(o.createdAt).toLocaleString("tr-TR",{timeZone:"Europe/Istanbul"})}</time><span>{o.aciklama}</span></p>)}</details>
    </>}
    {form && <TakipFormu key={`${form.tur}:${form.kayit.surum}`} tur={form.tur} kayit={form.kayit} cariId={form.kayit.cari.id} yazabilir={yazabilir} onMesgul={(v) => { setMesgul(v); onMesgul(v); }} onKapat={() => setForm(null)} onKaydedildi={() => { setForm(null); setYenile((n) => n+1); onDegisti(); }} />}
  </section>;
}

function TakipFormu({ tur, kayit:s, cariId, yazabilir, onMesgul, onKapat, onKaydedildi }: { tur:"yeni"|"guncelle"|"gorusme"; kayit?:TahsilatTakibi; cariId:string; yazabilir:boolean; onMesgul:(v:boolean)=>void; onKapat:()=>void; onKaydedildi:(id?:string)=>void }) {
  const formRef = useRef<HTMLElement>(null);
  useEffect(() => { formRef.current?.focus({preventScroll:true}); formRef.current?.scrollIntoView({block:"nearest"}); }, []);
  const fid = useId(), [konu,setKonu] = useState(""), [neden,setNeden] = useState(s?.neden ?? "tahsilat"), [durum,setDurum] = useState<TakipDurumu>(s?.durum ?? "acik");
  const [sorumlu,setSorumlu] = useState(s?.sorumlu.id ?? ""), [kisiler,setKisiler] = useState<{id:string;adSoyad:string}[]>([]), [kisiHata,setKisiHata] = useState(""), [kisiYenile,setKisiYenile] = useState(0), [kisiYuk,setKisiYuk] = useState(tur !== "gorusme");
  const [tarih,setTarih] = useState(s?.sonrakiIslemTarihi ?? turkiyeGunu()), [islem,setIslem] = useState(s?.sonrakiIslem ?? ""), [gerekce,setGerekce] = useState(""), [kanal,setKanal] = useState("telefon"), [gorusmeGunu,setGorusmeGunu] = useState(turkiyeGunu()), [not,setNot] = useState("");
  const [hata,setHata] = useState(""), [mesgul,setMesgul] = useState(false), [kilitli,setKilitli] = useState(false);
  const etkin=useRef(false), kilit=useRef(false), tekrar=useRef<{icerik:string;anahtar:string}|null>(null);
  useEffect(()=>{etkin.current=true;return()=>{etkin.current=false;};},[]);
  useEffect(()=>{let acik=true;if(tur==="gorusme")return;setKisiYuk(true);setKisiHata("");void api<unknown>("/cari/tahsilat-takipleri/sorumlular").then(sorumlulariDogrula).then(r=>{if(acik){setKisiler(r.kayitlar);if(!s)setSorumlu(r.varsayilanUserId??"");}}).catch(e=>{if(acik)setKisiHata(e instanceof Error?e.message:"Sorumlular alınamadı");}).finally(()=>{if(acik)setKisiYuk(false);});return()=>{acik=false;};},[tur,kisiYenile]);
  const kapali=["tamamlandi","iptal"].includes(durum), disabled=mesgul||kilitli||!yazabilir;
  async function kaydet(e:React.FormEvent){
    e.preventDefault();if(kilit.current||disabled)return;setHata("");
    try{
      let g:Record<string,unknown>;
      if(tur==="gorusme"){
        if(!sozGunuGecerli(gorusmeGunu)||gorusmeGunu>turkiyeGunu()||not.trim().length<2)throw new Error("Görüşme günü gelecekte olamaz; en az iki karakter not yazın.");
        g={beklenenSurum:s!.surum,kanal,gorusmeTarihi:gorusmeGunu,not:not.trim()};
      }else{
        if(kisiYuk||kisiHata||!sorumlu)throw new Error("Geçerli bir sorumlu seçin.");
        if(!kapali&&(!sozGunuGecerli(tarih)||tarih<turkiyeGunu()||islem.trim().length<2))throw new Error("Sonraki işlem ve bugünden önce olmayan bir gün gerekli.");
        const ortak={sorumluUserId:sorumlu,neden,sonrakiIslemTarihi:kapali?null:tarih,sonrakiIslem:kapali?null:islem.trim()};
        if(tur==="yeni"){if(konu.trim().length<2)throw new Error("Takip konusu gerekli.");g={...ortak,cariId,konu:konu.trim()};}
        else{if(gerekce.trim().length<2)throw new Error("Değişiklik gerekçesi gerekli.");g={...ortak,durum,beklenenSurum:s!.surum,gerekce:gerekce.trim()};}
      }
      if(tur!=="guncelle"){const icerik=JSON.stringify(g);if(tekrar.current?.icerik!==icerik)tekrar.current={icerik,anahtar:crypto.randomUUID()};g.istekAnahtari=tekrar.current.anahtar;}
      kilit.current=true;setMesgul(true);onMesgul(true);
      const yol=tur==="yeni"?"/cari/tahsilat-takipleri":`/cari/tahsilat-takipleri/${s!.id}${tur==="gorusme"?"/gorusmeler":""}`;
      const sonuc = await api<{id?:unknown}>(yol,{method:tur==="guncelle"?"PATCH":"POST",body:JSON.stringify(g),...(tekrar.current?{headers:{"Idempotency-Key":tekrar.current.anahtar}}:{})});
      if(etkin.current)onKaydedildi(takipUuid(sonuc?.id) ? sonuc.id as string : undefined);
    }catch(e){if(etkin.current){if(e instanceof ApiHata&&[403,409].includes(e.durum))setKilitli(true);setHata(e instanceof Error?e.message:"İşlem kaydedilemedi");}}
    finally{kilit.current=false;if(etkin.current){setMesgul(false);onMesgul(false);}}
  }
  return <section ref={formRef} tabIndex={-1} aria-label="Tahsilat takip işlemi" className="stack collection-form"><div className="collection-form__head"><h3>{tur==="yeni"?"Yeni tahsilat takibi":tur==="gorusme"?"Görüşme kaydı":"Takibi düzenle"}</h3><p>{tur === "gorusme" ? "Görüşmenin detaylarını ve müşteriyle kararlaştırdığınız adımları kaydedin." : "Sorumluyu ve sonraki adımı belirleyerek tahsilat planınızı netleştirin."}</p></div>
    <Alert tone="error">{hata}</Alert>{kilitli&&<Alert tone="warning">Takip veya erişim değişti. Taslağınız korunuyor. Güncel kaydı inceleyip işlemi kapatarak yeniden açın.</Alert>}
    <form className="collection-form__grid" onSubmit={e=>void kaydet(e)}>
      {tur==="gorusme"?<>
        <p className="muted">Kanal yalnız görüşmenin kaydıdır; e-posta veya mesaj gönderilmez.</p>
        <Field label="Görüşme kanalı" htmlFor={`${fid}-kanal`}><Select id={`${fid}-kanal`} value={kanal} disabled={disabled} onChange={e=>setKanal(e.target.value)}><option value="telefon">Telefon</option><option value="eposta">E-posta</option><option value="ziyaret">Ziyaret</option><option value="not">Not</option></Select></Field>
        <Field label="Görüşme günü" htmlFor={`${fid}-gun`}><Input id={`${fid}-gun`} type="date" required max={turkiyeGunu()} value={gorusmeGunu} disabled={disabled} onChange={e=>setGorusmeGunu(e.target.value)}/></Field>
        <Field label="Görüşme notu" htmlFor={`${fid}-not`}><textarea id={`${fid}-not`} className="textarea" required minLength={2} maxLength={2000} value={not} disabled={disabled} onChange={e=>setNot(e.target.value)}/></Field>
      </>:<>
        {tur==="yeni"&&<Field label="Takip konusu" htmlFor={`${fid}-konu`}><Input id={`${fid}-konu`} required minLength={2} maxLength={200} value={konu} disabled={disabled} onChange={e=>setKonu(e.target.value)}/></Field>}
        <Alert tone="error">{kisiHata}</Alert>{kisiHata&&<Button type="button" disabled={disabled||kisiYuk} onClick={()=>setKisiYenile(n=>n+1)}>Sorumluları yeniden dene</Button>}
        <Field label="Takip sorumlusu" htmlFor={`${fid}-sorumlu`}><Select id={`${fid}-sorumlu`} required value={sorumlu} disabled={disabled||kisiYuk} onChange={e=>setSorumlu(e.target.value)}><option value="">Sorumlu seçin</option>{s&&!kisiler.some(u=>u.id===s.sorumlu.id)&&<option value={s.sorumlu.id}>{s.sorumlu.adSoyad} (mevcut sorumlu)</option>}{kisiler.map(u=><option key={u.id} value={u.id}>{u.adSoyad}</option>)}</Select></Field>
        <Field label="Takip nedeni" htmlFor={`${fid}-neden`}><Select id={`${fid}-neden`} value={neden} disabled={disabled} onChange={e=>setNeden(e.target.value as "tahsilat"|"itiraz")}><option value="tahsilat">Tahsilat</option><option value="itiraz">İtiraz</option></Select></Field>
        {tur==="guncelle"&&<Field label="Takip durumu" htmlFor={`${fid}-durum`}><Select id={`${fid}-durum`} value={durum} disabled={disabled} onChange={e=>setDurum(e.target.value as TakipDurumu)}>{Object.entries(takipDurumAdi).map(([v,ad])=><option key={v} value={v}>{ad}</option>)}</Select></Field>}
        {!kapali&&<><Field label="Sonraki işlem günü" htmlFor={`${fid}-tarih`}><Input id={`${fid}-tarih`} type="date" required min={turkiyeGunu()} value={tarih} disabled={disabled} onChange={e=>setTarih(e.target.value)}/><div className="row-tight collection-date-shortcuts">{[["Bugün",0],["Yarın",1],["Bir hafta sonra",7]].map(([ad,ek]) => <Button key={ad} type="button" size="sm" disabled={disabled} onClick={() => { const d=new Date(`${turkiyeGunu()}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+Number(ek));setTarih(d.toISOString().slice(0,10)); }}>{ad}</Button>)}</div></Field><Field label="Sonraki işlem" htmlFor={`${fid}-islem`}><Input id={`${fid}-islem`} required minLength={2} maxLength={200} value={islem} disabled={disabled} onChange={e=>setIslem(e.target.value)}/></Field></>}
        {tur==="guncelle"&&<Field label="Değişiklik gerekçesi" htmlFor={`${fid}-gerekce`}><textarea id={`${fid}-gerekce`} className="textarea" required minLength={2} maxLength={2000} value={gerekce} disabled={disabled} onChange={e=>setGerekce(e.target.value)}/></Field>}
        {kapali&&<p>Bu takip sonlandırılır ve yeniden açılmaz. Tamamlamak, faturanın ödendiği anlamına gelmez.</p>}
      </>}
      <div className="row-tight"><Button type="submit" variant="primary" disabled={disabled||(tur!=="gorusme"&&(kisiYuk||Boolean(kisiHata)))}>{mesgul?"Kaydediliyor…":tur==="yeni"?"Takibi oluştur":tur==="gorusme"?"Görüşmeyi kaydet":"Takip değişikliğini kaydet"}</Button><Button type="button" disabled={mesgul} onClick={onKapat}>Vazgeç</Button></div>
    </form>
  </section>;
}
