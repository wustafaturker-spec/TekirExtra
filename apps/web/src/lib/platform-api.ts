"use client";

/**
 * Platform paneli (Mevzuat Merkezi, MVZ-04) istemcisi. Kiracı oturumundan
 * tamamen ayrıdır: token başka anahtarda, yalnız bu sekmede tutulur; yenileme
 * yoktur (30 dk), süre dolunca yeniden giriş istenir.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const ANAHTAR = "tekir_platform_access";

export function platformTokenAl(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ANAHTAR);
}

export function platformTokenYaz(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.sessionStorage.setItem(ANAHTAR, token);
  else window.sessionStorage.removeItem(ANAHTAR);
}

/**
 * Çıkış (PLT-25): oturum önce sunucuda iptal ettirilir, ardından yerel token her
 * durumda silinir. `false`: ağ hatası ya da sunucu iptali doğrulayamadı — sekmede
 * çıkış yapılmıştır ama eldeki token süresi dolana kadar başka yerde geçerli olabilir.
 */
export async function platformCikis(): Promise<boolean> {
  const token = platformTokenAl();
  try {
    const yanit = await fetch(`${API_URL}/platform/auth/cikis`, { method: "POST", credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const govde = yanit.ok ? ((await yanit.json().catch(() => null)) as { sunucudaIptal?: boolean } | null) : null;
    return !token || govde?.sunucudaIptal === true;
  } catch {
    return false;
  } finally {
    platformTokenYaz(null);
  }
}

export class PlatformApiHata extends Error {
  constructor(message: string, readonly durum: number) {
    super(message);
  }
}

export async function platformApi<T>(yol: string, secenek: RequestInit = {}): Promise<T> {
  const token = platformTokenAl();
  const yanit = await fetch(`${API_URL}${yol}`, {
    ...secenek,
    // PLT-08: giriş yanıtı rota koruması işaretini çerez olarak koyar.
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(secenek.headers ?? {}) },
  });
  if (yanit.status === 401 && !yol.startsWith("/platform/auth/giris")) {
    platformTokenYaz(null);
    if (typeof window !== "undefined") window.location.href = "/platform/giris";
    throw new PlatformApiHata("Oturum süresi doldu", 401);
  }
  const metin = await yanit.text();
  const govde = metin ? (JSON.parse(metin) as unknown) : null;
  if (!yanit.ok) {
    const mesaj = (govde as { message?: string | string[] } | null)?.message;
    throw new PlatformApiHata(Array.isArray(mesaj) ? mesaj.join("; ") : mesaj ?? "İşlem başarısız", yanit.status);
  }
  return govde as T;
}
