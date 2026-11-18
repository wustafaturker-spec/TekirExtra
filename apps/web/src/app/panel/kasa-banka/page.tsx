"use client";
import { csvHucresi } from "@tekirextra/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiHata, tokenAl, tumSayfalariAl } from "@/lib/api";
import { OdemeFisi, type FisBaslangici, type FisTipi } from "./odeme-fisi";
import { FisAyrintisi, type DefterHareketi } from "./fis-ayrintisi";
import { DovizIslemFormu } from "./doviz-islem-formu";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, Select, TableWrap } from "@/components/ui";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";
interface Hesap {
  id: string;
  ad: string;
  dovizCinsi: string;
  bakiye: string;
  borc: string;
  alacak: string;
  aktif: boolean;
  bankaAdi?: string;
  hesapNo?: string | null;
  iban?: string | null;
  acilis?: { id: string; tarih: string; tutar: string } | null;
}
interface Cari {
  id: string;
  unvan: string;
}
type Hareket = DefterHareketi & { geriAlindi: boolean };
/** KSB-13: süzgece uyan kayıtların döviz bazında toplamı (yalnız ilk sayfada gelir). */
interface HareketToplamlari {
  adet: number;
  dovizler: Array<{ dovizCinsi: string; giris: string; cikis: string; net: string }>;
}
interface HareketSayfasi {
  kayitlar: Hareket[];
  sonrakiImlec: string | null;
  toplamlar?: HareketToplamlari;
  bugun?: { giris: string; cikis: string };
}
const SAYFA_ADEDI = 50;
/** CSV süzgece uyan kayıtları sayfa sayfa çeker; en çok bu kadar. */
const CSV_SINIRI = 50_000;
interface PortfoyOzeti {
  acik: { adet: number; toplamTry: string };
  geciken: { adet: number; toplamTry: string };
}
type Modal = "kasa" | "banka" | "hareket" | "virman" | "detay" | "doviz" | null;
const yerelTarih = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const para = (v: string | number, d = "TRY") => Number(v).toLocaleString("tr-TR", { style: "currency", currency: d });
const tipAd = (t: string) =>
  t === "tahsilat"
    ? "Tahsilat"
    : t === "tediye"
      ? "Tediye"
      : t === "virman_gelis"
        ? "Virman girişi"
        : t === "virman_gidis"
          ? "Virman çıkışı"
          : t;
const giris = (t: string) => t === "tahsilat" || t === "virman_gelis";
export default function KasaBankaSayfasi() {
  const [kasalar, setKasalar] = useState<Hesap[]>([]),
    [bankalar, setBankalar] = useState<Hesap[]>([]),
    [hareketler, setHareketler] = useState<Hareket[]>([]),
    [sonrakiImlec, setSonrakiImlec] = useState<string | null>(null),
    [toplamlar, setToplamlar] = useState<HareketToplamlari | null>(null),
    [bugun, setBugun] = useState({ giris: "0", cikis: "0" }),
    [listeYukleniyor, setListeYukleniyor] = useState(true),
    [cariler, setCariler] = useState<Cari[]>([]);
  const [modal, setModal] = useState<Modal>(null),
    [islem, setIslem] = useState(""),
    [hata, setHata] = useState(""),
    [basari, setBasari] = useState("");
  const [arama, setArama] = useState(""),
    [turFiltre, setTurFiltre] = useState(""),
    [hesapFiltre, setHesapFiltre] = useState(""),
    [baslangic, setBaslangic] = useState(""),
    [bitis, setBitis] = useState(""),
    [gecikmeliArama, setGecikmeliArama] = useState("");
  const [ad, setAd] = useState(""),
    [bankaAdi, setBankaAdi] = useState(""),
    [hesapNo, setHesapNo] = useState(""),
    [iban, setIban] = useState(""),
    [doviz, setDoviz] = useState("TRY");
  const [tutar, setTutar] = useState(""),
    [tarih, setTarih] = useState(yerelTarih),
    [aciklama, setAciklama] = useState("");
  const [fisBaslangici, setFisBaslangici] = useState<FisBaslangici>({});
  const [portfoy, setPortfoy] = useState<PortfoyOzeti | null>(null);
  const [secili, setSecili] = useState<Hareket | null>(null);
  const [duzeltilenVirman, setDuzeltilenVirman] = useState<string | null>(null);
  const [virmanNedeni, setVirmanNedeni] = useState("");
  const [kaynak, setKaynak] = useState(""),
    [hedef, setHedef] = useState("");
  const [acilisTutari, setAcilisTutari] = useState(""),
    [acilisEksi, setAcilisEksi] = useState(false),
    [acilisTarihi, setAcilisTarihi] = useState(yerelTarih);
  const [virmanEksiUyari, setVirmanEksiUyari] = useState<string | null>(null);
  // Arama her tuşta değil, yazma durunca sunucuya gider.
  useEffect(() => {
    const t = setTimeout(() => setGecikmeliArama(arama.trim()), 300);
    return () => clearTimeout(t);
  }, [arama]);
  const suzgec = useMemo(() => {
    const p = new URLSearchParams();
    const [hesapTuru, hesapId] = hesapFiltre.split(":");
    if (hesapTuru === "kasa") p.set("kasaId", hesapId);
    if (hesapTuru === "banka") p.set("bankaHesapId", hesapId);
    if (turFiltre) p.set("tur", turFiltre);
    if (baslangic) p.set("baslangic", baslangic);
    if (bitis) p.set("bitis", bitis);
    if (gecikmeliArama) p.set("arama", gecikmeliArama);
    return p;
  }, [hesapFiltre, turFiltre, baslangic, bitis, gecikmeliArama]);
  // Süzgeç hızlı değişince geç gelen eski yanıt yenisinin üstüne yazmasın.
  const listeIstegi = useRef(0);
  const hareketleriYukle = useCallback(async () => {
    const no = ++listeIstegi.current;
    setListeYukleniyor(true);
    try {
      const p = new URLSearchParams(suzgec);
      p.set("adet", String(SAYFA_ADEDI));
      const sayfa = await api<HareketSayfasi>(`/kasa-banka/hareketler?${p}`);
      if (no !== listeIstegi.current) return;
      setHareketler(sayfa.kayitlar);
      setSonrakiImlec(sayfa.sonrakiImlec);
      setToplamlar(sayfa.toplamlar ?? null);
      if (sayfa.bugun) setBugun(sayfa.bugun);
    } catch (e) {
      if (no === listeIstegi.current) setHata(e instanceof Error ? e.message : "Hareketler yüklenemedi");
    } finally {
      if (no === listeIstegi.current) setListeYukleniyor(false);
    }
  }, [suzgec]);
  async function dahaFazlaYukle() {
    if (!sonrakiImlec) return;
    const no = listeIstegi.current;
    setListeYukleniyor(true);
    try {
      const p = new URLSearchParams(suzgec);
      p.set("adet", String(SAYFA_ADEDI));
      p.set("imlec", sonrakiImlec);
      const sayfa = await api<HareketSayfasi>(`/kasa-banka/hareketler?${p}`);
      if (no !== listeIstegi.current) return;
      setHareketler((onceki) => [...onceki, ...sayfa.kayitlar]);
      setSonrakiImlec(sayfa.sonrakiImlec);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Hareketler yüklenemedi");
    } finally {
      if (no === listeIstegi.current) setListeYukleniyor(false);
    }
  }
  useEffect(() => {
    if (tokenAl()) void hareketleriYukle();
  }, [hareketleriYukle]);
  const yukle = useCallback(async () => {
    setIslem("yukle");
    try {
      const [k, b] = await Promise.all([
        api<Hesap[]>("/kasa-banka/kasalar"),
        api<Hesap[]>("/kasa-banka/bankalar"),
        hareketleriYukle(),
      ]);
      setKasalar(k);
      setBankalar(b);
      void api<PortfoyOzeti>("/kasa-banka/cek-senet-ozet?yon=alinan")
        .then(setPortfoy)
        .catch(() => setPortfoy(null));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Finans verileri yüklenemedi");
    } finally {
      setIslem("");
    }
  }, [hareketleriYukle]);
  // Hesaplar bir kez yüklenir; süzgeç değişince yalnız liste yenilenir (yukarıdaki etki).
  useEffect(() => {
    if (tokenAl()) {
      void Promise.all([api<Hesap[]>("/kasa-banka/kasalar"), api<Hesap[]>("/kasa-banka/bankalar")])
        .then(([k, b]) => {
          setKasalar(k);
          setBankalar(b);
        })
        .catch((e) => setHata(e instanceof Error ? e.message : "Finans verileri yüklenemedi"));
      void api<PortfoyOzeti>("/kasa-banka/cek-senet-ozet?yon=alinan")
        .then(setPortfoy)
        .catch(() => setPortfoy(null));
      void tumSayfalariAl<Cari>("/cari").then(setCariler);
    }
  }, []);
  useEffect(() => {
    const p = new URLSearchParams(location.search),
      i = p.get("islem");
    if (i === "tahsilat" || i === "tediye" || i === "odeme") {
      setFisBaslangici({
        tip: i === "tahsilat" ? "tahsilat" : "tediye",
        cariId: p.get("cariId") || "",
        faturaId: p.get("faturaId"),
        tutar: p.get("tutar") || "",
        aciklama: p.get("aciklama") || "",
      });
      setModal("hareket");
    }
    setBaslangic(p.get("baslangic") || "");
    setBitis(p.get("bitis") || "");
    setTurFiltre(p.get("tur") || "");
  }, []);
  const tumHesaplar = [...kasalar.map((x) => ({ ...x, tur: "kasa" as const })), ...bankalar.map((x) => ({ ...x, tur: "banka" as const }))];
  const kaynakHesap = tumHesaplar.find((x) => `${x.tur}:${x.id}` === kaynak);
  const hedefler = tumHesaplar.filter(
    (x) => x.aktif && (!kaynakHesap || x.dovizCinsi === kaynakHesap.dovizCinsi) && `${x.tur}:${x.id}` !== kaynak,
  );
  const ozet = useMemo(
    () => ({
      toplam: [...kasalar, ...bankalar].filter((x) => x.dovizCinsi === "TRY" && x.aktif).reduce((t, x) => t + Number(x.bakiye), 0),
      giris: Number(bugun.giris),
      cikis: Number(bugun.cikis),
      negatif: [...kasalar, ...bankalar].filter((x) => Number(x.bakiye) < 0).length,
    }),
    [bugun, kasalar, bankalar],
  );
  const hesapAnahtari = (h?: DefterHareketi | null) => (h?.kasa ? `kasa:${h.kasa.id}` : h?.bankaHesap ? `banka:${h.bankaHesap.id}` : "");
  /** KSB-08: "geri al + yeniden gir" — form eski fişle dolu açılır, kayıtta eskisi aynı işlemde geri alınır. */
  function duzelt(h: DefterHareketi, karsi: DefterHareketi | null) {
    if (h.tip === "virman_gidis" || h.tip === "virman_gelis") {
      const gidis = h.tip === "virman_gidis" ? h : karsi,
        gelis = h.tip === "virman_gidis" ? karsi : h;
      temizle();
      setKaynak(hesapAnahtari(gidis));
      setHedef(hesapAnahtari(gelis));
      setTutar(h.tutar);
      setTarih(h.tarih.slice(0, 10));
      setAciklama(h.aciklama ?? "");
      setDuzeltilenVirman(h.id);
      setModal("virman");
      return;
    }
    setFisBaslangici({
      tip: h.tip as FisTipi,
      hesapAnahtari: hesapAnahtari(h),
      tarih: h.tarih.slice(0, 10),
      tutar: h.tutar,
      cariId: h.cari?.id ?? "",
      faturaId: h.fatura?.id ?? null,
      aciklama: h.aciklama ?? "",
      duzeltilenId: h.id,
    });
    setModal("hareket");
  }
  function temizle() {
    setFisBaslangici({});
    setDuzeltilenVirman(null);
    setVirmanNedeni("");
    setAd("");
    setBankaAdi("");
    setHesapNo("");
    setIban("");
    setDoviz("TRY");
    setTutar("");
    setAciklama("");
    setKaynak("");
    setHedef("");
    setTarih(yerelTarih());
    setAcilisTutari("");
    setAcilisEksi(false);
    setAcilisTarihi(yerelTarih());
    setVirmanEksiUyari(null);
  }
  async function hesapKaydet(e: React.FormEvent) {
    e.preventDefault();
    if (modal !== "kasa" && modal !== "banka") return;
    setIslem("kaydet");
    setHata("");
    try {
      await api(modal === "kasa" ? "/kasa-banka/kasalar" : "/kasa-banka/bankalar", {
        method: "POST",
        body: JSON.stringify({
          ...(modal === "kasa"
            ? { ad, dovizCinsi: doviz }
            : { ad, bankaAdi, hesapNo: hesapNo || null, iban: iban.replaceAll(" ", "") || null, dovizCinsi: doviz }),
          acilis:
            Number(acilisTutari) > 0 ? { tutar: (acilisEksi ? "-" : "") + Number(acilisTutari).toFixed(2), tarih: acilisTarihi } : null,
        }),
      });
      setBasari(
        `${modal === "kasa" ? "Kasa" : "Banka hesabı"} oluşturuldu${Number(acilisTutari) > 0 ? "; açılış bakiyesi kaydedildi" : ""}.`,
      );
      setModal(null);
      temizle();
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Hesap oluşturulamadı");
    } finally {
      setIslem("");
    }
  }
  async function virmanKaydet(e?: React.FormEvent, onayli = false) {
    e?.preventDefault();
    if (!kaynakHesap || !hedef) return;
    setIslem("kaydet");
    setHata("");
    setVirmanEksiUyari(null);
    try {
      const [kt, ki] = kaynak.split(":"),
        [ht, hi] = hedef.split(":");
      const virman = {
        kaynakKasaId: kt === "kasa" ? ki : null,
        kaynakBankaHesapId: kt === "banka" ? ki : null,
        hedefKasaId: ht === "kasa" ? hi : null,
        hedefBankaHesapId: ht === "banka" ? hi : null,
        tutar,
        tarih,
        aciklama: aciklama || null,
        ...(onayli ? { eksiBakiyeOnay: true } : {}),
      };
      if (duzeltilenVirman) {
        await api(`/kasa-banka/virman/${duzeltilenVirman}/duzelt`, {
          method: "POST",
          body: JSON.stringify({ neden: virmanNedeni, yeni: virman }),
        });
        setBasari("Virman düzeltildi; eski virmanın iki bacağı geri alındı.");
      } else {
        await api("/kasa-banka/virman", { method: "POST", body: JSON.stringify(virman) });
        setBasari("Virman tamamlandı ve karşılıklı hareketler oluşturuldu.");
      }
      setModal(null);
      temizle();
      await yukle();
    } catch (e) {
      if (e instanceof ApiHata && e.durum === 409 && !onayli && /eksi bakiye/i.test(e.message)) setVirmanEksiUyari(e.message);
      else setHata(e instanceof Error ? e.message : "Virman yapılamadı");
    } finally {
      setIslem("");
    }
  }
  async function csv() {
    setIslem("csv");
    let tumu: Hareket[] = [];
    try {
      let imlec: string | null = null;
      do {
        const p = new URLSearchParams(suzgec);
        p.set("adet", "1000");
        if (imlec) p.set("imlec", imlec);
        const sayfa: HareketSayfasi = await api<HareketSayfasi>(`/kasa-banka/hareketler?${p}`);
        tumu = tumu.concat(sayfa.kayitlar);
        imlec = sayfa.sonrakiImlec;
      } while (imlec && tumu.length < CSV_SINIRI);
    } catch (e) {
      setHata(e instanceof Error ? e.message : "CSV hazırlanamadı");
      return;
    } finally {
      setIslem("");
    }
    const rows = [
      ["Tarih", "Makbuz no", "Hesap", "Tür", "Cari", "Fatura", "Açıklama", "Tutar", "Döviz", "Kur", "TRY Tutar"],
      ...tumu.slice(0, CSV_SINIRI).map((h) => [
        h.tarih.slice(0, 10),
        h.makbuzNo || "",
        h.kasa?.ad || h.bankaHesap?.ad || "",
        tipAd(h.tip),
        h.cari?.unvan || "",
        h.fatura?.no || "",
        h.aciklama || "",
        h.tutar,
        h.dovizCinsi,
        h.kur,
        h.tutarTry,
      ]),
    ];
    const b = "\uFEFF" + rows.map((r) => r.map(csvHucresi).join(";")).join("\n");
    const u = URL.createObjectURL(new Blob([b], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = u;
    a.download = "kasa-banka-hareketleri.csv";
    a.click();
    URL.revokeObjectURL(u);
  }
  return (
    <div className="treasury-page">
      <PageHeader title="Kasa ve banka yönetimi" actions={<div className="row-tight treasury-page-actions">
          <Button
            onClick={() => {
              temizle();
              setModal("virman");
            }}
          >
            ↔ Virman
          </Button>
          <Button
            onClick={() => {
              temizle();
              setModal("doviz");
            }}
          >
            Döviz al/sat
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              temizle();
              setModal("hareket");
            }}
          >
            Fiş Girişi
          </Button>
      </div>} />
      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}
      <Card
        className="treasury-register"
        pad={false}
        title={
          <div>
            <h2>Kasa ve banka hareketleri</h2>
            <small>
              {toplamlar
                ? `${toplamlar.adet.toLocaleString("tr-TR")} kayıt${toplamlar.adet > hareketler.length ? ` · ${hareketler.length.toLocaleString("tr-TR")} gösteriliyor` : ""}`
                : "…"}
            </small>
          </div>
        }
      >
        <div className="treasury-filter-grid">
          <Field label="Hareket ara">
            <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Cari, fatura, makbuz no veya açıklama…" />
          </Field>
          <Field label="İşlem türü">
            <Select value={turFiltre} onChange={(e) => setTurFiltre(e.target.value)}>
              <option value="">Tümü</option>
              <option value="tahsilat">Tahsilat</option>
              <option value="tediye">Tediye</option>
              <option value="virman_gelis">Virman girişi</option>
              <option value="virman_gidis">Virman çıkışı</option>
              <option value="acilis">Açılış (devir)</option>
            </Select>
          </Field>
          <Field label="Hesap">
            <Select value={hesapFiltre} onChange={(e) => setHesapFiltre(e.target.value)}>
              <option value="">Tüm hesaplar</option>
              {tumHesaplar.map((x) => (
                <option key={`${x.tur}-${x.id}`} value={`${x.tur}:${x.id}`}>
                  {x.ad} · {x.dovizCinsi}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Başlangıç">
            <Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
          </Field>
          <Field label="Bitiş">
            <Input type="date" min={baslangic} value={bitis} onChange={(e) => setBitis(e.target.value)} />
          </Field>
          <Button onClick={() => void csv()} disabled={!hareketler.length || Boolean(islem)}>
            {islem === "csv" ? "Hazırlanıyor…" : "CSV"}
          </Button>
        </div>
        {toplamlar && toplamlar.dovizler.length > 0 && (
          <div className="treasury-totals" aria-label="Süzgece uyan kayıtların toplamı">
            {toplamlar.dovizler.map((t) => (
              <div key={t.dovizCinsi}>
                <b>{t.dovizCinsi}</b>
                <span>
                  Giriş <strong className="treasury-in">{para(t.giris, t.dovizCinsi)}</strong>
                </span>
                <span>
                  Çıkış <strong className="treasury-out">{para(t.cikis, t.dovizCinsi)}</strong>
                </span>
                <span>
                  Net <strong>{para(t.net, t.dovizCinsi)}</strong>
                </span>
              </div>
            ))}
          </div>
        )}
        <TableWrap className="treasury-movement-table platform-responsive-table">
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Hesap</th>
              <th>İşlem</th>
              <th>Cari / Belge</th>
              <th>Açıklama</th>
              <th>Kur / TRY</th>
              <th>Tutar</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {listeYukleniyor && !hareketler.length ? (
              <tr>
                <td colSpan={8}>
                  <div className="treasury-empty">Hareketler yükleniyor…</div>
                </td>
              </tr>
            ) : (
              hareketler.map((h) => (
                <tr
                  key={h.id}
                  className={`row-link${h.geriAlindi ? " is-reversed" : ""}`}
                  tabIndex={0}
                  aria-label="Fiş ayrıntısını aç"
                  onClick={() => {
                    setSecili(h);
                    setModal("detay");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSecili(h);
                      setModal("detay");
                    }
                  }}
                >
                  <td data-label="Tarih">
                    <strong>{new Date(h.tarih).toLocaleDateString("tr-TR")}</strong>
                    {h.makbuzNo && <small className="mono">{h.makbuzNo}</small>}
                  </td>
                  <td data-label="Hesap">
                    <strong>{h.kasa?.ad || h.bankaHesap?.ad || "POS / Sistem"}</strong>
                    <small>{h.dovizCinsi}</small>
                  </td>
                  <td data-label="İşlem">
                    {h.kaynakTur === "acilis" ? (
                      <Badge variant="info">Açılış</Badge>
                    ) : (
                      <Badge variant={giris(h.tip) ? "success" : "danger"}>{tipAd(h.tip)}</Badge>
                    )}
                    <small>
                      {h.kaynakTur === "acilis"
                        ? "devir bakiyesi"
                        : h.kaynakTur === "doviz_islem"
                          ? "döviz alım/satımı"
                          : h.kaynakTur.replaceAll("_", " ")}
                    </small>
                  </td>
                  <td data-label="Cari / belge">
                    <strong>{h.cari?.unvan || "—"}</strong>
                    <small>{h.fatura?.no ? `Fatura ${h.fatura.no}` : "Belge bağlantısı yok"}</small>
                  </td>
                  <td data-label="Açıklama">{h.aciklama || "—"}</td>
                  <td data-label="Kur / TRY">
                    <strong>{Number(h.kur).toLocaleString("tr-TR")}</strong>
                    <small>{para(h.tutarTry)}</small>
                  </td>
                  <td data-label="Tutar">
                    <strong className={giris(h.tip) ? "treasury-in" : "treasury-out"}>
                      {giris(h.tip) ? "+" : "-"}
                      {para(h.tutar, h.dovizCinsi)}
                    </strong>
                  </td>
                  <td data-label="Durum">
                    {h.kaynakTur === "ters_kayit" ? (
                      <Badge variant="warning">Ters kayıt</Badge>
                    ) : h.geriAlindi ? (
                      <Badge variant="neutral">Geri alındı</Badge>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
            {!hareketler.length && !listeYukleniyor && (
              <tr>
                <td colSpan={8}>
                  <div className="treasury-empty">Hareket bulunamadı.</div>
                </td>
              </tr>
            )}
          </tbody>
        </TableWrap>
        {sonrakiImlec && (
          <div className="treasury-more">
            <Button onClick={() => void dahaFazlaYukle()} disabled={listeYukleniyor}>
              {listeYukleniyor ? "Yükleniyor…" : `Daha fazla yükle (${SAYFA_ADEDI})`}
            </Button>
          </div>
        )}
      </Card>
      <section className="treasury-kpis">
        <a className="is-lead" href="/panel/kasa-banka/nakit-pozisyonu" title="Nakit pozisyonunu aç">
          <span>TRY likidite</span>
          <strong>{para(ozet.toplam)}</strong>
          <small>Aktif kasa ve banka hesapları · nakit pozisyonu →</small>
        </a>
        <div>
          <span>Bugünkü giriş</span>
          <strong>{para(ozet.giris)}</strong>
          <small>Tahsilat ve virman girişleri</small>
        </div>
        <div>
          <span>Bugünkü çıkış</span>
          <strong>{para(ozet.cikis)}</strong>
          <small>Ödeme ve virman çıkışları</small>
        </div>
        <div className={ozet.negatif ? "is-danger" : ""}>
          <span>Negatif bakiye</span>
          <strong>{ozet.negatif}</strong>
          <small>{ozet.negatif ? "Kontrol gerekiyor" : "Negatif hesap yok"}</small>
        </div>
        <a
          href="/panel/kasa-banka/cek-senet"
          className={portfoy && portfoy.geciken.adet > 0 ? "is-warning" : ""}
          title="Alınan çek ve senetler tahsil edilene kadar nakit sayılmaz"
        >
          <span>Çek/senet portföyü</span>
          <strong>{para(portfoy?.acik.toplamTry ?? 0)}</strong>
          <small>
            {portfoy
              ? `${portfoy.acik.adet} evrak · nakde dahil değil${portfoy.geciken.adet ? ` · ${portfoy.geciken.adet} vadesi geçti` : ""}`
              : "Yükleniyor…"}
          </small>
        </a>
      </section>
      <section className="treasury-accounts">
        <Card
          title={
            <div>
              <span>NAKİT HESAPLAR</span>
              <h2>Kasalar</h2>
            </div>
          }
          actions={
            <Button
              size="sm"
              onClick={() => {
                temizle();
                setModal("kasa");
              }}
            >
              + Kasa
            </Button>
          }
        >
          <div className="treasury-account-grid">
            {kasalar.map((k) => (
              <a
                key={k.id}
                className="treasury-account-link"
                href={`/panel/kasa-banka/hesap-ekstresi?hesap=kasa:${k.id}`}
                title="Hesap ekstresini aç"
              >
                <article className={Number(k.bakiye) < 0 ? "is-negative" : ""}>
                  <i>KS</i>
                  <div>
                    <strong>{k.ad}</strong>
                    <small>
                      {k.dovizCinsi} nakit kasa{k.acilis === null ? " · açılış girilmemiş" : ""}
                    </small>
                  </div>
                  <b>{para(k.bakiye, k.dovizCinsi)}</b>
                </article>
              </a>
            ))}
            {!kasalar.length && <div className="treasury-empty">Kasa hesabı yok.</div>}
          </div>
        </Card>
        <Card
          title={
            <div>
              <span>BANKA HESAPLARI</span>
              <h2>Bankalar</h2>
            </div>
          }
          actions={
            <Button
              size="sm"
              onClick={() => {
                temizle();
                setModal("banka");
              }}
            >
              + Banka
            </Button>
          }
        >
          <div className="treasury-account-grid">
            {bankalar.map((b) => (
              <a
                key={b.id}
                className="treasury-account-link"
                href={`/panel/kasa-banka/hesap-ekstresi?hesap=banka:${b.id}`}
                title="Hesap ekstresini aç"
              >
                <article className={Number(b.bakiye) < 0 ? "is-negative" : ""}>
                  <i>BK</i>
                  <div>
                    <strong>{b.ad}</strong>
                    <small>
                      {b.bankaAdi}
                      {b.iban ? ` · ${b.iban.slice(0, 6)}••••${b.iban.slice(-4)}` : ""}
                      {b.acilis === null ? " · açılış girilmemiş" : ""}
                    </small>
                  </div>
                  <b>{para(b.bakiye, b.dovizCinsi)}</b>
                </article>
              </a>
            ))}
            {!bankalar.length && <div className="treasury-empty">Banka hesabı yok.</div>}
          </div>
        </Card>
      </section>
      <div className="treasury-links">
        <ButtonLabel as="a" href="/panel/kasa-banka/hesap-ekstresi">
          Hesap ekstresi
        </ButtonLabel>
        <ButtonLabel as="a" href="/panel/kasa-banka/ekstre">
          Banka ekstreleri
        </ButtonLabel>
        <ButtonLabel as="a" href="/panel/kasa-banka/pos">
          POS hesapları
        </ButtonLabel>
        <ButtonLabel as="a" href="/panel/kasa-banka/kredi-kartlari">
          Kredi kartları
        </ButtonLabel>
        <ButtonLabel as="a" href="/panel/kasa-banka/krediler">
          Banka kredileri
        </ButtonLabel>
        <ButtonLabel as="a" href="/panel/kasa-banka/cek-senet">
          Çek ve senetler
        </ButtonLabel>
        <ButtonLabel as="a" href="/panel/kasa-banka/odeme-talimatlari">
          Ödeme talimatları
        </ButtonLabel>
        <ButtonLabel as="a" href="/panel/kasa-banka/raporlar">
          Raporlar
        </ButtonLabel>
      </div>
      {modal && (
        <div
          className="treasury-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !islem) setModal(null);
          }}
        >
          <section className="treasury-modal">
            <header>
              <div>
                <span>FİNANS İŞLEMİ</span>
                <h2>
                  {modal === "kasa"
                    ? "Yeni kasa hesabı"
                    : modal === "banka"
                      ? "Yeni banka hesabı"
                      : modal === "virman"
                        ? duzeltilenVirman
                          ? "Virmanı düzelt"
                          : "Hesaplar arası virman"
                        : modal === "detay"
                          ? "Fiş ayrıntısı"
                          : modal === "doviz"
                            ? "Döviz alım/satımı"
                            : fisBaslangici.duzeltilenId
                              ? "Fişi düzelt"
                              : "Tahsilat / ödeme fişi"}
                </h2>
              </div>
              <button onClick={() => setModal(null)}>×</button>
            </header>
            {(modal === "kasa" || modal === "banka") && (
              <form onSubmit={hesapKaydet}>
                <div className="treasury-form-grid">
                  <Field label="Hesap adı">
                    <Input autoFocus required minLength={2} value={ad} onChange={(e) => setAd(e.target.value)} />
                  </Field>
                  {modal === "banka" && (
                    <Field label="Banka adı">
                      <Input required value={bankaAdi} onChange={(e) => setBankaAdi(e.target.value)} />
                    </Field>
                  )}
                  <Field label="Para birimi">
                    <Select value={doviz} onChange={(e) => setDoviz(e.target.value)}>
                      <DovizSecenekleri />
                    </Select>
                  </Field>
                  {modal === "banka" && (
                    <>
                      <Field label="Hesap no">
                        <Input value={hesapNo} onChange={(e) => setHesapNo(e.target.value)} />
                      </Field>
                      <Field label="IBAN">
                        <Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="TR…" />
                      </Field>
                    </>
                  )}
                  <Field
                    label={
                      <>
                        Açılış bakiyesi <small className="muted">· isteğe bağlı</small>
                      </>
                    }
                  >
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={acilisTutari}
                      onChange={(e) => setAcilisTutari(e.target.value)}
                      placeholder="0,00"
                    />
                  </Field>
                  <Field label="Açılış tarihi">
                    <Input
                      type="date"
                      required={Number(acilisTutari) > 0}
                      value={acilisTarihi}
                      onChange={(e) => setAcilisTarihi(e.target.value)}
                    />
                  </Field>
                  {Number(acilisTutari) > 0 && (
                    <label className="treasury-check">
                      <input type="checkbox" checked={acilisEksi} onChange={(e) => setAcilisEksi(e.target.checked)} /> Eksi bakiye ile
                      açılıyor{modal === "banka" ? " (KMH)" : ""}
                    </label>
                  )}
                </div>
                <p className="treasury-hint">
                  Sisteme geçmeden önceki bakiyeyi açılış olarak girin: bakiyeye eklenir, tahsilat sayılmaz. Sonradan hesap ekstresi
                  ekranından değiştirilebilir.
                </p>
                <footer>
                  <Button type="button" onClick={() => setModal(null)}>
                    Vazgeç
                  </Button>
                  <Button type="submit" variant="primary" disabled={Boolean(islem)}>
                    Hesabı oluştur
                  </Button>
                </footer>
              </form>
            )}
            {modal === "detay" && secili && (
              <FisAyrintisi
                hareket={secili}
                onDuzelt={duzelt}
                onGeriAlindi={async (mesaj) => {
                  setBasari(mesaj);
                  setModal(null);
                  setSecili(null);
                  await yukle();
                }}
              />
            )}
            {modal === "doviz" && (
              <DovizIslemFormu
                hesaplar={tumHesaplar}
                onKapat={() => setModal(null)}
                onKaydedildi={async (mesaj) => {
                  setBasari(mesaj);
                  setModal(null);
                  temizle();
                  await yukle();
                }}
              />
            )}
            {modal === "hareket" && (
              <OdemeFisi
                hesaplar={tumHesaplar}
                cariler={cariler}
                baslangic={fisBaslangici}
                onKapat={() => setModal(null)}
                onKaydedildi={async (mesaj) => {
                  setBasari(mesaj);
                  setModal(null);
                  temizle();
                  await yukle();
                }}
              />
            )}
            {modal === "virman" && (
              <form onSubmit={virmanKaydet}>
                {duzeltilenVirman && (
                  <div className="payment-slip__correction">
                    <Alert tone="warning">
                      Düzeltme kaydedilince eski virmanın iki bacağı geri alınır ve bu form yeni virman olarak aynı işlemde yazılır.
                    </Alert>
                    <Field label="Düzeltme gerekçesi">
                      <Input
                        required
                        minLength={3}
                        maxLength={300}
                        value={virmanNedeni}
                        onChange={(e) => setVirmanNedeni(e.target.value)}
                        placeholder="Ör. Yanlış hedef hesap"
                      />
                    </Field>
                  </div>
                )}
                <div className="treasury-form-grid">
                  <Field label="Kaynak hesap">
                    <Select
                      autoFocus
                      required
                      value={kaynak}
                      onChange={(e) => {
                        setKaynak(e.target.value);
                        setHedef("");
                      }}
                    >
                      <option value="">Kaynak seçin</option>
                      {tumHesaplar
                        .filter((x) => x.aktif)
                        .map((x) => (
                          <option key={`${x.tur}-${x.id}`} value={`${x.tur}:${x.id}`}>
                            {x.ad} · {para(x.bakiye, x.dovizCinsi)}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label="Hedef hesap">
                    <Select required disabled={!kaynak} value={hedef} onChange={(e) => setHedef(e.target.value)}>
                      <option value="">Hedef seçin</option>
                      {hedefler.map((x) => (
                        <option key={`${x.tur}-${x.id}`} value={`${x.tur}:${x.id}`}>
                          {x.ad} · {x.dovizCinsi}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Transfer tutarı">
                    <Input required type="number" min="0.01" step="0.01" value={tutar} onChange={(e) => setTutar(e.target.value)} />
                  </Field>
                  <Field label="Tarih">
                    <Input required type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
                  </Field>
                  <Field label="Açıklama">
                    <Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
                  </Field>
                </div>
                {kaynakHesap && (
                  <div className="treasury-preview">
                    <span>Kaynak bakiyesi {para(kaynakHesap.bakiye, kaynakHesap.dovizCinsi)}</span>
                    <strong>Transfer sonrası {para(Number(kaynakHesap.bakiye) - Number(tutar || 0), kaynakHesap.dovizCinsi)}</strong>
                    <small>Virman aynı para birimindeki iki hesap arasında çift kayıt oluşturur.</small>
                  </div>
                )}
                {virmanEksiUyari && (
                  <div className="treasury-confirm" role="alertdialog" aria-label="Eksi bakiye uyarısı">
                    <Alert tone="warning">
                      <span>
                        <strong>Kaynak hesap eksi bakiyeye düşüyor.</strong> {virmanEksiUyari}
                      </span>
                    </Alert>
                    <div>
                      <Button type="button" size="sm" onClick={() => setVirmanEksiUyari(null)}>
                        Vazgeç
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={Boolean(islem)}
                        onClick={() => void virmanKaydet(undefined, true)}
                      >
                        Yine de kaydet
                      </Button>
                    </div>
                  </div>
                )}
                <footer>
                  <Button type="button" onClick={() => setModal(null)}>
                    Vazgeç
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={Boolean(islem) || !kaynak || !hedef || (Boolean(duzeltilenVirman) && virmanNedeni.trim().length < 3)}
                  >
                    {duzeltilenVirman ? "Düzeltmeyi kaydet" : "Virmanı gerçekleştir"}
                  </Button>
                </footer>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
