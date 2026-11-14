"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { bugunTR, takvimGunuMu } from "@tekirextra/shared";
import { Alert, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { platformApi } from "@/lib/platform-api";
import { type FirmaIstatistikRaporu, type Metrikler, MODUL_ADI, donemFarki } from "@/lib/platform-istatistikleri";
import { PLANLAR, tarih } from "@/lib/platform-firmalar";
import { PlatformBuyumeOzeti } from "@/components/platform-buyume-ozeti";
import { PlatformEntegrasyonTalepleri } from "@/components/platform-entegrasyon-talepleri";
import { PlatformKullanimaBaslama, PlatformBekleyenIsler } from "@/components/platform-kullanim-operasyon";
import { PlatformOperasyonGecmisi } from "@/components/platform-operasyon-gecmisi";

const gunEkle = (gun: string, fark: number) => new Date(Date.parse(`${gun}T00:00:00Z`) + fark * 86400000).toISOString().slice(0, 10);
const sayi = (n: number | null) => n === null ? "—" : n.toLocaleString("tr-TR");
function filtreYaz(ek: Record<string, string>, detay = false) {
  const url = new URL(window.location.href);
  const genel = ["baslangic", "bitis", "plan", "firma"].some((k) => k in ek);
  if (genel || "olcut" in ek) url.searchParams.delete("sayfa");
  if (genel || "baslamaDurum" in ek) url.searchParams.delete("baslamaSayfa");
  if (genel || "operasyon" in ek) url.searchParams.delete("operasyonSayfa");
  if (genel || "operasyonGun" in ek) url.searchParams.delete("operasyonGecmisSayfa");
  if (genel) url.searchParams.delete("operasyonGun");
  for (const [k, v] of Object.entries(ek)) { if (v) url.searchParams.set(k, v); else url.searchParams.delete(k); }
  if (detay) url.hash = "istatistik-firmalar";
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  if (detay) document.getElementById("istatistik-firmalar")?.scrollIntoView({ block: "start" });
}
function Istatistikler() {
  const p = useSearchParams();
  const bugun = bugunTR();
  const baslangic = p.get("baslangic") && takvimGunuMu(p.get("baslangic")!) ? p.get("baslangic")! : gunEkle(bugun, -6);
  const bitis = p.get("bitis") && takvimGunuMu(p.get("bitis")!) ? p.get("bitis")! : bugun;
  const plan = (p.get("plan") ?? "").slice(0, 40);
  const firma = p.get("firma") ?? "";
  const olcut = ["etkin", "giris", "islem"].includes(p.get("olcut") ?? "") ? p.get("olcut")! : "etkin";
  const hamSayfa = Number(p.get("sayfa") ?? 1);
  const sayfa = Number.isInteger(hamSayfa) && hamSayfa > 0 && hamSayfa <= 100000 ? hamSayfa : 1;
  const baslamaDurum = ["baslamayan", "baslayan", "belirsiz"].includes(p.get("baslamaDurum") ?? "") ? p.get("baslamaDurum")! : "baslamayan";
  const operasyon = ["hepsi", "gorev", "fatura", "iade"].includes(p.get("operasyon") ?? "") ? p.get("operasyon")! : "hepsi";
  const sayfaOku = (ad: string) => { const n = Number(p.get(ad) ?? 1); return Number.isInteger(n) && n > 0 && n <= 100000 ? String(n) : "1"; };
  const sorgu = new URLSearchParams({ baslangic, bitis, plan, olcut, sayfa: String(sayfa), baslamaDurum, baslamaSayfa: sayfaOku("baslamaSayfa"), operasyon, operasyonSayfa: sayfaOku("operasyonSayfa"), ...(firma ? { firma } : {}) });
  const operasyonGun = p.get("operasyonGun");
  if (operasyonGun && takvimGunuMu(operasyonGun) && operasyonGun >= baslangic && operasyonGun <= bitis) sorgu.set("operasyonGun", operasyonGun);
  sorgu.set("operasyonGecmisSayfa", sayfaOku("operasyonGecmisSayfa"));
  const { veri, yukleniyor, hata, yenile } = usePlatformVerisi<FirmaIstatistikRaporu>(`/platform/istatistikler?${sorgu}`);
  const [islem, setIslem] = useState(false);
  const [islemHatasi, setIslemHatasi] = useState("");
  const [basari, setBasari] = useState("");
  const [bekleyen, setBekleyen] = useState(0);
  async function yenidenHesapla() {
    if (!veri || islem) return;
    setIslem(true); setIslemHatasi(""); setBasari(""); setBekleyen(0);
    try {
      const sonuc = await platformApi<{ mesaj: string; bekleyen?: number }>("/platform/istatistikler/yeniden-hesapla", { method: "POST", body: JSON.stringify({ baslangic: hesapBaslangic, bitis }) });
      setBasari(sonuc.mesaj); setBekleyen(sonuc.bekleyen ?? 0); yenile();
    } catch (e) { setIslemHatasi(e instanceof Error ? e.message : "İstatistikler hesaplanamadı."); }
    finally { setIslem(false); }
  }
  const hesapBaslangic = veri && baslangic < veri.olcum.baslangic ? veri.olcum.baslangic : baslangic;
  const hesapGun = Math.round((Date.parse(bitis) - Date.parse(hesapBaslangic)) / 86400000) + 1;
  const varsayilanPlanlar = [...PLANLAR, { kod: "v1", ad: "Profesyonel (eski kayıt)" }];
  const planlar = Array.from(new Set([...varsayilanPlanlar.map((p) => p.kod), ...(veri?.guncel.planlar.map((p) => p.kod) ?? []), ...(plan ? [plan] : [])]));
  const planAdi = (kod: string) => varsayilanPlanlar.find((p) => p.kod === kod)?.ad ?? kod;
  const firmaYolu = (goster = "hepsi", kod = plan) => firma ? `/platform/firmalar/${firma}` : `/platform/firmalar?${new URLSearchParams({ goster, ...(kod ? { plan: kod } : {}) })}`;
  const metrikAdlari: [keyof Metrikler, string, string][] = [["etkinFirma", "Etkin firma", "etkin"], ["etkinKullanici", "Tekil etkin kullanıcı", "etkin"], ["giris", "Başarılı giriş", "giris"], ["islem", "Kayda geçen modül işlemi", "islem"]];
  return <>
    <PageHeader title="Firma istatistikleri" subtitle="Gözlenen kullanımı ve güncel abonelik durumunu inceleyin." actions={<Button disabled={yukleniyor || islem} onClick={yenile}>Yenile</Button>} />
    {firma && <p>Firma filtresi etkin. <Link href={`/platform/firmalar/${firma}`}>Firma detayına dön</Link> · <Button size="sm" onClick={() => filtreYaz({ firma: "" })}>Tüm firmaları göster</Button></p>}
    <Card title="Rapor kapsamı"><div className="platform-stats-filters">
      <Field label="İstatistik başlangıcı"><Input type="date" max={bugun} value={baslangic} onChange={(e) => filtreYaz({ baslangic: e.target.value })} /></Field>
      <Field label="İstatistik bitişi"><Input type="date" max={bugun} value={bitis} onChange={(e) => filtreYaz({ bitis: e.target.value })} /></Field>
      <Field label="Paket"><Select value={plan} onChange={(e) => filtreYaz({ plan: e.target.value })}><option value="">Tüm paketler</option>{planlar.map((kod) => <option key={kod} value={kod}>{planAdi(kod)}</option>)}</Select></Field>
    </div><div className="platform-row-actions"><Button size="sm" onClick={() => filtreYaz({ baslangic: bugun, bitis: bugun })}>Bugün</Button><Button size="sm" onClick={() => filtreYaz({ baslangic: gunEkle(bugun, -6), bitis: bugun })}>Son 7 gün</Button><Button size="sm" onClick={() => filtreYaz({ baslangic: gunEkle(bugun, -29), bitis: bugun })}>Son 30 gün</Button></div>
      <p className="subtle">Tarihler Türkiye saatine göredir. Kullanımda ölçüm gününün son kaydedilen paketi, güncel kartlarda mevcut paket esas alınır. En çok 93 gün seçilebilir.</p>
    </Card>
    <Alert tone="error">{hata || islemHatasi}</Alert><Alert tone={bekleyen ? "warning" : "success"}>{basari}</Alert>
    {yukleniyor && <p role="status">İstatistikler yükleniyor…</p>}
    {!yukleniyor && hata && <Button onClick={yenile}>Tekrar dene</Button>}
    {veri && <>
      <Card title="Ölçüm kapsamı"><p>Ölçüm başlangıcı: <strong>{tarih(veri.olcum.baslangic)}</strong> · {veri.olcum.olculenGun}/{veri.olcum.gunSayisi} gün ölçüldü.</p>
        <p className="subtle">Etkinlik, başarılı giriş veya kayda geçen başarılı modül işlemidir. Salt sayfa okumaları dahil değildir. Destek ve sistem işlemleri sayılmaz.</p>
        {veri.olcum.eksikGunler.length > 0 && <Alert tone="warning">Seçili dönemde {veri.olcum.eksikGunler.length} günün ölçümü veya paket bilgisi eksik. Dönem toplamları bu nedenle gösterilmiyor; tablolar yalnız bilinen kayıtları içerir.</Alert>}
        {veri.olcum.bugunDahil && <p className="subtle">Bugün devam ediyor; bugünün değerleri son ölçüme kadar olan etkinliği gösterir.</p>}
        <p className="subtle">Son üretim: {veri.olcum.sonGuncelleme ? new Date(veri.olcum.sonGuncelleme).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "Henüz üretilmedi"}. Otomatik üretim 10 dakikada bir çalışır.</p>
        <Button disabled={islem || hesapGun < 1 || hesapGun > 31} onClick={() => void yenidenHesapla()}>{islem ? "Hesaplanıyor…" : "Seçili günleri yeniden hesapla"}</Button><p className="subtle">Yeniden hesaplama tüm firmaların kullanım özetlerini kapsar; ölçüm başlangıcından itibaren en çok 31 gün işlenir. Tarihsel operasyon gözlemlerini yeniden oluşturmaz.</p>
      </Card>
      {veri.buyume && <PlatformBuyumeOzeti rapor={veri.buyume} bugunDahil={veri.olcum.bugunDahil} aralik={veri.aralik} />}
      {veri.baslama && <PlatformKullanimaBaslama veri={veri.baslama} filtreYaz={filtreYaz} />}
      <section aria-label="Dönem kullanım özeti"><h2>Kayda geçen kullanım</h2><p className="subtle">Önceki eşit süreli dönem: {tarih(veri.aralik.oncekiBaslangic)} – {tarih(veri.aralik.oncekiBitis)}. Aynı hesap farklı günlerde yeniden sayılmaz; ayrı firmalardaki hesaplar ayrı sayılır.</p><div className="platform-overview platform-stats-metrics">
        {metrikAdlari.map(([kod, ad, olcut]) => <button className="platform-metric" key={kod} onClick={() => filtreYaz({ olcut }, true)}><span>{ad}</span><strong>{sayi(veri.donem[kod])}</strong><small>{donemFarki(veri.donem[kod], veri.onceki[kod], veri.olcum.bugunDahil)}</small></button>)}
      </div></section>
      <Card title="Günlük etkin firma"><p className="subtle">Bir güne tıklayarak o günün ayrıntısını açabilirsiniz. Çizgili sütunlar ölçümü eksik günlerdir.</p><div className="platform-stats-chart" aria-label="Günlük etkin firma grafiği">
        {veri.gunler.map((g) => { const tavan = Math.max(1, ...veri.gunler.map((v) => v.etkinFirma ?? 0)); return <button key={g.gun} className={`platform-stats-day${g.etkinFirma === null ? " is-missing" : ""}`} aria-label={`${tarih(g.gun)}: ${g.etkinFirma === null ? "Ölçüm eksik" : `${g.etkinFirma} etkin firma`}`} title={`${tarih(g.gun)}: ${sayi(g.etkinFirma)}`} onClick={() => filtreYaz({ baslangic: g.gun, bitis: g.gun })}><span className="platform-stats-bar" style={{ height: g.etkinFirma === null ? "100%" : `${Math.max(2, g.etkinFirma / tavan * 100)}%` }} /><small>{g.gun.slice(8)}</small></button>; })}
      </div><details><summary>Günlük değerleri tablo halinde göster</summary><TableWrap><thead><tr><th>Gün</th><th>Etkin firma</th><th>Tekil kullanıcı</th><th>Giriş</th><th>Modül işlemi</th></tr></thead><tbody>{veri.gunler.map((g) => <tr key={g.gun}><td>{tarih(g.gun)}</td><td>{sayi(g.etkinFirma)}</td><td>{sayi(g.etkinKullanici)}</td><td>{sayi(g.giris)}</td><td>{sayi(g.islem)}</td></tr>)}</tbody></TableWrap></details></Card>
      <Card title="Modül işlemleri"><p className="subtle">Ölçülen günlerdeki başarılı işlem istekleri. Bu sayılar belge adedi değildir.</p><TableWrap><thead><tr><th>Modül</th><th>İşlem</th></tr></thead><tbody>{veri.moduller.map((m) => <tr key={m.kod}><td>{MODUL_ADI[m.kod] ?? "Diğer"}</td><td>{sayi(m.adet)}</td></tr>)}{!veri.moduller.length && <tr><td colSpan={2}>Ölçülen günlerde kayda geçen modül işlemi yok.</td></tr>}</tbody></TableWrap></Card>
      <section aria-label="Güncel abonelik ve operasyon"><h2>Güncel abonelik ve operasyon</h2><p className="subtle">Bu bölüm tarih aralığından bağımsızdır; seçili paket ve firma kapsamındaki mevcut durumu gösterir.</p><div className="platform-overview">
        {([["toplam", "Tüm firmalar", "hepsi"], ["aktif", "Aboneliği aktif", "aktif"], ["deneme", "Deneme", "deneme"], ["geciken", "Ödemesi geciken", "askiyaAlinacak"], ["yaklasan", "7 günde yenilenecek", "yenilenecek"], ["baglantiHatali", "Bağlantı hatası olan", "baglantiHatali"], ["askida", "Askıda", "askida"], ["iptal", "İptal", "iptal"], ["talep", "Bekleyen paket talebi", "talep"]] as const).map(([kod, ad, goster]) => <Link className="platform-metric" key={kod} href={firmaYolu(goster)}><span>{ad}</span><strong>{sayi(veri.guncel[kod])}</strong><small>Firmalarda incele</small></Link>)}
      </div></section>{veri.odeme && <Card title="Dönemdeki sorunlu ödeme denemeleri"><p>Seçili dönemde başarısız ödeme denemesi: <strong>{sayi(veri.odeme.sayilar.basarisiz)}</strong>; sonuçlanmayan: <strong>{sayi(veri.odeme.sayilar.sonuclanmadi)}</strong>. <Link href={`/platform/odeme-raporu?${new URLSearchParams({ sekme: "sorunlu", baslangic, bitis, plan, ...(firma ? { firma } : {}), durum: "basarisiz" })}`}>Sorunlu tahsilat raporunu aç</Link><small className="subtle"> Denemenin başlatıldığı Türkiye günü ve firmanın güncel paketi kullanılır. Test ve canlı ortam dahildir. Bugün seçiliyse sayılar gün boyunca değişebilir.</small></p></Card>}
      <Card title="Güncel paket dağılımı"><TableWrap><thead><tr><th>Paket</th><th>Firma</th></tr></thead><tbody>{veri.guncel.planlar.map((p) => <tr key={p.kod}><td><Link href={firmaYolu("hepsi", p.kod)}>{planAdi(p.kod)}</Link></td><td>{sayi(p.adet)}</td></tr>)}{!veri.guncel.planlar.length && <tr><td colSpan={2}>Seçili kapsamda firma yok.</td></tr>}</tbody></TableWrap></Card>
      <PlatformEntegrasyonTalepleri />
      {veri.operasyon && <PlatformBekleyenIsler veri={veri.operasyon} filtreYaz={filtreYaz} />}
      {veri.operasyonGecmisi && <PlatformOperasyonGecmisi veri={veri.operasyonGecmisi} filtreYaz={filtreYaz} />}
      <Card id="istatistik-firmalar" title="Ölçülen günlerde gözlenen firmalar"><Field label="Firma ayrıntı ölçütü"><Select value={olcut} onChange={(e) => filtreYaz({ olcut: e.target.value })}><option value="etkin">Giriş veya modül işlemi yapan</option><option value="giris">Giriş yapan</option><option value="islem">Modül işlemi yapan</option></Select></Field>
        <TableWrap><thead><tr><th>Firma</th><th>Etkin gün</th><th>Tekil kullanıcı</th><th>Giriş</th><th>Modül işlemi</th></tr></thead><tbody>{veri.firmalar.kayitlar.map((f) => <tr key={f.tenantId}><td>{f.unvan ? <Link href={`/platform/firmalar/${f.tenantId}`}>{f.unvan}</Link> : "Arşiv firma"}</td><td>{sayi(f.etkinGun)}</td><td>{sayi(f.etkinKullanici)}</td><td>{sayi(f.giris)}</td><td>{sayi(f.islem)}</td></tr>)}{!veri.firmalar.kayitlar.length && <tr><td colSpan={5}>Ölçülen günlerde bu ölçüte uygun firma yok.</td></tr>}</tbody></TableWrap>
        <div className="platform-pagination"><span>{veri.firmalar.toplam} firma · Sayfa {sayfa} / {Math.max(1, Math.ceil(veri.firmalar.toplam / 25))}</span><div className="platform-row-actions"><Button disabled={sayfa === 1} onClick={() => filtreYaz({ sayfa: String(sayfa - 1) })}>Önceki</Button><Button disabled={sayfa * 25 >= veri.firmalar.toplam} onClick={() => filtreYaz({ sayfa: String(sayfa + 1) })}>Sonraki</Button>{sayfa > 1 && !veri.firmalar.kayitlar.length && <Button onClick={() => filtreYaz({ sayfa: "1" })}>İlk sayfaya dön</Button>}</div></div>
      </Card>
    </>}
  </>;
}
export default function FirmaIstatistikleri() { return <Suspense fallback={<p role="status">İstatistikler yükleniyor…</p>}><Istatistikler /></Suspense>; }
