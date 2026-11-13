"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

/** Tarayıcının yerleşik barkod okuyucusu (Chrome/Android); türleri TS kitaplığında yok. */
interface BarkodOkuyucu { detect(kaynak: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
type BarkodOkuyucuSinifi = new (s?: { formats?: string[] }) => BarkodOkuyucu;
const okuyucuSinifi = (): BarkodOkuyucuSinifi | null => (typeof window !== "undefined" && "BarcodeDetector" in window ? (window as unknown as { BarcodeDetector: BarkodOkuyucuSinifi }).BarcodeDetector : null);

/**
 * SAH-03/06: kamerayla barkod okutma. Yerleşik okuyucu saniyede birkaç kare tarar; aynı barkod
 * 1,5 sn içinde tekrar sayılmaz. Okuyucu yoksa tabanca ya da elle giriş önerilir.
 */
export function KameraOkuyucu({ etkin, onOkut, onHata }: { etkin: boolean; onOkut: (kod: string) => void; onHata: (mesaj: string) => void }) {
  const [acik, setAcik] = useState(false);
  const [okuyucuVar, setOkuyucuVar] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const okutRef = useRef(onOkut); okutRef.current = onOkut;
  const hataRef = useRef(onHata); hataRef.current = onHata;

  useEffect(() => { setOkuyucuVar(Boolean(okuyucuSinifi())); }, []);

  useEffect(() => {
    if (!acik) return;
    const Sinif = okuyucuSinifi();
    if (!Sinif) { setAcik(false); return; }
    let akis: MediaStream | null = null; let dur = false; let son = { kod: "", an: 0 };
    const okuyucu = new Sinif({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code", "itf"] });
    void (async () => {
      try {
        akis = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = akis; await videoRef.current.play();
        while (!dur) {
          const bulunan = await okuyucu.detect(videoRef.current).catch(() => []);
          const kod = bulunan[0]?.rawValue;
          if (kod && (kod !== son.kod || Date.now() - son.an > 1500)) { son = { kod, an: Date.now() }; okutRef.current(kod); }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch { hataRef.current("Kamera açılamadı; izin verin ya da kodu elle yazın."); setAcik(false); }
    })();
    return () => { dur = true; akis?.getTracks().forEach((t) => t.stop()); };
  }, [acik]);

  if (!okuyucuVar) return <small className="muted">Bu tarayıcıda kamera okuyucusu yok; barkod okuyucu tabancası ya da elle giriş kullanın.</small>;
  return (
    <>
      <Button block onClick={() => setAcik((k) => !k)} disabled={!etkin}>{acik ? "Kamerayı kapat" : "📷 Kamerayla okut"}</Button>
      {acik && <video ref={videoRef} className="saha-kamera" playsInline muted />}
    </>
  );
}
