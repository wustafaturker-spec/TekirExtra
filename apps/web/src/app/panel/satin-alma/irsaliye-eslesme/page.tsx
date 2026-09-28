"use client";

/**
 * SAT-14: alış tarafında eşleşmeyen belgeler. Faturası gelmemiş alış
 * irsaliyeleri (faturalama süresiyle), alış irsaliyesine işlenmemiş gelen
 * e-İrsaliyeler ve irsaliyesi olmayan mal içeren alış faturaları; her satırdan
 * eşleştirmeyi tamamlayan işleme gidilir.
 */
import { useCallback, useEffect, useState } from "react";
import { api, tumSayfalariAl } from "@/lib/api";
import { AramaSecici } from "@/components/arama-secici";
import { GelenIrsaliyeIsle } from "@/components/gelen-irsaliye-isle";
import { IrsaliyeBaglaPaneli } from "@/components/irsaliye-bagla-paneli";
import { Alert, Badge, Button, ButtonLabel, Card, Field, Input, PageHeader, TableWrap } from "@/components/ui";
import { bugunTR, gunEkleTR } from "@tekirextra/shared";

interface Rapor {
  faturasiGelmemisIrsaliyeler: { id: string; no: string | null; tedarikciBelgeNo: string | null; tarih: string; cari: { id: string; unvan: string }; tutar: string; sonGun: string; kalanGun: number; gecti: boolean }[];
  islenmemisEirsaliyeler: { id: string; belgeNo: string; tarih: string; sevkTarihi: string; gonderenUnvan: string; gonderenVkn: string; yanit: string }[];
  irsaliyesizFaturalar: { id: string; no: string | null; tarih: string; durum: string; cari: { id: string; unvan: string }; genelToplam: string; dovizCinsi: string }[];
  faturalamaGunSayisi: number;
}
interface Cari { id: string; kod: string; unvan: string }

const gun = (v: string) => v.split("-").reverse().join(".");
const tutar = (v: string, doviz = "TRY") => `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doviz === "TRY" ? "TL" : doviz}`;

export default function IrsaliyeFaturaEslesmesi() {
  const [baslangic, setBaslangic] = useState(() => gunEkleTR(-90));
  const [bitis, setBitis] = useState(bugunTR());
  const [cariId, setCariId] = useState("");
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [rapor, setRapor] = useState<Rapor | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [isle, setIsle] = useState<string | null>(null);
  const [bagla, setBagla] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true); setHata("");
    try {
      const p = new URLSearchParams({ baslangic, bitis });
      if (cariId) p.set("cariId", cariId);
      setRapor(await api<Rapor>(`/belgeler/irsaliye-fatura-eslesmesi?${p}`));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Rapor alınamadı");
    } finally {
      setYukleniyor(false);
    }
  }, [baslangic, bitis, cariId]);

  useEffect(() => { void yukle(); }, [yukle]);
  useEffect(() => { void tumSayfalariAl<Cari>("/cari?tip=tedarikci").then(setCariler).catch(() => undefined); }, []);

  const bos = (metin: string, sutun: number) => <tr><td colSpan={sutun} className="muted">{yukleniyor ? "Yükleniyor…" : metin}</td></tr>;

  return (
    <div className="stack">
      <PageHeader title="İrsaliye–Fatura Eşleşmesi" subtitle="Faturası gelmemiş irsaliyeler, işlenmemiş gelen e-İrsaliyeler ve irsaliyesi olmayan alış faturaları" />
      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}

      <Card>
        <div className="despatch-report__filters">
          <Field label="Başlangıç"><Input type="date" value={baslangic} onChange={(e) => setBaslangic(e.target.value)} /></Field>
          <Field label="Bitiş"><Input type="date" value={bitis} onChange={(e) => setBitis(e.target.value)} /></Field>
          <Field label="Tedarikçi">
            <AramaSecici ariaLabel="Tedarikçi süzgeci" deger={cariId} onChange={setCariId} placeholder="Tümü" secenekler={cariler.map((c) => ({ deger: c.id, baslik: c.unvan, aciklama: c.kod }))} />
          </Field>
          <Button onClick={() => void yukle()}>Yenile</Button>
        </div>
      </Card>

      <Card title={`Faturası gelmemiş alış irsaliyeleri (${rapor?.faturasiGelmemisIrsaliyeler.length ?? 0})`}>
        <p className="muted" style={{ marginTop: 0 }}>Tedarikçi, malın tesliminden itibaren {rapor?.faturalamaGunSayisi ?? 7} gün içinde fatura düzenlemelidir (VUK 231/5).</p>
        <TableWrap>
          <thead><tr><th>İrsaliye</th><th>Tedarikçi no</th><th>Tarih</th><th>Tedarikçi</th><th className="num">Tutar</th><th>Faturalama süresi</th><th /></tr></thead>
          <tbody>
            {rapor?.faturasiGelmemisIrsaliyeler.length ? rapor.faturasiGelmemisIrsaliyeler.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.no ?? "—"}</td>
                <td className="mono">{b.tedarikciBelgeNo ?? "—"}</td>
                <td>{gun(b.tarih)}</td>
                <td>{b.cari.unvan}</td>
                <td className="num">{tutar(b.tutar)}</td>
                <td>{b.gecti ? <Badge variant="danger">Süre geçti ({gun(b.sonGun)})</Badge> : <Badge variant={b.kalanGun <= 2 ? "warning" : "neutral"}>{b.kalanGun === 0 ? "Son gün bugün" : `${b.kalanGun} gün kaldı`}</Badge>}</td>
                <td className="right"><ButtonLabel as="a" size="sm" href={`/panel/belgeler?yon=alis&tur=irsaliye&odak=${b.id}`}>Aç</ButtonLabel></td>
              </tr>
            )) : bos("Faturası beklenen alış irsaliyesi yok.", 7)}
          </tbody>
        </TableWrap>
      </Card>

      <Card title={`Alış irsaliyesine işlenmemiş gelen e-İrsaliyeler (${rapor?.islenmemisEirsaliyeler.length ?? 0})`}>
        <TableWrap>
          <thead><tr><th>e-İrsaliye</th><th>Sevk tarihi</th><th>Gönderen</th><th>Yanıt</th><th /></tr></thead>
          <tbody>
            {rapor?.islenmemisEirsaliyeler.length ? rapor.islenmemisEirsaliyeler.map((g) => (
              <tr key={g.id}>
                <td className="mono">{g.belgeNo}</td>
                <td>{gun(g.sevkTarihi)}</td>
                <td>{g.gonderenUnvan}<small className="muted" style={{ display: "block" }}>VKN {g.gonderenVkn}</small></td>
                <td>{g.yanit === "kabul" ? <Badge variant="success">Kabul</Badge> : <Badge variant="info">Yanıt bekliyor</Badge>}</td>
                <td className="right"><Button size="sm" variant="primary" onClick={() => setIsle(g.id)}>Alış irsaliyesine işle</Button></td>
              </tr>
            )) : bos("İşlenmeyi bekleyen gelen e-İrsaliye yok.", 5)}
          </tbody>
        </TableWrap>
      </Card>

      <Card title={`İrsaliyesi olmayan alış faturaları (${rapor?.irsaliyesizFaturalar.length ?? 0})`}>
        <p className="muted" style={{ marginTop: 0 }}>Yalnız mal içeren (hizmet dışı satırı olan) faturalar listelenir.</p>
        <TableWrap>
          <thead><tr><th>Fatura</th><th>Tarih</th><th>Tedarikçi</th><th>Durum</th><th className="num">Tutar</th><th /></tr></thead>
          <tbody>
            {rapor?.irsaliyesizFaturalar.length ? rapor.irsaliyesizFaturalar.map((f) => (
              <tr key={f.id}>
                <td className="mono">{f.no ?? "— taslak —"}</td>
                <td>{gun(f.tarih)}</td>
                <td>{f.cari.unvan}</td>
                <td><Badge variant={f.durum === "kesin" ? "success" : "neutral"}>{f.durum === "kesin" ? "Kesin" : "Taslak"}</Badge></td>
                <td className="num">{tutar(f.genelToplam, f.dovizCinsi)}</td>
                <td className="right"><div className="row" style={{ justifyContent: "flex-end", gap: "0.35rem" }}>
                  <Button size="sm" onClick={() => setBagla(f.id)}>İrsaliye bağla</Button>
                  <ButtonLabel as="a" size="sm" href={`/panel/fatura/yeni?ac=${f.id}`}>Aç</ButtonLabel>
                </div></td>
              </tr>
            )) : bos("İrsaliyesi eksik alış faturası yok.", 6)}
          </tbody>
        </TableWrap>
      </Card>

      {isle && <GelenIrsaliyeIsle gelenId={isle} onKapat={() => setIsle(null)} onTamam={(no) => { setIsle(null); setBasari(`${no ?? "Alış irsaliyesi"} oluşturuldu ve onaylandı.`); void yukle(); }} />}
      {bagla && <IrsaliyeBaglaPaneli kaynak={{ faturaId: bagla }} onKapat={() => setBagla(null)} onBaglandi={(mesaj) => { setBagla(null); setBasari(mesaj); void yukle(); }} />}
    </div>
  );
}
