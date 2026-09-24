"use client";

import { useEffect, useState } from "react";
import { api, tokenAl } from "./api";

/** Çoklu depo (STK-07) — depo listesini paylaşan ortak kanca. */

export interface DepoOzet {
  id: string;
  kod: string;
  ad: string;
  adres?: string | null;
  /** EBLG-87: e-İrsaliyede boşaltma adresi olarak kullanılır. */
  il?: string | null;
  ilce?: string | null;
  postaKodu?: string | null;
  sorumlu?: string | null;
  varsayilan: boolean;
  aktif: boolean;
  hareketSayisi: number;
  silinebilir: boolean;
}

/**
 * Aktif depoları yükler. `cokluDepo` false ise arayüz depo seçimini hiç
 * göstermez; sunucu boş bırakılan depoyu varsayılana çözer.
 */
export function useDepolar() {
  const [depolar, setDepolar] = useState<DepoOzet[]>([]);

  useEffect(() => {
    if (!tokenAl()) return;
    api<DepoOzet[]>("/depo?yalnizAktif=true")
      .then(setDepolar)
      .catch(() => undefined);
  }, []);

  const varsayilan = depolar.find((d) => d.varsayilan) ?? depolar[0] ?? null;
  return { depolar, varsayilan, cokluDepo: depolar.length > 1 };
}
