"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { hepsiniSil, kuyrukListesi, kvOku, kvYaz, sahipligiDogrula, type KuyrukIsi } from "@/lib/saha-depo";
import { kuyruguIsle, type GonderimSonucu } from "@/lib/saha-kuyruk";

/** SAH-01/02/09: saha ekranlarının ortak durumu: kullanıcı, bağlantı ve cihazdaki kuyruk. */
export interface SahaKullanici { userId: string; tenantId: string; rol: string }
interface SahaDurumu {
  kullanici: SahaKullanici | null;
  sahip: string | null;
  cevrimici: boolean;
  kuyruk: KuyrukIsi[];
  /** Kuyruğu yeniden okur (ekleme/silme sonrası). */
  kuyrukYenile: () => Promise<void>;
  /** Bekleyenleri gönderir; tek iş verilirse yalnız onu (hatalı işi yeniden denemek için). */
  gonder: (yalniz?: string) => Promise<GonderimSonucu[]>;
  sonGonderim: GonderimSonucu[];
  cikis: () => Promise<void>;
}

const Baglam = createContext<SahaDurumu | null>(null);
export function useSaha(): SahaDurumu {
  const b = useContext(Baglam);
  if (!b) throw new Error("Saha bağlamı yok");
  return b;
}

export function SahaSaglayici({ children }: { children: React.ReactNode }) {
  const [kullanici, setKullanici] = useState<SahaKullanici | null>(null);
  const [cevrimici, setCevrimici] = useState(true);
  const [kuyruk, setKuyruk] = useState<KuyrukIsi[]>([]);
  const [sonGonderim, setSonGonderim] = useState<GonderimSonucu[]>([]);
  const sahip = kullanici ? `${kullanici.tenantId}:${kullanici.userId}` : null;

  useEffect(() => {
    setCevrimici(navigator.onLine);
    const ac = () => setCevrimici(true), kapa = () => setCevrimici(false);
    window.addEventListener("online", ac); window.addEventListener("offline", kapa);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/saha-sw.js", { scope: "/saha" }).catch(() => undefined);
    return () => { window.removeEventListener("online", ac); window.removeEventListener("offline", kapa); };
  }, []);

  // Kullanıcı: çevrimiçiyken sunucudan; çevrimdışıyken cihazda kayıtlı son kullanıcı (aynı oturum).
  useEffect(() => {
    let gecerli = true;
    void (async () => {
      try {
        const ben = await api<SahaKullanici>("/auth/ben");
        const k = { userId: ben.userId, tenantId: ben.tenantId, rol: ben.rol };
        await sahipligiDogrula(`${k.tenantId}:${k.userId}`).catch(() => 0);
        await kvYaz("kullanici", k).catch(() => undefined);
        if (gecerli) setKullanici(k);
      } catch {
        const k = await kvOku<SahaKullanici>("kullanici").catch(() => undefined);
        if (gecerli && k) setKullanici(k);
      }
    })();
    return () => { gecerli = false; };
  }, []);

  const kuyrukYenile = useCallback(async () => { if (sahip) setKuyruk(await kuyrukListesi(sahip).catch(() => [])); }, [sahip]);
  const gonder = useCallback(async (yalniz?: string) => {
    if (!sahip) return [];
    const { sonuclar } = await kuyruguIsle(sahip, yalniz);
    if (sonuclar.length) setSonGonderim(sonuclar);
    await kuyrukYenile();
    return sonuclar;
  }, [sahip, kuyrukYenile]);

  useEffect(() => { void kuyrukYenile(); }, [kuyrukYenile]);
  // Bağlantı gelince ve açılışta bekleyenler kendiliğinden gönderilir.
  useEffect(() => { if (sahip && cevrimici) void gonder(); }, [sahip, cevrimici, gonder]);

  const cikis = useCallback(async () => {
    await hepsiniSil().catch(() => undefined);
    navigator.serviceWorker?.controller?.postMessage("temizle");
    await api("/auth/cikis", { method: "POST" }).catch(() => undefined);
    window.location.replace("/giris");
  }, []);

  const deger = useMemo(() => ({ kullanici, sahip, cevrimici, kuyruk, kuyrukYenile, gonder, sonGonderim, cikis }), [kullanici, sahip, cevrimici, kuyruk, kuyrukYenile, gonder, sonGonderim, cikis]);
  return <Baglam.Provider value={deger}>{children}</Baglam.Provider>;
}
