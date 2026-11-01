"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { platformApi } from "@/lib/platform-api";

/** PLT-42…46: iade edilecek abonelik ödemesi (rapor satırı ya da firma geçmişi). */
export interface IadeEdilecekOdeme {
  id: string;
  unvan?: string;
  tutar: number | string;
  iade: number | string;
  kaynak: "elle" | "saglayici";
  saglayici: string | null;
  aySayisi: number;
}

const SAGLAYICI_ADI: Record<string, string> = { iyzico: "iyzico", paytr: "PayTR" };
const tl = (v: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const yeniAnahtar = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(16).slice(2)}`.padEnd(24, "0"));

/**
 * Platform yöneticisinin abonelik ödemesini iade ettiği form. Kartla alınan ödemede
 * para varsayılan olarak sağlayıcıdan iade edilir; tam iadede dönem sonu ödemenin
 * süresi kadar geri alınır, kısmi iadede dönem değişmez. Aynı form gönderimi tek
 * işlem anahtarı taşır (çift tıklama ikinci iade üretmez).
 */
export function AbonelikIadeFormu({ odeme, onTamam, onVazgec }: { odeme: IadeEdilecekOdeme; onTamam: (mesaj: string) => void; onVazgec: () => void }) {
  const kalan = Math.max(0, Math.round((Number(odeme.tutar) - Number(odeme.iade)) * 100) / 100);
  const [tutar, setTutar] = useState(kalan.toFixed(2));
  const [neden, setNeden] = useState("");
  const [gonder, setGonder] = useState(odeme.kaynak === "saglayici");
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const anahtar = useMemo(yeniAnahtar, []);
  const sayi = Number(tutar.replace(",", "."));
  const tutarGecerli = Number.isFinite(sayi) && sayi > 0 && sayi <= kalan + 1e-9 && /^\d+([.,]\d{1,2})?$/.test(tutar.trim());
  const gecerli = tutarGecerli && neden.trim().length >= 3;
  // Dönem uyarısı yalnız tutara bağlıdır; neden yazılmadan da görünür.
  const tam = tutarGecerli && Math.abs(sayi - kalan) < 0.005;
  const saglayiciAdi = odeme.saglayici ? SAGLAYICI_ADI[odeme.saglayici] ?? odeme.saglayici : "sağlayıcı";

  async function gonderForm(e: FormEvent) {
    e.preventDefault();
    if (!gecerli || isleniyor) return;
    setIsleniyor(true);
    setHata("");
    try {
      const sonuc = await platformApi<{ mesaj: string }>(`/platform/abonelik-odemeleri/${odeme.id}/iade`, {
        method: "POST",
        body: JSON.stringify({ tutar: sayi.toFixed(2), neden: neden.trim(), saglayiciyaGonder: gonder, islemAnahtari: anahtar }),
      });
      onTamam(sonuc.mesaj);
    } catch (h) {
      setHata(h instanceof Error ? h.message : "İade yapılamadı.");
    } finally {
      setIsleniyor(false);
    }
  }

  return (
    <form className="subscription-refund" onSubmit={gonderForm} aria-label="Abonelik ödemesini iade et">
      <p className="subscription-refund__summary">
        {odeme.unvan ? <strong>{odeme.unvan} · </strong> : null}
        Ödeme {tl(Number(odeme.tutar))} TL
        {Number(odeme.iade) > 0 ? ` · önce iade edilen ${tl(Number(odeme.iade))} TL` : ""} · iade edilebilir <strong>{tl(kalan)} TL</strong>
      </p>
      <div className="subscription-refund__fields">
        <Field label="İade tutarı (TL)">
          <Input inputMode="decimal" value={tutar} onChange={(e) => setTutar(e.target.value)} aria-invalid={!tutarGecerli || undefined} />
        </Field>
        <Field label="Neden">
          <Input value={neden} maxLength={300} onChange={(e) => setNeden(e.target.value)} placeholder="Örn. hizmet iptali, mükerrer ödeme" />
        </Field>
      </div>
      {odeme.kaynak === "saglayici" ? (
        <label className="subscription-refund__check">
          <input type="checkbox" checked={gonder} onChange={(e) => setGonder(e.target.checked)} />
          Parayı {saglayiciAdi} üzerinden müşteriye iade et
          {!gonder && <small> — yalnız kayıt yazılır (para {saglayiciAdi} panelinden iade edildiyse)</small>}
        </label>
      ) : (
        <p className="subscription-refund__note">Havale ile alınmış ödeme: para bankadan elle iade edilir; burada iade kaydı ve dönem işlenir.</p>
      )}
      <p className="subscription-refund__note">
        {tam
          ? `Tam iade: firmanın dönem sonu bu ödemenin süresi kadar (${odeme.aySayisi} ay) geri alınır.`
          : "Kısmi iade: abonelik dönemi değişmez."}{" "}
        Faturalayan firmaya belge (iptal/iade) için bildirim düşer; belge kendiliğinden kesilmez.
      </p>
      {hata && <Alert tone="error">{hata}</Alert>}
      <div className="subscription-refund__actions">
        <Button type="button" onClick={onVazgec} disabled={isleniyor}>Vazgeç</Button>
        <Button type="submit" variant="danger" disabled={!gecerli || isleniyor}>{isleniyor ? "İade ediliyor…" : `${tl(Number.isFinite(sayi) ? sayi : 0)} TL iade et`}</Button>
      </div>
    </form>
  );
}
