"use client";

/**
 * POS tahsilatı üzerindeki gerekçeli işlemler (P1-6): açık bağlantıyı iptal,
 * ödenmiş tahsilatı tam/kısmi iade, yanlış girilmiş slibi ya da iadeyi geri
 * alma. Tarayıcı onay penceresi kullanılmaz; gerekçe denetim izine yazılır.
 */
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { bugunTR } from "@tekirextra/shared";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

export type TahsilatIslemTuru = "iptal" | "iade" | "slip_geri_al" | "iade_geri_al";

export interface IslemHedefi {
  tur: TahsilatIslemTuru;
  tahsilat: { id: string; tutar: string; dovizCinsi: string; iadeEdilen: string; cari: { unvan: string }; posHesap: { ad: string } };
  iade?: { id: string; tutar: string };
}

const BASLIK: Record<TahsilatIslemTuru, string> = {
  iptal: "Ödeme bağlantısını iptal et",
  iade: "Kart iadesi kaydet",
  slip_geri_al: "Slibi geri al",
  iade_geri_al: "İadeyi geri al",
};

const para = (v: string | number, d: string) => `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${d}`;

export function TahsilatIslemi({ hedef, onKapat, onTamam }: { hedef: IslemHedefi; onKapat: () => void; onTamam: (mesaj: string) => void }) {
  const { tur, tahsilat } = hedef;
  const iadeEdilebilir = Number(tahsilat.tutar) - Number(tahsilat.iadeEdilen);
  const [neden, setNeden] = useState("");
  const [tutar, setTutar] = useState(tur === "iade" ? iadeEdilebilir.toFixed(2) : "");
  const [tarih, setTarih] = useState(bugunTR());
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);

  async function gonder(e: FormEvent) {
    e.preventDefault();
    setIsleniyor(true);
    setHata("");
    try {
      if (tur === "iptal") {
        await api(`/pos/tahsilatlar/${tahsilat.id}/iptal`, { method: "POST", body: JSON.stringify({ neden }) });
        onTamam("Ödeme bağlantısı iptal edildi. Müşteri bağlantıyı yine de öderse tahsilat kaydedilir ve bildirim düşer.");
      } else if (tur === "iade") {
        await api(`/pos/tahsilatlar/${tahsilat.id}/iade`, { method: "POST", body: JSON.stringify({ tutar: Number(tutar).toFixed(2), tarih, neden }) });
        onTamam(`${para(tutar, tahsilat.dovizCinsi)} iade kaydedildi; cari borçlandı, faturaya mahsup edilen kısım yeniden açıldı. İadeyi sağlayıcı/banka panelinden de yapmayı unutmayın.`);
      } else if (tur === "slip_geri_al") {
        await api(`/pos/tahsilatlar/${tahsilat.id}/slip-geri-al`, { method: "POST", body: JSON.stringify({ neden }) });
        onTamam("Slip tahsilatı geri alındı; POS ve cari hareketleri silindi.");
      } else {
        await api(`/pos/iadeler/${hedef.iade!.id}/geri-al`, { method: "POST", body: JSON.stringify({ neden }) });
        onTamam("İade geri alındı.");
      }
    } catch (err) {
      setHata(err instanceof Error ? err.message : "İşlem yapılamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  return (
    <Card className="pos-form">
      <div className="pos-form__head">
        <div>
          <span>TAHSİLAT İŞLEMİ</span>
          <h2>{BASLIK[tur]}</h2>
          <p>{tahsilat.cari.unvan} · {tahsilat.posHesap.ad} · {para(tahsilat.tutar, tahsilat.dovizCinsi)}{Number(tahsilat.iadeEdilen) > 0 ? ` · ${para(tahsilat.iadeEdilen, tahsilat.dovizCinsi)} iade edildi` : ""}</p>
        </div>
        <Button onClick={onKapat}>Kapat</Button>
      </div>
      <form className="pos-form__grid" onSubmit={gonder}>
        {tur === "iade" && (
          <>
            <Field label={`İade tutarı (en fazla ${para(iadeEdilebilir, tahsilat.dovizCinsi)})`}>
              <Input required autoFocus type="number" inputMode="decimal" min="0.01" max={iadeEdilebilir.toFixed(2)} step="any" value={tutar} onChange={(e) => setTutar(e.target.value)} />
            </Field>
            <Field label="İade tarihi">
              <Input required type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Gerekçe" className={tur === "iade" ? undefined : "pos-form__wide"}>
          <Input required autoFocus={tur !== "iade"} minLength={3} maxLength={300} value={neden} onChange={(e) => setNeden(e.target.value)}
            placeholder={tur === "iptal" ? "Ör. Müşteri havale ile ödeyecek" : tur === "iade" ? "Ör. Ürün iadesi" : "Ör. Yanlış cariye girilmişti"} />
        </Field>
        <Button type="submit" variant={tur === "iade" ? "primary" : "danger"} disabled={isleniyor || neden.trim().length < 3 || (tur === "iade" && !(Number(tutar) > 0 && Number(tutar) <= iadeEdilebilir + 0.001))}>
          {isleniyor ? "İşleniyor…" : BASLIK[tur]}
        </Button>
        {hata && <div className="pos-form__error"><Alert tone="error">{hata}</Alert></div>}
      </form>
    </Card>
  );
}
