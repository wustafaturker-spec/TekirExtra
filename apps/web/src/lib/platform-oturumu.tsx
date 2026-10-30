"use client";

import { createContext, useContext } from "react";

export type PlatformRolu = "yonetici" | "mevzuat_editoru";
export interface PlatformOturumu { eposta: string; rol: PlatformRolu }

/** Yerleşimin doğruladığı kimlik; alt ekranlar rol için yeniden istek yapmaz. */
export const PlatformOturumuBaglami = createContext<PlatformOturumu | null>(null);
export const usePlatformOturumu = () => useContext(PlatformOturumuBaglami);
