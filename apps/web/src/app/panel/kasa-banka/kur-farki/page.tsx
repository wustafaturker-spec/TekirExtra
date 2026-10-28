"use client";

/**
 * Kur farkı (KSB-07).
 *
 * Dövizli faturanın tahsilat/ödemesi fatura kurundan farklı kurla yapılınca
 * gerçekleşen kur farkı doğar. Lehimize farkın faturasını biz keseriz (taslak
 * TL satış faturası), aleyhimize farkın faturasını karşı taraf keser (gelen
 * alış faturasıyla eşleştirilir). Fatura gerektirmeyen farklar kapatılır.
 * Dönem sonu değerleme yalnız bilgi raporudur; kayıt üretmez.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";
import { Alert, Badge, Button, Input, PageHeader, Para, Segmented, Stat, StatGrid, Table, TableSkeleton, Tabs, Tarih } from "@/components/ui";

type Sekme = "bekleyen" | "islenen" | "degerleme";
type Yon = "biz_keseriz" | "karsi_taraf_keser";

interface KurFarkiKalemi {
  hareketId: string;
  kaynakTur: "kasa_banka" | "kredi_karti" | "cek_senet" | "mahsup";
  tarih: string;
  tip: string;
  hesap: string;
  tutar: string;
  dovizCinsi: string;
  cari: { id: string; kod: string; unvan: string };
  fatura: { id: string; no: string | null; tip: string; dovizCinsi: string; kur: string };
  mahsup: string;
  odemeKuru: string | null;
  kurFarkiTry: string;
  yon: Yon;
  kdvOrani: string;
  gibIstisnaKodu: string | null;
  yurtDisi: boolean;
  kapandi: boolean;
  kurFarkiFaturasi: { id: string; no: string | null; tip: "satis" | "alis"; durum: "taslak" | "kesin"; tarih: string } | null;
}

interface DegerlemeSatiri {
  dovizCinsi: string;
  dovizBakiye: string;
  kayitliTry: string;
  kur: string;
  guncelTry: string;
  kurFarki: string;
}

interface Degerleme {
  degerlemeTarihi: string;
  kurTipi: string;
  kurlar: Record<string, string>;
  cariler: Array<DegerlemeSatiri & { cari: { id: string; kod: string; unvan: string } }>;
  hesaplar: Array<DegerlemeSatiri & { hesap: string }>;
  toplamCariKurFarki: string;
  toplamHesapKurFarki: string;
}

interface AlisFaturasi {
  id: string;
  no: string | null;
  tarih: string;
  durum: string;
  dovizCinsi: string;
  genelToplam: string;
  aciklama: string | null;
}

type Pencere = null | "fatura" | "eslestir" | "kapat";

const YON_ADI: Record<Yon, string> = { biz_keseriz: "Biz keseriz", karsi_taraf_keser: "Karşı taraf keser" };
const toplamTl = (liste: KurFarkiKalemi[]) => liste.reduce((t, k) => t + Math.abs(Number(k.kurFarkiTry)), 0);
const KAYNAK_ADI: Record<KurFarkiKalemi["kaynakTur"], string> = { kasa_banka: "", kredi_karti: "Kredi kartı", cek_senet: "Çek/senet", mahsup: "Mahsup" };
const faturaBaglantisi = (f: { id: string; tip: string }) => `/panel/fatura/yeni?ac=${f.id}${f.tip.startsWith("alis") ? "&yon=alis" : ""}`;

export default function KurFarkiSayfasi() {
  const [sekme, setSekme] = useState<Sekme>("bekleyen");

  return (
    <div className="fx-page">
      <PageHeader
        title="Kur farkı"
        subtitle="Dövizli faturaların tahsilat ve ödemelerinden doğan kur farklarını faturalayın, gelen faturalarla eşleştirin; dönem sonunda açık döviz pozisyonunuzu değerleyin."
      />
      <Tabs<Sekme>
        ariaLabel="Kur farkı bölümleri"
        value={sekme}
        onChange={setSekme}
        items={[
          { deger: "bekleyen", baslik: "Bekleyen kur farkları" },
          { deger: "islenen", baslik: "İşlenenler" },
          { deger: "degerleme", baslik: "Dönem sonu değerleme" },
        ]}
      />
      {sekme === "degerleme" ? <DegerlemeSekmesi /> : <KalemSekmesi key={sekme} durum={sekme} />}
    </div>
  );
}

function KalemSekmesi({ durum }: { durum: "bekleyen" | "islenen" }) {
  const [kalemler, setKalemler] = useState<KurFarkiKalemi[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [baslangic, setBaslangic] = useState("");
  const [bitis, setBitis] = useState("");
  const [yonSuzgeci, setYonSuzgeci] = useState<"" | Yon>("");
  const [arama, setArama] = useState("");
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [pencere, setPencere] = useState<Pencere>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState<{ mesaj: string; fatura?: { id: string; tip: string } } | null>(null);
  const [isleniyor, setIsleniyor] = useState(false);

  const yukle = useCallback(async () => {
    const qs = new URLSearchParams({ durum });
    if (baslangic) qs.set("baslangic", baslangic);
    if (bitis) qs.set("bitis", bitis);
    try {
      const liste = await api<KurFarkiKalemi[]>(`/kur-farki?${qs}`);
      setKalemler(liste);
      setSecili((onceki) => new Set([...onceki].filter((id) => liste.some((k) => k.hareketId === id))));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Kur farkları yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [durum, baslangic, bitis]);

  useEffect(() => { if (tokenAl()) void yukle(); }, [yukle]);

  const gorunen = useMemo(() => {
    const aranan = arama.trim().toLocaleLowerCase("tr");
    return kalemler.filter((k) =>
      (!yonSuzgeci || k.yon === yonSuzgeci) &&
      (!aranan || `${k.cari.unvan} ${k.cari.kod} ${k.fatura.no ?? ""}`.toLocaleLowerCase("tr").includes(aranan)));
  }, [kalemler, yonSuzgeci, arama]);

  const gruplar = useMemo(() => {
    const harita = new Map<string, { cari: KurFarkiKalemi["cari"]; kalemler: KurFarkiKalemi[] }>();
    for (const k of gorunen) {
      const g = harita.get(k.cari.id) ?? { cari: k.cari, kalemler: [] };
      g.kalemler.push(k);
      harita.set(k.cari.id, g);
    }
    return [...harita.values()].sort((a, b) => a.cari.unvan.localeCompare(b.cari.unvan, "tr"));
  }, [gorunen]);

  const ozet = useMemo(() => {
    const biz = kalemler.filter((k) => k.yon === "biz_keseriz");
    const karsi = kalemler.filter((k) => k.yon === "karsi_taraf_keser");
    return { biz, karsi, cariSayisi: new Set(kalemler.map((k) => k.cari.id)).size };
  }, [kalemler]);

  const seciliKalemler = kalemler.filter((k) => secili.has(k.hareketId));
  const tekCari = new Set(seciliKalemler.map((k) => k.cari.id)).size === 1;
  const yonler = new Set(seciliKalemler.map((k) => k.yon));
  const yurtDisiVar = seciliKalemler.some((k) => k.yurtDisi);
  const engel = !seciliKalemler.length ? "" : !tekCari ? "Faturalama ve eşleştirme için tek bir carinin kalemlerini seçin" : yonler.size > 1 ? "Seçimde iki yön karışık; aynı yöndeki kalemleri seçin" : "";

  function degistir(ids: string[], ekle: boolean) {
    setSecili((onceki) => {
      const yeni = new Set(onceki);
      for (const id of ids) {
        if (ekle) yeni.add(id);
        else yeni.delete(id);
      }
      return yeni;
    });
  }

  async function islem(yol: string, govde: object, mesaj: (sonuc: Record<string, unknown>) => string, fatura?: (sonuc: Record<string, unknown>) => { id: string; tip: string }) {
    setIsleniyor(true);
    setHata("");
    try {
      const sonuc = await api<Record<string, unknown>>(yol, { method: "POST", body: JSON.stringify(govde) });
      setBasari({ mesaj: mesaj(sonuc), fatura: fatura?.(sonuc) });
      setPencere(null);
      setSecili(new Set());
      await yukle();
    } catch (e) {
      setHata(e instanceof Error ? e.message : "İşlem yapılamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  const hareketIdleri = seciliKalemler.map((k) => k.hareketId);
  const bekleyen = durum === "bekleyen";

  return (
    <>
      {bekleyen && (
        <StatGrid>
          <Stat label="Biz keseceğiz (lehimize)" value={<Para deger={toplamTl(ozet.biz)} dovizCinsi="TRY" />} hint={`${ozet.biz.length} tahsilat/ödeme · KDV dahil`} tone="success" />
          <Stat label="Karşı taraf kesecek (aleyhimize)" value={<Para deger={toplamTl(ozet.karsi)} dovizCinsi="TRY" />} hint={`${ozet.karsi.length} tahsilat/ödeme · gelen faturayı bekleyin`} tone="danger" />
          <Stat label="Bekleyen cari" value={ozet.cariSayisi} hint="Fatura başına tek cari" />
        </StatGrid>
      )}

      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && (
        <Alert tone="success">
          {basari.mesaj}
          {basari.fatura && <> <a href={faturaBaglantisi(basari.fatura)}>Faturayı aç →</a></>}
        </Alert>
      )}

      <div className="fx-toolbar">
        <Segmented<"" | Yon>
          ariaLabel="Yön"
          value={yonSuzgeci}
          onChange={setYonSuzgeci}
          items={[{ deger: "", baslik: "Tümü" }, { deger: "biz_keseriz", baslik: "Biz keseriz" }, { deger: "karsi_taraf_keser", baslik: "Karşı taraf keser" }]}
        />
        <Input aria-label="Cari ya da fatura ara" value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Cari, fatura no…" />
        <Input aria-label="Başlangıç tarihi" type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} />
        <Input aria-label="Bitiş tarihi" type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} />
      </div>

      {seciliKalemler.length > 0 && (
        <div className="fx-selection" role="region" aria-label="Seçili kur farkları">
          <div>
            <strong>{seciliKalemler.length} kalem · <Para deger={toplamTl(seciliKalemler)} dovizCinsi="TRY" /></strong>
            <small>{engel || (tekCari ? seciliKalemler[0].cari.unvan : "")}</small>
          </div>
          <div className="row-tight">
            <Button size="sm" onClick={() => setSecili(new Set())}>Seçimi temizle</Button>
            {bekleyen ? (
              <>
                <Button size="sm" onClick={() => setPencere("kapat")}>Kapat (fatura gerekmiyor)</Button>
                {!engel && yonler.has("karsi_taraf_keser") && <Button size="sm" variant="primary" onClick={() => setPencere("eslestir")}>Gelen faturayla eşleştir</Button>}
                {!engel && !yurtDisiVar && yonler.has("biz_keseriz") && <Button size="sm" variant="primary" onClick={() => setPencere("fatura")}>Kur farkı faturası oluştur</Button>}
              </>
            ) : (
              <Button size="sm" disabled={isleniyor} onClick={() => void islem("/kur-farki/geri-ac", { hareketIdleri }, (s) => `${s.acilan} kalem bekleyenlere geri alındı`)}>Bekleyenlere geri al</Button>
            )}
          </div>
        </div>
      )}

      {yukleniyor ? <TableSkeleton rows={4} cols={7} /> : gruplar.length === 0 ? (
        <div className="fx-empty">
          <strong>{bekleyen ? "Bekleyen kur farkı yok." : "Henüz işlenmiş kur farkı yok."}</strong>
          <span>{bekleyen ? "Dövizli bir fatura fatura kurundan farklı kurla tahsil edildiğinde ya da ödendiğinde burada listelenir." : "Faturalanan, eşleştirilen ya da kapatılan kur farkları burada görünür."}</span>
        </div>
      ) : (
        <Table density="compact" className="fx-table">
          <thead>
            <tr>
              <th aria-label="Seç" />
              <th>Tarih</th>
              <th>Fatura</th>
              <th>Tahsilat / ödeme</th>
              <th className="num">Kapanan</th>
              <th className="num">Fatura kuru → ödeme kuru</th>
              <th className="num">Kur farkı (KDV dahil)</th>
              <th>{bekleyen ? "Faturayı kim keser" : "Sonuç"}</th>
            </tr>
          </thead>
          <tbody>
            {gruplar.map((g) => {
              const ids = g.kalemler.map((k) => k.hareketId);
              const hepsi = ids.every((id) => secili.has(id));
              return [
                <tr key={g.cari.id} className="table-subtotal">
                  <td><input type="checkbox" aria-label={`${g.cari.unvan} kalemlerinin hepsini seç`} checked={hepsi} onChange={(e) => degistir(ids, e.target.checked)} /></td>
                  <td colSpan={5}><strong>{g.cari.unvan}</strong> <small className="muted">{g.cari.kod} · {g.kalemler.length} kalem</small></td>
                  <td className="num"><strong><Para deger={toplamTl(g.kalemler)} dovizCinsi="TRY" /></strong></td>
                  <td />
                </tr>,
                ...g.kalemler.map((k) => {
                  const fark = Number(k.kurFarkiTry);
                  return (
                    <tr key={k.hareketId} className={secili.has(k.hareketId) ? "is-selected" : undefined} onClick={() => degistir([k.hareketId], !secili.has(k.hareketId))}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label="Seç" checked={secili.has(k.hareketId)} onChange={(e) => degistir([k.hareketId], e.target.checked)} />
                      </td>
                      <td><Tarih deger={k.tarih} /></td>
                      <td>
                        <a href={faturaBaglantisi(k.fatura)} onClick={(e) => e.stopPropagation()}>{k.fatura.no ?? "Numarasız"}</a>
                        <small className="muted"> · {k.fatura.dovizCinsi}</small>
                      </td>
                      <td>
                        {KAYNAK_ADI[k.kaynakTur] || (k.tip === "tahsilat" ? "Tahsilat" : "Ödeme")} · {k.hesap}
                        <small className="muted"> · <Para deger={k.tutar} dovizCinsi={k.dovizCinsi} /></small>
                      </td>
                      <td className="num"><Para deger={k.mahsup} dovizCinsi={k.fatura.dovizCinsi} /></td>
                      <td className="num">{Number(k.fatura.kur).toLocaleString("tr-TR", { minimumFractionDigits: 4 })} → {k.odemeKuru ? Number(k.odemeKuru).toLocaleString("tr-TR", { minimumFractionDigits: 4 }) : "—"}</td>
                      <td className={`num ${fark > 0 ? "fx-up" : "fx-down"}`}>{fark > 0 ? "+" : "−"}<Para deger={Math.abs(fark)} dovizCinsi="TRY" /></td>
                      <td>
                        {bekleyen ? (
                          k.yurtDisi
                            ? <span title="Yurt dışı işlemde kur farkı faturası kesilmez; kapatın, 646/656 fişi olur"><Badge variant="neutral">Yurt dışı · faturasız kapat</Badge></span>
                            : <Badge variant={k.yon === "biz_keseriz" ? "success" : "warning"}>{YON_ADI[k.yon]}</Badge>
                        ) : k.kurFarkiFaturasi ? (
                          <a href={faturaBaglantisi(k.kurFarkiFaturasi)} onClick={(e) => e.stopPropagation()}>
                            {k.kurFarkiFaturasi.tip === "satis" ? "Faturalandı" : "Gelen fatura"} · {k.kurFarkiFaturasi.no ?? "taslak"}
                          </a>
                        ) : (
                          <Badge variant="neutral">Kapatıldı</Badge>
                        )}
                      </td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </Table>
      )}

      {pencere === "fatura" && (
        <OnayPenceresi
          baslik="Kur farkı faturası oluştur"
          ust="LEHİMİZE KUR FARKI"
          onKapat={() => setPencere(null)}
          onOnayla={() => void islem("/kur-farki/faturalar", { hareketIdleri }, (s) => `Kur farkı faturası taslak olarak oluşturuldu.${s.cariGenisletildi ? " Cari kartı yalnız tedarikçiydi; satış faturası kesilebilmesi için türü “her ikisi” yapıldı." : ""}`, (s) => ({ id: String(s.faturaId), tip: "satis" }))}
          onayMetni="Taslak faturayı oluştur"
          isleniyor={isleniyor}
        >
          <KalemOzeti kalemler={seciliKalemler} />
          <p className="fx-note">
            <strong>{seciliKalemler[0]?.cari.unvan}</strong> adına bugün tarihli <strong>TL satış faturası</strong> taslağı oluşturulur. Kur farkı KDV dahil
            bedel sayılır; asıl faturanın KDV oranı, istisna ve tevkifat gruplarına tutarları oranında bölünür ve her grup için matrah iç yüzdeyle ayrılır,
            “KUR-FARKI” hizmet kartı kullanılır. Fatura ödenmez: kesinleşince “kur farkı karşılığı” kaydıyla kendiliğinden kapanır, carinin bakiyesi ve
            riski değişmez. Taslağı silerseniz kalemler bu listeye geri döner.
          </p>
        </OnayPenceresi>
      )}
      {pencere === "eslestir" && seciliKalemler[0] && (
        <EslestirmePenceresi
          kalemler={seciliKalemler}
          isleniyor={isleniyor}
          onKapat={() => setPencere(null)}
          onSec={(fatura) => void islem("/kur-farki/eslestir", { hareketIdleri, faturaId: fatura.id }, (s) => `${s.eslesen} kalem ${fatura.no ?? "seçilen"} numaralı gelen faturayla eşleştirildi.`)}
        />
      )}
      {pencere === "kapat" && (
        <OnayPenceresi
          baslik="Kur farkını kapat"
          ust="FATURA GEREKMİYOR"
          onKapat={() => setPencere(null)}
          onOnayla={() => void islem("/kur-farki/kapat", { hareketIdleri }, (s) => `${s.kapatilan} kalem kapatıldı.`)}
          onayMetni="Kur farkını kapat"
          isleniyor={isleniyor}
        >
          <KalemOzeti kalemler={seciliKalemler} />
          <p className="fx-note">Seçilen kur farkları için fatura kesilmeyecek ve bekleyenler listesinden çıkacak (yurt dışı işlemler ya da önemsiz kuruş farkları). Fark muhasebe aktarımında kur farkı geliri (646) ya da gideri (656) fişi olur. İşlenenler sekmesinden geri alabilirsiniz.</p>
        </OnayPenceresi>
      )}
    </>
  );
}

function KalemOzeti({ kalemler }: { kalemler: KurFarkiKalemi[] }) {
  const faturalar = [...new Set(kalemler.map((k) => k.fatura.no ?? "numarasız"))];
  return (
    <div className="treasury-preview">
      <span>{kalemler.length} tahsilat/ödeme · {faturalar.join(", ")}</span>
      <strong><Para deger={toplamTl(kalemler)} dovizCinsi="TRY" /></strong>
      <small>KDV dahil toplam kur farkı</small>
    </div>
  );
}

function OnayPenceresi({ baslik, ust, children, onKapat, onOnayla, onayMetni, isleniyor, onayKapali }: {
  baslik: string;
  ust: string;
  children: React.ReactNode;
  onKapat: () => void;
  onOnayla: () => void;
  onayMetni: string;
  isleniyor: boolean;
  onayKapali?: boolean;
}) {
  return (
    <div className="treasury-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onKapat(); }}>
      <section className="treasury-modal fx-modal" role="dialog" aria-label={baslik}>
        <header>
          <div><span>{ust}</span><h2>{baslik}</h2></div>
          <button onClick={onKapat} aria-label="Kapat">×</button>
        </header>
        <div className="fx-modal__body">{children}</div>
        <footer className="fx-modal__foot">
          <Button onClick={onKapat}>Vazgeç</Button>
          <Button variant="primary" disabled={isleniyor || onayKapali} onClick={onOnayla}>{isleniyor ? "İşleniyor…" : onayMetni}</Button>
        </footer>
      </section>
    </div>
  );
}

function EslestirmePenceresi({ kalemler, isleniyor, onKapat, onSec }: {
  kalemler: KurFarkiKalemi[];
  isleniyor: boolean;
  onKapat: () => void;
  onSec: (fatura: AlisFaturasi) => void;
}) {
  const cari = kalemler[0].cari;
  const [faturalar, setFaturalar] = useState<AlisFaturasi[] | null>(null);
  const [seciliId, setSeciliId] = useState("");
  const [hata, setHata] = useState("");

  useEffect(() => {
    tumSayfalariAl<AlisFaturasi>(`/fatura?tip=alis&cariId=${cari.id}`)
      .then((liste) => {
        // Kur farkı faturası TL'dir; en yeniler üstte.
        const uygun = liste.filter((f) => f.durum !== "iptal").sort((a, b) => b.tarih.localeCompare(a.tarih));
        setFaturalar(uygun);
        const tl = uygun.filter((f) => f.dovizCinsi === "TRY");
        const beklenen = toplamTl(kalemler);
        setSeciliId(tl.find((f) => Math.abs(Number(f.genelToplam) - beklenen) < 0.05)?.id ?? "");
      })
      .catch((e) => setHata(e instanceof Error ? e.message : "Faturalar yüklenemedi"));
  }, [cari.id, kalemler]);

  const secilen = faturalar?.find((f) => f.id === seciliId);
  const fark = secilen ? Number(secilen.genelToplam) - toplamTl(kalemler) : 0;

  return (
    <OnayPenceresi
      baslik="Gelen faturayla eşleştir"
      ust="ALEYHİMİZE KUR FARKI"
      onKapat={onKapat}
      onOnayla={() => { if (secilen) onSec(secilen); }}
      onayMetni="Eşleştir"
      isleniyor={isleniyor}
      onayKapali={!secilen}
    >
      <KalemOzeti kalemler={kalemler} />
      <p className="fx-note"><strong>{cari.unvan}</strong> tarafından kesilen kur farkı faturasını seçin. Fatura henüz kayıtlı değilse önce gelen kutusundan ya da alış faturası olarak içeri alın.</p>
      {hata && <Alert tone="error">{hata}</Alert>}
      {faturalar === null ? <p className="muted">Faturalar yükleniyor…</p> : faturalar.length === 0 ? (
        <p className="fx-empty">Bu cariye ait alış faturası yok.</p>
      ) : (
        <div className="fx-pick" role="radiogroup" aria-label="Alış faturası">
          {faturalar.slice(0, 50).map((f) => (
            <label key={f.id} className={f.id === seciliId ? "is-selected" : undefined}>
              <input type="radio" name="kur-farki-fatura" checked={f.id === seciliId} onChange={() => setSeciliId(f.id)} />
              <span>
                <strong>{f.no ?? "Numarasız"}</strong>
                <small><Tarih deger={f.tarih} />{f.durum === "taslak" ? " · taslak" : ""}{f.aciklama ? ` · ${f.aciklama}` : ""}</small>
              </span>
              <b><Para deger={f.genelToplam} dovizCinsi={f.dovizCinsi} /></b>
            </label>
          ))}
        </div>
      )}
      {secilen && Math.abs(fark) >= 0.01 && (
        <Alert tone="warning">
          Seçilen fatura toplamı kur farkından <Para deger={Math.abs(fark)} dovizCinsi="TRY" /> {fark > 0 ? "fazla" : "az"}. Karşı tarafın farklı kur ya da tarih kullanmış olması olağandır; yine de eşleştirebilirsiniz.
        </Alert>
      )}
    </OnayPenceresi>
  );
}

function DegerlemeSekmesi() {
  const [tarih, setTarih] = useState(bugunTR());
  const [rapor, setRapor] = useState<Degerleme | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");

  useEffect(() => {
    if (!tokenAl() || !tarih) return;
    setYukleniyor(true);
    setHata("");
    api<Degerleme>(`/kur-farki/degerleme?tarih=${tarih}`)
      .then(setRapor)
      .catch((e) => { setRapor(null); setHata(e instanceof Error ? e.message : "Değerleme hesaplanamadı"); })
      .finally(() => setYukleniyor(false));
  }, [tarih]);

  const toplam = rapor ? Number(rapor.toplamCariKurFarki) + Number(rapor.toplamHesapKurFarki) : 0;
  const isaretli = (d: string) => {
    const n = Number(d);
    return <span className={n > 0 ? "fx-up" : n < 0 ? "fx-down" : undefined}>{n > 0 ? "+" : n < 0 ? "−" : ""}<Para deger={Math.abs(n)} dovizCinsi="TRY" /></span>;
  };

  return (
    <>
      <div className="fx-toolbar">
        <label className="fx-date">
          <span>Değerleme günü</span>
          <Input type="date" value={tarih} max={bugunTR()} onChange={(e) => setTarih(e.target.value)} />
        </label>
        {rapor && Object.keys(rapor.kurlar).length > 0 && (
          <div className="fx-rates" aria-label="Kullanılan kurlar">
            {Object.entries(rapor.kurlar).map(([d, k]) => <span key={d}><b>{d}</b> {Number(k).toLocaleString("tr-TR", { minimumFractionDigits: 4 })}</span>)}
            <small>{rapor.kurTipi}</small>
          </div>
        )}
      </div>
      <p className="fx-note">Bilgi amaçlıdır: açık dövizli cari bakiyeleri ile döviz kasa/banka hesapları seçilen günün kuruyla yeniden değerlenir. Kayıt ya da fatura üretmez; gerçekleşen kur farkları “Bekleyen kur farkları” sekmesinden işlenir.</p>
      {hata && <Alert tone="error">{hata}</Alert>}

      {yukleniyor ? <TableSkeleton rows={4} cols={6} /> : rapor && (
        <>
          <StatGrid>
            <Stat label="Cari değerleme farkı" value={isaretli(rapor.toplamCariKurFarki)} hint={`${rapor.cariler.length} açık dövizli bakiye`} />
            <Stat label="Kasa/banka değerleme farkı" value={isaretli(rapor.toplamHesapKurFarki)} hint={`${rapor.hesaplar.length} döviz hesabı`} />
            <Stat label="Toplam" value={isaretli(String(toplam))} hint={toplam >= 0 ? "Değerleme kazancı" : "Değerleme kaybı"} tone={toplam >= 0 ? "success" : "danger"} />
          </StatGrid>

          <h2 className="fx-section">Dövizli cari bakiyeleri</h2>
          {rapor.cariler.length === 0 ? <p className="fx-empty">Açık dövizli cari bakiyesi yok.</p> : (
            <Table density="compact">
              <thead><tr><th>Cari</th><th className="num">Döviz bakiye</th><th className="num">Kayıtlı TL</th><th className="num">Kur</th><th className="num">Güncel TL</th><th className="num">Fark</th></tr></thead>
              <tbody>
                {rapor.cariler.map((c) => (
                  <tr key={`${c.cari.id}-${c.dovizCinsi}`}>
                    <td><a href={`/panel/cari/${c.cari.id}`}>{c.cari.unvan}</a> <small className="muted">{c.cari.kod}</small><br /><small className="muted">{Number(c.dovizBakiye) > 0 ? "Alacağımız" : "Borcumuz"}</small></td>
                    <td className="num"><Para deger={Math.abs(Number(c.dovizBakiye))} dovizCinsi={c.dovizCinsi} /></td>
                    <td className="num"><Para deger={Math.abs(Number(c.kayitliTry))} dovizCinsi="TRY" /></td>
                    <td className="num">{Number(c.kur).toLocaleString("tr-TR", { minimumFractionDigits: 4 })}</td>
                    <td className="num"><Para deger={Math.abs(Number(c.guncelTry))} dovizCinsi="TRY" /></td>
                    <td className="num">{isaretli(c.kurFarki)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <h2 className="fx-section">Döviz kasa ve banka hesapları</h2>
          {rapor.hesaplar.length === 0 ? <p className="fx-empty">Bakiyesi olan döviz hesabı yok.</p> : (
            <Table density="compact">
              <thead><tr><th>Hesap</th><th className="num">Döviz bakiye</th><th className="num">Kayıtlı TL</th><th className="num">Kur</th><th className="num">Güncel TL</th><th className="num">Fark</th></tr></thead>
              <tbody>
                {rapor.hesaplar.map((h) => (
                  <tr key={h.hesap}>
                    <td>{h.hesap}</td>
                    <td className="num"><Para deger={h.dovizBakiye} dovizCinsi={h.dovizCinsi} /></td>
                    <td className="num"><Para deger={h.kayitliTry} dovizCinsi="TRY" /></td>
                    <td className="num">{Number(h.kur).toLocaleString("tr-TR", { minimumFractionDigits: 4 })}</td>
                    <td className="num"><Para deger={h.guncelTry} dovizCinsi="TRY" /></td>
                    <td className="num">{isaretli(h.kurFarki)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </>
  );
}
