"use client";

/**
 * Şirket kredi kartları (KSB-10). Kart seçilince "bu dönem" paneli son
 * kesilen ekstreyi (dönem borcu, asgari, son ödeme günü) ve açık dönemi
 * gösterir; altında dönem ekstreleri gezilir. Limit aşan işlem onayla geçer.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Para, Select, Tarih } from "@/components/ui";
import { api, ApiHata, tokenAl } from "@/lib/api";
import { EkstrePaneli } from "./ekstre-paneli";
import { CariOdemeFormu, EkstreOdemeFormu, HareketFormu, KartAyarFormu, type Gonder } from "./islem-formlari";
import { ayAdi, DURUM, type Banka, type Kart } from "./tipler";

type Islem = "cari" | "hareket" | "ekstre" | "ayar" | null;

export default function KrediKartlariSayfasi() {
  const [kartlar, setKartlar] = useState<Kart[]>([]);
  const [bankalar, setBankalar] = useState<Banka[]>([]);
  const [secili, setSecili] = useState("");
  const [islem, setIslem] = useState<Islem>(null);
  const [kartFormu, setKartFormu] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [limitOnayi, setLimitOnayi] = useState<{ yol: string; govde: Record<string, unknown>; mesaj: string; uyari: string } | null>(null);
  const [yenile, setYenile] = useState(0);

  const yukle = useCallback(async () => {
    const [k, b] = await Promise.all([api<Kart[]>("/kasa-banka/kredi-kartlari"), api<Banka[]>("/kasa-banka/bankalar")]);
    setKartlar(k);
    setBankalar(b.filter((x) => x.aktif));
    setSecili((s) => s || new URLSearchParams(location.search).get("kart") || k[0]?.id || "");
  }, []);
  useEffect(() => { if (tokenAl()) void yukle().catch((e) => setHata(e instanceof Error ? e.message : "Kartlar yüklenemedi")); }, [yukle]);

  const mesaj = useCallback((metin: string, hataMi = false) => {
    if (hataMi) { setHata(metin); return; }
    setHata("");
    setBasari(metin);
    setYenile((x) => x + 1);
    void yukle();
  }, [yukle]);

  /** İşlemi gönderir; limit aşımında (409) onay ister, onaylanınca aynı isteği onayla yineler. */
  const gonder: Gonder = useCallback(async (yol, govde, basariMesaji, method = "POST") => {
    setHata("");
    try {
      await api(yol, { method, body: JSON.stringify(govde) });
      setLimitOnayi(null);
      setIslem(null);
      mesaj(basariMesaji);
      return true;
    } catch (e) {
      if (e instanceof ApiHata && e.durum === 409 && !govde.limitAsimiOnay && /limit/i.test(e.message)) {
        setLimitOnayi({ yol, govde, mesaj: basariMesaji, uyari: e.message });
        return false;
      }
      setHata(e instanceof Error ? e.message : "İşlem yapılamadı");
      return false;
    }
  }, [mesaj]);

  async function kartEkle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const oran = f.get("asgariOdemeOrani");
    if (await gonder("/kasa-banka/kredi-kartlari", {
      ad: f.get("ad"), bankaAdi: f.get("bankaAdi"), sonDortHane: f.get("sonDortHane"), kartSahibi: f.get("kartSahibi") || null, limit: f.get("limit"),
      dovizCinsi: f.get("dovizCinsi"), hesapKesimGunu: Number(f.get("hesapKesimGunu")), sonOdemeGunu: Number(f.get("sonOdemeGunu")),
      bagliBankaHesapId: f.get("bagliBankaHesapId") || null, renk: f.get("renk"), asgariOdemeOrani: oran ? Number(oran) : null,
    }, "Kredi kartı hesabı oluşturuldu.")) setKartFormu(false);
  }

  const aktifKart = kartlar.find((k) => k.id === secili) ?? kartlar[0];
  const ozet = useMemo(() => {
    const tl = kartlar.filter((k) => k.dovizCinsi === "TRY");
    const odenecek = tl.filter((k) => k.sonEkstre && Number(k.sonEkstre.kalan) > 0);
    const enYakin = odenecek.map((k) => k.sonEkstre!.sonOdemeTarihi).sort()[0] ?? null;
    return {
      borc: tl.reduce((t, k) => t + Number(k.borc), 0),
      limit: tl.reduce((t, k) => t + Number(k.limit), 0),
      uygun: tl.reduce((t, k) => t + Number(k.kullanilabilirLimit), 0),
      odenecek: odenecek.reduce((t, k) => t + Number(k.sonEkstre!.kalan), 0),
      gecikmis: tl.filter((k) => k.sonEkstre?.durum === "gecikti").length,
      enYakin,
    };
  }, [kartlar]);

  return (
    <div className="cc-page">
      <header className="cc-header">
        <div>
          <span>FİNANS YÖNETİMİ</span>
          <h1>Şirket kredi kartları</h1>
          <p>Dönem ekstrelerini, son ödeme günlerini, taksitleri ve kart giderlerini tek merkezden yönetin.</p>
        </div>
        <Button variant="primary" onClick={() => setKartFormu((v) => !v)}>+ Yeni kart hesabı</Button>
      </header>

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      {limitOnayi && (
        <div className="cc-limit-warning" role="alert">
          <p><strong>Kart limiti aşılıyor.</strong> {limitOnayi.uyari}</p>
          <div className="row-tight">
            <Button size="sm" onClick={() => setLimitOnayi(null)}>Vazgeç</Button>
            <Button size="sm" variant="primary" onClick={() => void gonder(limitOnayi.yol, { ...limitOnayi.govde, limitAsimiOnay: true }, limitOnayi.mesaj)}>Yine de kaydet</Button>
          </div>
        </div>
      )}

      <section className="cc-summary">
        <div className="cc-summary__lead">
          <span>Bu dönem ödenecek</span>
          <strong><Para deger={ozet.odenecek} dovizCinsi="TRY" /></strong>
          <small>{ozet.enYakin ? <>En yakın son ödeme <Tarih deger={ozet.enYakin} />{ozet.gecikmis ? ` · ${ozet.gecikmis} kart gecikmiş` : ""}</> : "Ödenmemiş kesilmiş ekstre yok"}</small>
        </div>
        <div><span>Toplam kart borcu</span><strong><Para deger={ozet.borc} dovizCinsi="TRY" /></strong><small>İleri taksitler dahil</small></div>
        <div><span>Kullanılabilir limit</span><strong><Para deger={ozet.uygun} dovizCinsi="TRY" /></strong><small>Toplam limit <Para deger={ozet.limit} dovizCinsi="TRY" /></small></div>
        <div>
          <span>Limit kullanımı</span>
          <strong>%{ozet.limit ? ((ozet.borc / ozet.limit) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "0"}</strong>
          <div className="cc-progress"><i style={{ width: `${Math.min(100, ozet.limit ? (ozet.borc / ozet.limit) * 100 : 0)}%` }} /></div>
        </div>
      </section>

      {kartFormu && (
        <Card className="cc-form-card">
          <h2>Yeni kart hesabı</h2>
          <form className="cc-form-grid" onSubmit={kartEkle}>
            <Field label="Kart hesap adı"><Input name="ad" required /></Field>
            <Field label="Banka"><Input name="bankaAdi" required /></Field>
            <Field label="Son 4 hane"><Input name="sonDortHane" required maxLength={4} pattern="[0-9]{4}" /></Field>
            <Field label="Kart sahibi"><Input name="kartSahibi" /></Field>
            <Field label="Kart limiti"><Input name="limit" required type="number" min="0.01" step="0.01" /></Field>
            <Field label="Para birimi"><Select name="dovizCinsi"><option>TRY</option><option>USD</option><option>EUR</option></Select></Field>
            <Field label="Hesap kesim günü"><Input name="hesapKesimGunu" required type="number" min="1" max="31" /></Field>
            <Field label="Son ödeme günü"><Input name="sonOdemeGunu" required type="number" min="1" max="31" /></Field>
            <Field label="Asgari ödeme oranı (%)"><Input name="asgariOdemeOrani" type="number" min="1" max="100" step="any" placeholder="Boş: limite göre %20/%40" /></Field>
            <Field label="Ödeme banka hesabı">
              <Select name="bagliBankaHesapId"><option value="">Bağlı hesap yok</option>{bankalar.map((b) => <option key={b.id} value={b.id}>{b.ad} · {b.dovizCinsi}</option>)}</Select>
            </Field>
            <Field label="Kart rengi">
              <Select name="renk"><option value="lacivert">Lacivert</option><option value="turkuaz">Turkuaz</option><option value="mor">Mor</option><option value="bordo">Bordo</option></Select>
            </Field>
            <div className="cc-form-actions"><Button type="button" onClick={() => setKartFormu(false)}>Vazgeç</Button><Button type="submit" variant="primary">Kart hesabını oluştur</Button></div>
          </form>
        </Card>
      )}

      <section className="cc-layout">
        <div className="cc-wallet">
          <div className="cc-section-title"><div><h2>Kart portföyü</h2><p>Ayrıntı için bir kart seçin.</p></div></div>
          {kartlar.map((k) => (
            <button type="button" className={`cc-card cc-card--${k.renk}${aktifKart?.id === k.id ? " is-active" : ""}${k.aktif ? "" : " is-passive"}`} key={k.id} onClick={() => { setSecili(k.id); setIslem(null); setLimitOnayi(null); }}>
              <div className="cc-card__top"><span>{k.bankaAdi}</span>{k.sonEkstre && Number(k.sonEkstre.kalan) > 0 ? <em className={`is-${DURUM[k.sonEkstre.durum].ton}`}>{k.sonEkstre.durum === "gecikti" ? "Gecikti" : <>Son ödeme <Tarih deger={k.sonEkstre.sonOdemeTarihi} /></>}</em> : <i>◒</i>}</div>
              <strong>•••• •••• •••• {k.sonDortHane}</strong>
              <div className="cc-card__foot">
                <span>{k.ad}<small>{k.aktif ? k.kartSahibi ?? "Kurumsal kart" : "Pasif kart"}</small></span>
                <span><small>Güncel borç</small><Para deger={k.borc} dovizCinsi={k.dovizCinsi} /></span>
              </div>
            </button>
          ))}
          {!kartlar.length && <p className="cc-empty">Henüz kart hesabı yok.</p>}
        </div>

        <div className="cc-detail">
          {aktifKart ? (
            <>
              <div className="cc-detail__head">
                <div>
                  <span>{aktifKart.bankaAdi} · •••• {aktifKart.sonDortHane}</span>
                  <h2>{aktifKart.ad}</h2>
                  <p>Kesim günü {aktifKart.hesapKesimGunu} · son ödeme günü {aktifKart.sonOdemeGunu} · asgari %{aktifKart.asgariOdemeOrani ? Number(aktifKart.asgariOdemeOrani) : Number(aktifKart.limit) <= 50000 ? 20 : 40} · {aktifKart.bagliBankaHesap?.ad ?? "ödeme hesabı tanımsız"}</p>
                </div>
                <div className="row-tight">
                  <Button variant="primary" onClick={() => setIslem("ekstre")}>Ekstre öde</Button>
                  <Button onClick={() => setIslem("cari")}>Cari borcu öde</Button>
                  <Button onClick={() => setIslem("hareket")}>Harcama / gider</Button>
                  <Button onClick={() => setIslem("ayar")}>Ayarlar</Button>
                </div>
              </div>

              <div className="cc-period-panel">
                <div className={`cc-period-panel__main is-${aktifKart.sonEkstre ? DURUM[aktifKart.sonEkstre.durum].ton : "neutral"}`}>
                  {aktifKart.sonEkstre ? (
                    <>
                      <span>Son ekstre · {ayAdi(aktifKart.sonEkstre.kesimTarihi)} <Badge variant={DURUM[aktifKart.sonEkstre.durum].ton}>{DURUM[aktifKart.sonEkstre.durum].ad}</Badge></span>
                      <strong><Para deger={aktifKart.sonEkstre.kalan} dovizCinsi={aktifKart.dovizCinsi} /></strong>
                      <small>
                        kalan · dönem borcu <Para deger={aktifKart.sonEkstre.donemBorcu} dovizCinsi={aktifKart.dovizCinsi} /> · asgari kalan <Para deger={aktifKart.sonEkstre.asgariKalan} dovizCinsi={aktifKart.dovizCinsi} /> · son ödeme <Tarih deger={aktifKart.sonEkstre.sonOdemeTarihi} />
                      </small>
                    </>
                  ) : <><span>Son ekstre</span><strong>—</strong><small>Henüz kesilmiş ekstre yok</small></>}
                </div>
                <div>
                  <span>Açık dönem{aktifKart.acikDonem ? ` · kesim ${new Date(`${aktifKart.acikDonem.kesimTarihi}T00:00:00Z`).toLocaleDateString("tr-TR", { timeZone: "UTC" })}` : ""}</span>
                  <strong><Para deger={aktifKart.acikDonem?.harcamalar ?? 0} dovizCinsi={aktifKart.dovizCinsi} /></strong>
                  <small>Bu döneme düşen harcama ve taksitler</small>
                </div>
                <div>
                  <span>Kullanılabilir limit</span>
                  <strong><Para deger={aktifKart.kullanilabilirLimit} dovizCinsi={aktifKart.dovizCinsi} /></strong>
                  <small>Borç <Para deger={aktifKart.borc} dovizCinsi={aktifKart.dovizCinsi} /> · %{Number(aktifKart.kullanimOrani).toLocaleString("tr-TR")}</small>
                </div>
              </div>
              {aktifKart.gelecekTaksitler.length > 0 && (
                <p className="cc-future">
                  Gelecek ekstrelere düşecek taksitler:{" "}
                  {aktifKart.gelecekTaksitler.slice(0, 6).map((g, i) => <span key={g.kesimTarihi}>{i ? " · " : ""}{ayAdi(g.kesimTarihi)} <b><Para deger={g.tutar} dovizCinsi={aktifKart.dovizCinsi} /></b></span>)}
                  {aktifKart.gelecekTaksitler.length > 6 && ` · +${aktifKart.gelecekTaksitler.length - 6} dönem`}
                </p>
              )}

              {islem === "ekstre" && <EkstreOdemeFormu key={aktifKart.id} kart={aktifKart} bankalar={bankalar} gonder={gonder} />}
              {islem === "cari" && <CariOdemeFormu key={aktifKart.id} kart={aktifKart} gonder={gonder} />}
              {islem === "hareket" && <HareketFormu key={aktifKart.id} kart={aktifKart} gonder={gonder} />}
              {islem === "ayar" && <KartAyarFormu key={aktifKart.id} kart={aktifKart} bankalar={bankalar} gonder={gonder} onKapat={() => setIslem(null)} />}

              <EkstrePaneli kart={aktifKart} yenile={yenile} onMesaj={mesaj} />
            </>
          ) : <div className="cc-empty">Ayrıntıları görüntülenecek bir kart seçin.</div>}
        </div>
      </section>
    </div>
  );
}
