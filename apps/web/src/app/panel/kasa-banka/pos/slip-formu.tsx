"use client";

/**
 * Banka POS'u slip tahsilatı (P1-6): fiziksel cihazda çekilen kart ödemesi
 * cari ve isteğe bağlı satış faturasıyla kaydedilir; para hesabın valör
 * gününde "Bankaya geçecekler" listesine düşer.
 */
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";
import { CariBakiye } from "@/components/cari-bakiye";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

interface BankaPos { id: string; ad: string; dovizCinsi: string; valorGun: number }
interface Cari { id: string; kod: string; unvan: string; dovizCinsi: string }
interface Fatura { id: string; no: string | null; genelToplam: string; dovizCinsi: string; odemeOzeti?: { durum: string; kalan: string } }

const para = (v: string | number, d: string) => `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${d}`;

export function SlipFormu({ hesaplar, cariler, onKapat, onKaydedildi }: { hesaplar: BankaPos[]; cariler: Cari[]; onKapat: () => void; onKaydedildi: (mesaj: string) => void }) {
  const [posHesapId, setPosHesapId] = useState(hesaplar.length === 1 ? hesaplar[0].id : "");
  const [cariId, setCariId] = useState("");
  const [faturalar, setFaturalar] = useState<Fatura[]>([]);
  const [faturaId, setFaturaId] = useState("");
  const [tutar, setTutar] = useState("");
  const [tarih, setTarih] = useState(bugunTR());
  const [slipNo, setSlipNo] = useState("");
  const [hata, setHata] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const pos = hesaplar.find((h) => h.id === posHesapId);

  useEffect(() => {
    if (!cariId) { setFaturalar([]); return; }
    let iptal = false;
    api<{ kayitlar: Fatura[] }>(`/fatura?cariId=${cariId}&yon=satis&durum=kesin&adet=100`)
      .then((f) => { if (!iptal) setFaturalar(f.kayitlar.filter((x) => !x.odemeOzeti || Number(x.odemeOzeti.kalan) > 0)); })
      .catch(() => { if (!iptal) setFaturalar([]); });
    return () => { iptal = true; };
  }, [cariId]);

  async function kaydet(e: FormEvent) {
    e.preventDefault();
    setKaydediliyor(true);
    setHata("");
    try {
      await api("/pos/slip", { method: "POST", body: JSON.stringify({ posHesapId, cariId, faturaId: faturaId || null, tutar: Number(tutar).toFixed(2), tarih, slipNo: slipNo || null }) });
      onKaydedildi(`Slip tahsilatı kaydedildi; ${pos?.valorGun === 0 ? "aynı gün" : `${pos?.valorGun} gün sonra`} bankaya geçecekler listesinde görünür.`);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Slip kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <Card className="pos-form">
      <div className="pos-form__head">
        <div><span>BANKA POS'U</span><h2>Slip tahsilatı</h2><p>Fiziksel POS cihazında çekilen kart ödemesini kaydedin. Fatura seçerseniz kalan tutar uygulanır.</p></div>
        <Button onClick={onKapat}>Kapat</Button>
      </div>
      <form className="pos-form__grid" onSubmit={kaydet}>
        <Field label="Banka POS'u">
          <Select required value={posHesapId} onChange={(e) => { setPosHesapId(e.target.value); setCariId(""); setFaturaId(""); }}>
            <option value="">POS seçin</option>
            {hesaplar.map((h) => <option key={h.id} value={h.id}>{h.ad} · {h.dovizCinsi}</option>)}
          </Select>
        </Field>
        <Field label="Cari hesap">
          <Select required value={cariId} onChange={(e) => { setCariId(e.target.value); setFaturaId(""); setTutar(""); }}>
            <option value="">Cari seçin</option>
            {cariler.filter((c) => !pos || c.dovizCinsi === pos.dovizCinsi).map((c) => <option key={c.id} value={c.id}>{c.kod} · {c.unvan}</option>)}
          </Select>
        </Field>
        <Field label="Açık satış faturası">
          <Select value={faturaId} onChange={(e) => { setFaturaId(e.target.value); const f = faturalar.find((x) => x.id === e.target.value); if (f) setTutar(f.odemeOzeti?.kalan ?? f.genelToplam); }}>
            <option value="">Cari bakiyesine işle</option>
            {faturalar.filter((f) => !pos || f.dovizCinsi === pos.dovizCinsi).map((f) => <option key={f.id} value={f.id}>{f.no ?? "Numarasız"} · kalan {para(f.odemeOzeti?.kalan ?? f.genelToplam, f.dovizCinsi)}</option>)}
          </Select>
        </Field>
        <CariBakiye cariId={cariId} />
        <Field label={`Tutar${pos ? ` (${pos.dovizCinsi})` : ""}`}>
          <Input required type="number" inputMode="decimal" min="0.01" step="any" value={tutar} onChange={(e) => setTutar(e.target.value)} />
        </Field>
        <Field label="İşlem tarihi">
          <Input required type="date" value={tarih} max={bugunTR()} onChange={(e) => setTarih(e.target.value)} />
        </Field>
        <Field label="Slip / provizyon no">
          <Input maxLength={50} value={slipNo} onChange={(e) => setSlipNo(e.target.value)} placeholder="İsteğe bağlı" />
        </Field>
        <Button type="submit" variant="primary" disabled={kaydediliyor || !posHesapId || !cariId || !(Number(tutar) > 0)}>{kaydediliyor ? "Kaydediliyor…" : "Slibi kaydet"}</Button>
        {hata && <div className="pos-form__error"><Alert tone="error">{hata}</Alert></div>}
      </form>
    </Card>
  );
}
