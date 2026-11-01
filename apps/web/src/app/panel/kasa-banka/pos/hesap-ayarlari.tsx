"use client";

/**
 * POS hesabının bankaya geçiş ayarları (P1-6): bağlı banka, valör günü, komisyon oranı.
 * KSB-35: işlem başı ücret ve 2–12 taksit oranları; boş bırakılan taksit ödeme sayfasında açılmaz.
 */
import { useState, type FormEvent } from "react";
import { POS_TAKSIT_SECENEKLERI, posTaksitBosluklari, type PosTaksitOrani } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

export interface AyarlanacakPos {
  id: string;
  ad: string;
  saglayici: string;
  dovizCinsi: string;
  valorGun: number;
  komisyonOrani: string;
  islemUcreti: string;
  taksitOranlari: PosTaksitOrani[];
  varsayilanBankaHesap: { id: string; ad: string } | null;
}

const sayi = (deger: string) => deger.trim().replace(",", ".");

export function HesapAyarlari({ hesap, bankalar, onKapat, onKaydedildi }: { hesap: AyarlanacakPos; bankalar: { id: string; ad: string; dovizCinsi: string }[]; onKapat: () => void; onKaydedildi: (mesaj: string) => void }) {
  const [bankaId, setBankaId] = useState(hesap.varsayilanBankaHesap?.id ?? "");
  const [valorGun, setValorGun] = useState(String(hesap.valorGun));
  const [komisyon, setKomisyon] = useState(String(Number(hesap.komisyonOrani)));
  const [ucret, setUcret] = useState(String(Number(hesap.islemUcreti ?? 0)));
  const [taksitler, setTaksitler] = useState<Record<number, string>>(() =>
    Object.fromEntries((hesap.taksitOranlari ?? []).map((t) => [t.taksit, String(Number(t.oran))])),
  );
  const [hata, setHata] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const taksitli = hesap.dovizCinsi === "TRY";
  const tablo: PosTaksitOrani[] = POS_TAKSIT_SECENEKLERI.filter((t) => sayi(taksitler[t] ?? "") !== "").map((t) => ({ taksit: t, oran: Number(sayi(taksitler[t])).toFixed(2) }));
  const bosluklar = hesap.saglayici === "paytr" ? posTaksitBosluklari(tablo) : [];

  async function kaydet(e: FormEvent) {
    e.preventDefault();
    setKaydediliyor(true);
    setHata("");
    try {
      await api(`/kasa-banka/pos-hesaplari/${hesap.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          varsayilanBankaHesapId: bankaId || null,
          valorGun: Number(valorGun),
          komisyonOrani: Number(sayi(komisyon)).toFixed(2),
          islemUcreti: Number(sayi(ucret) || "0").toFixed(2),
          ...(taksitli ? { taksitOranlari: tablo } : {}),
        }),
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
        <Field label="Tek çekim komisyonu (%)">
          <Input required type="number" inputMode="decimal" min="0" max="99.99" step="any" value={komisyon} onChange={(e) => setKomisyon(e.target.value)} />
        </Field>
        <Field label={`İşlem başı ücret (${hesap.dovizCinsi})`}>
          <Input type="number" inputMode="decimal" min="0" step="0.01" value={ucret} onChange={(e) => setUcret(e.target.value)} />
        </Field>
        {taksitli ? (
          <fieldset className="pos-taksit">
            <legend>Taksit komisyonları (%)</legend>
            <p className="muted">Oranı boş bırakılan taksit ödeme sayfasında açılmaz. Hiç taksit girilmezse yalnız tek çekim açılır.</p>
            <div className="pos-taksit__grid">
              {POS_TAKSIT_SECENEKLERI.map((t) => (
                <Field key={t} label={`${t} taksit`}>
                  <Input type="number" inputMode="decimal" min="0" max="99.99" step="any" placeholder="Kapalı" value={taksitler[t] ?? ""} onChange={(e) => setTaksitler((o) => ({ ...o, [t]: e.target.value }))} />
                </Field>
              ))}
            </div>
            {bosluklar.length > 0 && (
              <Alert tone="warning">
                PayTR yalnız en fazla taksit sayısını alır; {bosluklar.join(", ")} taksit de ödeme sayfasında açılacak ama oranı tanımlı değil (tek çekim oranıyla tahmin edilir).
              </Alert>
            )}
          </fieldset>
        ) : (
          <p className="muted pos-taksit">Taksit yalnız TL POS hesaplarında tanımlanır; bu hesapta yalnız tek çekim açılır.</p>
        )}
        <Button type="submit" variant="primary" disabled={kaydediliyor}>{kaydediliyor ? "Kaydediliyor…" : "Ayarları kaydet"}</Button>
        {hata && <div className="pos-form__error"><Alert tone="error">{hata}</Alert></div>}
      </form>
    </Card>
  );
}
