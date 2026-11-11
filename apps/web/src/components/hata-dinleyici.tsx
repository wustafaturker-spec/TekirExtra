"use client";

import { useEffect } from "react";
import { hataBildir } from "@/lib/hata-bildir";

/** PLT-119: panelde yakalanmamış hatalar ve sonuçlanmayan sözler hata kaydına gider. */
export function HataDinleyici() {
  useEffect(() => {
    const hataOlayi = (olay: ErrorEvent) => hataBildir(olay.error ?? olay.message, "pencere");
    const sozOlayi = (olay: PromiseRejectionEvent) => hataBildir(olay.reason, "soz");
    window.addEventListener("error", hataOlayi);
    window.addEventListener("unhandledrejection", sozOlayi);
    return () => {
      window.removeEventListener("error", hataOlayi);
      window.removeEventListener("unhandledrejection", sozOlayi);
    };
  }, []);
  return null;
}
