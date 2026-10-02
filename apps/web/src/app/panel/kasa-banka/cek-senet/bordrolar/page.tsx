"use client";

/**
 * Çek/senet bordroları (KSB-11): giriş, ciro, bankaya tahsil/teminat ve borç
 * çeki çıkışı. Bordro numaralı belgedir; PDF'i imza alanlı basılır (istenirse
 * evrak görüntüleriyle), bütün olarak geri alınır.
 */
import { useCallback, useEffect, useState } from "react";
import { api, apiDosyaIndir, tokenAl } from "@/lib/api";
import { GeriAlmaFormu, type GeriAlmaYontemi } from "@/components/geri-alma-formu";
import { Alert, Badge, Button, ButtonLabel, Para, Segmented, Tarih } from "@/components/ui";
import { CekGorunumu } from "../cek-gorunumu";
import { BORDRO_ADI, YeniBordro, type BordroTuru } from "./yeni-bordro";

interface BordroOzeti {
  id: string; no: string; tur: BordroTuru; durum: "aktif" | "geri_alindi"; tarih: string; dovizCinsi: string; toplam: string; adet: number; ortalamaVade: string;
  aciklama: string | null; cari: { id: string; kod: string; unvan: string } | null; bankaHesap: { id: string; ad: string } | null; geriAlmaNedeni?: string | null;
}
interface BordroAyrintisi extends BordroOzeti {
  olaylar: Array<{ id: string; geriAlindi: boolean; cekSenet: { id: string; tur: string; portfoyNo: string; cekNo: string | null; vadeTarihi: string; tutar: string; borclu: string; banka: string | null; sube: string | null; durum: string; onYuzEkId: string | null; arkaYuzEkId: string | null } | null }>;
}

const TUR_ROZETI: Record<BordroTuru, "success" | "info" | "warning" | "accent" | "neutral"> = { giris: "success", ciro: "accent", tahsile: "info", teminata: "warning", borc_cikis: "neutral" };

export default function BordrolarSayfasi() {
  const [bordrolar, setBordrolar] = useState<BordroOzeti[]>([]);
  const [suzgec, setSuzgec] = useState<"" | BordroTuru>("");
  const [yeni, setYeni] = useState<BordroTuru | null>(null);
  const [seciliId, setSeciliId] = useState<string | null>(null);
  const [ayrinti, setAyrinti] = useState<BordroAyrintisi | null>(null);
  const [acikEvrak, setAcikEvrak] = useState<string | null>(null);
  const [geriAl, setGeriAl] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const yukle = useCallback(async () => {
    try {
      setBordrolar(await api<BordroOzeti[]>(`/kasa-banka/cek-bordrolari${suzgec ? `?tur=${suzgec}` : ""}`));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Bordrolar yüklenemedi");
    }
  }, [suzgec]);
  useEffect(() => { if (tokenAl()) void yukle(); }, [yukle]);
  useEffect(() => { const id = new URLSearchParams(location.search).get("bordro"); if (id) setSeciliId(id); }, []);

  const ayrintiYukle = useCallback(async () => {
    if (!seciliId) { setAyrinti(null); return; }
    try { setAyrinti(await api<BordroAyrintisi>(`/kasa-banka/cek-bordrolari/${seciliId}`)); } catch (e) { setHata(e instanceof Error ? e.message : "Bordro yüklenemedi"); }
  }, [seciliId]);
  useEffect(() => { void ayrintiYukle(); setGeriAl(false); setAcikEvrak(null); }, [ayrintiYukle]);

  const evraklar = ayrinti?.olaylar.filter((o) => o.cekSenet) ?? [];
  const gorunumVar = evraklar.some((o) => o.cekSenet!.onYuzEkId || o.cekSenet!.arkaYuzEkId);

  return (
    <div className="bordro-page">
      <section className="cheque-hero">
        <div>
          <span>ÇEK & SENET</span>
          <h1>Bordrolar</h1>
          <p>Birden çok evrakı tek seferde portföye alın, ciro edin, bankaya verin ya da kendi çeklerinizi çıkarın. Her bordro numaralı, imza alanlı çıktısı olan bir belgedir.</p>
        </div>
        <div><ButtonLabel as="a" href="/panel/kasa-banka/cek-senet">← Çek & Senetler</ButtonLabel></div>
      </section>

      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      {yeni ? (
        <YeniBordro
          tur={yeni}
          onVazgec={() => setYeni(null)}
          onKaydedildi={(id, mesaj) => { setYeni(null); setBasari(mesaj); setHata(""); setSeciliId(id); void yukle(); }}
        />
      ) : (
        <div className="bordro-start" role="group" aria-label="Yeni bordro">
          {(Object.keys(BORDRO_ADI) as BordroTuru[]).map((t) => (
            <button key={t} type="button" onClick={() => { setYeni(t); setBasari(""); setSeciliId(null); }}>
              <b>+ {BORDRO_ADI[t]}</b>
              <small>{t === "giris" ? "Müşteriden evrak al" : t === "ciro" ? "Portföyden tedarikçiye" : t === "tahsile" ? "Portföyden bankaya" : t === "teminata" ? "Kredi teminatı" : "Kendi çekimizi ver"}</small>
            </button>
          ))}
        </div>
      )}

      <div className="bordro-layout">
        <section className="bordro-list">
          <Segmented<"" | BordroTuru>
            ariaLabel="Bordro türü"
            value={suzgec}
            onChange={setSuzgec}
            items={[{ deger: "", baslik: "Tümü" }, ...(Object.keys(BORDRO_ADI) as BordroTuru[]).map((t) => ({ deger: t, baslik: BORDRO_ADI[t].replace(" bordrosu", "") }))]}
          />
          {bordrolar.map((b) => (
            <button key={b.id} type="button" className={`bordro-item${b.id === seciliId ? " is-selected" : ""}${b.durum === "geri_alindi" ? " is-undone" : ""}`} onClick={() => setSeciliId(b.id)}>
              <span className="mono">{b.no}</span>
              <span><strong>{b.cari?.unvan ?? b.bankaHesap?.ad ?? "—"}</strong><small><Badge variant={TUR_ROZETI[b.tur]}>{BORDRO_ADI[b.tur]}</Badge> · <Tarih deger={b.tarih} /> · {b.adet} evrak{b.durum === "geri_alindi" ? " · geri alındı" : ""}</small></span>
              <b><Para deger={b.toplam} dovizCinsi={b.dovizCinsi} /></b>
            </button>
          ))}
          {!bordrolar.length && <p className="bordro-note">Henüz bordro yok. Yukarıdan bir bordro türü seçerek başlayın.</p>}
        </section>

        <section className="bordro-detail">
          {ayrinti ? (
            <>
              <header className="bordro-detail__head">
                <div>
                  <span>{BORDRO_ADI[ayrinti.tur].toLocaleUpperCase("tr")}</span>
                  <h2>{ayrinti.no} {ayrinti.durum === "geri_alindi" && <Badge variant="neutral">Geri alındı</Badge>}</h2>
                  <p><Tarih deger={ayrinti.tarih} /> · {ayrinti.cari ? ayrinti.cari.unvan : ayrinti.bankaHesap?.ad}{ayrinti.aciklama ? ` · ${ayrinti.aciklama}` : ""}</p>
                </div>
                <div className="row-tight">
                  <Button size="sm" onClick={() => void apiDosyaIndir(`/kasa-banka/cek-bordrolari/${ayrinti.id}/pdf`, `${ayrinti.no}.pdf`)}>PDF</Button>
                  {gorunumVar && <Button size="sm" onClick={() => void apiDosyaIndir(`/kasa-banka/cek-bordrolari/${ayrinti.id}/pdf?gorunumler=1`, `${ayrinti.no}-gorunumlu.pdf`)}>PDF + görüntüler</Button>}
                  {ayrinti.durum === "aktif" && !geriAl && <Button size="sm" variant="danger" onClick={() => setGeriAl(true)}>Bordroyu geri al</Button>}
                </div>
              </header>
              <dl className="bordro-detail__sums">
                <div><dt>Evrak</dt><dd>{ayrinti.adet}</dd></div>
                <div><dt>Toplam</dt><dd><Para deger={ayrinti.toplam} dovizCinsi={ayrinti.dovizCinsi} /></dd></div>
                <div><dt>Ortalama vade</dt><dd><Tarih deger={ayrinti.ortalamaVade} /></dd></div>
              </dl>
              {ayrinti.durum === "geri_alindi" && ayrinti.geriAlmaNedeni && <Alert tone="warning">Geri alma gerekçesi: {ayrinti.geriAlmaNedeni}</Alert>}
              {geriAl && (
                <GeriAlmaFormu<{ yontem: GeriAlmaYontemi; no: string; evrak: number; silinen: number; tersKayit: boolean }>
                  baslik="Bordroyu geri al"
                  uc={`/kasa-banka/cek-bordrolari/${ayrinti.id}/geri-al`}
                  aciklama={<>Bordrodaki {ayrinti.adet} evrakın bu işlemi birlikte geri alınır{ayrinti.tur === "giris" || ayrinti.tur === "borc_cikis" ? "; açık dönemde evraklar görüntüleriyle silinir, kapalı dönemde ters kayıt atılır" : "; evraklar portföye döner"}. Bordrodan sonra evraklarda başka işlem yapıldıysa önce o işlem geri alınmalıdır. Bordro numarası yeniden kullanılmaz.</>}
                  onVazgec={() => setGeriAl(false)}
                  onTamam={(s) => { setGeriAl(false); setBasari(`${s.no} geri alındı: ${s.evrak} evrak${s.silinen ? `, ${s.silinen} evrak silindi` : ""}${s.tersKayit ? "; kapalı dönem için ters kayıt atıldı" : ""}.`); void ayrintiYukle(); void yukle(); }}
                />
              )}
              <div className="bordro-docs">
                {evraklar.map((o, i) => {
                  const c = o.cekSenet!;
                  const acik = acikEvrak === c.id;
                  return (
                    <article key={o.id} className={`bordro-doc${o.geriAlindi ? " is-undone" : ""}`}>
                      <button type="button" className="bordro-doc__row" onClick={() => setAcikEvrak(acik ? null : c.id)} aria-expanded={acik}>
                        <span className="bordro-doc__no">{i + 1}</span>
                        <span className="mono">{c.portfoyNo}</span>
                        <span><strong>{c.borclu}</strong><small>{c.tur === "senet" ? "Senet" : `Çek ${c.cekNo ?? ""}`}{c.banka ? ` · ${c.banka}${c.sube ? ` / ${c.sube}` : ""}` : ""}</small></span>
                        <span><Tarih deger={c.vadeTarihi} /></span>
                        <b><Para deger={c.tutar} dovizCinsi={ayrinti.dovizCinsi} /></b>
                        <span className="bordro-doc__img">{c.onYuzEkId || c.arkaYuzEkId ? "📷" : "＋"}</span>
                      </button>
                      {acik && <CekGorunumu cekId={c.id} onYuzEkId={c.onYuzEkId} arkaYuzEkId={c.arkaYuzEkId} duzenlenebilir={!o.geriAlindi} onDegisti={() => void ayrintiYukle()} />}
                    </article>
                  );
                })}
                {!evraklar.length && <p className="bordro-note">Bu bordronun evrakları geri alma ile silindi.</p>}
              </div>
              <p className="bordro-note">Evrak satırına tıklayarak ön/arka yüz görüntüsünü görün ya da ekleyin.</p>
            </>
          ) : <p className="bordro-note">Ayrıntı için soldan bir bordro seçin.</p>}
        </section>
      </div>
    </div>
  );
}
