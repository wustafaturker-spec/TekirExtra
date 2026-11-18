"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiHata, tumSayfalariAl } from "@/lib/api";
import { BankayaGececekler, type AktarimGrubu } from "./bankaya-gececekler";
import { SlipFormu } from "./slip-formu";
import { TahsilatIslemi, type IslemHedefi } from "./tahsilat-islemi";
import { HesapAyarlari } from "./hesap-ayarlari";
import { CariBakiye } from "@/components/cari-bakiye";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, TabPanel, Tabs, TableWrap } from "@/components/ui";
import { bugunTR } from "@tekirextra/shared";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";
import { CariSecici } from "@/components/cari-secici";

interface Banka {
  id: string;
  ad: string;
  dovizCinsi: string;
}
interface Baglanti {
  id: string;
  aile: string;
  saglayici: string;
  durum: string;
}
interface Cari {
  id: string;
  kod: string;
  unvan: string;
  eposta: string | null;
  telefon: string | null;
  dovizCinsi: string;
}
interface CariDetay extends Cari {
  adresler: { id: string }[];
}
interface Fatura {
  id: string;
  no: string | null;
  tarih: string;
  genelToplam: string;
  dovizCinsi: string;
  odemeOzeti?: { durum: string; kalan: string };
}
interface PosHesap {
  id: string;
  ad: string;
  saglayici: string;
  dovizCinsi: string;
  aktif: boolean;
  bakiye: string;
  varsayilanBankaHesap: { id: string; ad: string } | null;
  valorGun: number;
  komisyonOrani: string;
  islemUcreti: string;
  taksitOranlari: { taksit: number; oran: string }[];
  baglanti: { durum: string; sonSenkronHatasi: string | null; updatedAt: string } | null;
}
interface Tahsilat {
  id: string;
  tutar: string;
  dovizCinsi: string;
  durum: "baslatildi" | "odendi" | "basarisiz" | "iptal" | "suresi_doldu";
  odemeSayfasiUrl: string | null;
  makbuzYolu: string | null;
  hataMesaji: string | null;
  epostaGonderimTarihi: string | null;
  epostaHatasi: string | null;
  smsGonderimTarihi: string | null;
  smsHatasi: string | null;
  createdAt: string;
  odemeTarihi: string | null;
  sonKullanimTarihi: string | null;
  posHesap: { id: string; ad: string; saglayici: string };
  cari: { id: string; kod: string; unvan: string };
  fatura: { id: string; no: string | null } | null;
  kanal: string;
  slipNo: string | null;
  gecOdeme: boolean;
  iptalNedeni: string | null;
  iadeEdilen: string;
  iadeler: { id: string; tutar: string; tarih: string; neden: string; saglayiciyaGonderildi: boolean }[];
  taksitSayisi: number;
  odenenTutar: string | null;
  komisyonTutari: string | null;
  netTutar: string | null;
  komisyonKaynagi: "tahmin" | "saglayici" | null;
  kartMarkasi: string | null;
  kartAilesi: string | null;
  kartSon4: string | null;
  kartBin: string | null;
  kartTuru: string | null;
  saglayiciOdemeId: string | null;
  provizyonKodu: string | null;
  hostReferansi: string | null;
  saglayiciKomisyonu: string | null;
  saglayiciUcreti: string | null;
  fraudDurumu: number | null;
}

/** PLT-40: "5526 08•• •••• 0006" — BIN'in ilk 6 hanesi ve son 4; tam kart numarası saklanmaz. */
function maskeliKart(bin: string | null, son4: string | null): string | null {
  if (!son4) return null;
  return bin && bin.length === 6 ? `${bin.slice(0, 4)} ${bin.slice(4)}•• •••• ${son4}` : `•••• ${son4}`;
}
/** KSB-40 */
interface HesapOzeti {
  posHesapId: string;
  dovizCinsi: string;
  adet: number;
  komisyonsuzAdet: number;
  brut: string;
  komisyonSaglayici: string;
  komisyonTahmin: string;
  iade: string;
  net: string;
  aktarilabilir: string;
}
type OzetDonemi = "bu_ay" | "gecen_ay";
function ozetAraligi(d: OzetDonemi): { baslangic: string; bitis: string } {
  const bugun = bugunTR();
  if (d === "bu_ay") return { baslangic: `${bugun.slice(0, 8)}01`, bitis: bugun };
  const [y, a] = bugun.split("-").map(Number);
  const [gy, ga] = a === 1 ? [y - 1, 12] : [y, a - 1];
  const ay = String(ga).padStart(2, "0");
  return { baslangic: `${gy}-${ay}-01`, bitis: `${gy}-${ay}-${String(new Date(Date.UTC(gy, ga, 0)).getUTCDate()).padStart(2, "0")}` };
}
interface ListeYaniti {
  kayitlar: Tahsilat[];
  toplam: number;
  sayfa: number;
  adet: number;
  durumOzetleri: Record<string, number>;
}

const bugun = () => bugunTR();
const para = (v: string | number, d = "TRY") =>
  Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + d;
const durumAdi: Record<string, string> = {
  baslatildi: "Ödeme bekliyor",
  odendi: "Ödendi",
  basarisiz: "Başarısız",
  iptal: "İptal",
  suresi_doldu: "Süresi doldu",
};
const durumRengi = (d: string): "success" | "danger" | "warning" | "neutral" =>
  d === "odendi" ? "success" : d === "basarisiz" ? "danger" : d === "baslatildi" ? "warning" : "neutral";

export default function PosHesaplari() {
  const [hesaplar, setHesaplar] = useState<PosHesap[]>([]),
    [bankalar, setBankalar] = useState<Banka[]>([]),
    [baglantilar, setBaglantilar] = useState<Baglanti[]>([]),
    [cariler, setCariler] = useState<Cari[]>([]),
    [liste, setListe] = useState<ListeYaniti>({ kayitlar: [], toplam: 0, sayfa: 1, adet: 25, durumOzetleri: {} });
  const [panel, setPanel] = useState<"tahsilat" | "hesap" | "slip" | null>(null),
    [islemHedefi, setIslemHedefi] = useState<IslemHedefi | null>(null),
    [ayarHesap, setAyarHesap] = useState<PosHesap | null>(null),
    [aktarimOn, setAktarimOn] = useState<{ brut: string; komisyon: string; tarih: string } | null>(null),
    [yenile, setYenile] = useState(0),
    [mukerrer, setMukerrer] = useState<string | null>(null),
    [yeniSaglayici, setYeniSaglayici] = useState<"sanal" | "banka">("sanal"),
    [aktarim, setAktarim] = useState<PosHesap | null>(null),
    [seciliPosId, setSeciliPosId] = useState(""),
    [seciliCariId, setSeciliCariId] = useState(""),
    [cariDetay, setCariDetay] = useState<CariDetay | null>(null),
    [faturalar, setFaturalar] = useState<Fatura[]>([]),
    [faturaId, setFaturaId] = useState(""),
    [tutar, setTutar] = useState("");
  const [gorunum, setGorunum] = useState<"tahsilatlar" | "hesaplar" | "mutabakat">("tahsilatlar");
  const [arama, setArama] = useState(""),
    [durum, setDurum] = useState(""),
    [posFiltresi, setPosFiltresi] = useState(""),
    [sayfa, setSayfa] = useState(1),
    [acikAyrinti, setAcikAyrinti] = useState<string | null>(null),
    [islemde, setIslemde] = useState(""),
    [hata, setHata] = useState(""),
    [basari, setBasari] = useState("");
  const yukle = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ sayfa: String(sayfa), adet: "25" });
      if (arama) qs.set("arama", arama);
      if (durum) qs.set("durum", durum);
      if (posFiltresi) qs.set("posHesapId", posFiltresi);
      const [p, b, bg, c, t] = await Promise.all([
        api<PosHesap[]>("/kasa-banka/pos-hesaplari"),
        api<Banka[]>("/kasa-banka/bankalar"),
        api<Baglanti[]>("/baglantilar"),
        tumSayfalariAl<Cari>("/cari"),
        api<ListeYaniti>(`/pos/tahsilatlar?${qs}`),
      ]);
      setHesaplar(p);
      setBankalar(b);
      setBaglantilar(bg.filter((x) => x.aile === "pos"));
      setCariler(c);
      setListe(t);
      setYenile((x) => x + 1);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "POS verileri yüklenemedi");
    }
  }, [arama, durum, posFiltresi, sayfa]);
  useEffect(() => {
    void yukle();
  }, [yukle]);
  const [ozetDonemi, setOzetDonemi] = useState<OzetDonemi>("bu_ay");
  const [ozetler, setOzetler] = useState<Record<string, HesapOzeti>>({});
  useEffect(() => {
    const { baslangic, bitis } = ozetAraligi(ozetDonemi);
    api<{ hesaplar: HesapOzeti[] }>(`/pos/hesap-ozetleri?baslangic=${baslangic}&bitis=${bitis}`)
      .then((s) => setOzetler(Object.fromEntries(s.hesaplar.map((h) => [h.posHesapId, h]))))
      .catch(() => setOzetler({}));
  }, [ozetDonemi, yenile]);
  useEffect(() => {
    if (!seciliCariId) {
      setCariDetay(null);
      setFaturalar([]);
      return;
    }
    let iptal = false;
    void Promise.all([
      api<CariDetay>(`/cari/${seciliCariId}`),
      api<{ kayitlar: Fatura[] }>(`/fatura?cariId=${seciliCariId}&yon=satis&durum=kesin&adet=100`),
    ])
      .then(([c, f]) => {
        if (!iptal) {
          setCariDetay(c);
          setFaturalar(f.kayitlar);
        }
      })
      .catch((e) => setHata(e instanceof Error ? e.message : "Cari bilgileri alınamadı"));
    return () => {
      iptal = true;
    };
  }, [seciliCariId]);
  const seciliPos = hesaplar.find((x) => x.id === seciliPosId),
    seciliFatura = faturalar.find((x) => x.id === faturaId);
  const fazlaTahsilat = seciliFatura && Number(tutar) > Number(seciliFatura.odemeOzeti?.kalan ?? seciliFatura.genelToplam);
  const hazir = Boolean(
    seciliPos &&
    cariDetay &&
    seciliPos.dovizCinsi === cariDetay.dovizCinsi &&
    cariDetay.eposta &&
    (seciliPos.saglayici !== "iyzico" || cariDetay.adresler.length),
  );
  const dovizBakiyeleri = new Map<string, number>();
  for (const hesap of hesaplar) {
    dovizBakiyeleri.set(hesap.dovizCinsi, (dovizBakiyeleri.get(hesap.dovizCinsi) ?? 0) + Number(hesap.bakiye));
  }
  const basarili = liste.durumOzetleri.odendi ?? 0,
    basarisiz = liste.durumOzetleri.basarisiz ?? 0,
    bekleyen = liste.durumOzetleri.baslatildi ?? 0;
  const basariOrani = basarili + basarisiz ? (basarili / (basarili + basarisiz)) * 100 : 0;
  const formKonumu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    formKonumu.current?.focus({ preventScroll: true });
    formKonumu.current?.scrollIntoView({ block: "start" });
  }, [panel, islemHedefi, ayarHesap, aktarim, aktarimOn]);

  const acikPanel = (p: "tahsilat" | "hesap" | "slip") => {
    setPanel(p);
    setAktarim(null);
    setIslemHedefi(null);
    setAyarHesap(null);
    setMukerrer(null);
    setHata("");
    setBasari("");
  };
  const bankaPoslari = hesaplar.filter((x) => x.saglayici === "banka" && x.aktif);
  /** P1-6: bankaya geçecekler listesinden aktarım formu grubun tutarlarıyla açılır. */
  function grubuAktar(hesapId: string, g: AktarimGrubu) {
    const h = hesaplar.find((x) => x.id === hesapId);
    if (!h) return;
    setPanel(null);
    setIslemHedefi(null);
    setAyarHesap(null);
    setAktarim(h);
    setAktarimOn({ brut: g.brut, komisyon: g.onerilenKomisyon, tarih: g.vadesiGeldi ? g.valorTarihi : bugun() });
  }
  function islemAc(h: IslemHedefi) {
    setPanel(null);
    setAktarim(null);
    setAyarHesap(null);
    setIslemHedefi(h);
    setHata("");
    setBasari("");
  }
  async function calistir(anahtar: string, is: () => Promise<void>) {
    setIslemde(anahtar);
    setHata("");
    setBasari("");
    try {
      await is();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İşlem tamamlanamadı");
    } finally {
      setIslemde("");
    }
  }
  async function tahsilatBaslat(e?: FormEvent<HTMLFormElement>, oncekiniIptalEt = false) {
    e?.preventDefault();
    if (
      !oncekiniIptalEt &&
      fazlaTahsilat &&
      !window.confirm(
        `Uyarı: Tahsilat faturanın kalan tutarını ${para(Number(tutar) - Number(seciliFatura!.odemeOzeti?.kalan ?? seciliFatura!.genelToplam), seciliFatura!.dovizCinsi)} aşıyor. Yine de ödeme bağlantısı oluşturulsun mu?`,
      )
    )
      return;
    setMukerrer(null);
    await calistir("tahsilat", async () => {
      let s: { odemeSayfasiUrl: string };
      try {
        s = await api<{ odemeSayfasiUrl: string }>("/pos/tahsilatlar", {
          method: "POST",
          body: JSON.stringify({
            posHesapId: seciliPosId,
            cariId: seciliCariId,
            faturaId: faturaId || undefined,
            tutar,
            ...(oncekiniIptalEt ? { oncekiniIptalEt: true } : {}),
          }),
        });
      } catch (err) {
        if (err instanceof ApiHata && err.durum === 409 && /açık ödeme bağlantısı/.test(err.message)) {
          setMukerrer(err.message);
          return;
        }
        throw err;
      }
      setBasari(
        oncekiniIptalEt
          ? "Eski bağlantı iptal edildi; yeni ödeme bağlantısı oluşturuldu ve müşteriye gönderildi."
          : "Ödeme bağlantısı oluşturuldu ve müşteriye gönderildi.",
      );
      setPanel(null);
      await yukle();
      const pencere = window.open(s.odemeSayfasiUrl, "_blank", "noopener,noreferrer");
      if (!pencere) setBasari("Bağlantı oluşturuldu. Tarayıcı yeni pencereyi engelledi; talepler listesinden açabilirsiniz.");
    });
  }
  async function hesapOlustur(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await calistir("hesap", async () => {
      const b = baglantilar.find((x) => x.id === f.get("baglantiId"));
      await api("/kasa-banka/pos-hesaplari", {
        method: "POST",
        body: JSON.stringify({
          ad: f.get("ad"),
          saglayici: yeniSaglayici === "banka" ? "banka" : b?.saglayici,
          baglantiId: yeniSaglayici === "banka" ? null : f.get("baglantiId"),
          varsayilanBankaHesapId: f.get("bankaId") || undefined,
          dovizCinsi: f.get("dovizCinsi"),
          valorGun: Number(f.get("valorGun") || 1),
          komisyonOrani: Number(String(f.get("komisyonOrani") || "0").replace(",", ".")).toFixed(2),
        }),
      });
      setBasari("POS hesabı oluşturuldu.");
      setPanel(null);
      await yukle();
    });
  }
  async function bankayaAktar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!aktarim) return;
    const f = new FormData(e.currentTarget);
    await calistir("aktar", async () => {
      const s = await api<{ netTutar: string; komisyonTutar: string }>("/kasa-banka/pos-hesaplari/bankaya-aktar", {
        method: "POST",
        body: JSON.stringify({
          posHesapId: aktarim.id,
          bankaHesapId: f.get("bankaId") || undefined,
          brutTutar: f.get("brutTutar"),
          komisyonTutar: f.get("komisyonTutar") || "0",
          tarih: f.get("tarih"),
          aciklama: f.get("aciklama") || undefined,
        }),
      });
      setBasari(`${s.netTutar} ${aktarim.dovizCinsi} bankaya aktarıldı; ${s.komisyonTutar} komisyon kaydedildi.`);
      setAktarim(null);
      setAktarimOn(null);
      await yukle();
    });
  }
  async function eylem(id: string, tur: "eposta" | "sms" | "yeniden-dene") {
    await calistir(`${tur}-${id}`, async () => {
      const yeni = await api<{ odemeSayfasiUrl?: string }>(`/pos/tahsilatlar/${id}/${tur}`, { method: "POST" });
      setBasari(
        tur === "yeniden-dene" ? "Yeni ödeme bağlantısı oluşturuldu." : `Bağlantı ${tur === "eposta" ? "e-posta" : "SMS"} ile gönderildi.`,
      );
      await yukle();
      if (yeni.odemeSayfasiUrl) window.open(yeni.odemeSayfasiUrl, "_blank", "noopener,noreferrer");
    });
  }
  /** KSB-38: bildirimi gelmemiş iyzico ödemesini sağlayıcıdan sorgular; ödenmemişse durum değişmez. */
  async function saglayicidanSorgula(id: string) {
    await calistir(`sorgula-${id}`, async () => {
      const s = await api<{ odendi: boolean; mesaj: string }>(`/pos/tahsilatlar/${id}/sorgula`, { method: "POST" });
      if (s.odendi) setBasari(s.mesaj);
      else setHata(s.mesaj);
      await yukle();
    });
  }
  async function kopyala(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setBasari("Ödeme bağlantısı panoya kopyalandı.");
    } catch {
      setHata("Bağlantı kopyalanamadı.");
    }
  }
  return (
    <div className="pos-page pos-workspace">
      <PageHeader title="POS tahsilatları" actions={<div className="pos-actions pos-page-actions">
        {bankaPoslari.length > 0 && <Button onClick={() => acikPanel("slip")}>Slip gir</Button>}
        <Button variant="primary" onClick={() => acikPanel("tahsilat")}>Ödeme bağlantısı oluştur</Button>
      </div>} />
      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>
      <section className="pos-kpis">
        <div className="is-lead">
          <span>Bekleyen POS alacağı</span>
          <div className="pos-currency-balances">
            {dovizBakiyeleri.size ? Array.from(dovizBakiyeleri, ([doviz, bakiye]) => <strong key={doviz}>{para(bakiye, doviz)}</strong>) : <strong>—</strong>}
          </div>
          <small>{hesaplar.length} sağlayıcı hesabı</small>
        </div>
        <div>
          <span>Ödeme bekleyen</span>
          <strong>{bekleyen}</strong>
          <small>Aktif bağlantı talepleri</small>
        </div>
        <div className={basarisiz ? "is-danger" : ""}>
          <span>Başarısız işlem</span>
          <strong>{basarisiz}</strong>
          <small>İncelenmesi gereken kayıt</small>
        </div>
        <div>
          <span>Başarı oranı</span>
          <strong>%{basariOrani.toFixed(1)}</strong>
          <small>{basarili} tamamlanan ödeme</small>
        </div>
      </section>
      {(panel || islemHedefi || ayarHesap || aktarim) && <div ref={formKonumu} tabIndex={-1} className="pos-form-anchor" aria-label="POS işlem formu" />}
      {panel === "hesap" && (
        <Card className="pos-form">
          <div className="pos-form__head">
            <div>
              <span>YENİ HESAP</span>
              <h2>POS hesabı tanımla</h2>
              <p>Aktif sağlayıcı bağlantısını aynı dövizdeki banka hesabıyla eşleştirin.</p>
            </div>
            <Button onClick={() => setPanel(null)}>Kapat</Button>
          </div>
          <form className="pos-form__grid" onSubmit={hesapOlustur}>
            <Field label="POS türü">
              <Select value={yeniSaglayici} onChange={(e) => setYeniSaglayici(e.target.value as "sanal" | "banka")}>
                <option value="sanal">Sanal POS (iyzico / PayTR)</option>
                <option value="banka">Banka POS'u (fiziksel cihaz)</option>
              </Select>
            </Field>
            <Field label="Hesap adı">
              <Input name="ad" required placeholder={yeniSaglayici === "banka" ? "Örn. Ziraat POS" : "Örn. iyzico Ana POS"} />
            </Field>
            {yeniSaglayici === "sanal" && (
              <Field label="POS bağlantısı">
                <Select name="baglantiId" required>
                  <option value="">Bağlantı seçin</option>
                  {baglantilar
                    .filter((x) => x.durum === "aktif")
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.saglayici} · aktif
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            <Field label="Para birimi">
              <Select name="dovizCinsi">
                <DovizSecenekleri />
              </Select>
            </Field>
            <Field label={yeniSaglayici === "banka" ? "Paranın geçeceği banka" : "Varsayılan banka"}>
              <Select name="bankaId" required={yeniSaglayici === "banka"}>
                <option value="">{yeniSaglayici === "banka" ? "Banka hesabı seçin" : "Sonra seç"}</option>
                {bankalar.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.ad} · {x.dovizCinsi}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Valör / bloke (gün)">
              <Input name="valorGun" type="number" min="0" max="365" step="1" defaultValue="1" />
            </Field>
            <Field label="Komisyon oranı (%)">
              <Input name="komisyonOrani" type="number" inputMode="decimal" min="0" max="99.99" step="any" defaultValue="0" />
            </Field>
            <Button type="submit" variant="primary" disabled={islemde === "hesap"}>
              {islemde === "hesap" ? "Oluşturuluyor…" : "Hesabı oluştur"}
            </Button>
          </form>
        </Card>
      )}
      {panel === "tahsilat" && (
        <Card className="pos-form">
          <div className="pos-form__head">
            <div>
              <span>YENİ TAHSİLAT</span>
              <h2>Güvenli ödeme bağlantısı</h2>
              <p>Fatura seçildiğinde kalan tutar otomatik uygulanır. Link 7 gün geçerlidir.</p>
            </div>
            <Button onClick={() => setPanel(null)}>Kapat</Button>
          </div>
          <form className="pos-form__grid" onSubmit={tahsilatBaslat}>
            <Field label="POS hesabı">
              <Select
                required
                value={seciliPosId}
                onChange={(e) => {
                  setSeciliPosId(e.target.value);
                  setSeciliCariId("");
                  setFaturaId("");
                }}
              >
                <option value="">Hesap seçin</option>
                {hesaplar
                  .filter((x) => x.aktif && x.baglanti?.durum === "aktif")
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.ad} · {x.saglayici} · {x.dovizCinsi}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Cari hesap">
              <CariSecici
                required
                cariler={cariler.filter((x) => !seciliPos || x.dovizCinsi === seciliPos.dovizCinsi)}
                deger={seciliCariId}
                ek={(x) => (cariler.find((c) => c.id === x.id)?.eposta ? null : "e-posta eksik")}
                onChange={(id) => {
                  setSeciliCariId(id);
                  setFaturaId("");
                  setTutar("");
                }}
              />
            </Field>
            <Field label="Açık satış faturası">
              <Select
                value={faturaId}
                onChange={(e) => {
                  setFaturaId(e.target.value);
                  const f = faturalar.find((x) => x.id === e.target.value);
                  if (f) setTutar(f.odemeOzeti?.kalan ?? f.genelToplam);
                }}
              >
                <option value="">Cari bakiyesine işle</option>
                {faturalar
                  .filter((x) => !seciliPos || x.dovizCinsi === seciliPos.dovizCinsi)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.no ?? "Numarasız"} · kalan {para(x.odemeOzeti?.kalan ?? x.genelToplam, x.dovizCinsi)}
                    </option>
                  ))}
              </Select>
            </Field>
            <CariBakiye cariId={seciliCariId} />
            <Field label="Tahsilat tutarı">
              <Input type="number" min="0.01" step="0.01" required value={tutar} onChange={(e) => setTutar(e.target.value)} />
            </Field>
            <div className="pos-readiness">
              <Badge variant={cariDetay?.eposta ? "success" : "danger"}>{cariDetay?.eposta ? "E-posta hazır" : "E-posta gerekli"}</Badge>
              {seciliPos?.saglayici === "iyzico" && (
                <Badge variant={cariDetay?.adresler.length ? "success" : "danger"}>
                  {cariDetay?.adresler.length ? "Adres hazır" : "Adres gerekli"}
                </Badge>
              )}
              {seciliFatura && (
                <span>
                  Tahsilat sonrası fatura bakiyesi:{" "}
                  {para(
                    Math.max(0, Number(seciliFatura.odemeOzeti?.kalan ?? seciliFatura.genelToplam) - Number(tutar || 0)),
                    seciliFatura.dovizCinsi,
                  )}
                </span>
              )}
            </div>
            <Button type="submit" variant="primary" disabled={!hazir || islemde === "tahsilat"}>
              {islemde === "tahsilat" ? "Bağlantı hazırlanıyor…" : "Bağlantıyı oluştur ve gönder"}
            </Button>
            {mukerrer && (
              <div className="pos-form__error treasury-confirm" role="alertdialog" aria-label="Açık ödeme bağlantısı">
                <Alert tone="warning">
                  <span>
                    <strong>Bu faturanın açık bağlantısı var.</strong> {mukerrer}
                  </span>
                </Alert>
                <div>
                  <Button type="button" size="sm" onClick={() => setMukerrer(null)}>
                    Vazgeç
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={islemde === "tahsilat"}
                    onClick={() => void tahsilatBaslat(undefined, true)}
                  >
                    Eskisini iptal et, yenisini oluştur
                  </Button>
                </div>
              </div>
            )}
          </form>
        </Card>
      )}
      {panel === "slip" && (
        <SlipFormu
          hesaplar={bankaPoslari}
          cariler={cariler}
          onKapat={() => setPanel(null)}
          onKaydedildi={async (m) => {
            setPanel(null);
            setBasari(m);
            await yukle();
          }}
        />
      )}
      {islemHedefi && (
        <TahsilatIslemi
          key={`${islemHedefi.tur}:${islemHedefi.tahsilat.id}:${islemHedefi.iade?.id ?? ""}`}
          hedef={islemHedefi}
          onKapat={() => setIslemHedefi(null)}
          onTamam={async (m) => {
            setIslemHedefi(null);
            setBasari(m);
            await yukle();
          }}
        />
      )}
      {ayarHesap && (
        <HesapAyarlari
          key={ayarHesap.id}
          hesap={ayarHesap}
          bankalar={bankalar}
          onKapat={() => setAyarHesap(null)}
          onKaydedildi={async (m) => {
            setAyarHesap(null);
            setBasari(m);
            await yukle();
          }}
        />
      )}
      {aktarim && (
        <Card key={JSON.stringify(aktarimOn)} className="pos-form">
          <div className="pos-form__head">
            <div>
              <span>MUTABAKAT</span>
              <h2>{aktarim.ad} → Banka</h2>
              <p>Brüt sağlayıcı alacağını net banka girişi ve komisyon olarak ayırın.</p>
            </div>
            <Button
              onClick={() => {
                setAktarim(null);
                setAktarimOn(null);
              }}
            >
              Kapat
            </Button>
          </div>
          <form className="pos-form__grid" onSubmit={bankayaAktar}>
            <Field label="Brüt alacak">
              <Input name="brutTutar" type="number" step="0.01" min="0.01" required defaultValue={aktarimOn?.brut ?? aktarim.bakiye} />
            </Field>
            <Field label="Komisyon / kesinti">
              <Input name="komisyonTutar" type="number" step="0.01" min="0" defaultValue={aktarimOn?.komisyon ?? "0"} />
            </Field>
            <Field label="Banka hesabı">
              <Select name="bankaId" defaultValue={aktarim.varsayilanBankaHesap?.id ?? ""}>
                <option value="">Hesap seçin</option>
                {bankalar
                  .filter((x) => x.dovizCinsi === aktarim.dovizCinsi)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.ad}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Aktarım tarihi">
              <Input name="tarih" type="date" required defaultValue={aktarimOn?.tarih ?? bugun()} />
            </Field>
            <Field label="Açıklama">
              <Input name="aciklama" placeholder="Sağlayıcı ödeme referansı" />
            </Field>
            <Button type="submit" variant="primary" disabled={islemde === "aktar"}>
              Net tutarı bankaya aktar
            </Button>
          </form>
        </Card>
      )}
      <Tabs ariaLabel="POS çalışma alanı" idPrefix="pos-workspace" value={gorunum} onChange={setGorunum} items={[
        { deger: "tahsilatlar", baslik: "Tahsilatlar" },
        { deger: "hesaplar", baslik: "POS hesapları" },
        { deger: "mutabakat", baslik: "Bankaya geçecekler" },
      ]} />
      <div hidden={gorunum !== "tahsilatlar"}>
        <TabPanel idPrefix="pos-workspace" value="tahsilatlar">
          <Card className="pos-register pos-payment-register" pad={false} title="Tahsilat listesi">
            <div className="pos-filter__grid">
              <Field label="Talep ara">
                <Input
                  value={arama}
                  onChange={(e) => {
                    setArama(e.target.value);
                    setSayfa(1);
                  }}
                  placeholder="Cari, fatura veya hata mesajı…"
                />
              </Field>
              <Field label="Durum">
                <Select
                  value={durum}
                  onChange={(e) => {
                    setDurum(e.target.value);
                    setSayfa(1);
                  }}
                >
                  <option value="">Tüm durumlar</option>
                  {Object.entries(durumAdi).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="POS hesabı">
                <Select
                  value={posFiltresi}
                  onChange={(e) => {
                    setPosFiltresi(e.target.value);
                    setSayfa(1);
                  }}
                >
                  <option value="">Tüm hesaplar</option>
                  {hesaplar.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.ad}
                    </option>
                  ))}
                </Select>
              </Field>
              <span>{liste.toplam} kayıt</span>
            </div>
            <TableWrap>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Cari / fatura</th>
                  <th>Durum</th>
                  <th className="num">Tutar</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {liste.kayitlar.map((t) => (
                  <Fragment key={t.id}>
                    <tr className={t.durum === "basarisiz" ? "is-error" : undefined}>
                      <td data-label="Tarih">
                        <strong>{new Date(t.createdAt).toLocaleString("tr-TR")}</strong>
                        <small>
                          {t.odemeTarihi
                            ? `Ödendi: ${t.kanal === "slip" ? new Date(t.odemeTarihi).toLocaleDateString("tr-TR") : new Date(t.odemeTarihi).toLocaleString("tr-TR")}`
                            : t.sonKullanimTarihi
                              ? `Son kullanım: ${new Date(t.sonKullanimTarihi).toLocaleDateString("tr-TR")}`
                              : "—"}
                        </small>
                      </td>
                      <td data-label="Cari / fatura">
                        <strong>{t.cari.unvan}</strong>
                        <small>
                          {t.cari.kod}
                          {t.fatura?.no ? ` · Fatura ${t.fatura.no}` : " · Cari bakiye"}
                        </small>
                      </td>
                      <td data-label="Durum">
                        <div className="pos-delivery">
                          {t.kanal === "abonelik" && <Badge variant="info">Abonelik</Badge>}
                          <Badge variant={durumRengi(t.durum)}>{durumAdi[t.durum] ?? t.durum}</Badge>
                          {t.gecOdeme && <Badge variant="warning">Geç ödeme</Badge>}
                          {t.fraudDurumu === 0 && (
                            <span title="iyzico ödemeyi dolandırıcılık incelemesine aldı; teslimi inceleme sonuçlanana kadar bekletin.">
                              <Badge variant="warning">iyzico incelemesinde</Badge>
                            </span>
                          )}
                          {Number(t.iadeEdilen) > 0 && (
                            <Badge variant="info">{Number(t.iadeEdilen) >= Number(t.tutar) ? "İade edildi" : "Kısmi iade"}</Badge>
                          )}
                        </div>
                        {t.hataMesaji && <small className="pos-error">{t.hataMesaji}</small>}
                        {t.iptalNedeni && <small>İptal: {t.iptalNedeni}</small>}
                        {t.iadeler.map((i) => (
                          <small key={i.id} className="pos-refund">
                            İade {para(i.tutar, t.dovizCinsi)} · {new Date(i.tarih).toLocaleDateString("tr-TR")} · {i.neden}
                            {t.kanal === "abonelik" ? (
                              <> · platformdan iade</>
                            ) : i.saglayiciyaGonderildi ? (
                              <> · {t.posHesap.saglayici === "paytr" ? "PayTR" : "iyzico"} üzerinden iade edildi</>
                            ) : (
                              <>
                                {t.kanal !== "slip" && " · elle"}{" "}
                                <button type="button" className="link-button" onClick={() => islemAc({ tur: "iade_geri_al", tahsilat: t, iade: i })}>
                                  geri al
                                </button>
                              </>
                            )}
                          </small>
                        ))}
                      </td>
                      <td className="num" data-label="Tutar">
                        <strong>{para(t.tutar, t.dovizCinsi)}</strong>
                      </td>
                      <td data-label="İşlem">
                        <div className="pos-actions">
                          <Button size="sm" aria-expanded={acikAyrinti === t.id} onClick={() => setAcikAyrinti(acikAyrinti === t.id ? null : t.id)}>
                            {acikAyrinti === t.id ? "Ayrıntıyı kapat" : "Ayrıntı"}
                          </Button>
                          {t.makbuzYolu && (
                            <a
                              className="btn btn--primary btn--sm"
                              href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}${t.makbuzYolu}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Makbuz PDF
                            </a>
                          )}
                          {t.odemeSayfasiUrl && t.durum === "baslatildi" && (
                            <>
                              <Button size="sm" onClick={() => void kopyala(t.odemeSayfasiUrl!)}>
                                Kopyala
                              </Button>
                              <a className="btn btn--ghost btn--sm" href={t.odemeSayfasiUrl} target="_blank" rel="noreferrer">
                                Aç
                              </a>
                            </>
                          )}
                          {t.durum === "baslatildi" && t.epostaHatasi && (
                            <Button size="sm" onClick={() => void eylem(t.id, "eposta")}>
                              E-posta
                            </Button>
                          )}
                          {t.durum === "baslatildi" && t.smsHatasi && (
                            <Button size="sm" onClick={() => void eylem(t.id, "sms")}>
                              SMS
                            </Button>
                          )}
                          {["basarisiz", "suresi_doldu"].includes(t.durum) && t.kanal !== "slip" && (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={islemde === `yeniden-dene-${t.id}`}
                              onClick={() => void eylem(t.id, "yeniden-dene")}
                            >
                              Yeniden dene
                            </Button>
                          )}
                          {["baslatildi", "suresi_doldu", "iptal"].includes(t.durum) && t.kanal !== "slip" && t.posHesap.saglayici === "iyzico" && (
                            <Button size="sm" disabled={islemde === `sorgula-${t.id}`} onClick={() => void saglayicidanSorgula(t.id)}>
                              {islemde === `sorgula-${t.id}` ? "Sorgulanıyor…" : "iyzico'dan sorgula"}
                            </Button>
                          )}
                          {t.durum === "baslatildi" && t.posHesap.saglayici === "paytr" && (
                            <small className="muted" title="PayTR Link API ödeme öncesinde sorgulanabilir sipariş numarası vermez.">
                              PayTR ödemesi bildirimle kaydedilir
                            </small>
                          )}
                          {t.durum === "baslatildi" && (
                            <Button size="sm" variant="danger" onClick={() => islemAc({ tur: "iptal", tahsilat: t })}>
                              İptal
                            </Button>
                          )}
                          {t.durum === "odendi" && t.kanal === "abonelik" && (
                            <small className="muted" title="Abonelik ödemesi platformun tahsilatıdır; iadesi platform tarafında yapılır.">
                              İade platformdan yapılır
                            </small>
                          )}
                          {t.durum === "odendi" && t.kanal !== "abonelik" && Number(t.iadeEdilen) < Number(t.tutar) && (
                            <Button size="sm" onClick={() => islemAc({ tur: "iade", tahsilat: t })}>
                              İade
                            </Button>
                          )}
                          {t.durum === "odendi" && t.kanal === "slip" && !t.iadeler.length && (
                            <Button size="sm" variant="danger" onClick={() => islemAc({ tur: "slip_geri_al", tahsilat: t })}>
                              Geri al
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {acikAyrinti === t.id && <tr className="pos-payment-detail">
                      <td colSpan={5}>
                        <div className="pos-payment-detail__grid">
                          <div>
                            <strong>Kanal</strong>
                            <span>{t.posHesap.ad}</span>
                            <small>{t.kanal === "slip" ? `Slip${t.slipNo ? ` · ${t.slipNo}` : ""}` : t.kanal === "abonelik" ? `Abonelik · ${t.posHesap.saglayici}` : t.posHesap.saglayici}</small>
                          </div>
                          <div>
                            <strong>Gönderim</strong>
                            {t.kanal === "slip" ? (
                              <small>Cihazda çekildi</small>
                            ) : t.kanal !== "abonelik" ? (
                              <div className="pos-delivery">
                                <Badge variant={t.epostaGonderimTarihi ? "success" : t.epostaHatasi ? "danger" : "neutral"}>E-posta</Badge>
                                <Badge variant={t.smsGonderimTarihi ? "success" : t.smsHatasi ? "danger" : "neutral"}>SMS</Badge>
                              </div>
                            ) : <small>Abonelik tahsilatı</small>}
                          </div>
                          <div>
                            <strong>Ödeme bilgileri</strong>
                            {/* KSB-36: taksit, komisyon ve bankaya geçecek net */}
                            {t.durum === "odendi" && t.komisyonTutari !== null && (
                              <small>
                                {t.kartSon4 ? `${[t.kartMarkasi?.replace(/_/g, " "), t.kartAilesi].filter(Boolean).join(" ")} ${maskeliKart(t.kartBin, t.kartSon4)} · ` : ""}
                                {t.taksitSayisi > 1 ? `${t.taksitSayisi} taksit · ` : ""}komisyon {para(t.komisyonTutari, t.dovizCinsi)}
                                {t.komisyonKaynagi === "tahmin" ? " (tahmini)" : ""} · net {para(t.netTutar ?? t.tutar, t.dovizCinsi)}
                              </small>
                            )}
                            {/* PLT-40: kart no (BIN + son 4), ödeme ve provizyon numaraları, sağlayıcı kesintisinin dökümü */}
                            {t.durum === "odendi" && t.kanal !== "slip" && t.saglayiciOdemeId && (
                              <small className="pos-ids">
                                {[
                                  `Ödeme no ${t.saglayiciOdemeId}`,
                                  t.provizyonKodu && `Provizyon ${t.provizyonKodu}`,
                                ].filter(Boolean).join(" · ")}
                              </small>
                            )}
                            {t.durum === "odendi" && t.komisyonKaynagi === "saglayici" && (t.saglayiciKomisyonu !== null || t.saglayiciUcreti !== null) && (
                              <small className="pos-ids">
                                {t.posHesap.saglayici === "iyzico" ? "iyzico" : "Sağlayıcı"} komisyonu {para(t.saglayiciKomisyonu ?? "0", t.dovizCinsi)}
                                {t.saglayiciUcreti !== null && Number(t.saglayiciUcreti) > 0 ? ` + işlem ücreti ${para(t.saglayiciUcreti, t.dovizCinsi)}` : ""}
                              </small>
                            )}
                            {t.odenenTutar !== null && Number(t.odenenTutar) > Number(t.tutar) && (
                              <small title="Müşteriye yansıtılan vade farkını sağlayıcı alır; firmanın geliri değildir.">
                                müşteri {para(t.odenenTutar, t.dovizCinsi)} ödedi
                              </small>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>}
                  </Fragment>
                ))}
                {!liste.kayitlar.length && (
                  <tr>
                    <td colSpan={5}>
                      <div className="pos-empty">
                        <strong>Kayıt bulunamadı</strong>
                        <span>Filtreleri değiştirin veya yeni tahsilat başlatın.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </TableWrap>
            <div className="pos-pagination">
              <span>
                Sayfa {liste.sayfa} · {liste.toplam} kayıt
              </span>
              <div>
                <Button size="sm" disabled={sayfa <= 1} onClick={() => setSayfa((x) => x - 1)}>
                  Önceki
                </Button>
                <Button size="sm" disabled={sayfa * liste.adet >= liste.toplam} onClick={() => setSayfa((x) => x + 1)}>
                  Sonraki
                </Button>
              </div>
            </div>
          </Card>
        </TabPanel>
      </div>
      <div hidden={gorunum !== "hesaplar"}>
        <TabPanel idPrefix="pos-workspace" value="hesaplar">
          <section className="pos-accounts">
            <div className="pos-section-head">
              <div>
                <h2>POS hesapları</h2>
              </div>
              <div className="pos-actions"><Select aria-label="Özet dönemi" value={ozetDonemi} onChange={(e) => setOzetDonemi(e.target.value as OzetDonemi)}>
                <option value="bu_ay">Bu ay</option>
                <option value="gecen_ay">Geçen ay</option>
              </Select><Button onClick={() => acikPanel("hesap")}>POS hesabı aç</Button></div>
            </div>
            <div className="pos-account-grid">
              {hesaplar.map((x) => (
                <article key={x.id} className={x.saglayici !== "banka" && x.baglanti?.durum !== "aktif" ? "is-error" : ""}>
                  <div className="pos-provider">{x.saglayici.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <strong>{x.ad}</strong>
                    <small>
                      {x.saglayici === "banka" ? "Banka POS'u" : x.saglayici} · {x.dovizCinsi} · valör{" "}
                      {x.valorGun === 0 ? "aynı gün" : `${x.valorGun} gün`} · %{Number(x.komisyonOrani).toLocaleString("tr-TR")}
                      {Number(x.islemUcreti) > 0 && ` + ${para(x.islemUcreti, x.dovizCinsi)}`}
                      {x.taksitOranlari?.length ? ` · taksit ${x.taksitOranlari.map((t) => t.taksit).join(", ")}` : " · tek çekim"}
                    </small>
                    {x.saglayici === "banka" ? (
                      <span>
                        <i className="is-online" />
                        {x.varsayilanBankaHesap ? `→ ${x.varsayilanBankaHesap.ad}` : "Banka hesabı seçilmeli"}
                      </span>
                    ) : (
                      <span>
                        <i className={x.baglanti?.durum === "aktif" ? "is-online" : ""} />
                        {x.baglanti?.durum === "aktif" ? "Bağlantı hazır" : (x.baglanti?.sonSenkronHatasi ?? "Bağlantı kontrol edilmeli")}
                      </span>
                    )}
                    {ozetler[x.id] && <PosOzetSatiri o={ozetler[x.id]} />}
                  </div>
                  <div>
                    <small>Bekleyen alacak</small>
                    <strong>{para(x.bakiye, x.dovizCinsi)}</strong>
                    <div className="pos-actions">
                      <Button
                        size="sm"
                        onClick={() => {
                          setAyarHesap(x);
                          setAktarim(null);
                          setPanel(null);
                          setIslemHedefi(null);
                        }}
                      >
                        Ayarlar
                      </Button>
                      <Link className="btn btn--sm" href={`/panel/kasa-banka/hesap-ekstresi?hesap=pos:${x.id}`}>
                        Hareketler
                      </Link>
                      <Button
                        size="sm"
                        disabled={!x.aktif || Number(x.bakiye) <= 0}
                        onClick={() => {
                          setAktarim(x);
                          setAktarimOn(null);
                          setPanel(null);
                        }}
                      >
                        Bankaya aktar
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </TabPanel>
      </div>
      <div hidden={gorunum !== "mutabakat"}>
        <TabPanel idPrefix="pos-workspace" value="mutabakat">
          <BankayaGececekler yenile={yenile} onAktar={grubuAktar} />
        </TabPanel>
      </div>
    </div>
  );
}

/** KSB-40: POS hesabının dönem özeti; komisyonu yazılmamış eski tahsilatlar ayrıca belirtilir. */
function PosOzetSatiri({ o }: { o: HesapOzeti }) {
  const komisyon = Number(o.komisyonSaglayici) + Number(o.komisyonTahmin);
  return (
    <small className="pos-ozet">
      {o.adet} tahsilat · brüt {para(o.brut, o.dovizCinsi)} · komisyon {para(komisyon, o.dovizCinsi)}
      {Number(o.komisyonTahmin) > 0 && ` (${para(o.komisyonTahmin, o.dovizCinsi)} tahmini)`}
      {Number(o.iade) > 0 && ` · iade ${para(o.iade, o.dovizCinsi)}`} · net {para(o.net, o.dovizCinsi)}
      {o.komisyonsuzAdet > 0 && ` · ${o.komisyonsuzAdet} eski tahsilatta komisyon yok`}
      {" · "}aktarılabilir {para(o.aktarilabilir, o.dovizCinsi)}
    </small>
  );
}
