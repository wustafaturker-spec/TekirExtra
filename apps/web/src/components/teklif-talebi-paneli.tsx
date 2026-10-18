"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button } from "@/components/ui";
import { CariSecModali } from "@/components/cari-sec-modali";

type Durum = "isleniyor" | "atlandi" | "teklif_degil" | "incelenmeli" | "cari_secimi" | "cari_onayi_bekliyor" | "cari_yok" | "taslak_hazir" | "sinirda" | "hata";

interface Kalem { ifade: string; miktar: number | null; birim: string | null; stokId: string | null; kod: string | null; ad: string | null; belirsizKart?: { kartKodu: string; kartAdi: string; secenekler: string[] } }
interface Islem {
  durum: Durum; guven: number | null; uyarilar: string[]; kalemler: Kalem[]; hata: string | null;
  belgeAdresi: string | null; onayAdresi: string | null; yanitOnerisi: string | null;
  cariAdaylari: Array<{ cariId: string; kod: string | null; unvan: string; vknTckn: string | null; gerekceler: string[] }>;
}

type Varyant = "neutral" | "accent" | "success" | "info" | "danger" | "warning";
export const TEKLIF_DURUMU: Record<Durum, { ad: string; varyant: Varyant }> = {
  isleniyor: { ad: "İşleniyor", varyant: "info" },
  atlandi: { ad: "Otomatik ileti", varyant: "neutral" },
  teklif_degil: { ad: "Teklif talebi değil", varyant: "neutral" },
  incelenmeli: { ad: "Teklif: incelenmeli", varyant: "warning" },
  cari_secimi: { ad: "Teklif: cari seçimi bekliyor", varyant: "warning" },
  cari_onayi_bekliyor: { ad: "Teklif: cari onayı bekliyor", varyant: "warning" },
  cari_yok: { ad: "Teklif: cari yok", varyant: "warning" },
  taslak_hazir: { ad: "Teklif taslağı hazır", varyant: "success" },
  sinirda: { ad: "Teklif: AI sınırında", varyant: "danger" },
  hata: { ad: "Teklif: hata", varyant: "danger" },
};

/** Listede küçük rozet; teklifle ilgisi olmayan sonuçlar gösterilmez. */
export function TeklifTalebiRozeti({ durum }: { durum: string | null | undefined }) {
  if (!durum || durum === "teklif_degil" || durum === "atlandi") return null;
  const d = TEKLIF_DURUMU[durum as Durum];
  return d ? <Badge variant={d.varyant}>{d.ad}</Badge> : null;
}

const YENIDEN: Durum[] = ["atlandi", "teklif_degil", "incelenmeli", "cari_yok", "sinirda", "hata"];

/**
 * AI-37: seçili e-postanın teklif talebi işlemi — durum, kalem eşleşmeleri,
 * uyarılar, taslak/onay bağlantıları ve elle "Taslak hazırla".
 */
export function TeklifTalebiPaneli({ epostaId, onDegisti }: { epostaId: string; onDegisti?: () => void }) {
  const [islem, setIslem] = useState<Islem | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState("");
  const [cariSec, setCariSec] = useState(false);

  const yukle = useCallback(async () => {
    setHata("");
    try { setIslem((await api<{ islem: Islem | null }>(`/ai/teklif-talepleri/${epostaId}`)).islem); }
    catch (e) { setHata(e instanceof Error ? e.message : "Teklif talebi durumu okunamadı"); }
  }, [epostaId]);
  useEffect(() => { setIslem(null); void yukle(); }, [yukle]);

  async function hazirla(secim: { cariId?: string; yeniCari?: true } = {}) {
    setCariSec(false); setYukleniyor(true); setHata("");
    try {
      setIslem(await api<Islem>(`/ai/teklif-talepleri/${epostaId}/hazirla`, { method: "POST", body: JSON.stringify(secim) }));
      onDegisti?.();
    } catch (e) { setHata(e instanceof Error ? e.message : "Taslak hazırlanamadı"); }
    finally { setYukleniyor(false); }
  }

  const d = islem ? TEKLIF_DURUMU[islem.durum] : null;
  const yenidenCalisir = !islem || (YENIDEN.includes(islem.durum) && !islem.belgeAdresi);
  return (
    <div className="teklif-talebi">
      <div className="row-tight teklif-talebi__ust">
        {d ? <Badge variant={d.varyant}>{d.ad}</Badge> : <span className="muted">Teklif talebi olarak işlenmedi</span>}
        {islem?.guven != null && islem.durum !== "atlandi" && <span className="muted">Güven %{Math.round(islem.guven * 100)}</span>}
        {islem?.belgeAdresi && <Link href={islem.belgeAdresi}>Taslağı aç</Link>}
        {islem?.onayAdresi && islem.durum === "cari_onayi_bekliyor" && <Link href={islem.onayAdresi}>Cari açma onayı</Link>}
        {yenidenCalisir && <Button size="sm" disabled={yukleniyor} onClick={() => void hazirla()}>{yukleniyor ? "Hazırlanıyor…" : islem ? "Yeniden dene" : "Taslak hazırla"}</Button>}
        {(islem?.durum === "cari_yok" || islem?.durum === "cari_secimi") && <Button size="sm" disabled={yukleniyor} onClick={() => setCariSec(true)}>{islem.durum === "cari_secimi" ? "Başka cari seç" : "Cari seçerek hazırla"}</Button>}
        {islem?.durum === "cari_secimi" && <Button size="sm" disabled={yukleniyor} onClick={() => void hazirla({ yeniCari: true })}>Hiçbiri, yeni cari aç</Button>}
      </div>
      {islem?.durum === "cari_secimi" && !!islem.cariAdaylari.length && (
        <ul className="teklif-talebi__adaylar" aria-label="Olası cariler">
          {islem.cariAdaylari.map((a) => (
            <li key={a.cariId}>
              <span><strong>{a.unvan}</strong>{a.kod ? <span className="muted"> · {a.kod}</span> : null} <span className="muted">— {a.gerekceler.join(" · ")}</span></span>
              <Button size="sm" variant="primary" disabled={yukleniyor} onClick={() => void hazirla({ cariId: a.cariId })}>Bu cari</Button>
            </li>
          ))}
        </ul>
      )}
      {hata && <Alert tone="error">{hata}</Alert>}
      {islem?.hata && <Alert tone="error">{islem.hata}</Alert>}
      {!!islem?.uyarilar.length && <ul className="teklif-talebi__uyarilar">{islem.uyarilar.map((u, i) => <li key={i}>{u}</li>)}</ul>}
      {!!islem?.kalemler.length && (
        <ul className="teklif-talebi__kalemler" aria-label="İstenen kalemler">
          {islem.kalemler.map((k, i) => (
            <li key={i}>
              <span>{k.ifade}{k.miktar !== null ? ` — ${k.miktar}${k.birim ? ` ${k.birim}` : ""}` : ""}</span>
              {k.stokId ? <span className="muted"> → [{k.kod}] {k.ad}</span>
                : k.belirsizKart ? <><span className="muted"> → [{k.belirsizKart.kartKodu}] {k.belirsizKart.kartAdi}</span> <Badge variant="warning">Varyant belirtilmemiş</Badge></>
                : <Badge variant="warning">Stokta yok</Badge>}
            </li>
          ))}
        </ul>
      )}
      {islem?.yanitOnerisi && <YanitOnerisi metin={islem.yanitOnerisi} />}
      {cariSec && (
        <CariSecModali
          baslik="Teklif hangi cariye hazırlansın?"
          aciklama="Gönderen adresi bir cariyle tek başına eşleşmedi. Seçtiğiniz cari için önceki çıkarımla taslak hazırlanır."
          onSec={(c) => void hazirla({ cariId: c.id })}
          onKapat={() => setCariSec(false)}
        />
      )}
    </div>
  );
}

/** Varyantı belirsiz kalemler için müşteriye sorulacak metin; gönderim kullanıcının posta programından. */
function YanitOnerisi({ metin }: { metin: string }) {
  const [kopyalandi, setKopyalandi] = useState(false);
  async function kopyala() {
    try {
      await navigator.clipboard.writeText(metin);
      setKopyalandi(true);
      setTimeout(() => setKopyalandi(false), 2000);
    } catch {
      setKopyalandi(false);
    }
  }
  return (
    <div className="teklif-talebi__yanit">
      <div className="between">
        <strong>Müşteriye sorulacak yanıt önerisi</strong>
        <Button size="sm" onClick={() => void kopyala()}>{kopyalandi ? "✓ Kopyalandı" : "Kopyala"}</Button>
      </div>
      <pre>{metin}</pre>
    </div>
  );
}
