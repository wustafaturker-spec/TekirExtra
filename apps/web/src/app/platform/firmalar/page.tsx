"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PlatformArama, PlatformListeDurumu } from "@/components/platform-liste";
import Link from "next/link";
import { FirmaYonet } from "@/components/platform-firma-yonet";
import { type Firma, type FirmaListesi, type Suzgec, GORUNUMLER, PLANLAR, DURUM, tarih } from "@/lib/platform-firmalar";
import { usePlatformVerisi } from "@/lib/use-platform-verisi";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";

/**
 * Platform P0-1 / P1-1: firmalar ve abonelikleri. Liste yalnız yönetim için
 * gereken sayıları ve durumları içerir; firma verisinin içeriği görünmez.
 */
function filtreYaz(ek: Record<string, string>) {
  const url = new URL(window.location.href);
  url.searchParams.delete("sayfa");
  for (const [k, v] of Object.entries(ek)) {
    if (!v || v === "hepsi" || (k === "siralama" && v === "unvan") || (k === "sayfa" && v === "1")) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function PlatformFirmalarIcerigi() {
  const parametreler = useSearchParams();
  const secim = parametreler.get("goster") ?? "hepsi";
  const suzgec: Suzgec = Object.hasOwn(GORUNUMLER, secim) ? secim as Suzgec : "hepsi";
  const aramaParam = (parametreler.get("arama") ?? "").slice(0, 200);
  const [arama, setArama] = useState(aramaParam);
  const plan = (parametreler.get("plan") ?? "").slice(0, 40);
  const baglantiParam = parametreler.get("baglanti") ?? "hepsi";
  const baglanti = ["hepsi", "hata", "ebelgeAktif", "ebelgeYok"].includes(baglantiParam) ? baglantiParam : "hepsi";
  const siraParam = parametreler.get("siralama") ?? "unvan";
  const siralama = ["unvan", "kayitYeni", "sonGiris", "yenileme"].includes(siraParam) ? siraParam : "unvan";
  const sayfaParam = Number(parametreler.get("sayfa") ?? 1);
  const sayfa = Number.isInteger(sayfaParam) && sayfaParam > 0 && sayfaParam <= 100000 ? sayfaParam : 1;
  useEffect(() => { setArama(aramaParam); }, [aramaParam]);
  useEffect(() => {
    if (arama === aramaParam) return;
    const t = setTimeout(() => filtreYaz({ arama }), 300);
    return () => clearTimeout(t);
  }, [arama, aramaParam]);
  const sorgu = new URLSearchParams({ arama: aramaParam, goster: suzgec, plan, baglanti, siralama, sayfa: String(sayfa) });
  for (const alan of ["kayitBaslangic", "kayitBitis", "yenilemeBaslangic", "yenilemeBitis"]) {
    const deger = parametreler.get(alan);
    if (deger) sorgu.set(alan, deger);
  }
  const { veri, yukleniyor, hata: listeHatasi, yenile: yukle } = usePlatformVerisi<FirmaListesi>(`/platform/firmalar/sayfali?${sorgu}`);
  const firmalar = veri?.kayitlar ?? [];
  const sayilar = veri?.sayilar;
  const toplam = veri?.toplam ?? 0;
  const toplamSayfa = Math.max(1, Math.ceil(toplam / (veri?.sayfaBoyutu ?? 25)));
  const [destekIslem, setDestekIslem] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [secili, setSecili] = useState<Firma | null>(null);
  const istenenFirma = parametreler.get("firma");
  const firmaDetayi = usePlatformVerisi<FirmaListesi>(istenenFirma ? `/platform/firmalar/sayfali?firma=${encodeURIComponent(istenenFirma)}&sayfaBoyutu=1` : null);
  useEffect(() => {
    if (!istenenFirma) { setSecili(null); return; }
    if (firmaDetayi.veri) setSecili(firmaDetayi.veri.kayitlar[0] ?? null);
  }, [istenenFirma, firmaDetayi.veri]);
  function firmaSec(firma: Firma | null) {
    setSecili(firma);
    const url = new URL(window.location.href);
    if (firma) url.searchParams.set("firma", firma.tenantId);
    else url.searchParams.delete("firma");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  /**
   * PLT-10: izinli firmanın paneli yeni sekmede salt okunur açılır. Sekme
   * tıklamayla hemen açılır (açılır pencere engeline takılmasın), token gelince
   * adres # ile verilir; sunucuya gitmez.
   */
  async function destekAc(f: Firma) {
    if (destekIslem) return;
    setDestekIslem(true);
    setHata("");
    setBasari("");
    const sekme = window.open("", "_blank");
    try {
      const s = await platformApi<{ token: string; bitis: string }>(`/platform/firmalar/${f.tenantId}/destek-oturumu`, { method: "POST" });
      if (sekme) {
        sekme.opener = null;
        sekme.location.href = `/destek#t=${encodeURIComponent(s.token)}`;
      }
      setBasari(`${f.unvan} için destek oturumu açıldı; ${new Date(s.bitis).toLocaleTimeString("tr-TR")} saatinde kapanır.`);
      yukle();
    } catch (e) {
      sekme?.close();
      setHata(e instanceof Error ? e.message : "Destek oturumu açılamadı");
    } finally { setDestekIslem(false); }
  }

  async function destekKapat(oturumId: string) {
    if (destekIslem) return;
    setDestekIslem(true); setHata(""); setBasari("");
    try {
      setBasari((await platformApi<{ mesaj: string }>(`/platform/firmalar/destek-oturumlari/${oturumId}/kapat`, { method: "POST" })).mesaj);
      yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Destek oturumu kapatılamadı");
    } finally { setDestekIslem(false); }
  }

  function tamamlandi(mesaj: string) {
    setBasari(mesaj);
    setHata("");
    firmaSec(null);
    yukle();
    firmaDetayi.yenile();
  }

  return <>
    <PageHeader title="Firmalar" subtitle="Abonelikleri izleyin, plan taleplerini değerlendirin ve izinli destek oturumlarını yönetin." actions={<Button disabled={yukleniyor} onClick={() => { yukle(); firmaDetayi.yenile(); }}><RefreshCw size={16} aria-hidden="true" />Yenile</Button>} />
    <Alert tone="error">{hata}</Alert>
    <Alert tone="error">{firmaDetayi.hata || (firmaDetayi.veri && !firmaDetayi.veri.kayitlar.length ? "Firma bulunamadı." : "")}</Alert>
    {basari && <Alert tone="success">{basari}</Alert>}
    <div className="platform-overview platform-firma-overview" aria-label="Firma durumları">
      {([
        ["hepsi", "Tüm firmalar", sayilar?.toplam], ["talep", "Bekleyen plan talebi", sayilar?.talep],
        ["askiyaAlinacak", "Ödemesi geciken", sayilar?.askiyaAlinacak], ["askida", "Askıda", sayilar?.askida], ["iptal", "İptal", sayilar?.iptal],
      ] as const).map(([deger, ad, sayi]) => <button key={deger} className={`platform-metric${suzgec === deger ? " is-active" : ""}`} aria-pressed={suzgec === deger} onClick={() => filtreYaz({ goster: deger })}><span>{ad}</span><strong>{yukleniyor || listeHatasi ? "—" : sayi}</strong></button>)}
    </div>
    <Card title="Firma listesi" pad={false}>
      <div className="platform-filter-bar platform-firma-filters">
        <PlatformArama etiket="Firma ara" deger={arama} onChange={setArama} placeholder="Unvan veya VKN ile ara…" />
        <Field label="Göster"><Select value={suzgec} onChange={(e) => filtreYaz({ goster: e.target.value })}>
          {Object.entries(GORUNUMLER).map(([kod, ad]) => <option key={kod} value={kod}>{ad}</option>)}
        </Select></Field>
        <Field label="Plan"><Select value={plan} onChange={(e) => filtreYaz({ plan: e.target.value })}>
          <option value="">Tüm planlar</option>
          {PLANLAR.map((p) => <option key={p.kod} value={p.kod}>{p.ad}</option>)}
          <option value="v1">Profesyonel (eski kayıt)</option>
          {plan && !["v1", ...PLANLAR.map((p) => p.kod)].includes(plan) && <option value={plan}>{plan}</option>}
        </Select></Field>
        <Field label="Bağlantı"><Select value={baglanti} onChange={(e) => filtreYaz({ baglanti: e.target.value })}>
          <option value="hepsi">Tüm bağlantı durumları</option><option value="hata">Bağlantı hatası olan</option>
          <option value="ebelgeAktif">Aktif e-Belge bağlantısı var</option><option value="ebelgeYok">Aktif e-Belge bağlantısı yok</option>
        </Select></Field>
        <Field label="Sıralama"><Select value={siralama} onChange={(e) => filtreYaz({ siralama: e.target.value })}>
          <option value="unvan">Firma adına göre</option><option value="kayitYeni">En yeni kayıt</option>
          <option value="sonGiris">Son giriş</option><option value="yenileme">Yaklaşan yenileme</option>
        </Select></Field>
        {([['kayitBaslangic', 'Kayıt başlangıcı'], ['kayitBitis', 'Kayıt bitişi'], ['yenilemeBaslangic', 'Yenileme başlangıcı'], ['yenilemeBitis', 'Yenileme bitişi']] as const).map(([alan, ad]) => <Field key={alan} label={ad}><Input type="date" value={parametreler.get(alan) ?? ""} onChange={(e) => filtreYaz({ [alan]: e.target.value })} /></Field>)}
        <Button onClick={() => { setArama(""); filtreYaz({ arama: "", goster: "", plan: "", baglanti: "", siralama: "", kayitBaslangic: "", kayitBitis: "", yenilemeBaslangic: "", yenilemeBitis: "" }); }}>Filtreleri temizle</Button>
      </div>
      <p className="subtle" style={{ padding: "0 1rem" }}>Üstteki sayaçlar tüm firmaları gösterir. Tarih filtreleri Türkiye saatine göredir.</p>
      {(suzgec === "yenilenecek" || suzgec === "denemesiBitecek") && <p className="subtle" style={{ padding: "0 1rem" }}>Bugünden başlayarak yedi gün sonuna kadar yenilenecek aktif ve deneme abonelikleri.</p>}
      {suzgec === "uzunSuredirGirmeyen" && <p className="subtle" style={{ padding: "0 1rem" }}>Son girişi 30 günden eski firmalar. Hiç giriş yapmayan firmalar ayrı görünümde listelenir.</p>}
      <div className="platform-list-caption" role="status">{yukleniyor ? "Firma listesi yükleniyor…" : listeHatasi ? "Firma listesi alınamadı" : `${toplam} firma · Sayfa ${sayfa} / ${toplamSayfa}`}</div>
      <TableWrap className="platform-responsive-table platform-firma-table">
        <thead><tr><th>Firma</th><th>Plan</th><th>Durum</th><th className="num">Kullanıcı</th><th>Son giriş</th><th>e-Belge</th><th>Talep</th><th>Destek</th><th>İşlem</th></tr></thead>
        <tbody>
          {(!yukleniyor && !listeHatasi ? firmalar : []).map((f) => (
            <tr key={f.tenantId}>
              <td data-label="Firma" className="platform-cell-title"><strong>{f.unvan}</strong><div className="subtle mono" style={{ fontSize: "0.8rem" }}>{f.vkn}</div>{f.takip && <div className="subtle">{f.takip.sorumluAdi ?? "Sorumlu atanmadı"}{f.takip.sonrakiGorusme ? ` · Görüşme ${tarih(f.takip.sonrakiGorusme)}` : ""}{f.takip.sorumluUygun === false && " · Yeniden atama gerekiyor"}</div>}</td>
              <td data-label="Plan">{f.planAdi}{f.donemSonu && <div className="subtle" style={{ fontSize: "0.8rem" }}>Dönem sonu {tarih(f.donemSonu)}</div>}</td>
              <td data-label="Durum"><Badge variant={DURUM[f.durum]?.ton ?? "neutral"}>{DURUM[f.durum]?.ad ?? f.durum}</Badge>{f.askiyaAlinacak && <div style={{ marginTop: 4 }}><Badge variant="warning">Ödeme gecikti</Badge></div>}{f.baglantiHatali && <div style={{ marginTop: 4 }}><Badge variant="warning">Bağlantı hatası</Badge></div>}</td>
              <td data-label="Kullanıcı" className="num">{f.aktifKullanici}</td>
              <td data-label="Son giriş" className="subtle">{f.sonGiris ? new Date(f.sonGiris).toLocaleString("tr-TR") : "Hiç"}</td>
              <td data-label="e-Belge">{f.ebelgeSaglayici ?? <span className="subtle">—</span>}</td>
              <td data-label="Plan talebi">{f.bekleyenTalep ? <Badge variant="info">{f.bekleyenTalep.istenenPlanAdi} istiyor</Badge> : <span className="subtle">—</span>}</td>
              <td data-label="Destek" className="platform-support-cell">
                {f.destek ? (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="subtle" style={{ fontSize: "0.8rem" }}>İzin {new Date(f.destek.izinBitis).toLocaleString("tr-TR")}&apos;e kadar</span>
                    {f.destek.acikOturum
                      ? <div className="row-tight"><Badge variant="warning">Bağlı: {f.destek.acikOturum.kisi}</Badge><Button size="sm" disabled={destekIslem} onClick={() => void destekKapat(f.destek!.acikOturum!.id)}>Kapat</Button></div>
                      : <Button size="sm" disabled={destekIslem} onClick={() => void destekAc(f)}>Destek oturumu aç</Button>}
                  </div>
                ) : <span className="subtle">İzin yok</span>}
              </td>
              <td data-label="İşlem"><div className="platform-row-actions"><Link className="btn btn--sm btn--ghost" href={`/platform/firmalar/${f.tenantId}?donus=${encodeURIComponent(`/platform/firmalar?${parametreler}`)}`}>Detay</Link><Button size="sm" onClick={() => firmaSec(f)}>Yönet</Button></div></td>
            </tr>
          ))}
          <PlatformListeDurumu sutun={9} yukleniyor={yukleniyor} hata={listeHatasi} bos={!firmalar.length} baslik={sayilar?.toplam ? "Eşleşen firma yok." : "Henüz firma yok."} aciklama={sayilar?.toplam ? "Arama metnini veya durum filtresini değiştirin." : "Firma kayıtları oluşturulduğunda burada listelenir."} onTekrar={yukle} />
        </tbody>
      </TableWrap>
      <nav aria-label="Firma sayfaları" className="row-tight" style={{ padding: "1rem", flexWrap: "wrap" }}>
        <Button disabled={yukleniyor || !!listeHatasi || sayfa <= 1} onClick={() => filtreYaz({ sayfa: String(sayfa - 1) })}>Önceki</Button>
        <span>Sayfa {sayfa} / {toplamSayfa}</span>
        <Button disabled={yukleniyor || !!listeHatasi || sayfa >= toplamSayfa} onClick={() => filtreYaz({ sayfa: String(sayfa + 1) })}>Sonraki</Button>
        {!yukleniyor && !listeHatasi && sayfa > toplamSayfa && <Button onClick={() => filtreYaz({ sayfa: "1" })}>İlk sayfaya dön</Button>}
      </nav>
    </Card>
    {secili && secili.tenantId === istenenFirma && <FirmaYonet firma={secili} onKapat={() => firmaSec(null)} onTamam={tamamlandi} />}
  </>;
}


export default function PlatformFirmalar() {
  return <Suspense fallback={<p className="muted" role="status">Firmalar yükleniyor…</p>}><PlatformFirmalarIcerigi /></Suspense>;
}
