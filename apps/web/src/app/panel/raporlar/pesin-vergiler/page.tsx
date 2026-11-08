"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAdresDurumu } from "@/lib/adres-durumu";
import { Alert, Badge, BulkActionsBar, Button, Card, Field, Input, Modal, ModalEylem, Para, PageHeader, Segmented, Select, Stat, StatGrid, TableSkeleton, TableWrap, Tarih } from "@/components/ui";

/** GLR-06: bizden kesilen stopajın toplu izlenmesi ve beyannamede mahsup işareti. */
interface Mahsup { id: string; beyannameTuru: string; yil: number; donem: number | null; not: string | null }
interface Satir {
  kaynakTur: "gelir" | "fatura" | "pazaryeri"; kaynakAdi: string; kaynakId: string; tarih: string; belgeNo: string | null; cari: string | null; tur: string;
  matrah: string | null; oran: string | null; tutar: string; dovizCinsi: string; tutarTry: string; yol: string; mahsup: Mahsup | null;
}
interface Kirilim { baslik: string; adet: number; tutarTry: string }
interface Beyan { beyannameTuru: string; yil: number; donem: number | null; adet: number; tutarTry: string }
interface Kopuk { id: string; etiket: string; belgeTarihi: string; tutarTry: string; neden: "kaynak_yok" | "tutar_degisti"; guncelTutarTry: string | null }
interface Yanit {
  satirlar: Satir[];
  ozet: { donemToplamTry: string; mahsupEdilenTry: string; mahsupEdilecekTry: string; bakiyeTry: string };
  kaynakKirilimi: Kirilim[]; turKirilimi: Kirilim[]; beyanlar: Beyan[]; kopuklar: Kopuk[];
  bekleyenPazaryeri: { adet: number; tutarlar: Record<string, string> };
}

type DonemTuru = "ay" | "ceyrek" | "yil";
type DurumSuzgeci = "hepsi" | "edilecek" | "edildi";

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const anahtar = (s: Satir) => `${s.kaynakTur}:${s.kaynakId}`;
const ikiHane = (n: number) => String(n).padStart(2, "0");

function donemAraligi(tur: DonemTuru, yil: number, parca: number) {
  const son = (ay: number) => new Date(Date.UTC(yil, ay, 0)).getUTCDate();
  if (tur === "yil") return { baslangic: `${yil}-01-01`, bitis: `${yil}-12-31` };
  if (tur === "ceyrek") {
    const sonAy = parca * 3;
    return { baslangic: `${yil}-${ikiHane(sonAy - 2)}-01`, bitis: `${yil}-${ikiHane(sonAy)}-${son(sonAy)}` };
  }
  return { baslangic: `${yil}-${ikiHane(parca)}-01`, bitis: `${yil}-${ikiHane(parca)}-${son(parca)}` };
}

const beyanMetni = (b: { beyannameTuru: string; yil: number; donem: number | null }) =>
  b.beyannameTuru === "yillik" ? `${b.yil} yıllık beyanname` : `${b.yil} / ${b.donem}. dönem geçici vergi`;

function KirilimTablosu({ baslik, satirlar }: { baslik: string; satirlar: Kirilim[] }) {
  return (
    <Card pad={false} title={baslik}>
      <TableWrap>
        <table className="table table--fit">
          <thead><tr><th>Başlık</th><th className="num">Kayıt</th><th className="num">Stopaj (TL)</th></tr></thead>
          <tbody>
            {satirlar.map((k) => <tr key={k.baslik}><td>{k.baslik}</td><td className="num">{k.adet}</td><td className="num"><Para deger={k.tutarTry} /></td></tr>)}
            {!satirlar.length && <tr><td colSpan={3} className="muted">Bu dönemde kayıt yok.</td></tr>}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

export default function PesinVergilerSayfasi() {
  const simdi = new Date();
  const buYil = simdi.getFullYear();
  const [adres, adresGuncelle, adresHazir] = useAdresDurumu({ tur: "yil", yil: String(buYil), parca: "1" });
  const tur = (["ay", "ceyrek", "yil"].includes(adres.tur) ? adres.tur : "yil") as DonemTuru;
  const yil = Number(adres.yil) || buYil;
  const parca = Number(adres.parca) || 1;
  const { baslangic, bitis } = donemAraligi(tur, yil, parca);

  const [veri, setVeri] = useState<Yanit | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [bilgi, setBilgi] = useState("");
  const [durum, setDurum] = useState<DurumSuzgeci>("hepsi");
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [formAcik, setFormAcik] = useState(false);
  const [isleniyor, setIsleniyor] = useState(false);
  const [beyannameTuru, setBeyannameTuru] = useState<"gecici_vergi" | "yillik">("gecici_vergi");
  const [beyanYili, setBeyanYili] = useState(String(buYil));
  const [beyanDonemi, setBeyanDonemi] = useState("1");
  const [not, setNot] = useState("");

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata("");
    try {
      setVeri(await api<Yanit>(`/rapor/pesin-vergiler?${new URLSearchParams({ baslangic, bitis })}`));
      setSecili(new Set());
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Peşin ödenen vergiler yüklenemedi");
    } finally {
      setYukleniyor(false);
    }
  }, [baslangic, bitis]);

  useEffect(() => { if (adresHazir) void yukle(); }, [yukle, adresHazir]);

  const gorunen = useMemo(() => (veri?.satirlar ?? []).filter((s) => durum === "hepsi" || (durum === "edildi") === Boolean(s.mahsup)), [veri, durum]);
  const seciliSatirlar = gorunen.filter((s) => secili.has(anahtar(s)));
  const seciliEdilecek = seciliSatirlar.filter((s) => !s.mahsup);
  const seciliEdilen = seciliSatirlar.filter((s) => s.mahsup);
  const seciliToplam = seciliEdilecek.reduce((t, s) => t + Number(s.tutarTry), 0);
  const hepsiSecili = gorunen.length > 0 && seciliSatirlar.length === gorunen.length;

  const degistir = (k: string) => setSecili((o) => { const y = new Set(o); if (y.has(k)) y.delete(k); else y.add(k); return y; });

  async function mahsupEt(e: FormEvent) {
    e.preventDefault();
    setIsleniyor(true);
    setHata("");
    try {
      const r = await api<{ isaretlenen: number }>("/rapor/pesin-vergiler/mahsup", {
        method: "POST",
        body: JSON.stringify({
          kalemler: seciliEdilecek.map((s) => ({ kaynakTur: s.kaynakTur, kaynakId: s.kaynakId })),
          beyannameTuru, yil: Number(beyanYili), donem: beyannameTuru === "gecici_vergi" ? Number(beyanDonemi) : null, not: not.trim() || undefined,
        }),
      });
      setBilgi(`${r.isaretlenen} kayıt mahsup edildi olarak işaretlendi.`);
      setFormAcik(false);
      setNot("");
      await yukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Mahsup işareti kaydedilemedi");
      setFormAcik(false);
    } finally {
      setIsleniyor(false);
    }
  }

  async function geriAl(mahsupIdleri: string[]) {
    setIsleniyor(true);
    setHata("");
    try {
      const r = await api<{ geriAlinan: number }>("/rapor/pesin-vergiler/mahsup/geri-al", { method: "POST", body: JSON.stringify({ mahsupIdleri }) });
      setBilgi(`${r.geriAlinan} kaydın mahsup işareti kaldırıldı.`);
      await yukle();
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Mahsup işareti kaldırılamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  const bekleyen = veri?.bekleyenPazaryeri;
  const yillar = [buYil, buYil - 1, buYil - 2, buYil - 3];

  return (
    <div>
      <PageHeader
        title="Peşin Ödenen Vergiler ve Fonlar"
        subtitle="Bizden kesilen stopaj: faaliyet dışı gelirler, satış faturaları ve kaydedilmiş pazaryeri stopajı. Tutarlar belge kuruyla TL. İşaretleme kayıt üretmez, muhasebe fişini (193) değiştirmez."
      />

      <Alert tone="error">{hata}</Alert>
      <Alert tone="success">{bilgi}</Alert>
      {!!bekleyen?.adet && (
        <Alert tone="warning">
          Bu dönemde kaydedilmeyi bekleyen {bekleyen.adet} pazaryeri stopajı var ({Object.entries(bekleyen.tutarlar).map(([d, v]) => `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${d}`).join(" · ")}). Kaydedilene kadar bu ekrana ve 193 hesabına girmez. <Link href="/panel/pazaryeri/kesintiler">Pazaryeri kesintilerini aç →</Link>
        </Alert>
      )}

      <Card style={{ marginBottom: "1rem" }}>
        <div className="row-tight" style={{ flexWrap: "wrap", alignItems: "flex-end", gap: "0.75rem" }}>
          <Segmented<DonemTuru>
            ariaLabel="Dönem türü"
            value={tur}
            onChange={(v) => adresGuncelle({ tur: v, parca: "1" })}
            items={[{ deger: "ay", baslik: "Ay" }, { deger: "ceyrek", baslik: "Çeyrek" }, { deger: "yil", baslik: "Yıl" }]}
          />
          <Field label="Yıl" htmlFor="pv-yil">
            <Select id="pv-yil" value={String(yil)} onChange={(e) => adresGuncelle({ yil: e.target.value })}>
              {yillar.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </Field>
          {tur === "ay" && (
            <Field label="Ay" htmlFor="pv-ay">
              <Select id="pv-ay" value={String(parca)} onChange={(e) => adresGuncelle({ parca: e.target.value })}>
                {AYLAR.map((a, i) => <option key={a} value={i + 1}>{a}</option>)}
              </Select>
            </Field>
          )}
          {tur === "ceyrek" && (
            <Field label="Çeyrek" htmlFor="pv-ceyrek">
              <Select id="pv-ceyrek" value={String(Math.min(parca, 4))} onChange={(e) => adresGuncelle({ parca: e.target.value })}>
                {[1, 2, 3, 4].map((c) => <option key={c} value={c}>{c}. çeyrek</option>)}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      {veri && (
        <StatGrid>
          <Stat label="Dönemde kesilen" value={<Para deger={veri.ozet.donemToplamTry} />} />
          <Stat label="Mahsup edildi" value={<Para deger={veri.ozet.mahsupEdilenTry} />} hint="Bu dönemin kayıtlarından" />
          <Stat label="Mahsup edilecek" value={<Para deger={veri.ozet.mahsupEdilecekTry} />} hint="Bu dönemin kayıtlarından" />
          <Stat label="Mahsup edilecek bakiye" value={<Para deger={veri.ozet.bakiyeTry} />} hint="Dönem sonuna kadar bütün kayıtlar" tone="accent" />
        </StatGrid>
      )}

      {!!veri?.kopuklar.length && (
        <div style={{ marginTop: "1rem" }}>
          <Alert tone="warning">Mahsup edildi işaretli {veri.kopuklar.length} kaydın kaynağı sonradan değişti. Beyanname tutarını kontrol edin, gerekiyorsa işareti kaldırın.</Alert>
          <Card pad={false} title="Kaynağı değişen mahsup işaretleri">
            <TableWrap>
              <thead><tr><th>Belge tarihi</th><th>Kayıt</th><th>Durum</th><th className="num">İşaretli tutar (TL)</th><th>İşlem</th></tr></thead>
              <tbody>
                {veri.kopuklar.map((k) => (
                  <tr key={k.id}>
                    <td><Tarih deger={k.belgeTarihi} /></td>
                    <td>{k.etiket}</td>
                    <td>{k.neden === "kaynak_yok" ? "Kaynak iptal edildi ya da geri alındı" : <>Tutar değişti, güncel: <Para deger={k.guncelTutarTry ?? "0"} /></>}</td>
                    <td className="num"><Para deger={k.tutarTry} /></td>
                    <td><Button size="sm" disabled={isleniyor} onClick={() => void geriAl([k.id])}>İşareti kaldır</Button></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </div>
      )}

      {veri && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "1rem", margin: "1rem 0" }}>
          <KirilimTablosu baslik="Kaynağa göre" satirlar={veri.kaynakKirilimi} />
          <KirilimTablosu baslik="Türe göre" satirlar={veri.turKirilimi} />
        </div>
      )}

      <div style={{ marginBottom: "0.75rem" }}>
        <Segmented<DurumSuzgeci>
          ariaLabel="Mahsup durumu"
          value={durum}
          onChange={(v) => { setDurum(v); setSecili(new Set()); }}
          items={[{ deger: "hepsi", baslik: "Hepsi" }, { deger: "edilecek", baslik: "Mahsup edilecek" }, { deger: "edildi", baslik: "Mahsup edildi" }]}
        />
      </div>

      <BulkActionsBar selectedCount={seciliSatirlar.length} onClear={() => setSecili(new Set())}>
        {seciliEdilecek.length > 0 && <Button size="sm" variant="primary" disabled={isleniyor} onClick={() => setFormAcik(true)}>Mahsup edildi işaretle</Button>}
        {seciliEdilen.length > 0 && <Button size="sm" disabled={isleniyor} onClick={() => void geriAl(seciliEdilen.map((s) => s.mahsup!.id))}>İşareti kaldır</Button>}
      </BulkActionsBar>

      <Card pad={false} title="Kayıtlar">
        {yukleniyor && !veri ? <TableSkeleton rows={5} cols={8} /> : (
          <TableWrap>
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Tümünü seç" checked={hepsiSecili} onChange={() => setSecili(hepsiSecili ? new Set() : new Set(gorunen.map(anahtar)))} /></th>
                <th>Tarih</th><th>Kaynak</th><th>Belge</th><th>Cari</th><th>Tür</th><th className="num">Matrah</th><th className="num">Oran</th><th className="num">Stopaj</th><th className="num">Stopaj (TL)</th><th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {gorunen.map((s) => (
                <tr key={anahtar(s)}>
                  <td><input type="checkbox" aria-label={`${s.belgeNo ?? s.tur} seç`} checked={secili.has(anahtar(s))} onChange={() => degistir(anahtar(s))} /></td>
                  <td><Tarih deger={s.tarih} /></td>
                  <td>{s.kaynakAdi}</td>
                  <td style={{ whiteSpace: "nowrap" }}><Link href={s.yol}>{s.belgeNo ?? "Kaydı aç"}</Link></td>
                  <td>{s.cari ?? "—"}</td>
                  <td>{s.tur}</td>
                  <td className="num">{s.matrah ? <Para deger={s.matrah} dovizCinsi={s.dovizCinsi} /> : "—"}</td>
                  <td className="num">{s.oran ? `%${Number(s.oran).toLocaleString("tr-TR")}` : "—"}</td>
                  <td className="num"><Para deger={s.tutar} dovizCinsi={s.dovizCinsi} /></td>
                  <td className="num"><Para deger={s.tutarTry} /></td>
                  <td>
                    {s.mahsup ? <Badge variant="success">Mahsup edildi</Badge> : <Badge variant="warning">Mahsup edilecek</Badge>}
                    {s.mahsup && <div className="cell-entity__meta">{beyanMetni(s.mahsup)}{s.mahsup.not ? ` · ${s.mahsup.not}` : ""}</div>}
                  </td>
                </tr>
              ))}
              {!gorunen.length && <tr><td colSpan={11} className="muted">Bu seçimde kayıt yok.</td></tr>}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {!!veri?.beyanlar.length && (
        <div style={{ marginTop: "1rem" }}>
          <Card pad={false} title="Beyannamelere göre mahsup edilenler">
            <TableWrap>
              <thead><tr><th>Beyanname</th><th className="num">Kayıt</th><th className="num">Tutar (TL)</th></tr></thead>
              <tbody>{veri.beyanlar.map((b) => <tr key={beyanMetni(b)}><td>{beyanMetni(b)}</td><td className="num">{b.adet}</td><td className="num"><Para deger={b.tutarTry} /></td></tr>)}</tbody>
            </TableWrap>
          </Card>
        </div>
      )}

      {formAcik && (
        <Modal baslik="Mahsup edildi işaretle" aciklama={`${seciliEdilecek.length} kayıt, toplam ${seciliToplam.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`} onKapat={() => setFormAcik(false)}>
          <form onSubmit={(e) => void mahsupEt(e)}>
            <Field label="Beyanname" htmlFor="pv-beyan-tur">
              <Select id="pv-beyan-tur" value={beyannameTuru} onChange={(e) => setBeyannameTuru(e.target.value as "gecici_vergi" | "yillik")}>
                <option value="gecici_vergi">Geçici vergi</option>
                <option value="yillik">Yıllık beyanname</option>
              </Select>
            </Field>
            <Field label="Yıl" htmlFor="pv-beyan-yil">
              <Select id="pv-beyan-yil" value={beyanYili} onChange={(e) => setBeyanYili(e.target.value)}>
                {yillar.map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </Field>
            {beyannameTuru === "gecici_vergi" && (
              <Field label="Dönem" htmlFor="pv-beyan-donem">
                <Select id="pv-beyan-donem" value={beyanDonemi} onChange={(e) => setBeyanDonemi(e.target.value)}>
                  {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}. dönem</option>)}
                </Select>
              </Field>
            )}
            <Field label="Beyanname notu (isteğe bağlı)" htmlFor="pv-beyan-not">
              <Input id="pv-beyan-not" maxLength={500} value={not} onChange={(e) => setNot(e.target.value)} />
            </Field>
            <ModalEylem onVazgec={() => setFormAcik(false)} isleniyor={isleniyor} metin="İşaretle" />
          </form>
        </Modal>
      )}
    </div>
  );
}
