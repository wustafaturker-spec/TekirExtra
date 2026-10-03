"use client";

import { useEffect, useState } from "react";
import { bugunTR, cariHareketKurTipi, MUHASEBE_HESAPLARI } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { DovizSecenekleri } from "@/components/doviz-secenekleri";

type Tur = "acilis" | "duzeltme";
type Tip = "borc" | "alacak";

const sayi = (v: string) => Number(String(v).replace(",", ".")) || 0;

/**
 * CARI-27/28: elle cari hareketi — açılış bakiyesi ya da düzeltme. Dövizde
 * kur, tarih ve yöne göre TCMB'den önerilir (borç alış, alacak satış — fatura
 * ile aynı kural); kullanıcı değiştirebilir, 1 kabul edilmez.
 */
export function ElleHareketFormu({ cariId, varsayilanDoviz, onTamam, onVazgec }: {
  cariId: string;
  varsayilanDoviz: string;
  onTamam: (mesaj: string) => void;
  onVazgec: () => void;
}) {
  const [f, setF] = useState({
    tur: "duzeltme" as Tur, tip: "borc" as Tip, tarih: bugunTR(), vadeTarihi: "", dovizCinsi: varsayilanDoviz || "TRY",
    tutar: "", aciklama: "", karsiHesapKodu: "",
  });
  const [kur, setKur] = useState("");
  const [kurElle, setKurElle] = useState(false);
  const [kurBilgisi, setKurBilgisi] = useState("");
  const [hata, setHata] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const dovizli = f.dovizCinsi !== "TRY";

  useEffect(() => {
    if (!dovizli || !f.tarih) { setKurBilgisi(""); return; }
    let iptal = false;
    const tip = cariHareketKurTipi(f.tip);
    api<{ kurTarihi: string; kurlar: Record<string, number> }>(`/doviz-kurlari?tarih=${f.tarih}&tip=${tip}`)
      .then((y) => {
        if (iptal) return;
        const deger = y.kurlar[f.dovizCinsi];
        if (!deger) { setKurBilgisi(`${f.dovizCinsi} için TCMB kuru bulunamadı; kuru girin.`); if (!kurElle) setKur(""); return; }
        if (!kurElle) setKur(String(deger));
        setKurBilgisi(`TCMB döviz ${tip === "alis" ? "alış" : "satış"} kuru ${deger.toLocaleString("tr-TR", { maximumFractionDigits: 4 })} (${y.kurTarihi.split("-").reverse().join(".")})`);
      })
      .catch((e) => { if (!iptal) setKurBilgisi(e instanceof Error ? e.message : "Kur alınamadı"); });
    return () => { iptal = true; };
  }, [dovizli, f.tarih, f.tip, f.dovizCinsi, kurElle]);

  const tlKarsiligi = dovizli ? sayi(f.tutar) * sayi(kur) : sayi(f.tutar);
  const varsayilanKarsi = f.tip === "borc" ? MUHASEBE_HESAPLARI.cari_duzeltme_gelir.kod : MUHASEBE_HESAPLARI.cari_duzeltme_gider.kod;

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    setHata("");
    if (dovizli && sayi(kur) === 1) { setHata("Dövizli harekette kur 1 olamaz."); return; }
    setKaydediliyor(true);
    try {
      await api(`/cari/${cariId}/hareketler`, {
        method: "POST",
        body: JSON.stringify({
          tur: f.tur, tip: f.tip, tarih: f.tarih, vadeTarihi: f.vadeTarihi || undefined, dovizCinsi: f.dovizCinsi,
          tutar: String(sayi(f.tutar)), kur: dovizli && kur ? String(sayi(kur)) : undefined,
          aciklama: f.aciklama.trim() || undefined,
          karsiHesapKodu: f.tur === "duzeltme" && f.karsiHesapKodu.trim() ? f.karsiHesapKodu.trim() : undefined,
        }),
      });
      onTamam(f.tur === "acilis" ? "Açılış bakiyesi kaydedildi." : "Düzeltme kaydı eklendi.");
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Hareket kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <form className="kredi-form cari-elle-hareket" onSubmit={(e) => void kaydet(e)}>
      {hata && <Alert tone="error">{hata}</Alert>}
      <div className="kredi-form__alanlar">
        <Field label="Tür">
          <Select value={f.tur} onChange={(e) => setF({ ...f, tur: e.target.value as Tur })}>
            <option value="duzeltme">Düzeltme</option>
            <option value="acilis">Açılış bakiyesi</option>
          </Select>
        </Field>
        <Field label="Yön">
          <Select value={f.tip} onChange={(e) => setF({ ...f, tip: e.target.value as Tip })}>
            <option value="borc">Borç — cari bize borçlanır</option>
            <option value="alacak">Alacak — cari alacaklanır</option>
          </Select>
        </Field>
        <Field label="Tarih"><Input type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} required /></Field>
        <Field label="Vade (isteğe bağlı)"><Input type="date" min={f.tarih} value={f.vadeTarihi} onChange={(e) => setF({ ...f, vadeTarihi: e.target.value })} /></Field>
        <Field label="Döviz">
          <Select value={f.dovizCinsi} onChange={(e) => { setF({ ...f, dovizCinsi: e.target.value }); setKurElle(false); }}><DovizSecenekleri /></Select>
        </Field>
        <Field label={`Tutar (${f.dovizCinsi === "TRY" ? "TL" : f.dovizCinsi})`}><Input inputMode="decimal" value={f.tutar} onChange={(e) => setF({ ...f, tutar: e.target.value })} required /></Field>
        {dovizli && (
          <Field label="Kur">
            <Input inputMode="decimal" value={kur} onChange={(e) => { setKur(e.target.value); setKurElle(true); }} placeholder="TCMB kuru" required />
          </Field>
        )}
        {f.tur === "duzeltme" && (
          <Field label="Muhasebe karşı hesabı">
            <Input value={f.karsiHesapKodu} maxLength={40} onChange={(e) => setF({ ...f, karsiHesapKodu: e.target.value })} placeholder={`Boşsa ${varsayilanKarsi}`} />
          </Field>
        )}
        <Field label="Açıklama"><Input value={f.aciklama} maxLength={500} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /></Field>
      </div>
      {dovizli && kurBilgisi && <p className="kredi-form__not">{kurBilgisi}{kurElle && <> · <button type="button" className="link-button" onClick={() => setKurElle(false)}>TCMB kuruna dön</button></>}</p>}
      <p className="kredi-form__not">
        {f.tur === "acilis"
          ? "Açılış bakiyesi muhasebe aktarımına girmez; devir mali müşavirin açılış fişindedir."
          : `Muhasebe aktarımında ${f.tip === "borc" ? "120/320 borç, karşı hesap alacak" : "karşı hesap borç, 120/320 alacak"} fişi üretilir.`}
      </p>
      <footer className="kredi-form__alt">
        <span>TL karşılığı: <strong>{tlKarsiligi.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</strong></span>
        <span className="row-tight">
          <Button type="button" onClick={onVazgec}>Vazgeç</Button>
          <Button type="submit" variant="primary" disabled={kaydediliyor || sayi(f.tutar) <= 0}>{kaydediliyor ? "Kaydediliyor…" : "Kaydet"}</Button>
        </span>
      </footer>
    </form>
  );
}
