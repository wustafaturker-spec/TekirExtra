"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, Grid2X2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { PANEL_WIDGET_SINIRI, panelWidgetSemasi, panelWidgetTercihiSemasi, type PanelWidget, type PanelWidgetTercihi } from "@tekirextra/shared";
import { Alert, Button, Card, Input, Select } from "@/components/ui";
import { api, ApiHata } from "@/lib/api";
import { WIDGET_GORUNUMLERI, WIDGET_KAYNAKLARI, widgetGorunumleri, widgetKaynagiGorunur, widgetTutarBicimle, widgetVerisiniAl, type TrendGunu } from "./panel-widget-verisi";
import { widgetSablonlari } from "./panel-widget-sablonlari";
import styles from "./panel-widgetlar.module.css";

const ADET_BICIMI = new Intl.NumberFormat("tr-TR");
const KAYNAKLAR = Object.keys(WIDGET_KAYNAKLARI) as PanelWidget["kaynak"][];

type WidgetTaslagi = Pick<PanelWidget, "id" | "baslik" | "kaynak" | "gorunum"> & { filtre: string };

function varsayilanWidget(kaynak: PanelWidget["kaynak"], id: string, baslik = ""): WidgetTaslagi {
  const tanim = WIDGET_KAYNAKLARI[kaynak];
  return { id, baslik, kaynak, filtre: Object.keys(tanim.filtreler)[0], gorunum: tanim.gorunumler[0] };
}

function TahsilatTrendi({ gunler }: { gunler: TrendGunu[] }) {
  // Ondalık tutarlar yalnız sütun boyunu ölçeklemek için Number'a çevrilir.
  const degerler = gunler.map(({ tutar }) => Number(tutar));
  const alt = Math.min(0, ...degerler);
  const ust = Math.max(0, ...degerler);
  const aralik = ust - alt || 1;
  const taban = -alt / aralik * 100;
  const kisaTarih = (tarih: string) => `${tarih.slice(8, 10)}.${tarih.slice(5, 7)}`;

  return (
    <>
      <div className={styles.chart} aria-hidden="true">
        <div className={styles.chartPlot}>
          <span className={styles.chartBaseline} style={{ bottom: `${taban}%` }} />
          {gunler.map((gun, sira) => {
            const deger = degerler[sira];
            return (
              <div key={gun.tarih} className={styles.chartDay}>
                <span
                  className={deger < 0 ? styles.chartNegative : styles.chartBar}
                  style={{ bottom: `${(Math.min(0, deger) - alt) / aralik * 100}%`, height: `${Math.abs(deger) / aralik * 100}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className={styles.chartDates}>
          <span>{kisaTarih(gunler[0].tarih)}</span>
          {gunler.length > 1 && <span>{kisaTarih(gunler[gunler.length - 1].tarih)}</span>}
        </div>
      </div>
      <details className={styles.chartValues}>
        <summary>Günlük tahsilat tutarları</summary>
        <dl>
          {gunler.map(({ tarih, tutar }) => (
            <div key={tarih}>
              <dt><time dateTime={tarih}>{kisaTarih(tarih)}.{tarih.slice(0, 4)}</time></dt>
              <dd>{widgetTutarBicimle(tutar)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}

function WidgetIcerigi({ widget, rol, yenileme }: { widget: PanelWidget; rol: string; yenileme: number }) {
  const erisimVar = widgetKaynagiGorunur(widget.kaynak, rol);
  const [veri, setVeri] = useState<Awaited<ReturnType<typeof widgetVerisiniAl>>>();
  const [hata, setHata] = useState("");
  const [deneme, setDeneme] = useState(0);

  useEffect(() => {
    if (!erisimVar) return;
    const istek = new AbortController();
    setVeri(undefined);
    setHata("");
    void widgetVerisiniAl(widget, istek.signal).then((sonuc) => {
      if (!istek.signal.aborted) setVeri(sonuc);
    }).catch((e: unknown) => {
      if (istek.signal.aborted) return;
      setHata(e instanceof ApiHata && e.durum === 403 ? "Bu veri kaynağına erişiminiz yok." : "Bu veri yüklenemedi.");
    });
    return () => istek.abort();
  }, [widget, erisimVar, yenileme, deneme]);

  if (!erisimVar) return <p className={styles.muted}>Bu veri kaynağına erişiminiz yok.</p>;
  if (hata) return <div className={styles.toolbar}><p role="status">{hata}</p><Button size="sm" onClick={() => setDeneme((sayi) => sayi + 1)}>Tekrar dene</Button></div>;
  if (!veri) return <p role="status" className={styles.muted}>Veri yükleniyor…</p>;
  return (
    <>
      <p className={styles.muted}>{veri.aciklama}</p>
      {"adet" in veri && <strong className={styles.value}>{ADET_BICIMI.format(veri.adet)}</strong>}
      {"tutar" in veri && (
        <>
          {veri.gunler && <span className={styles.muted}>Dönem toplamı</span>}
          <strong className={styles.value}>{widgetTutarBicimle(veri.tutar)}</strong>
          {veri.gunler && <TahsilatTrendi gunler={veri.gunler} />}
        </>
      )}
      {"satirlar" in veri && (veri.satirlar.length ? (
        <ul className={styles.list}>
          {veri.satirlar.map((satir) => (
            <li key={satir.id}>
              <div>
                {satir.href ? <Link href={satir.href}>{satir.baslik}</Link> : <strong>{satir.baslik}</strong>}
                {satir.detay && <p className={styles.muted}>{satir.detay}</p>}
              </div>
              {satir.tutar !== undefined && <span>{widgetTutarBicimle(satir.tutar)}</span>}
            </li>
          ))}
        </ul>
      ) : <p className={styles.muted}>Eşleşen kayıt yok.</p>)}
      {veri.href && <Link className={styles.link} href={veri.href}>{veri.baglanti}</Link>}
    </>
  );
}

export function PanelWidgetlar({ rol, yenileme }: { rol: string; yenileme: number }) {
  const kaynaklar = KAYNAKLAR.filter((kaynak) => widgetKaynagiGorunur(kaynak, rol));
  const [tercih, setTercih] = useState<PanelWidgetTercihi>();
  const [taslak, setTaslak] = useState<WidgetTaslagi>();
  const [onizleme, setOnizleme] = useState<PanelWidget>();
  const [duzenle, setDuzenle] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [hata, setHata] = useState("");
  const [cakisiyor, setCakisiyor] = useState(false);
  const [pilotDisi, setPilotDisi] = useState(false);
  const [deneme, setDeneme] = useState(0);

  useEffect(() => {
    const istek = new AbortController();
    void api<PanelWidgetTercihi>("/panel-widgetlar", { signal: istek.signal }).then((sonuc) => {
      if (!istek.signal.aborted) setTercih(panelWidgetTercihiSemasi.parse(sonuc));
    }).catch((e: unknown) => {
      if (istek.signal.aborted) return;
      if (e instanceof ApiHata && e.durum === 404) setPilotDisi(true);
      else setHata("Widget düzeni yüklenemedi.");
    });
    return () => istek.abort();
  }, [deneme]);

  function yenidenYukle() {
    setHata("");
    setCakisiyor(false);
    setTercih(undefined);
    setTaslak(undefined);
    setOnizleme(undefined);
    setDeneme((sayi) => sayi + 1);
  }

  async function kaydet(widgetlar: PanelWidget[], formuKapat = false) {
    if (!tercih || kaydediliyor || cakisiyor) return;
    setKaydediliyor(true);
    setHata("");
    try {
      const sonuc = await api<PanelWidgetTercihi>("/panel-widgetlar", {
        method: "PUT",
        body: JSON.stringify({ surum: tercih.surum, widgetlar }),
      });
      setTercih({ surum: panelWidgetTercihiSemasi.parse(sonuc).surum, widgetlar });
      if (formuKapat) {
        setTaslak(undefined);
        setOnizleme(undefined);
      }
    } catch (e) {
      const cakisma = e instanceof ApiHata && e.durum === 409;
      setCakisiyor(cakisma);
      setHata(cakisma ? "Panel düzeni başka bir oturumda değişti. Güncel düzeni yükleyin." : "Widget düzeni kaydedilemedi. Tekrar deneyin.");
    } finally {
      setKaydediliyor(false);
    }
  }

  function kaydetForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tercih) return;
    const sonuc = panelWidgetSemasi.safeParse(taslak);
    if (!sonuc.success || !kaynaklar.includes(sonuc.data.kaynak)) {
      setHata("Widget başlığını ve ayarlarını kontrol edin.");
      return;
    }
    const widget = sonuc.data;
    const varOlan = tercih.widgetlar.some((kayit) => kayit.id === widget.id);
    void kaydet(varOlan ? tercih.widgetlar.map((kayit) => kayit.id === widget.id ? widget : kayit) : [...tercih.widgetlar, widget], true);
  }

  function tasi(sira: number, fark: -1 | 1) {
    if (!tercih) return;
    const yeni = [...tercih.widgetlar];
    [yeni[sira], yeni[sira + fark]] = [yeni[sira + fark], yeni[sira]];
    void kaydet(yeni);
  }

  const sablonlar = widgetSablonlari(rol, kaynaklar);
  const ayarlar = taslak && WIDGET_KAYNAKLARI[taslak.kaynak];
  const devreDisi = kaydediliyor || cakisiyor || !tercih;
  const widgetlar = tercih?.widgetlar ?? [];
  const mevcutWidgetDuzenleniyor = widgetlar.some((widget) => widget.id === taslak?.id);
  if (pilotDisi || (!tercih && !hata) || (kaynaklar.length === 0 && widgetlar.length === 0 && !hata)) return null;

  return (
    <section className={styles.section} aria-labelledby="panel-widget-basligi">
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.icon}><Grid2X2 size={19} aria-hidden /></span>
          <div>
            <h2 id="panel-widget-basligi">Widget’larım</h2>
            <p className={styles.muted}>{widgetlar.length ? `${widgetlar.length} kişisel widget` : "Sık takip ettiğiniz göstergeleri panele ekleyin."}</p>
          </div>
        </div>
        <div className={styles.toolbar}>
          {widgetlar.length > 0 && <Button type="button" size="sm" disabled={kaydediliyor} onClick={() => setDuzenle(!duzenle)}>{duzenle ? "Düzenlemeyi bitir" : "Paneli düzenle"}</Button>}
          {kaynaklar.length > 0 && <Button type="button" size="sm" variant="primary" disabled={devreDisi || !!taslak || widgetlar.length >= PANEL_WIDGET_SINIRI} onClick={() => {
            setHata("");
            setTaslak(varsayilanWidget(kaynaklar[0], crypto.randomUUID()));
          }}><Plus size={15} aria-hidden /> Widget ekle</Button>}
        </div>
      </div>

      {hata && <Alert tone="error"><div className={styles.toolbar}>{hata}{(!tercih || cakisiyor) && <Button type="button" size="sm" onClick={yenidenYukle}>Güncel düzeni yükle</Button>}</div></Alert>}

      {taslak && ayarlar && (
        <Card pad={false} className={styles.builder}>
          <h3>{mevcutWidgetDuzenleniyor ? "Widget’ı düzenle" : "Yeni widget"}</h3>
          {!mevcutWidgetDuzenleniyor && sablonlar.length > 0 && (
            <div className={styles.templates} role="group" aria-label="Hazır şablonlar">
              <span className={styles.muted}>Hazır şablonlar</span>
              {sablonlar.map(({ kod, widget }) => (
                <Button key={kod} type="button" size="sm" disabled={devreDisi} onClick={() => {
                  const yeni = { ...widget, id: taslak.id };
                  setTaslak(yeni);
                  setOnizleme(yeni);
                }}>{widget.baslik}</Button>
              ))}
            </div>
          )}
          <form onSubmit={kaydetForm}>
            <fieldset disabled={kaydediliyor} className={styles.fields}>
              <label>Başlık
                <Input autoFocus required maxLength={60} value={taslak.baslik} onChange={(e) => { setTaslak({ ...taslak, baslik: e.target.value }); setOnizleme(undefined); }} placeholder="Örneğin, gecikmiş alacaklar" />
              </label>
              <label>Veri kaynağı
                <Select value={taslak.kaynak} onChange={(e) => {
                  setTaslak(varsayilanWidget(e.target.value as PanelWidget["kaynak"], taslak.id, taslak.baslik));
                  setOnizleme(undefined);
                }}>
                  {kaynaklar.map((kaynak) => <option value={kaynak} key={kaynak}>{WIDGET_KAYNAKLARI[kaynak].ad}</option>)}
                </Select>
              </label>
              <label>Filtre
                <Select value={taslak.filtre} onChange={(e) => {
                  const filtre = e.target.value;
                  const gorunumler = widgetGorunumleri(taslak.kaynak, filtre);
                  const gorunum = gorunumler.includes(taslak.gorunum) ? taslak.gorunum : gorunumler[0];
                  setTaslak({ ...taslak, filtre, gorunum });
                  setOnizleme(undefined);
                }}>
                  {Object.entries(ayarlar.filtreler).map(([deger, ad]) => <option key={deger} value={deger}>{ad}</option>)}
                </Select>
              </label>
              <label>Görünüm
                <Select value={taslak.gorunum} onChange={(e) => {
                  setTaslak({ ...taslak, gorunum: e.target.value as PanelWidget["gorunum"] });
                  setOnizleme(undefined);
                }}>
                  {widgetGorunumleri(taslak.kaynak, taslak.filtre).map((gorunum) => <option key={gorunum} value={gorunum}>{WIDGET_GORUNUMLERI[gorunum]}</option>)}
                </Select>
              </label>
            </fieldset>
            <div className={styles.formActions}>
              <Button type="button" disabled={kaydediliyor} onClick={() => { setTaslak(undefined); setOnizleme(undefined); }}>İptal</Button>
              <Button type="button" disabled={kaydediliyor} onClick={() => {
                const sonuc = panelWidgetSemasi.safeParse({ ...taslak, baslik: taslak.baslik.trim() || ayarlar.ad });
                if (sonuc.success) setOnizleme(sonuc.data);
              }}>Önizle</Button>
              <Button type="submit" variant="primary" disabled={devreDisi || !taslak.baslik.trim()}>{kaydediliyor ? "Kaydediliyor…" : "Kaydet"}</Button>
            </div>
          </form>
          {onizleme && <div className={styles.preview}><h4>Önizleme · {onizleme.baslik}</h4><WidgetIcerigi widget={onizleme} rol={rol} yenileme={yenileme} /></div>}
        </Card>
      )}

      {widgetlar.length > 0 && (
        <div className={styles.grid}>
          {widgetlar.map((widget, sira) => (
            <Card key={widget.id} pad={false} className={styles.widget}>
              <div className={styles.header}>
                <h3>{widget.baslik}</h3>
                {duzenle && <div className={styles.toolbar}>
                  <Button type="button" size="sm" aria-label={`${widget.baslik} yukarı taşı`} title="Yukarı taşı" disabled={devreDisi || sira === 0} onClick={() => tasi(sira, -1)}><ArrowUp size={15} aria-hidden /></Button>
                  <Button type="button" size="sm" aria-label={`${widget.baslik} aşağı taşı`} title="Aşağı taşı" disabled={devreDisi || sira === widgetlar.length - 1} onClick={() => tasi(sira, 1)}><ArrowDown size={15} aria-hidden /></Button>
                  <Button type="button" size="sm" aria-label={`${widget.baslik} düzenle`} title="Düzenle" disabled={devreDisi || !!taslak || !kaynaklar.includes(widget.kaynak)} onClick={() => setTaslak(widget)}><Pencil size={15} aria-hidden /></Button>
                  <Button type="button" size="sm" aria-label={`${widget.baslik} kaldır`} title="Kaldır" disabled={devreDisi || !!taslak} onClick={() => void kaydet(widgetlar.filter((kayit) => kayit.id !== widget.id))}><Trash2 size={15} aria-hidden /></Button>
                </div>}
              </div>
              <WidgetIcerigi key={`${widget.kaynak}:${widget.filtre}:${widget.gorunum}`} widget={widget} rol={rol} yenileme={yenileme} />
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
