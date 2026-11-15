"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge } from "@/components/ui";

/* ─── API sözleşmesi (GET /fiyat-endeks/teklif-uyarilari?ids=…) ──────────── */
export interface TeklifUyarisi { tur: "kur" | "endeks"; degisim: string; mesaj: string }
export type TeklifUyarilari = Record<string, TeklifUyarisi[]>;

/**
 * END-20: açık satış tekliflerinin kur/endeks uyarıları. Plan özelliği ya da
 * satış tarafı erişimi yoksa istek reddedilir ve hiçbir şey gösterilmez.
 * Teklif kendiliğinden değişmez.
 */
export function useTeklifUyarilari(belgeIdler: string[]): TeklifUyarilari {
  const anahtar = useMemo(() => [...new Set(belgeIdler)].sort().slice(0, 100).join(","), [belgeIdler]);
  const [uyarilar, setUyarilar] = useState<TeklifUyarilari>({});
  useEffect(() => {
    if (!anahtar) { setUyarilar({}); return; }
    let iptal = false;
    api<TeklifUyarilari>(`/fiyat-endeks/teklif-uyarilari?ids=${anahtar}`).then((r) => { if (!iptal) setUyarilar(r); }).catch(() => { if (!iptal) setUyarilar({}); });
    return () => { iptal = true; };
  }, [anahtar]);
  return uyarilar;
}

/** Liste rozeti: ayrıntı rozetin ipucundadır. */
export function TeklifEndeksRozeti({ uyarilar }: { uyarilar?: TeklifUyarisi[] }) {
  if (!uyarilar?.length) return null;
  const turler = [...new Set(uyarilar.map((u) => (u.tur === "kur" ? "Kur" : "Endeks")))].join("/");
  return <span title={uyarilar.map((u) => u.mesaj).join("\n")}><Badge variant="warning">{turler} değişti</Badge></span>;
}

/** Teklif ekranındaki uyarı kutusu. */
export function TeklifEndeksUyariKutusu({ belgeId }: { belgeId: string }) {
  const uyarilar = useTeklifUyarilari([belgeId])[belgeId];
  if (!uyarilar?.length) return null;
  return <Alert tone="warning">
    <strong>Teklif tarihinden bu yana fiyat koşulları değişti</strong>
    <ul style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>{uyarilar.map((u) => <li key={u.tur}>{u.mesaj}</li>)}</ul>
    <small className="muted">Teklif kendiliğinden değişmez; gerekirse revizyon açın. Eşikler Ayarlar › Modül Ayarları › Fiyat ve Endeks Analizi'nde.</small>
  </Alert>;
}
