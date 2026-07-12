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

export async function api<T>(
  yol: string,
  secenekler: RequestInit = {},
): Promise<T> {
  const token = tokenAl();
  const yanit = await fetch(`${API_URL}${yol}`, {
    ...secenekler,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...secenekler.headers,
    },
  });
  const govde = (await yanit.json().catch(() => ({}))) as Record<string, unknown>;
  if (!yanit.ok) {
    const mesaj = Array.isArray(govde.message)
      ? govde.message.join("; ")
      : String(govde.message ?? "İstek başarısız");
    throw new ApiHata(mesaj, yanit.status);
  }
  return govde as T;
}
