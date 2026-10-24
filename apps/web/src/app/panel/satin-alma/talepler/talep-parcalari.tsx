"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Field, Input, Modal, Para, Tarih } from "@/components/ui";

export type Durum = "taslak" | "onay_bekliyor" | "onaylandi" | "reddedildi" | "siparise_donustu" | "iptal";

export const DURUM: Record<Durum, { ad: string; ton: "neutral" | "info" | "success" | "danger" | "warning" }> = {
  taslak: { ad: "Taslak", ton: "neutral" },
  onay_bekliyor: { ad: "Onay bekliyor", ton: "warning" },
  onaylandi: { ad: "Onaylandı", ton: "info" },
  reddedildi: { ad: "Reddedildi", ton: "danger" },
  siparise_donustu: { ad: "Siparişe dönüştü", ton: "success" },
  iptal: { ad: "İptal", ton: "neutral" },
};

/* ─── Akış göstergesi ──────────────────────────────────────────────────────
   Talep gerçekten sıralı dört aşamadan geçer; numaralar bu sırayı anlatır. */

type AdimDurumu = "tamam" | "aktif" | "bekliyor" | "kapali";

function adimlar(durum: Durum, yenidenOnay: boolean): { ad: string; durum: AdimDurumu }[] {
  // SAT-09: seçilen teklif sınırı aştıysa teklif ile sipariş arasına yeniden onay girer.
  if (yenidenOnay) {
    const ad = ["Taslak", "Onay", "Teklif", "Yeniden onay", "Sipariş"];
    const sira: AdimDurumu[] = durum === "onay_bekliyor" ? ["tamam", "tamam", "tamam", "aktif", "bekliyor"]
      : durum === "reddedildi" ? ["tamam", "tamam", "tamam", "kapali", "bekliyor"]
      : ["tamam", "tamam", "tamam", "kapali", "kapali"];
    return sira.map((d, i) => ({ ad: i === 3 && durum === "reddedildi" ? "Reddedildi" : ad[i], durum: d }));
  }
  const ad = ["Taslak", "Onay", "Teklif", "Sipariş"];
  const sira: Record<Durum, AdimDurumu[]> = {
    taslak: ["aktif", "bekliyor", "bekliyor", "bekliyor"],
    onay_bekliyor: ["tamam", "aktif", "bekliyor", "bekliyor"],
    onaylandi: ["tamam", "tamam", "aktif", "bekliyor"],
    siparise_donustu: ["tamam", "tamam", "tamam", "tamam"],
    reddedildi: ["tamam", "kapali", "bekliyor", "bekliyor"],
    iptal: ["tamam", "kapali", "kapali", "kapali"],
  };
  return sira[durum].map((d, i) => ({ ad: i === 1 && durum === "reddedildi" ? "Reddedildi" : ad[i], durum: d }));
}

export function AkisGostergesi({ durum, yenidenOnay }: { durum: Durum; yenidenOnay: boolean }) {
  return (
    <ol className="sat-akis" aria-label="Talep aşamaları">
      {adimlar(durum, yenidenOnay).map((a, i) => (
        <li key={a.ad} className={`sat-akis__adim is-${a.durum}`} aria-current={a.durum === "aktif" ? "step" : undefined}>
          <span className="sat-akis__no" aria-hidden="true">{a.durum === "tamam" ? "✓" : i + 1}</span>
          <span>{a.ad}</span>
        </li>
      ))}
    </ol>
  );
}

/* ─── Onay sınırına göre tutar çubuğu ──────────────────────────────────────
   Teklif tutarını yeniden onay sınırına göre gösterir; sınır çizgisi sabit
   bir yerde durur ki teklifler aynı ölçekte karşılaştırılsın. */

export function TutarCubugu({ tutar, sinir, olcek }: { tutar: number; sinir: number; olcek: number }) {
  const yuzde = (v: number) => `${Math.min(100, (v / olcek) * 100).toFixed(1)}%`;
  const asim = tutar > sinir;
  return (
    <div className={`sat-cubuk${asim ? " is-asim" : ""}`}>
      <div className="sat-cubuk__iz">
        <span className="sat-cubuk__dolgu" style={{ width: yuzde(tutar) }} />
        <span className="sat-cubuk__sinir" style={{ left: yuzde(sinir) }} title="Yeniden onay sınırı" />
      </div>
      <small>{asim ? <>Sınırı <Para deger={tutar - sinir} /> aşıyor</> : <>Sınıra <Para deger={sinir - tutar} /> var</>}</small>
    </div>
  );
}

/* ─── Geçmiş ───────────────────────────────────────────────────────────── */

const OLAY_ADI: Record<string, string> = {
  olusturuldu: "Oluşturuldu", guncellendi: "Güncellendi", onaya_gonderildi: "Onaya gönderildi", geri_cekildi: "Geri çekildi",
  onaylandi: "Onaylandı", reddedildi: "Reddedildi", iptal_edildi: "İptal edildi", teklif_eklendi: "Teklif eklendi",
  teklif_silindi: "Teklif silindi", teklif_secildi: "Teklif seçildi", siparise_donustu: "Siparişe dönüştü",
  yeniden_onaya_gonderildi: "Yeniden onaya düştü",
};

const OLAY_TONU: Record<string, string> = { onaylandi: "is-iyi", siparise_donustu: "is-iyi", reddedildi: "is-kotu", iptal_edildi: "is-kotu", yeniden_onaya_gonderildi: "is-uyari" };

export function Gecmis({ olaylar }: { olaylar: { tur: string; aciklama: string | null; kullanici: string; zaman: string }[] }) {
  if (!olaylar.length) return <p className="subtle">Henüz kayıtlı işlem yok.</p>;
  return (
    <ol className="sat-gecmis">
      {[...olaylar].reverse().map((o, i) => (
        <li key={`${o.zaman}-${i}`} className={OLAY_TONU[o.tur] ?? ""}>
          <div className="sat-gecmis__baslik">
            <strong>{OLAY_ADI[o.tur] ?? o.tur}</strong>
            <span className="muted">{o.kullanici}</span>
            <time className="subtle" dateTime={o.zaman}><Tarih deger={o.zaman} saatli /></time>
          </div>
          {o.aciklama && <p>{o.aciklama}</p>}
        </li>
      ))}
    </ol>
  );
}

/* ─── Karar penceresi ──────────────────────────────────────────────────────
   Onay, red, iptal ve teklif seçimi kendi gerekçesiyle açılır; tek ortak
   gerekçe kutusu bir kararın gerekçesini öbürüne taşıyordu. */

export interface KararTanimi {
  baslik: string;
  aciklama?: ReactNode;
  icerik?: ReactNode;
  gerekceEtiketi?: string;
  /** Verilirse gerekçe zorunludur ve en az bu kadar karakter olmalıdır. */
  enAzGerekce?: number;
  /** Gerekçe alanı hiç gösterilmez. */
  gerekcesiz?: boolean;
  onayMetni: string;
  tehlikeli?: boolean;
  calistir: (gerekce: string) => Promise<void>;
}

export function KararPenceresi({ karar, onKapat, isleniyor }: { karar: KararTanimi; onKapat: () => void; isleniyor: boolean }) {
  const [gerekce, setGerekce] = useState("");
  const eksik = karar.enAzGerekce !== undefined && gerekce.trim().length < karar.enAzGerekce;
  function gonder(e: FormEvent) {
    e.preventDefault();
    if (eksik || isleniyor) return;
    void karar.calistir(gerekce.trim());
  }
  return (
    <Modal baslik={karar.baslik} aciklama={karar.aciklama} onKapat={onKapat}>
      <form className="stack" onSubmit={gonder}>
        {karar.icerik}
        {!karar.gerekcesiz && (
          <Field label={karar.gerekceEtiketi ?? (karar.enAzGerekce ? "Gerekçe" : "Gerekçe (isteğe bağlı)")}>
            <Input autoFocus value={gerekce} onChange={(e) => setGerekce(e.target.value)} maxLength={500} aria-invalid={eksik || undefined} />
          </Field>
        )}
        {karar.enAzGerekce !== undefined && eksik && gerekce.length > 0 && <p className="subtle">En az {karar.enAzGerekce} karakter yazın.</p>}
        <div className="row-tight" style={{ justifyContent: "flex-end" }}>
          <Button type="button" onClick={onKapat}>Vazgeç</Button>
          <Button type="submit" variant={karar.tehlikeli ? "danger" : "primary"} disabled={isleniyor || eksik}>{isleniyor ? "İşleniyor…" : karar.onayMetni}</Button>
        </div>
      </form>
    </Modal>
  );
}
