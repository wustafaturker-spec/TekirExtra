"use client";

/**
 * Ödeme paketleri (ENT-07): aynı kaynak hesabın onaylı talimatları. Dosya
 * hesabın profiline göre üretilir; ilk indirmede talimatlar "bankaya
 * gönderildi" olur. Yeniden indirme onay ister (bankaya iki kez yüklenmesin).
 */
import { useEffect, useState } from "react";
import { api, apiDosyaIndir } from "@/lib/api";
import { Badge, Button, Para } from "@/components/ui";
import { DURUM, type TalimatDurumu } from "./tipler";

interface Paket {
  id: string; no: string; dosyaBicimi: string; toplam: string; adet: number; indirmeSayisi: number; sonIndirme: string | null; iptal: boolean; createdAt: string;
  bankaHesap: { id: string; ad: string; bankaAdi: string };
  talimatlar: Array<{ id: string; no: string | null; durum: TalimatDurumu; aliciUnvan: string; tutar: string }>;
}
const BICIM_ADI: Record<string, string> = { xlsx: "Excel", csv: "CSV", pain001: "ISO 20022 XML" };

export function Paketler({ yenile, onMesaj }: { yenile: number; onMesaj: (m: string, hata?: boolean) => void }) {
  const [paketler, setPaketler] = useState<Paket[]>([]);
  const [onayBekleyen, setOnayBekleyen] = useState<string | null>(null);
  const [icYenile, setIcYenile] = useState(0);

  useEffect(() => { void api<Paket[]>("/kasa-banka/odeme-paketleri").then(setPaketler).catch((e) => onMesaj(e instanceof Error ? e.message : "Paketler yüklenemedi", true)); }, [yenile, icYenile, onMesaj]);

  async function indir(p: Paket) {
    try {
      const uzanti = p.dosyaBicimi === "pain001" ? "xml" : p.dosyaBicimi;
      await apiDosyaIndir(`/kasa-banka/odeme-paketleri/${p.id}/dosya`, `${p.no}.${uzanti}`);
      onMesaj(p.indirmeSayisi ? `${p.no} dosyası yeniden indirildi.` : `${p.no} dosyası indirildi; ${p.adet} talimat "bankaya gönderildi" oldu. Dosyayı bankanızın internet şubesindeki toplu ödeme ekranına yükleyin.`);
      setOnayBekleyen(null);
      setIcYenile((x) => x + 1);
    } catch (e) {
      onMesaj(e instanceof Error ? e.message : "Dosya indirilemedi", true);
    }
  }

  async function iptal(p: Paket) {
    try {
      await api(`/kasa-banka/odeme-paketleri/${p.id}/iptal`, { method: "POST" });
      onMesaj(`${p.no} iptal edildi; talimatlar yeniden pakete alınabilir.`);
      setIcYenile((x) => x + 1);
    } catch (e) {
      onMesaj(e instanceof Error ? e.message : "Paket iptal edilemedi", true);
    }
  }

  return (
    <section className="ot-packages">
      {paketler.map((p) => {
        const gerceklesen = p.talimatlar.filter((t) => t.durum === "gerceklesti").length;
        return (
          <article key={p.id} className={`ot-package${p.iptal ? " is-cancelled" : ""}`}>
            <header>
              <div>
                <span className="mono">{p.no}</span>
                <strong>{p.bankaHesap.bankaAdi} · {p.bankaHesap.ad}</strong>
                <small>{new Date(p.createdAt).toLocaleString("tr-TR")} · {BICIM_ADI[p.dosyaBicimi] ?? p.dosyaBicimi} · {p.adet} talimat{p.indirmeSayisi ? ` · ${p.indirmeSayisi} kez indirildi` : " · henüz indirilmedi"}{gerceklesen ? ` · ${gerceklesen}/${p.adet} gerçekleşti` : ""}</small>
              </div>
              <b><Para deger={p.toplam} dovizCinsi="TRY" /></b>
              <div className="row-tight">
                {p.iptal ? <Badge variant="neutral">İptal</Badge> : (
                  <>
                    {p.indirmeSayisi === 0 && <Button size="sm" onClick={() => void iptal(p)}>İptal</Button>}
                    {p.indirmeSayisi > 0 && onayBekleyen !== p.id
                      ? <Button size="sm" onClick={() => setOnayBekleyen(p.id)}>Yeniden indir</Button>
                      : <Button size="sm" variant="primary" onClick={() => void indir(p)}>{p.indirmeSayisi ? "Evet, yeniden indir" : "Dosyayı indir"}</Button>}
                  </>
                )}
              </div>
            </header>
            {onayBekleyen === p.id && <p className="ot-warn">Bu paket daha önce indirildi{p.sonIndirme ? ` (${new Date(p.sonIndirme).toLocaleString("tr-TR")})` : ""}. Bankaya yeniden yüklerseniz ödemeler iki kez yapılabilir.</p>}
            <ul>
              {p.talimatlar.map((t) => <li key={t.id}><span className="mono">{t.no}</span> {t.aliciUnvan} <Para deger={t.tutar} dovizCinsi="TRY" /> <Badge variant={DURUM[t.durum].ton}>{DURUM[t.durum].ad}</Badge></li>)}
            </ul>
          </article>
        );
      })}
      {!paketler.length && <p className="ot-empty">Henüz ödeme paketi yok. Talimatlar sekmesinde onaylı talimatları seçip "Ödeme paketi oluştur" deyin.</p>}
    </section>
  );
}
