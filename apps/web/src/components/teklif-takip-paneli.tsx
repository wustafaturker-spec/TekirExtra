"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Modal, ModalEylem, Select } from "@/components/ui";

type Durum = "yanit_bekliyor" | "hatirlatildi" | "yanit_geldi" | "kapandi";
interface Takip {
  durum: Durum; kaynak: "eposta" | "elle"; alici: string | null; gonderildiAt: string; gonderimSayisi: number;
  hatirlatmaGunu: string; hatirlatildiAt: string | null; yanitAt: string | null; yanitEpostaId: string | null;
  kapanisNedeni: string | null; bekleyenGun: number | null;
}

type Varyant = "neutral" | "success" | "info" | "warning";
const DURUM: Record<Durum, { ad: string; varyant: Varyant }> = {
  yanit_bekliyor: { ad: "Yanıt bekliyor", varyant: "info" },
  hatirlatildi: { ad: "Yanıt yok — takip et", varyant: "warning" },
  yanit_geldi: { ad: "Yanıt geldi", varyant: "success" },
  kapandi: { ad: "Takip kapandı", varyant: "neutral" },
};

const gunTR = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

/** AI-43: belge listesindeki takip rozeti. */
export function TeklifTakipRozeti({ takip }: { takip?: { durum: string; gonderildiAt: string } | null }) {
  if (!takip) return null;
  const d = DURUM[takip.durum as Durum];
  if (!d || takip.durum === "kapandi") return null;
  const gun = Math.max(0, Math.round((Date.now() - Date.parse(takip.gonderildiAt)) / 86_400_000));
  return <Badge variant={d.varyant}>{takip.durum === "yanit_bekliyor" ? `${d.ad} (${gun} gün)` : d.ad}</Badge>;
}

/**
 * AI-38…43: satış teklifinin takibi. Sistem kendiliğinden e-posta göndermez;
 * takip e-postasını kullanıcı düzenleyip gönderir.
 */
export function TeklifTakipPaneli({ belgeId, belgeDurumu, onDegisti }: { belgeId: string; belgeDurumu: string; onDegisti?: () => void }) {
  const [takip, setTakip] = useState<Takip | null>(null);
  const [yuklendi, setYuklendi] = useState(false);
  const [hata, setHata] = useState("");
  const [basari, setBasari] = useState("");
  const [islem, setIslem] = useState(false);
  const [elleTarih, setElleTarih] = useState("");
  const [erteleGun, setErteleGun] = useState("3");
  const [eposta, setEposta] = useState<{ alici: string; konu: string; metin: string; kaynak: "model" | "sablon" } | null>(null);
  const [kapatma, setKapatma] = useState<{ yanitAlindi: boolean; not: string } | null>(null);

  const yukle = useCallback(async () => {
    setHata("");
    try { setTakip((await api<{ takip: Takip | null }>(`/belgeler/${belgeId}/takip`)).takip); }
    catch (e) { setHata(e instanceof Error ? e.message : "Takip okunamadı"); }
    finally { setYuklendi(true); }
  }, [belgeId]);
  useEffect(() => { setTakip(null); setYuklendi(false); void yukle(); }, [yukle]);

  async function calistir<T>(yol: string, govde: unknown, basariMetni: string): Promise<T | null> {
    setIslem(true); setHata(""); setBasari("");
    try {
      const sonuc = await api<T>(`/belgeler/${belgeId}/takip/${yol}`, { method: "POST", body: JSON.stringify(govde ?? {}) });
      setBasari(basariMetni);
      return sonuc;
    } catch (e) { setHata(e instanceof Error ? e.message : "İşlem yapılamadı"); return null; }
    finally { setIslem(false); }
  }

  async function guncelle(yol: string, govde: unknown, basariMetni: string) {
    const s = await calistir<{ takip: Takip }>(yol, govde, basariMetni);
    if (s) { setTakip(s.takip); onDegisti?.(); }
  }

  async function epostaAc() {
    const m = await calistir<{ konu: string; metin: string; alici: string | null; kaynak: "model" | "sablon" }>("metin", {}, "");
    if (m) setEposta({ alici: m.alici ?? "", konu: m.konu, metin: m.metin, kaynak: m.kaynak });
  }

  async function epostaGonder(e: FormEvent) {
    e.preventDefault();
    if (!eposta) return;
    const s = await calistir<{ takip: Takip; alici: string }>("gonder", { ...(eposta.alici.trim() ? { alici: eposta.alici.trim() } : {}), konu: eposta.konu, metin: eposta.metin }, "Takip e-postası gönderildi.");
    if (s) { setTakip(s.takip); setEposta(null); setBasari(`Takip e-postası ${s.alici} adresine gönderildi; hatırlatma yeniden kuruldu.`); onDegisti?.(); }
  }

  if (!yuklendi) return null;
  const d = takip ? DURUM[takip.durum] : null;
  const acik = takip && (takip.durum === "yanit_bekliyor" || takip.durum === "hatirlatildi");
  return (
    <div className="invoice-summary teklif-takip">
      <h4>Teklif takibi</h4>
      {hata && <Alert tone="error">{hata}</Alert>}
      {basari && <Alert tone="success">{basari}</Alert>}
      {!takip ? (
        belgeDurumu === "onaylandi" ? <>
          <p className="muted">Teklif sistemden e-postayla gönderilince kendiliğinden takibe alınır. Başka yoldan (WhatsApp, elden) verdiyseniz işaretleyin.</p>
          <div className="row-tight">
            <Input aria-label="Gönderim tarihi" type="date" value={elleTarih} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setElleTarih(e.target.value)} />
            <Button size="sm" disabled={islem} onClick={() => void guncelle("elle-gonderildi", elleTarih ? { tarih: elleTarih } : {}, "Teklif takibe alındı.")}>Gönderildi olarak işaretle</Button>
          </div>
        </> : <p className="muted">Takipte değil.</p>
      ) : <>
        <div className="row-tight">{d && <Badge variant={d.varyant}>{d.ad}</Badge>}{takip.bekleyenGun !== null && <span className="muted">{takip.bekleyenGun} gündür bekliyor</span>}</div>
        <div className="invoice-summary__line"><span>Gönderim</span><strong>{gunTR(takip.gonderildiAt)}{takip.kaynak === "elle" ? " (elle)" : takip.alici ? ` · ${takip.alici}` : ""}{takip.gonderimSayisi > 1 ? ` · ${takip.gonderimSayisi}. gönderim` : ""}</strong></div>
        {acik && <div className="invoice-summary__line"><span>Hatırlatma</span><strong>{gunTR(takip.hatirlatmaGunu)}</strong></div>}
        {takip.yanitAt && <div className="invoice-summary__line"><span>Yanıt</span><strong>{gunTR(takip.yanitAt)}{takip.yanitEpostaId && <> · <Link href="/panel/eposta">e-postayı aç</Link></>}</strong></div>}
        {takip.kapanisNedeni && <small className="muted">{takip.kapanisNedeni}</small>}
        {acik && (
          <div className="row-tight teklif-takip__eylemler">
            <Button size="sm" variant="primary" disabled={islem} onClick={() => void epostaAc()}>Takip e-postası</Button>
            <Button size="sm" disabled={islem} onClick={() => setKapatma({ yanitAlindi: true, not: "" })}>Yanıt alındı</Button>
            <Button size="sm" disabled={islem} onClick={() => setKapatma({ yanitAlindi: false, not: "" })}>Takibi kapat</Button>
            <Select aria-label="Erteleme" value={erteleGun} onChange={(e) => setErteleGun(e.target.value)}>
              {["1", "3", "5", "10"].map((g) => <option key={g} value={g}>{g} iş günü</option>)}
            </Select>
            <Button size="sm" disabled={islem} onClick={() => void guncelle("ertele", { isGunu: Number(erteleGun) }, `Hatırlatma ${erteleGun} iş günü ertelendi.`)}>Ertele</Button>
          </div>
        )}
      </>}

      {eposta && (
        <Modal baslik="Takip e-postası" aciklama={eposta.kaynak === "model" ? "Metni yapay zekâ önerdi; göndermeden önce kontrol edin. Teklif PDF'i eklenir." : "Hazır metin; göndermeden önce düzenleyin. Teklif PDF'i eklenir."} onKapat={() => setEposta(null)} genis>
          <form className="stack" onSubmit={(e) => void epostaGonder(e)}>
            <Field label="Alıcı"><Input type="email" value={eposta.alici} placeholder="Boşsa cari kartındaki adres" onChange={(e) => setEposta({ ...eposta, alici: e.target.value })} /></Field>
            <Field label="Konu"><Input required minLength={3} maxLength={200} value={eposta.konu} onChange={(e) => setEposta({ ...eposta, konu: e.target.value })} /></Field>
            <Field label="Metin"><textarea className="textarea" required minLength={10} maxLength={4000} rows={9} value={eposta.metin} onChange={(e) => setEposta({ ...eposta, metin: e.target.value })} /></Field>
            <ModalEylem onVazgec={() => setEposta(null)} isleniyor={islem} metin="Gönder" />
          </form>
        </Modal>
      )}
      {kapatma && (
        <Modal baslik={kapatma.yanitAlindi ? "Yanıt alındı" : "Takibi kapat"} aciklama={kapatma.yanitAlindi ? "Müşteri e-posta dışında (telefon, yüz yüze) yanıt verdiyse işaretleyin; takip görevi tamamlanır." : "Bu teklif artık hatırlatılmaz; takip görevi tamamlanır."} onKapat={() => setKapatma(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void guncelle("kapat", { yanitAlindi: kapatma.yanitAlindi, not: kapatma.not.trim() || null }, kapatma.yanitAlindi ? "Yanıt alındı olarak işaretlendi." : "Takip kapatıldı.").then(() => setKapatma(null)); }}>
            <Field label="Not (isteğe bağlı)"><Input maxLength={300} value={kapatma.not} onChange={(e) => setKapatma({ ...kapatma, not: e.target.value })} placeholder={kapatma.yanitAlindi ? "ör. telefonla görüşüldü, fiyat uygun" : "ör. müşteri başka tedarikçiyle çalışacak"} /></Field>
            <ModalEylem onVazgec={() => setKapatma(null)} isleniyor={islem} metin={kapatma.yanitAlindi ? "İşaretle" : "Kapat"} />
          </form>
        </Modal>
      )}
    </div>
  );
}
