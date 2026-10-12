"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { paraBicimi } from "@/lib/doviz-uyumu";
import { HizliKayitPaneli } from "@/components/hizli-kayit-paneli";
import { Alert, Button, TableWrap } from "@/components/ui";

interface DenklestirmeFaturasi {
  id: string;
  no: string | null;
  tip: string;
  tarih: string;
  vadeTarihi: string | null;
  dovizCinsi: string;
  genelToplam: string;
  kalanOnce: string;
  kalanSonra: string;
}

interface DenklestirmeSonucu {
  bekleyenGecmisVar: boolean;
  degisenFatura: number;
  faturalar: DenklestirmeFaturasi[];
}

const TIP_ADI: Record<string, string> = { satis: "Satış", alis: "Alış", satis_iade: "Satış iade", alis_iade: "Alış iade" };
const gun = (iso: string) => iso.split("-").reverse().join(".");

/**
 * KSB-16: "Vadeye göre yeniden denkleştir". Bütün ödeme ve iadeler (göç
 * öncesi dahil) açık faturalara vade sırasıyla dağıtılır; elle bağlanan
 * kapamalar korunur. Önce önizleme gösterilir, onayla uygulanır.
 */
export function DenklestirmePaneli({ cariId, onKapat, onUygulandi }: { cariId: string; onKapat: () => void; onUygulandi: (mesaj: string) => void }) {
  const [onizleme, setOnizleme] = useState<DenklestirmeSonucu | null>(null);
  const [hata, setHata] = useState("");
  const [uygulaniyor, setUygulaniyor] = useState(false);

  useEffect(() => {
    api<DenklestirmeSonucu>(`/cari/${cariId}/denklestirme`)
      .then(setOnizleme)
      .catch((h: unknown) => setHata(h instanceof Error ? h.message : "Önizleme alınamadı"));
  }, [cariId]);

  async function uygula() {
    setHata(""); setUygulaniyor(true);
    try {
      const sonuc = await api<DenklestirmeSonucu>(`/cari/${cariId}/denklestir`, { method: "POST" });
      onUygulandi(sonuc.degisenFatura ? `Cari vadeye göre denkleştirildi; ${sonuc.degisenFatura} faturanın kalanı değişti.` : "Cari zaten vadeye göre denkleşik; değişiklik olmadı.");
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Denkleştirme yapılamadı");
    } finally {
      setUygulaniyor(false);
    }
  }

  return (
    <HizliKayitPaneli baslik="Vadeye göre yeniden denkleştir" onKapat={onKapat}>
      <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
        Faturaya bağlanmamış tahsilat, ödeme, çek ve iadeler en erken vadeli açık faturadan başlayarak dağıtılır. Faturaya elle bağlanmış ödemeler değişmez.
      </p>
      {hata && <Alert tone="error">{hata}</Alert>}
      {!onizleme && !hata && <p className="muted">Önizleme hazırlanıyor…</p>}
      {onizleme && (
        <>
          {onizleme.bekleyenGecmisVar && (
            <Alert tone="warning">Bu caride geçiş öncesi girilmiş, faturaya dağıtılmamış ödeme ya da iade olabilir; denkleştirme bunları da dağıtır.</Alert>
          )}
          {onizleme.faturalar.length === 0 ? (
            <p className="muted">Açık fatura yok; değişecek bir şey bulunmuyor.</p>
          ) : (
            <TableWrap>
              <thead>
                <tr><th>Fatura</th><th>Vade</th><th className="num">Toplam</th><th className="num">Şu anki kalan</th><th className="num">Sonraki kalan</th></tr>
              </thead>
              <tbody>
                {onizleme.faturalar.map((f) => (
                  <tr key={f.id} style={f.kalanOnce !== f.kalanSonra ? { fontWeight: 700 } : undefined}>
                    <td>{f.no ?? "Numarasız"} <small className="muted">{TIP_ADI[f.tip] ?? f.tip}</small></td>
                    <td>{gun(f.vadeTarihi ?? f.tarih)}</td>
                    <td className="num">{paraBicimi(f.genelToplam, f.dovizCinsi)}</td>
                    <td className="num">{paraBicimi(f.kalanOnce, f.dovizCinsi)}</td>
                    <td className="num">{paraBicimi(f.kalanSonra, f.dovizCinsi)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            {onizleme.degisenFatura ? `${onizleme.degisenFatura} faturanın kalanı değişecek (kalın satırlar).` : "Hiçbir faturanın kalanı değişmeyecek."}
          </p>
        </>
      )}
      <div className="quick-panel__actions">
        <Button type="button" onClick={onKapat}>Vazgeç</Button>
        <Button type="button" variant="primary" disabled={!onizleme || uygulaniyor} onClick={() => void uygula()}>{uygulaniyor ? "Denkleştiriliyor…" : "Denkleştir"}</Button>
      </div>
    </HizliKayitPaneli>
  );
}
