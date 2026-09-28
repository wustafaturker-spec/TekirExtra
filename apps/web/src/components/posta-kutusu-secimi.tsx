"use client";

/**
 * EBLG-86: alıcının GİB'de birden çok posta kutusu varsa hangisine
 * gönderileceği. Kural (bizim entegratörümüzün alan adı → `defaultpk` → en
 * yeni kayıt) bir tahmindir; cari kartında elle seçilen kutu, listede durduğu
 * sürece kuralın önüne geçer. Gönderim aynı sunucu işlevini kullanır: burada
 * görünen kutu gönderilen kutudur.
 */
import { useState } from "react";
import { Alert, Badge, Button, Select } from "@/components/ui";
import { api } from "@/lib/api";

export interface PostaKutusuSecimi {
  adaylar: { postaKutusu: string; kayitZamani: string | null }[];
  secilen?: string;
  kuralSecimi?: string;
  elleSecilen: string | null;
  elleSecilenGecersiz: boolean;
  /** EBLG-110: toplu listede olup entegratörün güncel listesinde olmayan kutular; seçilemez. */
  entegratordeYok?: string[];
}

const BELGE_ADI = { efatura: "e-Fatura", eirsaliye: "e-İrsaliye" } as const;

export function PostaKutusuSecimleri({ cariId, secimler, duzenlenebilir, onDegisti }: {
  cariId: string;
  secimler: { efatura: PostaKutusuSecimi; eirsaliye: PostaKutusuSecimi } | null | undefined;
  duzenlenebilir: boolean;
  onDegisti: () => void;
}) {
  const [hata, setHata] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  if (!secimler) return null;
  const turler = (["efatura", "eirsaliye"] as const).filter((t) => secimler[t].adaylar.length > 1);
  if (turler.length === 0) return null;

  async function sec(belgeTuru: "efatura" | "eirsaliye", postaKutusu: string | null) {
    setHata("");
    setKaydediliyor(true);
    try {
      await api(`/cari/${cariId}/posta-kutusu`, { method: "PATCH", body: JSON.stringify({ belgeTuru, postaKutusu }) });
      onDegisti();
    } catch (h) {
      setHata(h instanceof Error ? h.message : "Posta kutusu kaydedilemedi");
    } finally {
      setKaydediliyor(false);
    }
  }

  const tarih = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("tr-TR") : "tarih yok");
  return (
    <div className="stack" style={{ gap: "0.35rem", marginTop: "0.5rem", fontSize: "0.85rem" }}>
      {hata && <Alert tone="error">{hata}</Alert>}
      {turler.map((tur) => {
        const s = secimler[tur];
        const elle = Boolean(s.elleSecilen) && !s.elleSecilenGecersiz;
        return (
          <div key={tur} className="stack" style={{ gap: "0.2rem" }}>
            <div className="row-tight">
              <span className="muted">{BELGE_ADI[tur]} posta kutusu ({s.adaylar.length} aday):</span>
              <strong>{s.secilen ?? "—"}</strong>
              <Badge variant={elle ? "info" : "neutral"}>{elle ? "Elle seçildi" : "Otomatik"}</Badge>
            </div>
            {s.elleSecilenGecersiz && (
              <Alert tone="warning">
                {s.entegratordeYok?.includes(s.elleSecilen!)
                  ? `Elle seçilen ${s.elleSecilen} kutusu entegratörün güncel listesinde yok; bu kutuya giden e-İrsaliye taslakta kalır. Gönderimde otomatik seçim kullanılır.`
                  : `Elle seçilen ${s.elleSecilen} kutusu artık alıcının GİB listesinde yok; otomatik seçime dönüldü.`}
                {/* Liste zaten "Otomatik" gösterdiği için oradan seçmek değişiklik
                    sayılmaz ve eski kayıt silinemezdi; kaldırma burada yapılır. */}
                {duzenlenebilir && (
                  <>
                    {" "}
                    <Button size="sm" type="button" disabled={kaydediliyor} onClick={() => void sec(tur, null)}>Elle seçimi kaldır</Button>
                  </>
                )}
              </Alert>
            )}
            {duzenlenebilir && (
              <Select
                aria-label={`${BELGE_ADI[tur]} posta kutusu`}
                disabled={kaydediliyor}
                value={elle ? s.elleSecilen! : ""}
                onChange={(e) => void sec(tur, e.target.value || null)}
              >
                <option value="">Otomatik — {s.kuralSecimi ?? "seçilemedi"}</option>
                {s.adaylar.map((a) => {
                  const yok = s.entegratordeYok?.includes(a.postaKutusu) ?? false;
                  return <option key={a.postaKutusu} value={a.postaKutusu} disabled={yok}>{a.postaKutusu} · {tarih(a.kayitZamani)}{yok ? " — entegratör listesinde yok" : ""}</option>;
                })}
              </Select>
            )}
          </div>
        );
      })}
      <small className="muted">Otomatik seçim önce kendi entegratörümüzdeki kutuyu, sonra "defaultpk" adlı ve en yeni kaydı tercih eder; bir tahmindir. Alıcının kullandığı kutuyu biliyorsanız seçin.</small>
    </div>
  );
}
