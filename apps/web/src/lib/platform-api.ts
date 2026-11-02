"use client";

/**
 * Platform paneli (Mevzuat Merkezi, MVZ-04) istemcisi. Kiracı oturumundan
 * tamamen ayrıdır: token ayrı HttpOnly çerezdedir (SEC-16), sekmede yalnız oturum
 * işareti durur; yenileme yoktur (30 dk), süre dolunca yeniden giriş istenir.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const ANAHTAR = "tekir_platform_access";
const OTURUM_ACIK = "cerez";
const CSRF_BASLIGI = { "X-Tekir-Istek": "1" };

export function platformTokenAl(): string | null {
  if (typeof window === "undefined") return null;
  const deger = window.sessionStorage.getItem(ANAHTAR);
  // Önceki sürümden kalan token silinir.
  if (deger && deger !== OTURUM_ACIK) window.sessionStorage.setItem(ANAHTAR, OTURUM_ACIK);
  return deger ? OTURUM_ACIK : null;
}

export function platformTokenYaz(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.sessionStorage.setItem(ANAHTAR, OTURUM_ACIK);
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
    const yanit = await fetch(`${API_URL}/platform/auth/cikis`, { method: "POST", credentials: "include", headers: CSRF_BASLIGI });
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
  const yanit = await fetch(`${API_URL}${yol}`, {
    ...secenek,
    // PLT-08: giriş yanıtı rota koruması işaretini çerez olarak koyar.
    credentials: "include",
    headers: { "Content-Type": "application/json", ...CSRF_BASLIGI, ...(secenek.headers ?? {}) },
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

/** Dosya indirir (PLT-37): yanıtı blob olarak alır ve tarayıcıda kaydettirir. */
export async function platformIndir(yol: string, varsayilanAd: string): Promise<void> {
  const yanit = await fetch(`${API_URL}${yol}`, { credentials: "include", headers: CSRF_BASLIGI });
  if (yanit.status === 401) {
    platformTokenYaz(null);
    window.location.href = "/platform/giris";
    throw new PlatformApiHata("Oturum süresi doldu", 401);
  }
  if (!yanit.ok) {
    const govde = (await yanit.json().catch(() => null)) as { message?: string | string[] } | null;
    const mesaj = govde?.message;
    throw new PlatformApiHata(Array.isArray(mesaj) ? mesaj.join("; ") : mesaj ?? "Dosya indirilemedi", yanit.status);
  }
  const ad = /filename="([^"]+)"/.exec(yanit.headers.get("Content-Disposition") ?? "")?.[1] ?? varsayilanAd;
  const adres = URL.createObjectURL(await yanit.blob());
  const baglanti = document.createElement("a");
  baglanti.href = adres;
  baglanti.download = ad;
  document.body.appendChild(baglanti);
  baglanti.click();
  baglanti.remove();
  setTimeout(() => URL.revokeObjectURL(adres), 1000);
}
