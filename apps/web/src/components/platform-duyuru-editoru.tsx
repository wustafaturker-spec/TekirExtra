"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input, Modal } from "@/components/ui";
import { platformApi, platformDosyaYukle, PlatformApiHata } from "@/lib/platform-api";
import { useKaydedilmemisUyarisi } from "@/lib/use-kaydedilmemis-uyarisi";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { PlatformDuyuruYayini } from "./platform-duyuru-yayini";
import { DuyuruOnizleme } from "./duyuru-onizleme";
import { Check, FilePenLine, ImagePlus, Link2, LockKeyhole, Send, Users } from "lucide-react";
import { DUYURU_DURUMU } from "@/lib/platform-duyurulari";
import type { Duyuru, DuyuruIcerigi } from "@/lib/platform-duyurulari";

const bos: DuyuruIcerigi = { baslik: "", icerik: "", butonMetni: null, butonUrl: null };
function icerikAl(d: DuyuruIcerigi): DuyuruIcerigi {
  return { baslik: d.baslik, icerik: d.icerik, butonMetni: d.butonMetni, butonUrl: d.butonUrl };
}
export function PlatformDuyuruEditoru({ ilk, onKayit }: { ilk?: Duyuru; onKayit: (d: Duyuru) => void }) {
  const icerikRef = useRef<HTMLTextAreaElement>(null);
  const [kayit, setKayit] = useState(ilk);
  const [form, setForm] = useState<DuyuruIcerigi>(ilk ? icerikAl(ilk) : bos);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState(false);
  const [cakisma, setCakisma] = useState(false);
  const [onizleme, setOnizleme] = useState<(DuyuruIcerigi & { icerikHtml?: string }) | null>(null);
  const [gorselYukleniyor, setGorselYukleniyor] = useState(false), [gorselHata, setGorselHata] = useState("");
  const [arsivOnayi, setArsivOnayi] = useState(false);
  const [gecmisAcik, setGecmisAcik] = useState(false);
  const [gecmisSayfa, setGecmisSayfa] = useState(1);
  const gecmis = usePlatformVerisi<{ surum: number; zaman: string; icerik: Duyuru }[]>(gecmisAcik && kayit ? `/platform/duyurular/${kayit.id}/gecmis?sayfa=${gecmisSayfa}` : null);
  const degisti = JSON.stringify(form) !== JSON.stringify(kayit ? icerikAl(kayit) : bos);
  useKaydedilmemisUyarisi(degisti);
  const arsiv = kayit?.durum === "arsiv";
  const saltOkunur = Boolean(kayit && kayit.durum !== "taslak");
  function bicimlendir(tur: "strong" | "em" | "ul" | "ol") {
    const alan = icerikRef.current;
    if (!alan) return;
    const bas = alan.selectionStart, son = alan.selectionEnd;
    const secim = form.icerik.slice(bas, son) || (tur === "ul" || tur === "ol" ? "Liste öğesi" : "metin");
    const govde = tur === "strong" ? `**${secim}**` : tur === "em" ? `*${secim}*`
      : secim.split("\n").map((satir, i) => `${tur === "ul" ? "-" : `${i + 1}.`} ${satir}`).join("\n");
    const yeni = form.icerik.slice(0, bas) + govde + form.icerik.slice(son);
    setForm({ ...form, icerik: yeni });
    requestAnimationFrame(() => { alan.focus(); alan.setSelectionRange(bas + govde.length, bas + govde.length); });
  }
  async function gorselEkle(e: ChangeEvent<HTMLInputElement>) {
    const dosya = e.currentTarget.files?.[0]; e.currentTarget.value = "";
    if (!dosya || !kayit || kayit.durum !== "taslak" || gorselYukleniyor) return;
    setGorselYukleniyor(true); setGorselHata("");
    try {
      const gorsel = await platformDosyaYukle<{ markdown: string }>(`/platform/duyurular/${kayit.id}/gorsel`, dosya);
      const alan = icerikRef.current, konum = alan?.selectionStart ?? form.icerik.length;
      const on = form.icerik.slice(0, konum), arka = form.icerik.slice(konum);
      setForm({ ...form, icerik: `${on}${on && !on.endsWith("\n") ? "\n" : ""}${gorsel.markdown}${arka && !arka.startsWith("\n") ? "\n" : ""}${arka}` });
      requestAnimationFrame(() => { alan?.focus(); alan?.setSelectionRange(form.icerik.length + gorsel.markdown.length, form.icerik.length + gorsel.markdown.length); });
    } catch (hata) { setGorselHata(hata instanceof Error ? hata.message : "Görsel yüklenemedi."); }
    finally { setGorselYukleniyor(false); }
  }
  const kabul = (d: Duyuru) => { setKayit(d); setForm(icerikAl(d)); setCakisma(false); onKayit(d); gecmis.yenile(); };
  function hatayiYaz(e: unknown) { setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı."); setCakisma(e instanceof PlatformApiHata && e.durum === 409); }
  async function kaydet(e: FormEvent) {
    e.preventDefault(); if (islem || saltOkunur) return;
    setIslem(true); setHata(""); setBasari("");
    try {
      kabul(await platformApi<Duyuru>(kayit ? `/platform/duyurular/${kayit.id}` : "/platform/duyurular", {
        method: kayit ? "PATCH" : "POST", body: JSON.stringify({ ...form, ...(kayit ? { surum: kayit.surum } : {}) }),
      })); setBasari("Duyuru taslağı kaydedildi.");
    } catch (e) { hatayiYaz(e); } finally { setIslem(false); }
  }
  async function onizle() {
    setIslem(true); setHata("");
    try { setOnizleme(await platformApi<DuyuruIcerigi & { icerikHtml: string }>("/platform/duyurular/onizleme", { method: "POST", body: JSON.stringify(form) })); }
    catch (e) { hatayiYaz(e); } finally { setIslem(false); }
  }
  async function arsivle() {
    if (!kayit || islem) return;
    setIslem(true); setHata(""); setBasari("");
    try { kabul(await platformApi<Duyuru>(`/platform/duyurular/${kayit.id}/arsiv`, { method: "POST", body: JSON.stringify({ surum: kayit.surum }) })); setArsivOnayi(false); setBasari("Duyuru arşivlendi."); }
    catch (e) { setArsivOnayi(false); hatayiYaz(e); } finally { setIslem(false); }
  }
  async function gunceliYukle() {
    if (!kayit || islem || !window.confirm("Girdiğiniz değişiklikler bırakılacak. Güncel kayıt yüklensin mi?")) return;
    setIslem(true); setHata("");
    try { kabul(await platformApi<Duyuru>(`/platform/duyurular/${kayit.id}`)); }
    catch (e) { hatayiYaz(e); } finally { setIslem(false); }
  }
  return <div className="stack duyuru-editoru">
    <ol className="duyuru-akis" aria-label="Duyuru hazırlama adımları">
      <li aria-current={!saltOkunur && (!kayit || degisti) ? "step" : undefined} className={kayit && !degisti ? "is-complete" : ""}><span aria-hidden="true">{kayit && !degisti ? <Check size={17} /> : <FilePenLine size={17} />}</span><div><strong>İçeriği hazırlayın</strong><small>Mesajı yazın ve taslağı kaydedin</small></div></li>
      <li aria-current={kayit && !degisti && !saltOkunur ? "step" : undefined} className={saltOkunur ? "is-complete" : ""}><span aria-hidden="true"><Users size={17} /></span><div><strong>Hedefi belirleyin</strong><small>Kitle, gösterim ve yayın takvimi</small></div></li>
      <li aria-current={saltOkunur ? "step" : undefined}><span aria-hidden="true"><Send size={17} /></span><div><strong>Yayını yönetin</strong><small>Önizleme, onay ve etkileşim raporu</small></div></li>
    </ol>
    {kayit && <nav className="duyuru-bolum-gezinme" aria-label="Duyuru bölümleri"><a href="#duyuru-icerik-bolumu">İçerik</a>{!saltOkunur ? <><a href="#duyuru-hedef-kitle">Hedef kitle</a><a href="#duyuru-gosterim">Gösterim</a><a href="#duyuru-takvim">Takvim</a></> : <a href="#duyuru-yayin-bolumu">Yayın bilgileri</a>}{kayit.yayinSurumu && <a href="#duyuru-rapor">Rapor</a>}</nav>}
    <div className="duyuru-kayit-ozeti"><span className={`duyuru-kayit-durumu${degisti ? " is-dirty" : ""}`} aria-live="polite">{saltOkunur ? <LockKeyhole size={15} aria-hidden="true" /> : degisti || !kayit ? <FilePenLine size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{saltOkunur ? "İçerik salt okunur" : degisti ? "Kaydedilmemiş değişiklikler" : kayit ? "Tüm değişiklikler kaydedildi" : "Yeni taslak"}</span><span>{kayit ? `Sürüm ${kayit.surum}` : "Henüz kaydedilmedi"}{kayit?.updatedAt && ` · Son kayıt: ${new Date(kayit.updatedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} (Türkiye)`}</span></div>
    <Alert tone="error">{hata}</Alert>{basari && <p className="duyuru-basari" role="status">{basari}</p>}
    {cakisma && <Button disabled={islem} onClick={() => void gunceliYukle()}>Taslağı bırak ve güncel kaydı yükle</Button>}
    <Card className="duyuru-icerik-paneli" id="duyuru-icerik-bolumu" tabIndex={-1}><div className="duyuru-bolum-basligi"><span className="duyuru-adim">01</span><div><h2>Duyuru içeriği</h2><p className="muted">Başlığınızı, mesajınızı ve yönlendirme bağlantısını hazırlayın.</p></div></div><p className="muted">{arsiv ? "Arşivlenmiş duyuru. İçerik ve geçmiş salt okunur." : saltOkunur ? "Yayın içeriği salt okunur. Yayını durdurabilir veya arşivleyebilirsiniz." : "İçeriği kaydedin, ardından hedefi önizleyerek yayını onaylayın."}</p>
      <form onSubmit={(e) => void kaydet(e)}><fieldset className="platform-editor-fieldset" disabled={islem || saltOkunur || gorselYukleniyor}>
        <Field label="Duyuru başlığı" htmlFor="duyuru-baslik"><Input id="duyuru-baslik" placeholder="Örn. Yeni özellikler ve kullanım bilgileri" required minLength={3} maxLength={200} value={form.baslik} onChange={(e) => setForm({ ...form, baslik: e.target.value })} /><small className="duyuru-alan-sayaci">{form.baslik.length} / 200 karakter</small></Field>
        <Field label="Biçimlendirilmiş içerik" htmlFor="duyuru-icerik"><div className="duyuru-bicim-araclari" role="group" aria-label="İçerik biçimlendirme"><Button type="button" onClick={() => bicimlendir("strong")}><strong>Kalın</strong></Button><Button type="button" onClick={() => bicimlendir("em")}><em>İtalik</em></Button><Button type="button" onClick={() => bicimlendir("ul")}>Madde listesi</Button><Button type="button" onClick={() => bicimlendir("ol")}>Numaralı liste</Button></div><textarea ref={icerikRef} id="duyuru-icerik" className="input platform-textarea" required maxLength={20000} rows={10} placeholder="Duyurunuzun ana mesajını buraya yazın…" value={form.icerik} onChange={(e) => setForm({ ...form, icerik: e.target.value })} /><div className="duyuru-icerik-yardimi"><small>Kalın için **metin**, italik için *metin*, listeler için araçları kullanın.</small><small>{form.icerik.length.toLocaleString("tr-TR")} / 20.000</small></div></Field>
        {!saltOkunur && <section className="duyuru-gorsel-alani" aria-labelledby="duyuru-gorsel-basligi"><div className="duyuru-editor-alt-baslik"><ImagePlus size={22} aria-hidden="true" /><div><h3 id="duyuru-gorsel-basligi">Görselle destekleyin</h3><p>Bir ekran görüntüsü veya açıklayıcı görsel ekleyin.</p></div></div>{kayit?.durum === "taslak" ? <Field label="Görsel ekle (JPEG, PNG veya WebP; en fazla 5 MB)" htmlFor="duyuru-gorsel"><input className="duyuru-dosya-secimi" id="duyuru-gorsel" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="duyuru-gorsel-yardimi" onChange={(e) => void gorselEkle(e)} />{gorselYukleniyor && <span role="status">Görsel yükleniyor…</span>}<Alert tone="error">{gorselHata}</Alert><small id="duyuru-gorsel-yardimi">Her taslağa en fazla 20 görsel eklenebilir. Seçtiğiniz görsel metindeki imleç konumuna eklenir; ardından taslağı kaydedin.</small></Field> : <p className="duyuru-gorsel-bekliyor"><LockKeyhole size={16} aria-hidden="true" />Görsel eklemek için önce taslağı kaydedin.</p>}</section>}
        <fieldset className="duyuru-baglanti-alani"><legend>Yönlendirme düğmesi · İsteğe bağlı</legend><div className="duyuru-editor-alt-baslik"><Link2 size={22} aria-hidden="true" /><div><h3>Okuyucuyu bir sonraki adıma yönlendirin</h3><p>Düğme eklemek için metni ve bağlantıyı birlikte doldurun.</p></div></div><div className="duyuru-baglanti-alanlari">
          <Field label="Buton metni (isteğe bağlı)" htmlFor="duyuru-buton"><Input id="duyuru-buton" placeholder="Örn. Detayları incele" maxLength={80} value={form.butonMetni ?? ""} onChange={(e) => setForm({ ...form, butonMetni: e.target.value || null })} /><small>En fazla 80 karakter.</small></Field>
          <Field label="Buton bağlantısı (HTTPS veya /panel yolu)" htmlFor="duyuru-url"><Input id="duyuru-url" placeholder="/panel/duyurular veya https://…" maxLength={2000} aria-describedby="duyuru-baglanti-yardimi" value={form.butonUrl ?? ""} onChange={(e) => setForm({ ...form, butonUrl: e.target.value || null })} /><small id="duyuru-baglanti-yardimi">Panel içindeki bir sayfaya veya HTTPS adresine yönlendirin.</small></Field>
        </div>{Boolean(form.butonMetni) !== Boolean(form.butonUrl) && <p className="duyuru-baglanti-uyarisi">{form.butonMetni ? "Düğmenin çalışması için bağlantı adresini de ekleyin." : "Bağlantının görünmesi için düğme metnini de ekleyin."}</p>}</fieldset>
        <div className="duyuru-kaydet-satiri"><span>{degisti ? "Değişiklikleriniz kaydedildikten sonra yayına hazırlanabilir." : saltOkunur ? "Bu duyurunun içerik alanları düzenlemeye kapalı." : kayit ? "İçerik hazır. Hedefleme ve yayın bölümünden devam edebilirsiniz." : "Taslağınızı kaydederek hedefleme ve görsel eklemeyi açın."}</span>
        <Button type="submit" variant="primary" disabled={!degisti}>{islem ? "İşleniyor…" : "Taslağı kaydet"}</Button></div>
      </fieldset></form>
      <div className="duyuru-editor-islemleri"><Button disabled={islem} onClick={() => void onizle()}>Önizle</Button>{kayit && <Button onClick={() => setGecmisAcik(!gecmisAcik)} aria-expanded={gecmisAcik}>Değişiklik geçmişi</Button>}{kayit && !arsiv && <Button disabled={islem || degisti} onClick={() => setArsivOnayi(true)}>Arşivle</Button>}</div>
    </Card>
    {kayit && <PlatformDuyuruYayini key={`${kayit.id}:${kayit.surum}`} duyuru={kayit} kilitli={degisti || islem} onDegisti={(d, mesaj) => { kabul(d); setHata(""); setBasari(mesaj); }} />}
    {gecmisAcik && <Card className="duyuru-gecmis"><h2>Değişiklik geçmişi</h2>{gecmis.yukleniyor && <p role="status">Geçmiş yükleniyor…</p>}{gecmis.hata && <Alert tone="error">{gecmis.hata}<Button onClick={gecmis.yenile}>Tekrar dene</Button></Alert>}{gecmis.veri?.map((g) => <details key={g.surum}><summary>Sürüm {g.surum} · {new Date(g.zaman).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })} · {DUYURU_DURUMU[g.icerik.durum]}</summary><DuyuruOnizleme veri={g.icerik} /></details>)}<div className="platform-row-actions"><Button disabled={gecmis.yukleniyor || gecmisSayfa === 1} onClick={() => setGecmisSayfa(gecmisSayfa - 1)}>Önceki</Button><span>Sayfa {gecmisSayfa}</span><Button disabled={gecmis.yukleniyor || !gecmis.veri || gecmis.veri.length < 25} onClick={() => setGecmisSayfa(gecmisSayfa + 1)}>Sonraki</Button></div></Card>}
    {onizleme && <Modal baslik="Duyuru önizlemesi" aciklama="İçeriğinizi ve bağlantınızı yayınlamadan önce kontrol edin." genis onKapat={() => setOnizleme(null)} altBilgi={<Button onClick={() => setOnizleme(null)}>Düzenlemeye dön</Button>}><DuyuruOnizleme veri={onizleme} /></Modal>}
    {arsivOnayi && <Modal baslik="Duyuruyu arşivle" onKapat={() => { if (!islem) setArsivOnayi(false); }}><p>Arşivlenen duyuru tekrar düzenlenemez. Değişiklik geçmişi korunur.</p><Button disabled={islem} onClick={() => void arsivle()}>Arşivlemeyi onayla</Button></Modal>}
  </div>;
}
