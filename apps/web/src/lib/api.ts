"use client";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export function tokenAl(): string | null {
  return typeof window === "undefined"
    ? null
    : window.localStorage.getItem("tekir_access");
}

export function tokenYaz(token: string | null): void {
  if (token) window.localStorage.setItem("tekir_access", token);
  else window.localStorage.removeItem("tekir_access");
}

export class ApiHata extends Error {
  constructor(
    message: string,
    readonly durum: number,
  ) {
    super(message);
  }
}

let yenilemeIstegi: Promise<string | null> | null = null;

async function accessTokenYenile(): Promise<string | null> {
  if (!yenilemeIstegi) {
    yenilemeIstegi = fetch(`${API_URL}/auth/yenile`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then(async (yanit) => {
        if (!yanit.ok) return null;
        const govde = (await yanit.json()) as { accessToken?: string };
        if (!govde.accessToken) return null;
        tokenYaz(govde.accessToken);
        return govde.accessToken;
      })
      .catch(() => null)
      .finally(() => { yenilemeIstegi = null; });
  }
  return yenilemeIstegi;
}

function giriseYonlendir(): Promise<never> {
  tokenYaz(null);
  if (typeof window !== "undefined") {
    const donus = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/giris?oturum=sona-erdi&donus=${encodeURIComponent(donus)}`);
  }
  // Sayfa yönlendirilirken mevcut React effect'lerinin hata üretmesini önler.
  return new Promise<never>(() => undefined);
}

async function istekYap(yol: string, secenekler: RequestInit, token: string | null): Promise<Response> {
  return fetch(`${API_URL}${yol}`, {
    ...secenekler,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...secenekler.headers,
    },
  });
}

export async function api<T>(
  yol: string,
  secenekler: RequestInit = {},
): Promise<T> {
  let yanit = await istekYap(yol, secenekler, tokenAl());
  if (yanit.status === 401 && !yol.startsWith("/auth/")) {
    const yeniToken = await accessTokenYenile();
    if (!yeniToken) return giriseYonlendir();
    yanit = await istekYap(yol, secenekler, yeniToken);
    if (yanit.status === 401) return giriseYonlendir();
  }
  const govde = (await yanit.json().catch(() => ({}))) as Record<string, unknown>;
  if (!yanit.ok) {
    const mesaj = Array.isArray(govde.message)
      ? govde.message.join("; ")
      : String(govde.message ?? "İstek başarısız");
    throw new ApiHata(mesaj, yanit.status);
  }
  return govde as T;
}

export async function tumSayfalariAl<T>(yol: string, adet = 200): Promise<T[]> {
  const kayitlar: T[] = [];
  const gorulenImlecler = new Set<string>();
  let imlec: string | null = null;
  do {
    const parametreler = new URLSearchParams({ adet: String(adet) });
    if (imlec) parametreler.set("imlec", imlec);
    const ayirici = yol.includes("?") ? "&" : "?";
    const sayfa: { kayitlar: T[]; sonrakiImlec: string | null } = await api(
      yol + ayirici + parametreler.toString(),
    );
    kayitlar.push(...sayfa.kayitlar);
    imlec = sayfa.sonrakiImlec;
    if (imlec && gorulenImlecler.has(imlec)) break;
    if (imlec) gorulenImlecler.add(imlec);
  } while (imlec);
  return kayitlar;
}
