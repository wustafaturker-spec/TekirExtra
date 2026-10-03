"use client";

import { useEffect, useState } from "react";
import { bugunTR } from "@tekirextra/shared";
import { api, apiDosyaIndir } from "@/lib/api";
import { Badge, Button, Field, Input } from "@/components/ui";

type Durum = "bildirilir" | "esige_yakin" | "esik_alti";
interface FormOzeti { belgeSayisi: number; tutar: number; durum: Durum }
interface BabsVerisi { donemAdi: string; esik: number; cariKodlari: string[]; ba: FormOzeti; bs: FormOzeti }

const DURUM: Record<Durum, { ad: string; variant: "warning" | "info" | "neutral" }> = {
  bildirilir: { ad: "Bildirilir", variant: "warning" },
  esige_yakin: { ad: "Eşiğe yakın", variant: "info" },
  esik_alti: { ad: "Eşik altı", variant: "neutral" },
};
const tl = (n: number) => n.toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

/** Bildirimler bir sonraki ay verildiği için varsayılan dönem geçen aydır. */
function gecenAy(): string {
  const [y, a] = bugunTR().split("-").map(Number);
  return a === 1 ? `${y - 1}-12` : `${y}-${String(a - 1).padStart(2, "0")}`;
}

/**
 * CARI-37: cari kartında dönemin Form BA/BS özeti ve mutabakat mektubu (PDF,
 * e-posta). Aynı VKN'li cariler sunucuda tek kişi sayılır.
 */
export function BabsMutabakatPaneli({ cariId, cariKod, varsayilanEposta, onMesaj }: {
  cariId: string;
  cariKod: string;
  varsayilanEposta: string;
  onMesaj: (mesaj: { hata?: string; basari?: string }) => void;
}) {
  const [donem, setDonem] = useState(gecenAy);
  const [veri, setVeri] = useState<BabsVerisi | null>(null);
  const [eposta, setEposta] = useState(varsayilanEposta);
  const [islemde, setIslemde] = useState(false);
  const [yil, ay] = donem.split("-").map(Number);
  const gecerli = Boolean(yil && ay);

  useEffect(() => {
    if (!gecerli) return;
    let iptal = false;
    setVeri(null);
    api<BabsVerisi>(`/cari/${cariId}/babs?yil=${yil}&ay=${ay}`)
      .then((v) => { if (!iptal) setVeri(v); })
      .catch((h) => { if (!iptal) onMesaj({ hata: h instanceof Error ? h.message : "BA/BS özeti yüklenemedi" }); });
    return () => { iptal = true; };
  }, [cariId, yil, ay, gecerli, onMesaj]);

  async function gonder() {
    setIslemde(true);
    try {
      const sonuc = await api<{ mesaj: string }>(`/cari/${cariId}/babs/eposta`, { method: "POST", body: JSON.stringify({ yil, ay, alici: eposta || undefined }) });
      onMesaj({ basari: sonuc.mesaj });
    } catch (h) {
      onMesaj({ hata: h instanceof Error ? h.message : "Mutabakat gönderilemedi" });
    } finally {
      setIslemde(false);
    }
  }

  const satir = (ad: string, f: FormOzeti) => (
    <div className="invoice-summary__line">
      <span>{ad}</span>
      <strong>{f.belgeSayisi} belge · {tl(f.tutar)} <Badge variant={DURUM[f.durum].variant}>{DURUM[f.durum].ad}</Badge></strong>
    </div>
  );

  return (
    <details className="cari-babs">
      <summary>Form BA/BS mutabakatı</summary>
      <div className="cari-statement__toolbar">
        <Field label="Dönem"><Input type="month" value={donem} onChange={(e) => setDonem(e.target.value)} /></Field>
        <Button disabled={!gecerli} onClick={() => void apiDosyaIndir(`/cari/${cariId}/babs/pdf?yil=${yil}&ay=${ay}`, `babs-mutabakat-${cariKod}-${donem}.pdf`)}>PDF indir</Button>
      </div>
      {veri ? (
        <div className="invoice-summary">
          {satir("Form BA (bizim alışlarımız)", veri.ba)}
          {satir("Form BS (bizim satışlarımız)", veri.bs)}
          <small className="muted">
            {veri.donemAdi} · eşik {tl(veri.esik)} (KDV hariç, kişi başına aylık)
            {veri.cariKodlari.length > 1 ? ` · aynı VKN'li cariler birlikte: ${veri.cariKodlari.join(", ")}` : ""}
          </small>
        </div>
      ) : gecerli && <p className="subtle">Yükleniyor…</p>}
      <div className="cari-statement__mail">
        <Field label="Gönderilecek e-posta"><Input type="email" value={eposta} onChange={(e) => setEposta(e.target.value)} placeholder="muhasebe@firma.com" /></Field>
        <Button variant="primary" disabled={!gecerli || !eposta || islemde} onClick={() => void gonder()}>{islemde ? "Gönderiliyor…" : "Mutabakatı e-posta gönder"}</Button>
      </div>
    </details>
  );
}
