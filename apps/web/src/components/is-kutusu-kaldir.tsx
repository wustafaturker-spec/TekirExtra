"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Alert, Input, Modal, ModalEylem } from "@/components/ui";

export type KaldirTuru = "eposta" | "yanit" | "onay";
type Neden = "elle_yapildi" | "iptal" | "teklif_degil";
interface Aday { id: string; no: string | null; tarih: string; durum: string; tutar: string; doviz: string; cari: { id: string; unvan: string } }

export interface KaldirHedefi {
  tur: KaldirTuru;
  id: string;
  baslik: string;
  /** Bilinen cari: "Elle yapıldı"da o carinin teklifleri önerilir. */
  cariId?: string | null;
  /** E-postadan açılmış taslak; kaldırılınca silinir, aday listesinde gösterilmez. */
  taslakId?: string | null;
}

const NEDENLER: Array<{ deger: Neden; ad: string; aciklama: string }> = [
  { deger: "elle_yapildi", ad: "Elle yapıldı", aciklama: "Teklif ya da iş kutunun dışında yapıldı." },
  { deger: "iptal", ad: "İptal / gerek yok", aciklama: "Müşteri vazgeçti ya da yapılacak bir şey kalmadı." },
  { deger: "teklif_degil", ad: "Teklif talebi değil", aciklama: "Yapay zekâ bu örnekten öğrenir; benzer e-postalar talep sayılmaz." },
];
const tutar = (t: string, d: string) => `${Number(t).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${d}`;

/**
 * AI-66…68: iş kutusundaki kaydı nedenle kaldırır. "Elle yapıldı"da e-posta
 * talebi kullanıcının elle girdiği teklife isteğe bağlı bağlanır (AI-67).
 */
export function IsKutusuKaldir({ hedef, onKapat, onTamam }: { hedef: KaldirHedefi; onKapat: () => void; onTamam: (mesaj: string) => void }) {
  const [neden, setNeden] = useState<Neden>("elle_yapildi");
  const [not, setNot] = useState("");
  const [arama, setArama] = useState("");
  const [adaylar, setAdaylar] = useState<Aday[] | null>(null);
  const [bagli, setBagli] = useState<string>("");
  const [hata, setHata] = useState("");
  const [isleniyor, setIsleniyor] = useState(false);
  const notId = useId();
  const aramaId = useId();
  const epostaMi = hedef.tur === "eposta";
  const teklifSecimi = epostaMi && neden === "elle_yapildi";

  useEffect(() => {
    if (!teklifSecimi) return;
    // Cari bilinmiyorsa liste aramayla dolar; boş aramada en yeni teklifler gelir.
    const q = new URLSearchParams();
    if (hedef.cariId && !arama.trim()) q.set("cariId", hedef.cariId);
    if (arama.trim()) q.set("arama", arama.trim());
    if (hedef.taslakId) q.set("haric", hedef.taslakId);
    const zamanlayici = setTimeout(() => {
      api<Aday[]>(`/is-kutusu/teklif-adaylari?${q}`).then(setAdaylar).catch(() => setAdaylar([]));
    }, arama ? 300 : 0);
    return () => clearTimeout(zamanlayici);
  }, [teklifSecimi, arama, hedef.cariId, hedef.taslakId]);

  async function gonder(e: FormEvent) {
    e.preventDefault();
    setIsleniyor(true); setHata("");
    try {
      const sonuc = await api<{ uyari: string | null }>("/is-kutusu/kapat", {
        method: "POST",
        body: JSON.stringify({ tur: hedef.tur, id: hedef.id, neden, not: not.trim() || null, belgeId: teklifSecimi && bagli ? bagli : null }),
      });
      onTamam(sonuc.uyari ?? `“${hedef.baslik}” iş kutusundan kaldırıldı.`);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Kaldırılamadı");
    } finally {
      setIsleniyor(false);
    }
  }

  const nedenler = NEDENLER.filter((n) => epostaMi || n.deger !== "teklif_degil");
  return (
    <Modal baslik="İş kutusundan kaldır" aciklama={hedef.baslik} onKapat={onKapat} genis={teklifSecimi}>
      <form className="stack" onSubmit={gonder}>
        <Alert tone="error">{hata}</Alert>
        <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="field-label">Neden</legend>
          {nedenler.map((n) => (
            <label key={n.deger} className="check-row">
              <input type="radio" name="kaldirma-nedeni" checked={neden === n.deger} onChange={() => setNeden(n.deger)} />
              <span><strong>{n.ad}</strong> <span className="muted">— {n.aciklama}</span></span>
            </label>
          ))}
        </fieldset>
        {hedef.tur === "onay" && <p className="muted">Onay talebi reddedilir; bu geri alınamaz.</p>}
        {epostaMi && hedef.taslakId && <p className="muted">E-postadan açılan taslak teklif silinir.</p>}

        {teklifSecimi && (
          <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="field-label">Elle girdiğiniz teklif (isteğe bağlı)</legend>
            <p className="muted">Seçerseniz e-posta bu teklife bağlanır; teklif onaylanınca yapay zekâ ürün eşleşmelerini ondan öğrenir.</p>
            <label className="field-label" htmlFor={aramaId}>Teklif no ya da cari ara</label>
            <Input id={aramaId} value={arama} onChange={(e) => setArama(e.target.value)} placeholder={hedef.cariId ? "Boş bırakırsanız bu carinin teklifleri" : "Teklif no ya da cari ünvanı"} />
            <ul className="is-kutusu__adaylar">
              <li>
                <label className="check-row">
                  <input type="radio" name="bagli-teklif" checked={!bagli} onChange={() => setBagli("")} />
                  <span>Teklif bağlama</span>
                </label>
              </li>
              {adaylar?.map((a) => (
                <li key={a.id}>
                  <label className="check-row">
                    <input type="radio" name="bagli-teklif" checked={bagli === a.id} onChange={() => setBagli(a.id)} />
                    <span>{a.no ?? "Taslak teklif"} · {a.cari.unvan} <span className="muted">— {a.tarih.split("-").reverse().join(".")} · {tutar(a.tutar, a.doviz)}</span></span>
                  </label>
                </li>
              ))}
              {adaylar && !adaylar.length && <li className="muted">Eşleşen teklif yok.</li>}
            </ul>
          </fieldset>
        )}

        <label className="field-label" htmlFor={notId}>Not (isteğe bağlı)</label>
        <textarea id={notId} className="input" rows={2} maxLength={300} value={not} onChange={(e) => setNot(e.target.value)} placeholder="Örn. telefonla teklif verildi" />
        <ModalEylem onVazgec={onKapat} isleniyor={isleniyor} metin={hedef.tur === "onay" ? "Reddet ve kaldır" : "Kaldır"} tehlikeli={hedef.tur === "onay"} />
      </form>
    </Modal>
  );
}
