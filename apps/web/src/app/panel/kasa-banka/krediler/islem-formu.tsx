"use client";

import { useEffect, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api, ApiHata } from "@/lib/api";
import { Alert, Button, Field, Input, Select } from "@/components/ui";

export type IslemTipi = "taksit" | "kullanim" | "geri_odeme" | "faiz";
export interface AcikTaksit { id: string; sira: number; vadeTarihi: string; anapara: string; faiz: string; bsmv: string; kkdf: string; toplam: string }

const ADI: Record<IslemTipi, string> = { taksit: "Taksit ödemesi", kullanim: "Kredi kullanımı", geri_odeme: "Anapara geri ödemesi", faiz: "Faiz tahsili" };
const sayi = (v: string) => Number(String(v).replace(",", ".")) || 0;

/**
 * KRD-03/04: taksit ödemesi ya da rotatif işlem. Taksitte plan tutarları
 * gelir; banka farklı tahsil ettiyse düzeltilir. Rotatif faizde kullanılan
 * bakiyeden hesaplanan öneri gelir.
 */
export interface OdemeHesabi { id: string; ad: string; bankaAdi: string; dovizCinsi: string; aktif: boolean }

export function IslemFormu({ krediId, krediHesapId, bankalar, dovizCinsi, tip, taksit, onTamam }: {
  krediId: string;
  /** Kullanımın girdiği, ödemede varsayılan hesap. */
  krediHesapId: string;
  bankalar: OdemeHesabi[];
  dovizCinsi: string;
  tip: IslemTipi;
  taksit?: AcikTaksit;
  onTamam: (mesaj: string) => void;
}) {
  // Ödeme kredinin dövizindeki herhangi bir aktif banka hesabından yapılabilir; kullanım kredinin hesabına girer.
  const odemeHesaplari = bankalar.filter((b) => b.aktif && b.dovizCinsi === dovizCinsi);
  const [hesapId, setHesapId] = useState(krediHesapId);
  const [f, setF] = useState({
    tarih: taksit && taksit.vadeTarihi < bugunTR() ? taksit.vadeTarihi : bugunTR(),
    anapara: taksit?.anapara ?? "", faiz: taksit?.faiz ?? "0", bsmv: taksit?.bsmv ?? "0", kkdf: taksit?.kkdf ?? "0", aciklama: "",
  });
  const [oneri, setOneri] = useState<string>("");
  const [hata, setHata] = useState("");
  const [eksiOnay, setEksiOnay] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    if (tip !== "faiz") return;
    void api<{ baslangic: string; faiz: number; bsmv: number; kkdf: number; ortalamaBakiye: number }>(`/kasa-banka/krediler/${krediId}/rotatif-faiz?bitis=${f.tarih}`)
      .then((o) => {
        setF((x) => ({ ...x, faiz: o.faiz.toFixed(2), bsmv: o.bsmv.toFixed(2), kkdf: o.kkdf.toFixed(2) }));
        setOneri(`${o.baslangic.split("-").reverse().join(".")} – ${f.tarih.split("-").reverse().join(".")} arası ortalama kullanılan ${o.ortalamaBakiye.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${dovizCinsi} üzerinden hesaplandı.`);
      })
      .catch(() => setOneri(""));
  }, [tip, krediId, f.tarih, dovizCinsi]);

  const anaparaVar = tip !== "faiz";
  const faizVar = tip === "taksit" || tip === "faiz";
  const toplam = (anaparaVar ? sayi(f.anapara) : 0) + (faizVar ? sayi(f.faiz) + sayi(f.bsmv) + sayi(f.kkdf) : 0);

  async function kaydet(e: React.FormEvent | React.MouseEvent, onayli = false) {
    e.preventDefault();
    setHata("");
    setKaydediliyor(true);
    try {
      await api(`/kasa-banka/krediler/${krediId}/islemler`, {
        method: "POST",
        body: JSON.stringify({
          tip, taksitId: taksit?.id ?? null, tarih: f.tarih, bankaHesapId: tip === "kullanim" ? null : hesapId,
          anapara: anaparaVar ? String(sayi(f.anapara)) : "0",
          faiz: faizVar ? String(sayi(f.faiz)) : "0", bsmv: faizVar ? String(sayi(f.bsmv)) : "0", kkdf: faizVar ? String(sayi(f.kkdf)) : "0",
          aciklama: f.aciklama || null, eksiBakiyeOnay: onayli,
        }),
      });
      onTamam(`${ADI[tip]} kaydedildi.`);
    } catch (err) {
      if (err instanceof ApiHata && err.durum === 409 && /eksi bakiye/i.test(err.message)) setEksiOnay(err.message);
      else setHata(err instanceof Error ? err.message : "İşlem kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  return (
    <form className="kredi-form" onSubmit={(e) => void kaydet(e)}>
      {taksit && <p className="kredi-form__not">{taksit.sira}. taksit · vade {taksit.vadeTarihi.split("-").reverse().join(".")} · plan tutarı {Number(taksit.toplam).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {dovizCinsi}</p>}
      {oneri && <p className="kredi-form__not">{oneri} Bankanın tahsil ettiği tutar farklıysa düzeltin.</p>}
      {hata && <Alert tone="error">{hata}</Alert>}
      {eksiOnay && <Alert tone="warning"><span>{eksiOnay} <Button size="sm" onClick={(e) => void kaydet(e, true)}>Yine de kaydet</Button></span></Alert>}
      <div className="kredi-form__alanlar">
        <Field label="Tarih"><Input type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} required /></Field>
        {tip !== "kullanim" && (
          <Field label="Ödemenin yapıldığı hesap">
            <Select value={hesapId} onChange={(e) => setHesapId(e.target.value)} required>
              {odemeHesaplari.map((b) => <option key={b.id} value={b.id}>{b.bankaAdi} · {b.ad}{b.id === krediHesapId ? " (kredinin hesabı)" : ""}</option>)}
            </Select>
          </Field>
        )}
        {anaparaVar && <Field label={`Anapara (${dovizCinsi})`}><Input inputMode="decimal" value={f.anapara} onChange={(e) => setF({ ...f, anapara: e.target.value })} required /></Field>}
        {faizVar && (
          <>
            <Field label="Faiz"><Input inputMode="decimal" value={f.faiz} onChange={(e) => setF({ ...f, faiz: e.target.value })} /></Field>
            <Field label="BSMV"><Input inputMode="decimal" value={f.bsmv} onChange={(e) => setF({ ...f, bsmv: e.target.value })} /></Field>
            <Field label="KKDF"><Input inputMode="decimal" value={f.kkdf} onChange={(e) => setF({ ...f, kkdf: e.target.value })} /></Field>
          </>
        )}
        <Field label="Açıklama"><Input value={f.aciklama} maxLength={500} onChange={(e) => setF({ ...f, aciklama: e.target.value })} /></Field>
      </div>
      <footer className="kredi-form__alt">
        <span>{tip === "kullanim" ? "Hesaba giriş" : "Hesaptan çıkış"}: <strong>{toplam.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {dovizCinsi}</strong></span>
        <Button type="submit" variant="primary" disabled={kaydediliyor || toplam <= 0}>{kaydediliyor ? "Kaydediliyor…" : "Kaydet"}</Button>
      </footer>
    </form>
  );
}
