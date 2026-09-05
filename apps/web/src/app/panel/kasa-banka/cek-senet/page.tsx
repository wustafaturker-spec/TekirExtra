"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tokenAl, tumSayfalariAl } from "@/lib/api";
import {
  Alert,
  Badge,
  Button,
  ButtonLabel,
  Card,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  Stat,
  StatGrid,
  TableWrap,
} from "@/components/ui";
import { AramaSecici } from "@/components/arama-secici";

/* ─── Tipler ─────────────────────────────────────────────────────────────── */

interface CariOzet {
  id: string;
  kod: string;
  unvan: string;
}

interface Hesap {
  id: string;
  ad: string;
  dovizCinsi: string;
}

interface CekSenet {
  id: string;
  tur: "cek" | "senet";
  yon: "alinan" | "verilen";
  portfoyNo: string;
  cekNo: string | null;
  islemTarihi: string;
  vadeTarihi: string;
  tutar: string;
  dovizCinsi: string;
  kur: string;
  tutarTry: string;
  borclu: string;
  kesideYeri: string | null;
  banka: string | null;
  sube: string | null;
  hesapNo: string | null;
  durum: string;
  aciklama: string | null;
  fizikselKonum: string | null;
  cari: CariOzet | null;
  ciroCari: CariOzet | null;
  olaylar?: { id:string; oncekiDurum:string|null; yeniDurum:string; islemTarihi:string; aciklama:string|null; createdAt:string }[];
}

interface PortfoyOzet { acik:{adet:number;toplamTry:string;dovizler:Record<string,string>}; geciken:{adet:number;toplamTry:string}; yaklasan:{adet:number;toplamTry:string}; bankada:{adet:number;toplamTry:string}; ciro:{adet:number;toplamTry:string}; karsiliksiz:{adet:number;toplamTry:string} }

type TurFiltre = "hepsi" | "cek" | "senet";
type Yon = "alinan" | "verilen";

/* ─── Sabitler ───────────────────────────────────────────────────────────── */

const DURUMLAR: Record<string, { baslik: string; renk: "warning" | "success" | "info" | "danger" | "neutral" }> = {
  portfoyde: { baslik: "📁 Portföyde", renk: "warning" },
  tahsile_verildi: { baslik: "🏦 Bankada Tahsilde", renk: "info" },
  teminata_verildi: { baslik: "🛡️ Bankada Teminatta", renk: "info" },
  ciro_edildi: { baslik: "↪️ Ciro Edildi", renk: "info" },
  tahsil_edildi: { baslik: "✅ Tahsil Edildi", renk: "success" },
  karsiliksiz: { baslik: "⛔ Karşılıksız", renk: "danger" },
  iade_edildi: { baslik: "↩️ İade Edildi", renk: "neutral" },
  verildi: { baslik: "📤 Verildi", renk: "warning" },
  odendi: { baslik: "✅ Ödendi", renk: "success" },
};

/** Yönüne göre açık (henüz sonuçlanmamış) durum ve seçilebilir eylemler. */
const YON_AKISI: Record<Yon, { acikDurum: string; durumlar: string[]; eylemler: { durum: string; baslik: string; vurgu?: "primary" | "danger" }[] }> = {
  alinan: {
    acikDurum: "portfoyde",
    durumlar: ["portfoyde", "tahsile_verildi", "teminata_verildi", "ciro_edildi", "tahsil_edildi", "karsiliksiz", "iade_edildi"],
    eylemler: [
      { durum: "tahsil_edildi", baslik: "Tahsil Et", vurgu: "primary" },
      { durum: "ciro_edildi", baslik: "Ciro Et" },
      { durum: "karsiliksiz", baslik: "Karşılıksız", vurgu: "danger" },
      { durum: "iade_edildi", baslik: "İade Et" },
    ],
  },
  verilen: {
    acikDurum: "verildi",
    durumlar: ["verildi", "odendi", "karsiliksiz", "iade_edildi"],
    eylemler: [
      { durum: "odendi", baslik: "Ödendi", vurgu: "primary" },
      { durum: "karsiliksiz", baslik: "Karşılıksız", vurgu: "danger" },
      { durum: "iade_edildi", baslik: "Geri Alındı" },
    ],
  },
};

function uygunEylemler(k:CekSenet) {
  if (k.yon === "verilen") return k.durum === "verildi" ? YON_AKISI.verilen.eylemler : [];
  if (k.durum === "portfoyde") return [
    { durum:"tahsil_edildi", baslik:"Tahsil et", vurgu:"primary" as const },
    { durum:"tahsile_verildi", baslik:"Bankaya ver" }, { durum:"teminata_verildi", baslik:"Teminata ver" },
    { durum:"ciro_edildi", baslik:"Ciro et" }, { durum:"karsiliksiz", baslik:"Karşılıksız", vurgu:"danger" as const }, { durum:"iade_edildi", baslik:"İade et" },
  ];
  if (["tahsile_verildi","teminata_verildi"].includes(k.durum)) return [
    { durum:"tahsil_edildi", baslik:"Tahsil et", vurgu:"primary" as const }, { durum:"portfoyde", baslik:"Portföye geri al" },
    { durum:"karsiliksiz", baslik:"Karşılıksız", vurgu:"danger" as const }, { durum:"iade_edildi", baslik:"İade et" },
  ];
  return [];
}

const para = (deger: string | number, doviz = "TRY"): string =>
  Number(deger).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " " + doviz;

const bugun = () => new Date().toISOString().slice(0, 10);

/** Vade günü dahil; saat farkını dışlamak için gün başına normalize edilir. */
function vadeyeKalanGun(vade: string): number {
  const v = new Date(vade.slice(0, 10) + "T00:00:00");
  const b = new Date(bugun() + "T00:00:00");
  return Math.round((v.getTime() - b.getTime()) / 86400000);
}

/* ─── Sayfa ──────────────────────────────────────────────────────────────── */

export default function CekSenetSayfasi() {
  const [kayitlar, setKayitlar] = useState<CekSenet[]>([]);
  const [cariler, setCariler] = useState<CariOzet[]>([]);
  const [kasalar, setKasalar] = useState<Hesap[]>([]);
  const [bankalar, setBankalar] = useState<Hesap[]>([]);
  const [yon, setYon] = useState<Yon>("alinan");
  const [tur, setTur] = useState<TurFiltre>("hepsi");
  const [durumFiltre, setDurumFiltre] = useState("");
  const [arama, setArama] = useState("");
  const [vadeBaslangic, setVadeBaslangic] = useState("");
  const [vadeBitis, setVadeBitis] = useState("");
  const [ozet, setOzet] = useState<PortfoyOzet|null>(null);
  const [detay, setDetay] = useState<CekSenet|null>(null);
  const [formAcik, setFormAcik] = useState(false);
  const [islemYapilan, setIslemYapilan] = useState<{ kayit: CekSenet; durum: string } | null>(null);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");

  const akis = YON_AKISI[yon];

  const yukle = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ yon });
      if (tur !== "hepsi") qs.set("tur", tur);
      if (durumFiltre) qs.set("durum", durumFiltre);
      if (arama.trim()) qs.set("arama", arama.trim());
      if (vadeBaslangic) qs.set("baslangic", vadeBaslangic);
      if (vadeBitis) qs.set("bitis", vadeBitis);
      const [liste, yeniOzet] = await Promise.all([api<CekSenet[]>(`/kasa-banka/cek-senet?${qs}`), api<PortfoyOzet>(`/kasa-banka/cek-senet-ozet?yon=${yon}`)]);
      setKayitlar(liste); setOzet(yeniOzet);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Çek/senet listesi yüklenemedi");
    }
  }, [tur, durumFiltre, yon, arama, vadeBaslangic, vadeBitis]);

  useEffect(() => {
    if (!tokenAl()) return;
    void yukle();
  }, [yukle]);

  useEffect(() => {
    if (!tokenAl()) return;
    void tumSayfalariAl<CariOzet>("/cari").then(setCariler).catch(() => {});
    void api<Hesap[]>("/kasa-banka/kasalar").then(setKasalar).catch(() => {});
    void api<Hesap[]>("/kasa-banka/bankalar").then(setBankalar).catch(() => {});
  }, []);

  async function detayAc(id:string){try{setDetay(await api<CekSenet>(`/kasa-banka/cek-senet/${id}`));}catch(h){setHata(h instanceof Error?h.message:"Detay yüklenemedi");}}

  async function durumGuncelle(govde: Record<string, unknown>) {
    if (!islemYapilan) return;
    setHata("");
    setBasari("");
    try {
      await api(`/kasa-banka/cek-senet/${islemYapilan.kayit.id}`, {
        method: "PATCH",
        body: JSON.stringify(govde),
      });
      setBasari(
        `${islemYapilan.kayit.portfoyNo} nolu ${islemYapilan.kayit.tur === "cek" ? "çek" : "senet"}: ` +
          `${DURUMLAR[islemYapilan.durum]?.baslik ?? islemYapilan.durum} olarak işlendi.`,
      );
      setIslemYapilan(null);
      await yukle();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Durum güncellenemedi");
    }
  }

  return (
    <div className="cheque-page">
      <section className="cheque-hero"><div><span>PORTFÖY & RİSK YÖNETİMİ</span><h1>Çek ve senet çalışma alanı</h1><p>{yon === "alinan" ? "Müşteri çeklerini yönetin, bankaya teslim süreçlerini takip edin ve tahsilat riskini görünür tutun." : "Verilen çek ve senetleri vade, lehtar ve ödeme riskiyle birlikte yönetin."}</p></div><div><ButtonLabel as="a" href="/panel/kasa-banka">← Kasa & Banka</ButtonLabel><Button variant="primary" onClick={() => setFormAcik(!formAcik)}>{formAcik ? "Vazgeç" : yon === "alinan" ? "+ Çek/Senet Al" : "+ Çek/Senet Ver"}</Button></div></section>

      <div className="cheque-switcher">
        <Segmented<Yon>
          value={yon}
          onChange={(y) => {
            setYon(y);
            setDurumFiltre("");
            setFormAcik(false);
            setIslemYapilan(null);
          }}
          items={[
            { deger: "alinan", baslik: "📥 Alınan (Müşteri Çeki)" },
            { deger: "verilen", baslik: "📤 Verilen (Kendi Çekimiz)" },
          ]}
        />
      </div>

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{basari}</Alert>

      <div className="cheque-kpis"><StatGrid>
        <Stat
          label={yon === "alinan" ? "Portföydeki" : "Tedavüldeki Borç"}
          value={para(ozet?.acik.toplamTry??0)}
          tone="accent"
          hint={`${ozet?.acik.adet??0} adet · ${(ozet?.acik.dovizler.TRY??"0")} TRY · ${(ozet?.acik.dovizler.USD??"0")} USD · ${(ozet?.acik.dovizler.EUR??"0")} EUR`}
        />
        <Stat
          label="Vadesi Geçmiş"
          value={para(ozet?.geciken.toplamTry??0)}
          tone={(ozet?.geciken.adet??0) > 0 ? "danger" : "default"}
          hint={`${ozet?.geciken.adet??0} adet`}
        />
        <Stat
          label="30 Gün İçinde"
          value={para(ozet?.yaklasan.toplamTry??0)}
          tone={(ozet?.yaklasan.adet??0) > 0 ? "info" : "default"}
          hint={yon === "alinan" ? `${ozet?.yaklasan.adet??0} adet vadesi yaklaşan` : `${ozet?.yaklasan.adet??0} adet ödenecek`}
        />
        <Stat label={yon==="alinan"?"Bankada / Teminatta":"Karşılıksız"} value={para(yon==="alinan"?(ozet?.bankada.toplamTry??0):(ozet?.karsiliksiz.toplamTry??0))} tone="info" hint={`${yon==="alinan"?(ozet?.bankada.adet??0):(ozet?.karsiliksiz.adet??0)} adet`}/>
      </StatGrid></div>

      {formAcik && (
        <CekSenetFormu
          key={yon}
          yon={yon}
          cariler={cariler}
          onKaydet={async (govde) => {
            setHata("");
            setBasari("");
            try {
              await api("/kasa-banka/cek-senet", { method: "POST", body: JSON.stringify({ ...govde, yon }) });
              setBasari(yon === "alinan" ? "Çek/senet portföye eklendi." : "Verilen çek/senet kaydedildi.");
              setFormAcik(false);
              await yukle();
              return true;
            } catch (h) {
              setHata(h instanceof Error ? h.message : "Kayıt başarısız");
              return false;
            }
          }}
        />
      )}

      <Card className="cheque-filter"><div className="cheque-filter__head"><div><span>OPERASYON FİLTRELERİ</span><strong>Portföy görünümünü daraltın</strong></div><small>{kayitlar.length} kayıt gösteriliyor</small></div><div className="cheque-filter__grid">
        <Input aria-label="Çek senet ara" value={arama} onChange={(e)=>setArama(e.target.value)} placeholder="Portföy, çek no, cari, keşideci veya banka ara…" style={{minWidth:280}}/>
        <Segmented<TurFiltre>
          value={tur}
          onChange={setTur}
          items={[
            { deger: "hepsi", baslik: "Tümü" },
            { deger: "cek", baslik: "Çekler" },
            { deger: "senet", baslik: "Senetler" },
          ]}
        />
        <Select value={durumFiltre} onChange={(e) => setDurumFiltre(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Tüm durumlar</option>
          {akis.durumlar.map((deger) => (
            <option key={deger} value={deger}>
              {DURUMLAR[deger]?.baslik ?? deger}
            </option>
          ))}
        </Select>
        <Input aria-label="Vade başlangıcı" type="date" value={vadeBaslangic} onChange={(e)=>setVadeBaslangic(e.target.value)} title="Vade başlangıcı"/>
        <Input aria-label="Vade bitişi" type="date" value={vadeBitis} onChange={(e)=>setVadeBitis(e.target.value)} title="Vade bitişi"/>
        {(arama||durumFiltre||vadeBaslangic||vadeBitis)&&<Button size="sm" onClick={()=>{setArama("");setDurumFiltre("");setVadeBaslangic("");setVadeBitis("");}}>Filtreleri temizle</Button>}
      </div></Card>

      <Card className="cheque-register" pad={false}>
        <TableWrap>
          <thead>
            <tr>
              <th>Portföy / Çek No</th>
              <th>Tür</th>
              <th>{yon === "alinan" ? "Borçlu" : "Lehtar"}</th>
              <th>Vade</th>
              <th className="num">Tutar</th>
              <th>Durum</th>
              <th className="center">Eylemler</th>
            </tr>
          </thead>
          <tbody>
            {kayitlar.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  Filtreye uyan çek/senet bulunamadı.
                </td>
              </tr>
            ) : (
              kayitlar.map((k) => {
                const kalan = vadeyeKalanGun(k.vadeTarihi);
                const eylemler = uygunEylemler(k);
                const acik = eylemler.length > 0;
                const gecikti = acik && kalan < 0;
                return (
                  <tr key={k.id}>
                    <td><div className="mono">{k.portfoyNo}</div>{k.cekNo && <div className="cell-entity__meta">Çek no: {k.cekNo}</div>}<div className="cell-entity__meta">İşlem: {k.islemTarihi.slice(0, 10)}</div></td>
                    <td>
                      <Badge variant={k.tur === "cek" ? "info" : "neutral"}>
                        {k.tur === "cek" ? "🧾 Çek" : "📜 Senet"}
                      </Badge>
                    </td>
                    <td>
                      {yon === "alinan" ? (
                        <>
                          <div className="cell-entity__name">{k.borclu}</div>
                          {k.cari && <div className="cell-entity__meta">{k.cari.unvan}</div>}
                          {k.ciroCari && <div className="cell-entity__meta">Ciro: {k.ciroCari.unvan}</div>}
                          {k.fizikselKonum && <div className="cell-entity__meta">Konum: {k.fizikselKonum}</div>}
                        </>
                      ) : (
                        <>
                          <div className="cell-entity__name">{k.cari?.unvan ?? "—"}</div>
                          <div className="cell-entity__meta">Keşideci: {k.borclu}</div>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="mono">{k.vadeTarihi.slice(0, 10)}</div>
                      {acik && (
                        <div
                          className="cell-entity__meta"
                          style={{ color: gecikti ? "var(--danger)" : undefined }}
                        >
                          {gecikti
                            ? `${Math.abs(kalan)} gün gecikti`
                            : kalan === 0
                              ? "Bugün"
                              : `${kalan} gün kaldı`}
                        </div>
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {para(k.tutar, k.dovizCinsi)}
                      {k.dovizCinsi !== "TRY" && (
                        <div className="cell-entity__meta">≈ {para(k.tutarTry)}</div>
                      )}
                    </td>
                    <td>
                      <Badge variant={DURUMLAR[k.durum]?.renk ?? "neutral"}>
                        {DURUMLAR[k.durum]?.baslik ?? k.durum}
                      </Badge>
                    </td>
                    <td className="center">
                      {acik ? (
                        <div className="row-tight" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                          {eylemler.map((e) => (
                            <Button
                              key={e.durum}
                              size="sm"
                              variant={e.vurgu}
                              onClick={() => setIslemYapilan({ kayit: k, durum: e.durum })}
                            >
                              {e.baslik}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <Button size="sm" onClick={()=>void detayAc(k.id)}>Detay</Button>
                      )}
                      {acik&&<Button size="sm" onClick={()=>void detayAc(k.id)}>Geçmiş</Button>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {detay&&<Card className="stack" style={{marginTop:"1.5rem",borderColor:"var(--accent)"}}>
        <div className="between"><div><div className="card__title" style={{margin:0}}>{detay.portfoyNo} · İşlem geçmişi</div><p className="muted" style={{margin:".35rem 0 0"}}>{detay.cari?.unvan??detay.borclu} · {para(detay.tutar,detay.dovizCinsi)} · {detay.fizikselKonum??"Konum belirtilmedi"}</p></div><Button size="sm" onClick={()=>setDetay(null)}>Kapat</Button></div>
        <div className="stack" style={{gap:".65rem"}}>{detay.olaylar?.map(o=><div key={o.id} className="between" style={{padding:".8rem 1rem",border:"1px solid var(--border)",borderRadius:"10px"}}><div><strong>{DURUMLAR[o.yeniDurum]?.baslik??o.yeniDurum}</strong><div className="muted" style={{fontSize:".82rem"}}>{o.oncekiDurum?`${DURUMLAR[o.oncekiDurum]?.baslik??o.oncekiDurum} durumundan geçildi`:"Başlangıç kaydı"}{o.aciklama?` · ${o.aciklama}`:""}</div></div><span className="mono">{new Date(o.createdAt).toLocaleString("tr-TR")}</span></div>)}{!detay.olaylar?.length&&<p className="empty">İşlem geçmişi bulunamadı.</p>}</div>
      </Card>}

      {islemYapilan && (
        <DurumKarti
          kayit={islemYapilan.kayit}
          durum={islemYapilan.durum}
          cariler={cariler}
          kasalar={kasalar}
          bankalar={bankalar}
          onVazgec={() => setIslemYapilan(null)}
          onOnayla={durumGuncelle}
        />
      )}
    </div>
  );
}

/* ─── Giriş formu ────────────────────────────────────────────────────────── */

function CekSenetFormu({
  yon,
  cariler,
  onKaydet,
}: {
  yon: Yon;
  cariler: CariOzet[];
  onKaydet: (govde: Record<string, unknown>) => Promise<boolean>;
}) {
  const verilen = yon === "verilen";
  const [tur, setTur] = useState<"cek" | "senet">("cek");
  const [portfoyNo, setPortfoyNo] = useState("");
  const [cekNo, setCekNo] = useState("");
  const [islemTarihi, setIslemTarihi] = useState(bugun());
  const [vadeTarihi, setVadeTarihi] = useState(bugun());
  const [tutar, setTutar] = useState("");
  const [dovizCinsi, setDovizCinsi] = useState("TRY");
  const [kur, setKur] = useState("1");
  const [borclu, setBorclu] = useState("");
  const [kesideYeri, setKesideYeri] = useState("");
  const [banka, setBanka] = useState("");
  const [sube, setSube] = useState("");
  const [hesapNo, setHesapNo] = useState("");
  const [cariId, setCariId] = useState("");
  const [aciklama, setAciklama] = useState("");

  const bosNull = (d: string) => (d.trim() === "" ? null : d.trim());

  async function kaydet() {
    const ok = await onKaydet({
      tur,
      portfoyNo: portfoyNo.trim(),
      cekNo: tur === "cek" ? bosNull(cekNo) : null,
      islemTarihi,
      vadeTarihi,
      tutar,
      dovizCinsi,
      kur: dovizCinsi === "TRY" ? "1" : kur || "1",
      borclu: borclu.trim(),
      kesideYeri: bosNull(kesideYeri),
      banka: bosNull(banka),
      sube: bosNull(sube),
      hesapNo: bosNull(hesapNo),
      cariId: cariId === "" ? null : cariId,
      aciklama: bosNull(aciklama),
    });
    if (ok) {
      setPortfoyNo("");
      setCekNo("");
      setTutar("");
      setBorclu("");
      setKesideYeri("");
      setBanka("");
      setSube("");
      setHesapNo("");
      setCariId("");
      setAciklama("");
    }
  }

  return (
    <Card className="stack" style={{ marginTop: "1.25rem" }}>
      <div className="card__title">{verilen ? "Verilen Çek/Senet" : "Alınan Çek/Senet"}</div>

      <div className="row">
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Tür *">
            <Select value={tur} onChange={(e) => setTur(e.target.value as "cek" | "senet")}>
              <option value="cek">🧾 Çek</option>
              <option value="senet">📜 Senet</option>
            </Select>
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Portföy No *">
            <Input value={portfoyNo} onChange={(e) => setPortfoyNo(e.target.value)} placeholder="CK-2026-001" />
          </Field>
        </div>
        {tur === "cek" && <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Çek Numarası *">
            <Input value={cekNo} onChange={(e) => setCekNo(e.target.value)} placeholder="Çek üzerindeki seri/no" />
          </Field>
        </div>}
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label={verilen ? "Veriliş Tarihi *" : "Alınış Tarihi *"}>
            <Input type="date" value={islemTarihi} onChange={(e) => setIslemTarihi(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Vade Tarihi *">
            <Input type="date" value={vadeTarihi} onChange={(e) => setVadeTarihi(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Tutar *">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={tutar}
              onChange={(e) => setTutar(e.target.value)}
              placeholder="0,00"
            />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 110 }}>
          <Field label="Döviz">
            <Select value={dovizCinsi} onChange={(e) => setDovizCinsi(e.target.value)}>
              <option value="TRY">TRY</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </Select>
          </Field>
        </div>
        {dovizCinsi !== "TRY" && (
          <div style={{ flex: 1, minWidth: 130 }}>
            <Field label="Kur *">
              <Input type="number" step="0.000001" min="0" value={kur} onChange={(e) => setKur(e.target.value)} />
            </Field>
          </div>
        )}
      </div>

      <div className="row">
        <div style={{ flex: 2, minWidth: 220 }}>
          <Field label={verilen ? "Keşideci *" : "Borçlu (keşideci) *"}>
            <Input
              value={borclu}
              onChange={(e) => setBorclu(e.target.value)}
              placeholder={verilen ? "Kendi firmanız" : "Çeki keşide eden kişi/firma"}
            />
          </Field>
        </div>
        <div style={{ flex: 2, minWidth: 220 }}>
          <Field label={verilen ? "Lehtar (kime verildi) *" : "İlgili Cari"}>
            <AramaSecici ariaLabel={verilen ? "Lehtar (kime verildi)" : "İlgili Cari"} deger={cariId} onChange={setCariId} placeholder={verilen ? "Cari ara ve seç…" : "Cari bağlantısı ara…"} secenekler={cariler.map((c) => ({ deger: c.id, baslik: c.unvan, aciklama: c.kod, aramaMetni: `${c.kod} ${c.unvan}` }))} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <Field label="Keşide Yeri">
            <Input value={kesideYeri} onChange={(e) => setKesideYeri(e.target.value)} placeholder="İstanbul" />
          </Field>
        </div>
      </div>

      {cariId && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          {verilen ? (
            <>
              Lehtara çek/senet tutarı kadar <strong>borç</strong> kaydı yazılır (ona olan borcunuz azalır).
              Para, çek ödendiğinde hesabınızdan çıkar.
            </>
          ) : (
            <>
              Seçili cariye çek/senet tutarı kadar <strong>alacak</strong> kaydı yazılır (borcu azalır).
            </>
          )}
        </p>
      )}

      {tur === "cek" && (
        <div className="row">
          <div style={{ flex: 1, minWidth: 170 }}>
            <Field label="Banka">
              <Input value={banka} onChange={(e) => setBanka(e.target.value)} placeholder="Örn. Ziraat Bankası" />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Field label="Şube">
              <Input value={sube} onChange={(e) => setSube(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Field label="Hesap No">
              <Input value={hesapNo} onChange={(e) => setHesapNo(e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      <Field label="Açıklama">
        <Input value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
      </Field>

      <div>
        <Button
          variant="primary"
          onClick={kaydet}
          disabled={
            portfoyNo.trim() === "" ||
            (tur === "cek" && cekNo.trim() === "") ||
            !islemTarihi ||
            borclu.trim().length < 2 ||
            !tutar ||
            Number(tutar) <= 0 ||
            (verilen && cariId === "")
          }
        >
          {verilen ? "Kaydet" : "Portföye Ekle"}
        </Button>
      </div>
    </Card>
  );
}

/* ─── Durum işlem kartı ──────────────────────────────────────────────────── */

function DurumKarti({
  kayit,
  durum,
  cariler,
  kasalar,
  bankalar,
  onVazgec,
  onOnayla,
}: {
  kayit: CekSenet;
  durum: string;
  cariler: CariOzet[];
  kasalar: Hesap[];
  bankalar: Hesap[];
  onVazgec: () => void;
  onOnayla: (govde: Record<string, unknown>) => void;
}) {
  const [ciroCariId, setCiroCariId] = useState("");
  const [hesap, setHesap] = useState("");
  const [islemTarihi, setIslemTarihi] = useState(bugun());
  const [aciklama, setAciklama] = useState("");
  const [fizikselKonum, setFizikselKonum] = useState("");

  const tahsil = durum === "tahsil_edildi";
  const odeme = durum === "odendi";
  const paraHareketi = tahsil || odeme;
  const ciro = durum === "ciro_edildi";

  // Karışık para birimi engellendiği için yalnız aynı dövizli hesaplar seçilebilir
  const uygunKasalar = kasalar.filter((k) => k.dovizCinsi === kayit.dovizCinsi);
  const uygunBankalar = bankalar.filter((b) => b.dovizCinsi === kayit.dovizCinsi);

  function onayla() {
    const govde: Record<string, unknown> = { durum };
    if (aciklama.trim() !== "") govde.aciklama = aciklama.trim();
    if (ciro) govde.ciroCariId = ciroCariId;
    if (fizikselKonum.trim()) govde.fizikselKonum = fizikselKonum.trim();
    if (paraHareketi) {
      const [tip, id] = hesap.split(":");
      if (tip === "kasa") govde.hesapKasaId = id;
      else govde.hesapBankaHesapId = id;
      govde.islemTarihi = islemTarihi;
    }
    onOnayla(govde);
  }

  const gerekceZorunlu = ["karsiliksiz","iade_edildi"].includes(durum);
  const konumZorunlu = ["tahsile_verildi","teminata_verildi"].includes(durum);
  const gecerli = (ciro ? ciroCariId !== "" : paraHareketi ? hesap !== "" : true) && (!gerekceZorunlu||aciklama.trim().length>=3) && (!konumZorunlu||fizikselKonum.trim().length>=2);

  return (
    <Card className="stack" style={{ marginTop: "1.5rem", borderColor: "var(--accent)" }}>
      <div className="between">
        <div className="card__title" style={{ margin: 0 }}>
          {DURUMLAR[durum]?.baslik ?? durum} — {kayit.portfoyNo}
        </div>
        <Button size="sm" onClick={onVazgec}>
          ✖ Vazgeç
        </Button>
      </div>

      <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
        {kayit.borclu} · vade {kayit.vadeTarihi.slice(0, 10)} · <strong>{para(kayit.tutar, kayit.dovizCinsi)}</strong>
      </p>

      {ciro && (
        <>
          <Field label="Ciro Edilen Cari *">
            <AramaSecici ariaLabel="Ciro Edilen Cari" deger={ciroCariId} onChange={setCiroCariId} placeholder="Cari ara ve seç…" secenekler={cariler.map((c) => ({ deger: c.id, baslik: c.unvan, aciklama: c.kod, aramaMetni: `${c.kod} ${c.unvan}` }))} />
          </Field>
          <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
            Ciro edilen cariye tutar kadar <strong>alacak</strong> yazılır (ona olan borcumuz azalır).
          </p>
        </>
      )}

      {paraHareketi && (
        <>
          <div className="row">
            <div style={{ flex: 2, minWidth: 220 }}>
              <Field label={odeme ? "Paranın Çıkacağı Hesap *" : "Paranın Gireceği Hesap *"}>
                <Select value={hesap} onChange={(e) => setHesap(e.target.value)}>
                  <option value="">— Kasa ya da banka seçin —</option>
                  {uygunKasalar.map((k) => (
                    <option key={k.id} value={`kasa:${k.id}`}>
                      💵 {k.ad} ({k.dovizCinsi})
                    </option>
                  ))}
                  {uygunBankalar.map((b) => (
                    <option key={b.id} value={`banka:${b.id}`}>
                      🏦 {b.ad} ({b.dovizCinsi})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <Field label={odeme ? "Ödeme Tarihi" : "Tahsil Tarihi"}>
                <Input type="date" value={islemTarihi} onChange={(e) => setIslemTarihi(e.target.value)} />
              </Field>
            </div>
          </div>
          {uygunKasalar.length + uygunBankalar.length === 0 && (
            <Alert tone="error">
              {kayit.dovizCinsi} cinsinden tanımlı kasa/banka hesabı yok. İşlem için önce Kasa &amp; Banka
              ekranından {kayit.dovizCinsi} hesabı açmalısınız.
            </Alert>
          )}
          <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
            {odeme ? (
              <>
                Seçilen hesaptan <strong>{para(kayit.tutar, kayit.dovizCinsi)}</strong> tutarında tediye fişi
                çıkar. Lehtar, çek verilirken zaten borçlandırıldığı için yeniden cari hareketi oluşturulmaz.
              </>
            ) : (
              <>
                Seçilen hesaba <strong>{para(kayit.tutar, kayit.dovizCinsi)}</strong> tutarında tahsilat fişi
                yazılır.
                {kayit.cari ? " Cari, çek alımında zaten alacaklandırıldığı için yeniden cari hareketi oluşturulmaz." : ""}
              </>
            )}
          </p>
        </>
      )}

      {konumZorunlu&&<Field label={durum==="tahsile_verildi"?"Tahsil bankası / konumu *":"Teminat bankası / konumu *"}><Input value={fizikselKonum} onChange={(e)=>setFizikselKonum(e.target.value)} placeholder="Örn. Ziraat Bankası Kadıköy Şubesi"/></Field>}

      {durum === "karsiliksiz" && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          {kayit.yon === "verilen" ? (
            <>
              Karşılıksız kalan kendi çekiniz takipten düşer; para hareketi oluşmaz. Borcunuz devam ediyorsa
              cari hareketi elle girilmelidir.
            </>
          ) : (
            <>
              Karşılıksız işaretlenen çek/senet portföyden düşer; para hareketi oluşmaz. Borçludan tahsilat için
              cari hareketi elle girilmelidir.
            </>
          )}
        </p>
      )}

      {durum === "iade_edildi" && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          {kayit.yon === "verilen"
            ? "Geri alınan çek/senet takipten düşer; para hareketi oluşmaz."
            : "İade edilen çek/senet portföyden düşer; para hareketi oluşmaz."}
        </p>
      )}

      <Field label={gerekceZorunlu?"İşlem gerekçesi *":"Açıklama"}>
        <Input
          value={aciklama}
          onChange={(e) => setAciklama(e.target.value)}
          placeholder="İsteğe bağlı not"
        />
      </Field>

      <div>
        <Button variant="primary" onClick={onayla} disabled={!gecerli}>
          Onayla
        </Button>
      </div>
    </Card>
  );
}
