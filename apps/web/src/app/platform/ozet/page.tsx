"use client";

import Link from "next/link";
import { Activity, ArrowRight, CalendarClock, ClipboardCheck, FilePlus2, Inbox, RefreshCw, ListTodo, UserX, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, Badge, Button, Card, PageHeader } from "@/components/ui";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { usePlatformOturumu } from "@/lib/platform-oturumu";
import { OLAY_ADI, tarihTR } from "@/lib/mevzuat-gorunum";
import { GOREV_ONCELIGI, type GorevListesi } from "@/lib/platform-gorevleri";
import type { TakvimSatiri } from "@tekirextra/shared";

interface Onay { id: string; no: number; baslik: string; yururlukBaslangic: string; hazirlayan: { adSoyad: string } }
interface Talep { id: string; aciklama: string; kaynak: string; createdAt: string }
interface Olay { id: string; olay: string; zaman: string; kullanici: string | null; degisiklikId: string | null; degisiklik: { no: number; baslik: string } | null }
interface Firma { tenantId: string; unvan: string; askiyaAlinacak?: boolean; bekleyenTalep: { istenenPlanAdi: string } | null }
interface Saglik { zaman: string; alarmlar: { anahtar: string; ozet: string; acik: boolean }[] }
interface Faturalar { sorunlu: { odemeId: string; firma: string; durum: "bekliyor" | "hata" | "kesinlesti"; hata: string | null; faturaNo: string | null }[] }
const diziHatasi = (k: { veri: unknown; hata: string; yukleniyor: boolean }) => k.hata || (!k.yukleniyor && !Array.isArray(k.veri) ? "Kayıtlar beklenen biçimde alınamadı." : "");
const zaman = (s: string) => new Date(s).toLocaleString("tr-TR");

function OzetSayaci({ baslik, deger, href, aciklama, yukleniyor, hata, sinir, ikon: Icon }: {
  baslik: string; deger: number | null; href: string; aciklama: string; yukleniyor: boolean; hata: string; sinir?: number; ikon: LucideIcon;
}) {
  const sinirda = deger !== null && sinir !== undefined && deger >= sinir;
  return <Link href={href} className="platform-dashboard-metric" aria-label={`${baslik}: ${yukleniyor ? "yükleniyor" : hata || deger === null ? "veri alınamadı" : `${deger}${sinirda ? " veya daha fazla" : ""}`}`}>
    <div><span>{baslik}</span><Icon size={18} aria-hidden="true" /></div>
    <strong>{yukleniyor || hata || deger === null ? "—" : `${deger}${sinirda ? "+" : ""}`}</strong>
    <small>{yukleniyor ? "Yükleniyor…" : hata ? "Veri alınamadı · Ayrıntılara git" : aciklama}</small>
  </Link>;
}

function OzetBolumu({ baslik, href, yukleniyor, hata, yenile, children, className = "", id }: {
  baslik: string; href: string; yukleniyor: boolean; hata: string; yenile: () => void; children: ReactNode; className?: string; id?: string;
}) {
  return <Card id={id} className={`platform-dashboard-panel ${className}`} title={<h2>{baslik}</h2>} actions={<Link className="platform-dashboard-all" aria-label={`${baslik}: ilgili ekrana git`} href={href}>İlgili ekrana git<ArrowRight size={14} aria-hidden="true" /></Link>}>
    {yukleniyor ? <p className="platform-dashboard-empty" role="status">Veriler yükleniyor…</p>
      : hata ? <div className="platform-dashboard-error"><Alert tone="error">{hata}</Alert><Button size="sm" onClick={yenile}>Tekrar dene</Button></div>
      : children}
  </Card>;
}

/** Kaynaklar bağımsız yüklenir; yönetici uçları editör oturumunda çağrılmaz. */
export default function PlatformOzeti() {
  const ben = usePlatformOturumu();
  const yonetici = ben?.rol === "yonetici";
  const gorevler = usePlatformVerisi<GorevListesi>("/platform/gorevler?durum=acik_isler&benim=1");
  const gorevVerisi = gorevler.veri;
  const gorevHatasi = gorevler.hata || (!gorevler.yukleniyor && (!Array.isArray(gorevVerisi?.kayitlar) || !Number.isInteger(gorevVerisi?.toplam) || !Number.isInteger(gorevVerisi?.sayilar?.geciken) || !Number.isInteger(gorevVerisi?.sayilar?.sorumluPasif)) ? "Görev bilgileri alınamadı." : "");
  const onay = usePlatformVerisi<Onay[]>("/platform/mevzuat/degisiklikler?durum=onay_bekliyor");
  const talepler = usePlatformVerisi<Talep[]>("/platform/mevzuat/talepler?durum=acik");
  const takvim = usePlatformVerisi<TakvimSatiri[]>("/platform/mevzuat/yayin-takvimi");
  const olaylar = usePlatformVerisi<Olay[]>("/platform/mevzuat/olaylar?sayfa=1");
  const firmalar = usePlatformVerisi<Firma[]>(yonetici ? "/platform/firmalar" : null);
  const saglik = usePlatformVerisi<Saglik>(yonetici ? "/platform/sistem-sagligi" : null);
  const faturalar = usePlatformVerisi<Faturalar>(yonetici ? "/platform/abonelik-fatura" : null);
  const onaylar = Array.isArray(onay.veri) ? onay.veri : [];
  const acikTalepler = Array.isArray(talepler.veri) ? talepler.veri : [];
  const takvimSatirlari = Array.isArray(takvim.veri) ? takvim.veri : [];
  const sonOlaylar = Array.isArray(olaylar.veri) ? olaylar.veri : [];
  const firmaSatirlari = Array.isArray(firmalar.veri) ? firmalar.veri : [];
  const onayHatasi = diziHatasi(onay), talepHatasi = diziHatasi(talepler), takvimHatasi = diziHatasi(takvim), olayHatasi = diziHatasi(olaylar), firmaHatasi = diziHatasi(firmalar);
  const saglikHatasi = saglik.hata || (!saglik.yukleniyor && !Array.isArray(saglik.veri?.alarmlar) ? "Sistem ölçümleri eksik alındı." : "");
  const faturaHatasi = faturalar.hata || (!faturalar.yukleniyor && !Array.isArray(faturalar.veri?.sorunlu) ? "Fatura bilgileri eksik alındı." : "");
  const alarmlar = Array.isArray(saglik.veri?.alarmlar) ? saglik.veri.alarmlar.filter((a) => a.acik) : [];
  const sorunluFaturalar = Array.isArray(faturalar.veri?.sorunlu) ? faturalar.veri.sorunlu : [];
  const eksikler = takvimSatirlari.filter((t) => t.durum === "eksik");
  const yaklasanlar = takvimSatirlari.filter((t) => t.durum === "yaklasiyor");
  const oncelikliTakvim = [...eksikler, ...yaklasanlar].sort((a, b) => a.baslangic.localeCompare(b.baslangic));
  const planTalepleri = firmaSatirlari.filter((f) => f.bekleyenTalep);
  const gecikenler = firmaSatirlari.filter((f) => f.askiyaAlinacak);
  const kaynaklar = [gorevler, onay, talepler, takvim, olaylar, ...(yonetici ? [firmalar, saglik, faturalar] : [])];
  const yukleniyor = kaynaklar.some((k) => k.yukleniyor);
  const yenile = () => kaynaklar.forEach((k) => k.yenile());

  return <>
    <PageHeader title="Yönetim özeti" subtitle="Bekleyen işleri ve yaklaşan dönemleri görün; incelemek istediğiniz kayda doğrudan geçin." actions={<Button disabled={yukleniyor} onClick={yenile}><RefreshCw size={16} aria-hidden="true" />Tümünü yenile</Button>} />
    <div className="platform-dashboard-quick" aria-label="Hızlı erişim">
      <Link href="/platform/gorevler"><ListTodo size={18} aria-hidden="true" /><span>Görev merkezi</span><ArrowRight size={15} aria-hidden="true" /></Link>
      <Link href="/platform?yeni=1"><FilePlus2 size={18} aria-hidden="true" /><span>Yeni mevzuat taslağı</span><ArrowRight size={15} aria-hidden="true" /></Link>
      <Link href="/platform/tablolar"><CalendarClock size={18} aria-hidden="true" /><span>Yürürlükteki değerler</span><ArrowRight size={15} aria-hidden="true" /></Link>
      <Link href="/platform/denetim"><Activity size={18} aria-hidden="true" /><span>Denetim izi</span><ArrowRight size={15} aria-hidden="true" /></Link>
    </div>
    <section aria-labelledby="gorev-ozeti-baslik"><h2 id="gorev-ozeti-baslik" className="platform-dashboard-section-title">Görev takibi</h2><div className="platform-dashboard-metrics">
      <OzetSayaci baslik="Bana atanan açık görev" deger={gorevVerisi?.toplam ?? null} href="/platform/gorevler?benim=1" aciklama="Açık ve devam eden kişisel işleriniz" yukleniyor={gorevler.yukleniyor} hata={gorevHatasi} ikon={ListTodo} />
      <OzetSayaci baslik="Geciken ekip görevi" deger={gorevVerisi?.sayilar?.geciken ?? null} href="/platform/gorevler?geciken=1" aciklama="Yetkinizdeki tüm açık görevler arasında" yukleniyor={gorevler.yukleniyor} hata={gorevHatasi} ikon={CalendarClock} />
      <OzetSayaci baslik="Sorumlusu pasif görev" deger={gorevVerisi?.sayilar?.sorumluPasif ?? null} href="/platform/gorevler?sorumluPasif=1" aciklama="Pasife alınan kişide kalan açık işler; yeniden atayın" yukleniyor={gorevler.yukleniyor} hata={gorevHatasi} ikon={UserX} />
    </div></section>
    <section aria-labelledby="mevzuat-ozeti-baslik"><h2 id="mevzuat-ozeti-baslik" className="platform-dashboard-section-title">Mevzuat gündemi</h2><div className="platform-dashboard-metrics">
      <OzetSayaci baslik="Onay bekleyen değişiklik" deger={onay.veri ? onaylar.length : null} sinir={200} href="/platform?durum=onay_bekliyor" aciklama="İkinci yetkilinin incelemesini bekliyor" yukleniyor={onay.yukleniyor} hata={onayHatasi} ikon={ClipboardCheck} />
      <OzetSayaci baslik="Açık mevzuat talebi" deger={talepler.veri ? acikTalepler.length : null} sinir={300} href="/platform/talepler" aciklama="İncelenecek bildirimler" yukleniyor={talepler.yukleniyor} hata={talepHatasi} ikon={Inbox} />
      <OzetSayaci baslik="Dönem kaydı eksik" deger={takvim.veri ? eksikler.length : null} href="/platform?yeni=1" aciklama="Dönemi başlamış, kaydı yayınlanmamış" yukleniyor={takvim.yukleniyor} hata={takvimHatasi} ikon={CalendarClock} />
      <OzetSayaci baslik="Yaklaşan dönem" deger={takvim.veri ? yaklasanlar.length : null} href="/platform/ozet#yayin-gundemi" aciklama="45 gün içinde kayıt hazırlanmalı" yukleniyor={takvim.yukleniyor} hata={takvimHatasi} ikon={CalendarClock} />
    </div></section>
    {yonetici && <section aria-labelledby="operasyon-ozeti-baslik"><h2 id="operasyon-ozeti-baslik" className="platform-dashboard-section-title">Platform takibi</h2><div className="platform-dashboard-metrics">
      <OzetSayaci baslik="Bekleyen plan talebi" deger={firmalar.veri ? planTalepleri.length : null} href="/platform/firmalar?goster=talep" aciklama="Paket değişikliği isteyen firmalar" yukleniyor={firmalar.yukleniyor} hata={firmaHatasi} ikon={ClipboardCheck} />
      <OzetSayaci baslik="Ödemesi geciken firma" deger={firmalar.veri ? gecikenler.length : null} href="/platform/firmalar?goster=askiyaAlinacak" aciklama="Ödemesi 15 günden fazla gecikmiş" yukleniyor={firmalar.yukleniyor} hata={firmaHatasi} ikon={CalendarClock} />
      <OzetSayaci baslik="Açık sistem alarmı" deger={saglik.veri ? alarmlar.length : null} href="/platform/sistem-sagligi" aciklama="Son sistem ölçümündeki alarmlar" yukleniyor={saglik.yukleniyor} hata={saglikHatasi} ikon={Activity} />
      <OzetSayaci baslik="İşlem bekleyen fatura" deger={faturalar.veri ? sorunluFaturalar.length : null} sinir={100} href="/platform/odeme#abonelik-faturasi" aciklama="Fatura veya tahsilat işlemi bekliyor" yukleniyor={faturalar.yukleniyor} hata={faturaHatasi} ikon={Inbox} />
    </div></section>}
    <div className="platform-dashboard-grid">
      <OzetBolumu baslik="Bana atanan işler" href="/platform/gorevler?benim=1" yukleniyor={gorevler.yukleniyor} hata={gorevHatasi} yenile={gorevler.yenile} className="platform-dashboard-wide">
        {gorevVerisi?.kayitlar?.length ? <><ul className="platform-dashboard-list">{gorevVerisi.kayitlar.slice(0, 5).map((g) => <li key={g.id}><Link href={`/platform/gorevler?gorev=${encodeURIComponent(g.id)}`}><div><strong>{g.baslik}</strong><span>{GOREV_ONCELIGI[g.oncelik]} öncelik · {g.sonTarih ? `Son tarih ${tarihTR(g.sonTarih)}` : "Son tarih belirlenmedi"}</span></div>{g.sonTarih && g.sonTarih < gorevVerisi.bugun ? <Badge variant="danger">Gecikti</Badge> : <ArrowRight size={16} aria-hidden="true" />}</Link></li>)}</ul>{gorevVerisi.toplam > 5 && <p className="platform-dashboard-note">Son tarih sırasına göre ilk 5 görev gösteriliyor.</p>}</> : <p className="platform-dashboard-empty">Size atanmış açık görev yok.</p>}
      </OzetBolumu>
      <OzetBolumu baslik="Bekleyen onaylar" href="/platform?durum=onay_bekliyor" yukleniyor={onay.yukleniyor} hata={onayHatasi} yenile={onay.yenile}>
        {onaylar.length ? <><ul className="platform-dashboard-list">{onaylar.slice(0, 5).map((d) => <li key={d.id}><Link href={`/platform/degisiklik?id=${encodeURIComponent(d.id)}`}><div><strong>#{d.no} {d.baslik}</strong><span>{d.hazirlayan.adSoyad} · Yürürlük {tarihTR(d.yururlukBaslangic)}</span></div><ArrowRight size={16} aria-hidden="true" /></Link></li>)}</ul>{onaylar.length > 5 && <p className="platform-dashboard-note">En yeni 5 değişiklik gösteriliyor.</p>}</> : <p className="platform-dashboard-empty">Onay bekleyen değişiklik yok.</p>}
      </OzetBolumu>
      <OzetBolumu id="yayin-gundemi" baslik="Yayın takvimi" href="/platform" yukleniyor={takvim.yukleniyor} hata={takvimHatasi} yenile={takvim.yenile} className="platform-dashboard-calendar">
        {oncelikliTakvim.length ? <ul className="platform-dashboard-list">{oncelikliTakvim.map((t) => <li key={`${t.tur}/${t.anahtar}/${t.donem}`}><div className="platform-dashboard-agenda"><div><strong>{t.ad}</strong><span>{t.donem} · Başlangıç {tarihTR(t.baslangic)}</span></div><Badge variant={t.durum === "eksik" ? "danger" : "warning"}>{t.durum === "eksik" ? "Dönem başladı" : `${t.kalanGun} gün kaldı`}</Badge><p>{t.durum === "eksik" ? `Kayıt eksik: ${t.etki}.` : "Yeni dönem kaydı henüz yayınlanmadı."}</p><Link href="/platform?yeni=1">Değişiklik hazırla<ArrowRight size={14} aria-hidden="true" /></Link></div></li>)}</ul> : <p className="platform-dashboard-empty">Başlamış veya yaklaşan dönemler için eksik yayın yok.</p>}
      </OzetBolumu>
      <OzetBolumu baslik="Açık mevzuat talepleri" href="/platform/talepler" yukleniyor={talepler.yukleniyor} hata={talepHatasi} yenile={talepler.yenile}>
        {acikTalepler.length ? <ul className="platform-dashboard-list">{acikTalepler.slice(0, 5).map((t) => <li key={t.id}><Link href="/platform/talepler"><div><strong className="platform-dashboard-copy">{t.aciklama}</strong><span>{t.kaynak === "bilinmeyen_kod" ? "Bilinmeyen kod bildirimi" : "Kiracı bildirimi"} · {zaman(t.createdAt)}</span></div><ArrowRight size={16} aria-hidden="true" /></Link></li>)}</ul> : <p className="platform-dashboard-empty">İnceleme bekleyen mevzuat talebi yok.</p>}
      </OzetBolumu>
      <OzetBolumu baslik="Son işlemler" href="/platform/denetim" yukleniyor={olaylar.yukleniyor} hata={olayHatasi} yenile={olaylar.yenile}>
        {sonOlaylar.length ? <ul className="platform-dashboard-list">{sonOlaylar.slice(0, 5).map((o) => <li key={o.id}><Link href={o.degisiklikId ? `/platform/degisiklik?id=${encodeURIComponent(o.degisiklikId)}` : "/platform/denetim"}><div><strong>{o.kullanici ?? "Sistem"} · {OLAY_ADI[o.olay] ?? "Platform işlemi"}</strong><span>{o.degisiklik ? `#${o.degisiklik.no} ${o.degisiklik.baslik} · ` : ""}{zaman(o.zaman)}</span></div><ArrowRight size={16} aria-hidden="true" /></Link></li>)}</ul> : <p className="platform-dashboard-empty">Henüz işlem kaydı yok.</p>}
      </OzetBolumu>
      {yonetici && <>
        <OzetBolumu baslik="Firma takipleri" href="/platform/firmalar" yukleniyor={firmalar.yukleniyor} hata={firmaHatasi} yenile={firmalar.yenile}>
          {!gecikenler.length && !planTalepleri.length ? <p className="platform-dashboard-empty">Bekleyen plan talebi veya gecikmiş ödeme yok.</p> : <ul className="platform-dashboard-list">{gecikenler.slice(0, 3).map((f) => <li key={`odeme-${f.tenantId}`}><Link href="/platform/firmalar?goster=askiyaAlinacak"><div><strong>{f.unvan}</strong><span>Ödeme takibi gerekiyor</span></div><Badge variant="warning">Gecikti</Badge></Link></li>)}{planTalepleri.slice(0, 3).map((f) => <li key={`plan-${f.tenantId}`}><Link href="/platform/firmalar?goster=talep"><div><strong>{f.unvan}</strong><span>İstenen paket: {f.bekleyenTalep?.istenenPlanAdi}</span></div><Badge variant="info">Plan talebi</Badge></Link></li>)}</ul>}
        </OzetBolumu>
        <OzetBolumu baslik="Sistem uyarıları" href="/platform/sistem-sagligi" yukleniyor={saglik.yukleniyor} hata={saglikHatasi} yenile={saglik.yenile}>
          {saglik.veri?.zaman && <p className="platform-dashboard-note">Son ölçüm: {zaman(saglik.veri.zaman)}</p>}
          {alarmlar.length ? <ul className="platform-dashboard-list">{alarmlar.slice(0, 5).map((a) => <li key={a.anahtar}><Link href="/platform/sistem-sagligi"><div><strong className="platform-dashboard-copy">{a.ozet}</strong><span>Sistem sağlığında inceleyin</span></div><ArrowRight size={16} aria-hidden="true" /></Link></li>)}</ul> : <p className="platform-dashboard-empty">Son ölçümde açık sistem alarmı yok.</p>}
        </OzetBolumu>
        <OzetBolumu className="platform-dashboard-wide" baslik="Fatura takibi" href="/platform/odeme#abonelik-faturasi" yukleniyor={faturalar.yukleniyor} hata={faturaHatasi} yenile={faturalar.yenile}>
          {sorunluFaturalar.length ? <ul className="platform-dashboard-list">{sorunluFaturalar.slice(0, 5).map((f) => <li key={f.odemeId}><Link href="/platform/odeme#abonelik-faturasi"><div><strong>{f.firma}</strong><span>{f.durum === "hata" ? "Fatura açılamadı" : f.durum === "kesinlesti" ? "Tahsilat açılamadı" : "Fatura bekliyor"}{f.faturaNo ? ` · ${f.faturaNo}` : ""}</span></div><ArrowRight size={16} aria-hidden="true" /></Link></li>)}</ul> : <p className="platform-dashboard-empty">İşlem bekleyen fatura veya tahsilat yok.</p>}
        </OzetBolumu>
      </>}
    </div>
  </>;
}
