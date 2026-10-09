"use client";

import { useEffect, useState, type SelectHTMLAttributes } from "react";
import { bugunTR, VARSAYILAN_KOD_TABLOSU, type KodTablosu } from "@tekirextra/shared";
import { api } from "@/lib/api";
import { Select } from "@/components/ui";

const onbellek = new Map<string, Promise<KodTablosu>>();

/**
 * MVZ-11: belge tarihinde yürürlükteki KDV oranları ve kodları (Mevzuat
 * Merkezi). Aynı tarih için istek bir kez atılır; okunamazsa bugünkü
 * varsayılan liste kullanılır, kayıt sunucuda yine denetlenir.
 */
export function useKodTablosu(tarih?: string | null): KodTablosu {
  const gun = tarih && /^\d{4}-\d{2}-\d{2}/.test(tarih) ? tarih.slice(0, 10) : bugunTR();
  const [tablo, setTablo] = useState<KodTablosu>(VARSAYILAN_KOD_TABLOSU);
  useEffect(() => {
    let iptal = false;
    if (!onbellek.has(gun)) {
      onbellek.set(gun, api<KodTablosu>(`/mevzuat/kod-tablosu?tarih=${gun}`).catch((hata: unknown) => { onbellek.delete(gun); throw hata; }));
    }
    void onbellek.get(gun)!.then((t) => { if (!iptal) setTablo(t); }).catch(() => undefined);
    return () => { iptal = true; };
  }, [gun]);
  return tablo;
}

/**
 * KDV oranı seçimi: serbest yazılmaz, belge tarihindeki merkezi listeden
 * seçilir. Kayıtlı değer listede yoksa silinmez, "bu tarihte geçerli değil"
 * diye görünür; kullanıcı geçerli bir oran seçene kadar kayıt sunucuda reddedilir.
 */
export function KdvOraniSecimi({ value, onDegis, tablo, ...rest }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: string | number | null | undefined;
  onDegis: (oran: string) => void;
  tablo: KodTablosu;
}) {
  const mevcut = value === null || value === undefined || value === "" ? null : Number(value);
  const listede = mevcut !== null && tablo.kdvOranlari.some((k) => k.oran === mevcut);
  return (
    <Select aria-label="KDV oranı" {...rest} value={mevcut === null ? "" : String(mevcut)} onChange={(e) => onDegis(e.target.value)}>
      {mevcut === null && <option value="">Seçin</option>}
      {tablo.kdvOranlari.map((k) => <option key={k.oran} value={String(k.oran)}>%{k.oran}</option>)}
      {mevcut !== null && !listede && <option value={String(mevcut)}>%{mevcut} — bu tarihte geçerli değil</option>}
    </Select>
  );
}
