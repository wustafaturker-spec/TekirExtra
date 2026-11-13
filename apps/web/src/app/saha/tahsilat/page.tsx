"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { api, ApiHata } from "@/lib/api";
import { useSaha } from "../saha-baglam";

interface CariSatiri { id: string; kod: string; unvan: string; bakiyeler: Array<{ dovizCinsi: string; bakiye: string; bakiyeGuncelTry?: string }> }
interface AcikFatura { faturaId: string; no: string | null; vadeTarihi: string; gecikmeGun: number; kalanTry: number }
interface Baglanti { id: string; tutar: string; dovizCinsi: string; olusturma?: string }
interface CariOzeti {
  cari: { id: string; kod: string; unvan: string; eposta: string | null; telefon: string | null; dovizCinsi: string; aktif: boolean; adresVar: boolean };
  acikFaturalar: AcikFatura[];
  posHesaplari: Array<{ id: string; ad: string; saglayici: string }>;
  acikBaglantilar: Baglanti[];
}
type Kanal = "sms" | "eposta" | "karekod";

const para = (n: number, d = "TRY") => n.toLocaleString("tr-TR", { style: "currency", currency: d, maximumFractionDigits: 2 });
const tarihTR = (g: string) => g.split("-").reverse().join(".");
const maskeTel = (t: string) => t.replace(/\d(?=\d{2})/g, "•");

/** SAH-07: cari bulunur, bakiye ve vadesi geçenler görülür; POS ödeme bağlantısı SMS, e-posta ya da karekodla verilir. */
export default function SahaTahsilatSayfasi() {
  const { cevrimici } = useSaha();
  const [arama, setArama] = useState("");
  const [sonuclar, setSonuclar] = useState<CariSatiri[] | null>(null);
  const [secili, setSecili] = useState<CariSatiri | null>(null);
  const [ozet, setOzet] = useState<CariOzeti | null>(null);
  const [posHesapId, setPosHesapId] = useState("");
  const [faturaId, setFaturaId] = useState("");
  const [tutar, setTutar] = useState("");
  const [aktif, setAktif] = useState<Baglanti | null>(null);
  const [karekod, setKarekod] = useState("");
  const [hata, setHata] = useState(""); const [bilgi, setBilgi] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  const calistir = async (is: () => Promise<void>) => {
    setIsleniyor(true); setHata(""); setBilgi("");
    try { await is(); } catch (e) { setHata(e instanceof Error ? e.message : "İşlem başarısız"); } finally { setIsleniyor(false); }
  };

  const ara = () => calistir(async () => {
    const q = arama.trim();
    if (q.length < 2) { setHata("En az iki harf ya da kod yazın."); return; }
    const r = await api<{ kayitlar: CariSatiri[] }>(`/cari?${new URLSearchParams({ arama: q, adet: "20", durum: "aktif" })}`);
    setSonuclar(r.kayitlar);
  });

  const sec = (c: CariSatiri) => calistir(async () => {
    const o = await api<CariOzeti>(`/saha/tahsilat/cari/${c.id}`);
    setSecili(c); setOzet(o); setAktif(null); setKarekod(""); setFaturaId("");
    setPosHesapId(o.posHesaplari[0]?.id ?? "");
    const gecikmis = o.acikFaturalar.filter((f) => f.gecikmeGun > 0).reduce((t, f) => t + f.kalanTry, 0);
    setTutar(o.cari.dovizCinsi === "TRY" && gecikmis > 0 ? gecikmis.toFixed(2) : "");
  });

  const bakiyeTry = (c: CariSatiri) => c.bakiyeler.reduce((t, b) => t + Number(b.bakiyeGuncelTry ?? b.bakiye), 0);

  /** Tutar "1.250,50" ya da "1250.50" biçiminde; geçersizse null. */
  function tutarMetni(): string | null {
    const ham = tutar.trim();
    const t = ham.includes(",") ? ham.replace(/\./g, "").replace(",", ".") : ham;
    if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) <= 0) { setHata("Geçerli bir tutar girin."); return null; }
    return t;
  }

  async function baglantiAc(oncekiniIptalEt = false): Promise<Baglanti | null> {
    if (!ozet) return null;
    const t = tutarMetni();
    if (!t) return null;
    try {
      const r = await api<{ id: string; tutar: string; dovizCinsi: string }>("/pos/tahsilatlar", {
        method: "POST",
        body: JSON.stringify({ posHesapId, cariId: ozet.cari.id, tutar: Number(t).toFixed(2), bildirim: false, ...(faturaId ? { faturaId } : {}), ...(oncekiniIptalEt ? { oncekiniIptalEt: true } : {}) }),
      });
      const b = { id: r.id, tutar: String(r.tutar), dovizCinsi: r.dovizCinsi };
      setAktif(b);
      return b;
    } catch (e) {
      if (e instanceof ApiHata && e.durum === 409 && /açık ödeme bağlantısı/.test(e.message) && window.confirm(`${e.message}\nEski bağlantı iptal edilip yenisi açılsın mı?`)) return baglantiAc(true);
      throw e;
    }
  }

  const gonder = (kanal: Kanal, mevcut?: Baglanti) => calistir(async () => {
    if (!ozet) return;
    if (!mevcut && !aktif) {
      const t = tutarMetni();
      if (!t || !window.confirm(`${ozet.cari.unvan} için ${para(Number(t), ozet.cari.dovizCinsi)} tutarlı ödeme bağlantısı açılsın mı?`)) return;
    }
    const b = mevcut ?? aktif ?? (await baglantiAc());
    if (!b) return;
    setKarekod("");
    if (kanal === "karekod") {
      const r = await api<{ svg: string }>(`/pos/tahsilatlar/${b.id}/karekod`);
      setKarekod(r.svg);
      return;
    }
    await api(`/pos/tahsilatlar/${b.id}/${kanal}`, { method: "POST" });
    setBilgi(kanal === "sms" ? `Ödeme bağlantısı ${maskeTel(ozet.cari.telefon ?? "")} numarasına SMS ile gönderildi.` : `Ödeme bağlantısı ${ozet.cari.eposta} adresine gönderildi.`);
  });

  const geri = () => { setSecili(null); setOzet(null); setAktif(null); setKarekod(""); setHata(""); setBilgi(""); };

  if (!cevrimici) return (<div className="saha-tahsilat"><h1>Tahsilat</h1><Alert tone="warning">Tahsilat için bağlantı gerekir; para hareketi çevrimdışı yapılmaz.</Alert></div>);

  if (!secili || !ozet) {
    return (
      <div className="saha-tahsilat">
        <h1>Tahsilat</h1>
        {hata && <Alert tone="error">{hata}</Alert>}
        <section className="saha-kart">
          <form className="saha-okut saha-okut--iki" onSubmit={(e) => { e.preventDefault(); void ara(); }}>
            <Input aria-label="Cari unvanı ya da kodu" placeholder="Unvan ya da cari kodu" value={arama} onChange={(e) => setArama(e.target.value)} autoComplete="off" enterKeyHint="search" />
            <Button variant="primary" type="submit" disabled={isleniyor}>Ara</Button>
          </form>
          {sonuclar && (sonuclar.length ? (
            <ul className="saha-liste">
              {sonuclar.map((c) => (
                <li key={c.id}>
                  <div><strong>{c.unvan}</strong><small>{c.kod} · Bakiye {para(bakiyeTry(c))}</small></div>
                  <Button size="sm" disabled={isleniyor} onClick={() => void sec(c)}>Seç</Button>
                </li>
              ))}
            </ul>
          ) : <small className="muted">Eşleşen etkin cari yok.</small>)}
        </section>
      </div>
    );
  }

  const gecikmis = ozet.acikFaturalar.filter((f) => f.gecikmeGun > 0);
  const gecikmisToplam = gecikmis.reduce((t, f) => t + f.kalanTry, 0);
  const posYok = !ozet.posHesaplari.length;
  const seciliPos = ozet.posHesaplari.find((p) => p.id === posHesapId);
  const engel = !ozet.cari.eposta ? "Carinin e-posta adresi yok; ödeme bağlantısı için panelde ekleyin."
    : posYok ? `Bu cari için (${ozet.cari.dovizCinsi}) bağlantılı sanal POS yok.`
    : seciliPos?.saglayici === "iyzico" && !ozet.cari.adresVar ? "iyzico için carinin adresi gerekir; panelde ekleyin." : null;

  return (
    <div className="saha-tahsilat">
      <h1>Tahsilat</h1>
      {hata && <Alert tone="error">{hata}</Alert>}
      {bilgi && !hata && <Alert tone="success">{bilgi}</Alert>}

      <section className="saha-kart">
        <header>
          <div><strong>{ozet.cari.unvan}</strong><br /><small className="muted">{ozet.cari.kod}</small></div>
          <Button size="sm" variant="ghost" onClick={geri}>Değiştir</Button>
        </header>
        <div><small className="muted">Bakiye</small><div className="saha-tutar">{para(bakiyeTry(secili))}</div></div>
        <div><small className="muted">Vadesi geçen ({gecikmis.length} fatura)</small><div className="saha-tutar">{para(gecikmisToplam)}</div></div>
      </section>

      {ozet.acikFaturalar.length > 0 && (
        <section className="saha-kart" aria-label="Açık faturalar">
          <header><strong>Açık faturalar</strong></header>
          <ul className="saha-liste">
            {ozet.acikFaturalar.slice(0, 10).map((f) => (
              <li key={f.faturaId}>
                <div><strong>{f.no ?? "Taslak no"}</strong><small>Vade {tarihTR(f.vadeTarihi)}{f.gecikmeGun > 0 ? ` · ${f.gecikmeGun} gün gecikti` : ""}</small></div>
                <span>{para(f.kalanTry)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="saha-kart" aria-label="Ödeme bağlantısı">
        <header><strong>Ödeme bağlantısı</strong></header>
        {engel ? <Alert tone="warning">{engel}</Alert> : (
          <>
            {ozet.posHesaplari.length > 1 && (
              <Field label="POS hesabı">
                <Select value={posHesapId} onChange={(e) => { setPosHesapId(e.target.value); setAktif(null); }}>{ozet.posHesaplari.map((p) => <option key={p.id} value={p.id}>{p.ad}</option>)}</Select>
              </Field>
            )}
            {ozet.cari.dovizCinsi === "TRY" && ozet.acikFaturalar.length > 0 && (
              <Field label="Fatura">
                <Select value={faturaId} onChange={(e) => { const f = ozet.acikFaturalar.find((x) => x.faturaId === e.target.value); setFaturaId(e.target.value); setAktif(null); if (f) setTutar(f.kalanTry.toFixed(2)); }}>
                  <option value="">Cari hesaba (faturasız)</option>
                  {ozet.acikFaturalar.map((f) => <option key={f.faturaId} value={f.faturaId}>{f.no ?? "Fatura"} · {para(f.kalanTry)}</option>)}
                </Select>
              </Field>
            )}
            <Field label={`Tutar (${ozet.cari.dovizCinsi})`}>
              <Input value={tutar} onChange={(e) => { setTutar(e.target.value); setAktif(null); }} inputMode="decimal" placeholder="0,00" />
            </Field>
            <div className="saha-kanallar">
              <Button disabled={isleniyor || !ozet.cari.telefon} onClick={() => void gonder("sms")} title={ozet.cari.telefon ? undefined : "Carinin telefonu yok"}>SMS</Button>
              <Button disabled={isleniyor} onClick={() => void gonder("eposta")}>E-posta</Button>
              <Button variant="primary" disabled={isleniyor} onClick={() => void gonder("karekod")}>Karekod</Button>
            </div>
            <small className="muted">{aktif ? `Açılan bağlantı: ${para(Number(aktif.tutar), aktif.dovizCinsi)}; başka kanaldan da gönderebilirsiniz.` : "Bağlantı ilk kanalda açılır, 7 gün geçerlidir. Ödeme gelince tahsilat kendiliğinden işlenir."}</small>
          </>
        )}
        {karekod && (
          <div className="saha-karekod" aria-live="polite">
            {/* Sunucunun ürettiği SVG görsel olarak gösterilir (sayfaya HTML olarak eklenmez). */}
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(karekod)}`} alt="Ödeme bağlantısı karekodu" />
            <small className="muted">Müşteri kendi telefonunun kamerasıyla okutup öder.</small>
          </div>
        )}
      </section>

      {ozet.acikBaglantilar.length > 0 && (
        <section className="saha-kart" aria-label="Açık bağlantılar">
          <header><strong>Açık bağlantılar</strong></header>
          <ul className="saha-liste">
            {ozet.acikBaglantilar.map((b) => (
              <li key={b.id}>
                <div><strong>{para(Number(b.tutar), b.dovizCinsi)}</strong><small>{b.olusturma ? new Date(b.olusturma).toLocaleString("tr-TR") : ""}</small></div>
                <div className="saha-liste__eylem">
                  {ozet.cari.telefon && <Button size="sm" disabled={isleniyor} onClick={() => void gonder("sms", b)}>SMS</Button>}
                  <Button size="sm" disabled={isleniyor} onClick={() => void gonder("karekod", b)}>Karekod</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
