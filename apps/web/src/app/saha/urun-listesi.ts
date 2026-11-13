"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DepoOzet } from "@/lib/depolar";
import { kvOku, kvYaz, type UrunListesi } from "@/lib/saha-depo";

/**
 * SAH-05: cihazdaki ürün listesi (sayım ve mal kabul ortak). Liste yoksa ya da bir günden eskiyse
 * bağlantı varken indirilir; fiyat/maliyet içermez, çıkışta silinir.
 */
export function useUrunListesi(sahip: string | null, cevrimici: boolean) {
  const [liste, setListe] = useState<UrunListesi | null>(null);
  const [depolar, setDepolar] = useState<DepoOzet[]>([]);
  const [hazir, setHazir] = useState(false);
  const [hata, setHata] = useState("");

  useEffect(() => {
    if (!sahip) return;
    void (async () => {
      const [l, d] = await Promise.all([kvOku<UrunListesi>("urunler"), kvOku<DepoOzet[]>("depolar")]);
      if (l?.sahip === sahip) setListe(l);
      if (d) setDepolar(d);
    })().catch(() => undefined).finally(() => setHazir(true));
  }, [sahip]);

  const listeyiIndir = useCallback(async () => {
    if (!sahip) return null;
    setHata("");
    try {
      const [l, d] = await Promise.all([api<Omit<UrunListesi, "sahip">>("/saha/urunler"), api<DepoOzet[]>("/depo?yalnizAktif=true")]);
      const yeni = { ...l, sahip };
      await Promise.all([kvYaz("urunler", yeni), kvYaz("depolar", d)]);
      setListe(yeni); setDepolar(d);
      return d;
    } catch (e) { setHata(e instanceof Error ? e.message : "Ürün listesi indirilemedi"); return null; }
  }, [sahip]);

  useEffect(() => {
    if (!sahip || !cevrimici || !hazir) return;
    if (!liste || Date.now() - Date.parse(liste.alindi) > 86_400_000) void listeyiIndir();
  }, [sahip, cevrimici, hazir, liste, listeyiIndir]);

  return { liste, depolar, listeyiIndir, hata };
}
