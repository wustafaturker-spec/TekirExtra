"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";
import { api, tokenAl } from "@/lib/api";
import { gunEkleTR } from "@tekirextra/shared";

interface Merkez {
  id: string;
  kod: string;
  ad: string;
  gunlukKapasiteDakika: number;
  verimlilikYuzdesi: string;
  saatlikMaliyet: string;
  iscilikSaatlik: string;
  makineSaatlik: string;
  genelGiderSaatlik: string;
  aktif: boolean;
}
interface Kapasite {
  isMerkezi: Merkez;
  kapasiteDakika: string;
  planlananDakika: string;
  dolulukYuzdesi: string;
  asimDakika: string;
  operasyonlar: {
    id: string;
    operasyonKodu: string;
    operasyonAdi: string;
    planlananDakika: string;
    planlananBaslangic: string;
    planlananBitis: string;
    uretimEmri: { id: string; no: string; durum: string; stok: { kod: string; ad: string } };
  }[];
}
interface Vardiya {
  id: string;
  kod: string;
  ad: string;
  baslangicSaati: string;
  bitisSaati: string;
}
const tarih = (gunFarki = 0) => gunEkleTR(gunFarki);
const sayi = (v: string | number) => Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 2 });

export default function UretimPlanlamaSayfasi() {
  const [merkezler, setMerkezler] = useState<Merkez[]>([]);
  const [kapasite, setKapasite] = useState<Kapasite[]>([]);
  const [baslangic, setBaslangic] = useState(tarih());
  const [bitis, setBitis] = useState(tarih(6));
  const [formAcik, setFormAcik] = useState(false);
  const [kod, setKod] = useState("");
  const [ad, setAd] = useState("");
  const [dakika, setDakika] = useState("480");
  const [verimlilik, setVerimlilik] = useState("100");
  const [iscilik, setIscilik] = useState("0");
  const [makine, setMakine] = useState("0");
  const [genelGider, setGenelGider] = useState("0");
  const [duzenlenen, setDuzenlenen] = useState<Merkez | null>(null);
  const [vardiyalar, setVardiyalar] = useState<Vardiya[]>([]);
  const [vardiyaFormAcik, setVardiyaFormAcik] = useState(false);
  const [vardiyaKod, setVardiyaKod] = useState("");
  const [vardiyaAd, setVardiyaAd] = useState("");
  const [vardiyaBaslangic, setVardiyaBaslangic] = useState("08:00");
  const [vardiyaBitis, setVardiyaBitis] = useState("16:00");
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  async function yukle() {
    const [m, k, v] = await Promise.all([
      api<Merkez[]>("/uretim/is-merkezleri"),
      api<Kapasite[]>(`/uretim/kapasite?baslangic=${baslangic}&bitis=${bitis}`),
      api<Vardiya[]>("/uretim/vardiyalar"),
    ]);
    setMerkezler(m);
    setKapasite(k);
    setVardiyalar(v);
  }
  useEffect(() => {
    if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Planlama yüklenemedi"));
  }, [baslangic, bitis]);
  /** Saatlik maliyet = işçilik + makine + genel gider; operasyon süresiyle çarpılıp mamul maliyetine girer. */
  const toplamSaatlik = (Number(iscilik) || 0) + (Number(makine) || 0) + (Number(genelGider) || 0);
  function formuAc(m: Merkez | null) {
    setDuzenlenen(m);
    setKod(m?.kod ?? "");
    setAd(m?.ad ?? "");
    setDakika(String(m?.gunlukKapasiteDakika ?? 480));
    setVerimlilik(m ? String(Number(m.verimlilikYuzdesi)) : "100");
    setIscilik(m ? String(Number(m.iscilikSaatlik)) : "0");
    setMakine(m ? String(Number(m.makineSaatlik)) : "0");
    setGenelGider(m ? String(Number(m.genelGiderSaatlik)) : "0");
    setFormAcik(true);
  }
  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    try {
      await api(duzenlenen ? `/uretim/is-merkezleri/${duzenlenen.id}` : "/uretim/is-merkezleri", {
        method: duzenlenen ? "PUT" : "POST",
        body: JSON.stringify({
          kod,
          ad,
          gunlukKapasiteDakika: dakika,
          verimlilikYuzdesi: verimlilik,
          iscilikSaatlik: iscilik,
          makineSaatlik: makine,
          genelGiderSaatlik: genelGider,
          aktif: duzenlenen?.aktif ?? true,
        }),
      });
      setBasari(duzenlenen ? "İş merkezi güncellendi." : "İş merkezi oluşturuldu.");
      setFormAcik(false);
      setDuzenlenen(null);
      setKod("");
      setAd("");
      await yukle();
    } catch (neden) {
      setHata(neden instanceof Error ? neden.message : "İş merkezi kaydedilemedi");
    }
  }
  // Operasyon başlatmak vardiya ister; vardiya yoksa emir ekranında operasyon başlatılamaz.
  async function vardiyaKaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    try {
      await api("/uretim/vardiyalar", {
        method: "POST",
        body: JSON.stringify({
          kod: vardiyaKod,
          ad: vardiyaAd,
          baslangicSaati: vardiyaBaslangic,
          bitisSaati: vardiyaBitis,
        }),
      });
      setBasari("Vardiya oluşturuldu.");
      setVardiyaFormAcik(false);
      setVardiyaKod("");
      setVardiyaAd("");
      await yukle();
    } catch (neden) {
      setHata(neden instanceof Error ? neden.message : "Vardiya oluşturulamadı");
    }
  }
  return (
    <div className="production-page">
      <PageHeader
        title="Üretim Planlama"
        subtitle="İş merkezi kapasitesini ve planlanan operasyon yükünü izleyin."
        actions={
          <Button variant="primary" onClick={() => (formAcik && !duzenlenen ? setFormAcik(false) : formuAc(null))}>
            + İş merkezi
          </Button>
        }
      />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      {formAcik && (
        <Card title={duzenlenen ? `İş merkezini düzenle · ${duzenlenen.kod}` : "Yeni iş merkezi"}>
          <form className="form-grid" onSubmit={kaydet}>
            <Field label="Kod">
              <Input required maxLength={30} value={kod} onChange={(e) => setKod(e.target.value)} />
            </Field>
            <Field label="Ad">
              <Input required maxLength={120} value={ad} onChange={(e) => setAd(e.target.value)} />
            </Field>
            <Field label="Günlük kapasite (dakika)">
              <Input
                required
                type="number"
                min="1"
                max="1440"
                value={dakika}
                onChange={(e) => setDakika(e.target.value)}
              />
            </Field>
            <Field label="Verimlilik (%)">
              <Input
                required
                type="number"
                min="1"
                max="200"
                step="0.01"
                value={verimlilik}
                onChange={(e) => setVerimlilik(e.target.value)}
              />
            </Field>
            <Field label="İşçilik (TL/saat)">
              <Input
                required
                type="number"
                min="0"
                step="0.01"
                value={iscilik}
                onChange={(e) => setIscilik(e.target.value)}
              />
            </Field>
            <Field label="Makine (TL/saat)">
              <Input
                required
                type="number"
                min="0"
                step="0.01"
                value={makine}
                onChange={(e) => setMakine(e.target.value)}
              />
            </Field>
            <Field label="Genel gider (TL/saat)">
              <Input
                required
                type="number"
                min="0"
                step="0.01"
                value={genelGider}
                onChange={(e) => setGenelGider(e.target.value)}
              />
            </Field>
            <Field label="Saatlik maliyet (toplam)">
              <Input readOnly value={`${sayi(toplamSaatlik)} TL`} />
            </Field>
            <div className="row-tight">
              <Button type="submit" variant="primary">
                Kaydet
              </Button>
              {duzenlenen && (
                <Button
                  type="button"
                  onClick={() => {
                    setFormAcik(false);
                    setDuzenlenen(null);
                  }}
                >
                  Vazgeç
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}
      <Card className="production-filter-card" title="Planlama aralığı">
        <div className="production-filter-grid production-filter-grid--dates">
          <Field label="Başlangıç">
            <Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} />
          </Field>
          <div className="production-filter-note">
            <strong>93 güne kadar kapasite analizi</strong>
            <small>Tarih değişiklikleri planı otomatik yeniler.</small>
          </div>
        </div>
      </Card>
      <section className="production-summary" aria-label="İş merkezi kapasitesi">
        {kapasite.map((k) => (
          <article key={k.isMerkezi.id}>
            <span>
              {k.isMerkezi.kod} · {k.isMerkezi.ad}
            </span>
            <strong>%{sayi(k.dolulukYuzdesi)}</strong>
            <small>
              {sayi(k.planlananDakika)} / {sayi(k.kapasiteDakika)} dk{" "}
              {Number(k.asimDakika) > 0 ? `· ${sayi(k.asimDakika)} dk aşım` : ""}
            </small>
          </article>
        ))}
        {!kapasite.length && (
          <article>
            <span>İş merkezi</span>
            <strong>—</strong>
            <small>Henüz tanımlanmadı</small>
          </article>
        )}
      </section>
      <Card title="Planlanan operasyonlar" pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>İş merkezi</th>
              <th>Emir</th>
              <th>Operasyon</th>
              <th>Başlangıç</th>
              <th className="num">Süre</th>
              <th>Yük</th>
            </tr>
          </thead>
          <tbody>
            {kapasite.flatMap((k) =>
              k.operasyonlar.map((o) => (
                <tr key={o.id}>
                  <td>
                    {k.isMerkezi.kod} — {k.isMerkezi.ad}
                  </td>
                  <td>
                    <strong>{o.uretimEmri.no}</strong>
                    <br />
                    <small>
                      {o.uretimEmri.stok.kod} — {o.uretimEmri.stok.ad}
                    </small>
                  </td>
                  <td>
                    {o.operasyonKodu} — {o.operasyonAdi}
                  </td>
                  <td>{new Date(o.planlananBaslangic).toLocaleString("tr-TR")}</td>
                  <td className="num">{sayi(o.planlananDakika)} dk</td>
                  <td>
                    <Badge variant={Number(k.asimDakika) > 0 ? "danger" : "success"}>
                      {Number(k.asimDakika) > 0 ? "Kapasite aşımı" : "Planlı"}
                    </Badge>
                  </td>
                </tr>
              )),
            )}
            {!kapasite.some((k) => k.operasyonlar.length) && (
              <tr>
                <td colSpan={6}>Seçilen aralıkta planlanan operasyon yok.</td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>
      <Card title="İş merkezleri" pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Kod</th>
              <th>Ad</th>
              <th className="num">Günlük kapasite</th>
              <th className="num">Verimlilik</th>
              <th className="num">İşçilik</th>
              <th className="num">Makine</th>
              <th className="num">Genel gider</th>
              <th className="num">Saatlik toplam</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {merkezler.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.kod}</strong>
                </td>
                <td>{m.ad}</td>
                <td className="num">{m.gunlukKapasiteDakika} dk</td>
                <td className="num">%{sayi(m.verimlilikYuzdesi)}</td>
                <td className="num">{sayi(m.iscilikSaatlik)} TL</td>
                <td className="num">{sayi(m.makineSaatlik)} TL</td>
                <td className="num">{sayi(m.genelGiderSaatlik)} TL</td>
                <td className="num">
                  <strong>{sayi(m.saatlikMaliyet)} TL</strong>
                </td>
                <td>
                  <Button size="sm" onClick={() => formuAc(m)}>
                    Düzenle
                  </Button>
                </td>
              </tr>
            ))}
            {!merkezler.length && (
              <tr>
                <td colSpan={9}>İş merkezi tanımlanmadı.</td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>
      {vardiyaFormAcik && (
        <Card title="Yeni vardiya">
          <form className="form-grid" onSubmit={vardiyaKaydet}>
            <Field label="Kod">
              <Input
                required
                maxLength={20}
                value={vardiyaKod}
                onChange={(e) => setVardiyaKod(e.target.value)}
                placeholder="V1"
              />
            </Field>
            <Field label="Ad">
              <Input
                required
                minLength={2}
                maxLength={100}
                value={vardiyaAd}
                onChange={(e) => setVardiyaAd(e.target.value)}
                placeholder="Gündüz"
              />
            </Field>
            <Field label="Başlangıç">
              <Input
                required
                type="time"
                value={vardiyaBaslangic}
                onChange={(e) => setVardiyaBaslangic(e.target.value)}
              />
            </Field>
            <Field label="Bitiş">
              <Input required type="time" value={vardiyaBitis} onChange={(e) => setVardiyaBitis(e.target.value)} />
            </Field>
            <div>
              <Button type="submit" variant="primary">
                Kaydet
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Card
        title="Vardiyalar"
        actions={
          <Button size="sm" onClick={() => setVardiyaFormAcik((v) => !v)}>
            + Vardiya
          </Button>
        }
        pad={false}
      >
        <TableWrap>
          <thead>
            <tr>
              <th>Kod</th>
              <th>Ad</th>
              <th>Saatler</th>
            </tr>
          </thead>
          <tbody>
            {vardiyalar.map((v) => (
              <tr key={v.id}>
                <td>
                  <strong>{v.kod}</strong>
                </td>
                <td>{v.ad}</td>
                <td>
                  {v.baslangicSaati} – {v.bitisSaati}
                </td>
              </tr>
            ))}
            {!vardiyalar.length && (
              <tr>
                <td colSpan={3}>Vardiya tanımlanmadı. Operasyon başlatmak için en az bir vardiya gerekir.</td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}
