"use client";

/** POS hesabının bankaya geçiş ayarları (P1-6): bağlı banka, valör günü, komisyon oranı. */
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

export interface AyarlanacakPos {
  id: string;
  ad: string;
  saglayici: string;
  dovizCinsi: string;
  valorGun: number;
  komisyonOrani: string;
  varsayilanBankaHesap: { id: string; ad: string } | null;
}

export function HesapAyarlari({ hesap, bankalar, onKapat, onKaydedildi }: { hesap: AyarlanacakPos; bankalar: { id: string; ad: string; dovizCinsi: string }[]; onKapat: () => void; onKaydedildi: (mesaj: string) => void }) {
  const [bankaId, setBankaId] = useState(hesap.varsayilanBankaHesap?.id ?? "");
  const [valorGun, setValorGun] = useState(String(hesap.valorGun));
  const [komisyon, setKomisyon] = useState(String(Number(hesap.komisyonOrani)));
  const [hata, setHata] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);

  async function kaydet(e: FormEvent) {
    e.preventDefault();
    setKaydediliyor(true);
    setHata("");
    try {
      await api(`/kasa-banka/pos-hesaplari/${hesap.id}`, {
        method: "PATCH",
        body: JSON.stringify({ varsayilanBankaHesapId: bankaId || null, valorGun: Number(valorGun), komisyonOrani: Number(komisyon.replace(",", ".")).toFixed(2) }),
      });
      onKaydedildi(`${hesap.ad} ayarları kaydedildi.`);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Ayarlar kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <Card className="pos-form">
      <div className="pos-form__head">
        <div><span>POS AYARLARI</span><h2>{hesap.ad}</h2><p>Bankaya geçecekler listesi valör tarihini ve önerilen komisyonu bu ayarlardan hesaplar.</p></div>
        <Button onClick={onKapat}>Kapat</Button>
      </div>
      <form className="pos-form__grid" onSubmit={kaydet}>
        <Field label="Paranın geçeceği banka">
          <Select value={bankaId} required={hesap.saglayici === "banka"} onChange={(e) => setBankaId(e.target.value)}>
            <option value="">{hesap.saglayici === "banka" ? "Banka hesabı seçin" : "Sonra seç"}</option>
            {bankalar.filter((b) => b.dovizCinsi === hesap.dovizCinsi).map((b) => <option key={b.id} value={b.id}>{b.ad}</option>)}
          </Select>
        </Field>
        <Field label="Valör / bloke (gün)">
          <Input required type="number" min="0" max="365" step="1" value={valorGun} onChange={(e) => setValorGun(e.target.value)} />
        </Field>
        <Field label="Komisyon oranı (%)">
          <Input required type="number" inputMode="decimal" min="0" max="99.99" step="any" value={komisyon} onChange={(e) => setKomisyon(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={kaydediliyor}>{kaydediliyor ? "Kaydediliyor…" : "Ayarları kaydet"}</Button>
        {hata && <div className="pos-form__error"><Alert tone="error">{hata}</Alert></div>}
      </form>
    </Card>
  );
}
