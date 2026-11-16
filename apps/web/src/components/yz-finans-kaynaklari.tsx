"use client";
import { Tarih } from "@/components/ui";

export interface FinansKaynagi {
  arac: string; baslik: string; adres: string; alindiAt: string;
  /** AI-98; eski mesajlarda yoktur. */
  hesapSurumu?: string;
  donem: { baslangic?: string; bitis?: string; aciklama: string };
  kalemler: Array<{ ad: string; metrik?: string; deger: string; paraBirimi: string }>;
  uyarilar: string[];
}
const sayi = (deger: string) => {
  const [tam, kesir] = deger.split(".");
  return tam.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + `,${(kesir ?? "").padEnd(2, "0")}`;
};

export function YzFinansKaynaklari({ kaynaklar = [], kisaltildi = false }: { kaynaklar?: FinansKaynagi[]; kisaltildi?: boolean }) {
  if (!kaynaklar.length) return null;
  return <details style={{ marginTop: 10, fontSize: 12 }}>
    <summary>Kaynak verileri ({kaynaklar.length})</summary>
    {kaynaklar.map((k, i) => <div key={`${k.arac}-${i}`} style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}>
      {k.adres === "/panel" || k.adres.startsWith("/panel/") ? <a href={k.adres}>{k.baslik}</a> : <strong>{k.baslik}</strong>}
      <p>{k.donem.aciklama}{k.donem.baslangic && <> · <Tarih deger={k.donem.baslangic} /></>}{k.donem.bitis && <> {k.donem.baslangic ? "–" : "·"} <Tarih deger={k.donem.bitis} /></>}</p>
      {k.kalemler.map((t, n) => <p key={`${t.ad}-${n}`}>{t.ad}: <strong>{sayi(t.deger)} {t.paraBirimi}</strong>{t.metrik && <small className="muted"> · {t.metrik}</small>}</p>)}
      {k.uyarilar.map((u, n) => <p className="muted" key={n}>{u}</p>)}
      <small>Alındığı zaman: <Tarih deger={k.alindiAt} saatli />{k.hesapSurumu && <> · hesap {k.hesapSurumu}</>}</small>
    </div>)}
    {kisaltildi && <p>İlk 20 kaynak gösteriliyor; tüm ayrıntılar ilgili rapor ekranındadır.</p>}
    <p className="muted">Bu rakamlar yanıt sırasında alınmıştır. Bağlantıyı açtığınızda ekran güncel veriyi gösterebilir.</p>
  </details>;
}
