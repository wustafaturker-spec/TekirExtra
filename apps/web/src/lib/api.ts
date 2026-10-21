"use client";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const ACCESS_TOKEN_ANAHTARI = "tekir_access";

export function tokenAl(): string | null {
  if (typeof window === "undefined") return null;
  const sekmeTokeni = window.sessionStorage.getItem(ACCESS_TOKEN_ANAHTARI);
  if (sekmeTokeni) return sekmeTokeni;

  // Önceki sürümden kalan kalıcı tokenı bir kez sekme oturumuna taşı ve sil.
  const eskiToken = window.localStorage.getItem(ACCESS_TOKEN_ANAHTARI);
  if (!eskiToken) return null;
  window.sessionStorage.setItem(ACCESS_TOKEN_ANAHTARI, eskiToken);
  window.localStorage.removeItem(ACCESS_TOKEN_ANAHTARI);
  return eskiToken;
}

export function tokenYaz(token: string | null): void {
  if (typeof window === "undefined") return;
  // Access token kalıcı depoda tutulmaz; refresh token zaten HttpOnly cookie'dedir.
  window.localStorage.removeItem(ACCESS_TOKEN_ANAHTARI);
  if (token) window.sessionStorage.setItem(ACCESS_TOKEN_ANAHTARI, token);
  else window.sessionStorage.removeItem(ACCESS_TOKEN_ANAHTARI);
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
  const formVerisi = typeof FormData !== "undefined" && secenekler.body instanceof FormData;
  const basliklar = new Headers(secenekler.headers);
  if (!formVerisi && !basliklar.has("Content-Type")) basliklar.set("Content-Type", "application/json");
  if (formVerisi) basliklar.delete("Content-Type");
  if (token) basliklar.set("Authorization", `Bearer ${token}`);
  try {
    return await fetch(`${API_URL}${yol}`, {
      ...secenekler,
      credentials: "include",
      headers: basliklar,
    });
  } catch (hata) {
    // AI-82: kullanıcının durdurması bağlantı hatası değildir.
    if (secenekler.signal?.aborted) throw hata;
    throw new ApiHata("Sunucuya bağlanılamadı. Lütfen sunucunun çalıştığından emin olun.", 0);
  }
}

/**
 * AI-82: SSE ile POST. `adim` olayları `onOlay`'a gider; `son` olayının verisi
 * döner, `hata` olayı ApiHata olarak fırlatılır. Durdurmada fetch AbortError
 * fırlatır. Idempotency anahtarı eklenmez (tekrarı sunucu requestId ile ayıklar).
 */
export async function apiAkis<T>(yol: string, govde: unknown, onOlay: (olay: string, veri: unknown) => void, sinyal?: AbortSignal): Promise<T> {
  const secenek: RequestInit = { method: "POST", body: JSON.stringify(govde), signal: sinyal, headers: { Accept: "text/event-stream" } };
  let yanit = await istekYap(yol, secenek, tokenAl());
  if (yanit.status === 401) {
    const yeniToken = await accessTokenYenile();
    if (!yeniToken) return giriseYonlendir();
    yanit = await istekYap(yol, secenek, yeniToken);
    if (yanit.status === 401) return giriseYonlendir();
  }
  if (!yanit.ok || !yanit.body) {
    const g = (await yanit.json().catch(() => ({}))) as { message?: unknown };
    throw new ApiHata(typeof g.message === "string" ? g.message : `İstek başarısız (${yanit.status})`, yanit.status);
  }
  const okuyucu = yanit.body.getReader();
  const cozucu = new TextDecoder();
  let tampon = "";
  for (;;) {
    const { value, done } = await okuyucu.read();
    if (done) break;
    tampon += cozucu.decode(value, { stream: true });
    let sinir: number;
    while ((sinir = tampon.indexOf("\n\n")) >= 0) {
      const parca = tampon.slice(0, sinir);
      tampon = tampon.slice(sinir + 2);
      const olay = /^event: (.*)$/m.exec(parca)?.[1] ?? "message";
      const veriMetni = parca.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
      const veri = veriMetni ? JSON.parse(veriMetni) : null;
      if (olay === "son") return veri as T;
      if (olay === "hata") {
        const h = veri as { mesaj?: string; durum?: number } | null;
        throw new ApiHata(h?.mesaj ?? "Asistan yanıt veremedi.", h?.durum ?? 500);
      }
      onOlay(olay, veri);
    }
  }
  throw new ApiHata("Yanıt tamamlanmadan bağlantı kapandı.", 0);
}

async function idempotencyBilgisi(method: string, yol: string, body: BodyInit | null | undefined): Promise<{ anahtar: string; saklamaAnahtari: string | null }> {
  if (typeof window === "undefined" || !window.crypto?.subtle) return { anahtar: crypto.randomUUID(), saklamaAnahtari: null };
  let icerik = "";
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    icerik = JSON.stringify(Array.from(body.entries(), ([ad, deger]) => [ad, deger instanceof File ? { ad: deger.name, boyut: deger.size, tarih: deger.lastModified, tur: deger.type } : deger]));
  } else if (typeof body === "string") icerik = body;
  const parmak = new Uint8Array(await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${method}\n${yol}\n${icerik}`)));
  const ozet = Array.from(parmak, (x) => x.toString(16).padStart(2, "0")).join("");
  const saklamaAnahtari = `tekir_idempotency_${ozet}`;
  try {
    const onceki = window.sessionStorage.getItem(saklamaAnahtari);
    if (onceki) return { anahtar: onceki, saklamaAnahtari };
    const anahtar = window.crypto.randomUUID();
    window.sessionStorage.setItem(saklamaAnahtari, anahtar);
    return { anahtar, saklamaAnahtari };
  } catch {
    return { anahtar: window.crypto.randomUUID(), saklamaAnahtari: null };
  }
}

export async function api<T>(
  yol: string,
  secenekler: RequestInit = {},
): Promise<T> {
  const method = (secenekler.method ?? "GET").toUpperCase();
  const kullanilacakSecenekler = { ...secenekler };
  let saklamaAnahtari: string | null = null;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const basliklar = new Headers(secenekler.headers);
    if (!basliklar.has("Idempotency-Key")) {
      const bilgi = await idempotencyBilgisi(method, yol, secenekler.body);
      basliklar.set("Idempotency-Key", bilgi.anahtar);
      saklamaAnahtari = bilgi.saklamaAnahtari;
    }
    kullanilacakSecenekler.headers = basliklar;
  }
  let yanit = await istekYap(yol, kullanilacakSecenekler, tokenAl());
  if (yanit.status === 401 && !yol.startsWith("/auth/")) {
    const yeniToken = await accessTokenYenile();
    if (!yeniToken) return giriseYonlendir();
    yanit = await istekYap(yol, kullanilacakSecenekler, yeniToken);
    if (yanit.status === 401) return giriseYonlendir();
  }
  const govde = (await yanit.json().catch(() => ({}))) as Record<string, unknown>;
  if (!yanit.ok) {
    if (yanit.status >= 400 && yanit.status < 500 && yanit.status !== 409 && saklamaAnahtari) {
      try { window.sessionStorage.removeItem(saklamaAnahtari); } catch { /* storage erişimi isteği etkilemez */ }
    }
    const mesaj = Array.isArray(govde.message)
      ? govde.message.join("; ")
      : String(govde.message ?? "İstek başarısız");
    throw new ApiHata(mesaj, yanit.status);
  }
  if (saklamaAnahtari) {
    try { window.sessionStorage.removeItem(saklamaAnahtari); } catch { /* storage erişimi isteği etkilemez */ }
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

/** Kimlik doğrulamalı dosya yanıtını indirir; JSON bekleyen api()'den ayrıdır. */
export async function apiDosyaIndir(yol: string, dosyaAdi: string, secenekler: RequestInit = {}): Promise<void> {
  let yanit = await istekYap(yol, secenekler, tokenAl());
  if (yanit.status === 401) {
    const yeniToken = await accessTokenYenile();
    if (!yeniToken) return giriseYonlendir();
    yanit = await istekYap(yol, secenekler, yeniToken);
  }
  if (!yanit.ok) {
    // Sunucunun nedeni (ör. eksik işyeri, şema hatası) kullanıcıya gösterilir.
    const govde = (await yanit.json().catch(() => ({}))) as { message?: unknown };
    const mesaj = Array.isArray(govde.message) ? govde.message.join("; ") : typeof govde.message === "string" ? govde.message : "Dosya indirilemedi";
    throw new ApiHata(mesaj, yanit.status);
  }
  const adres = URL.createObjectURL(await yanit.blob());
  const baglanti = document.createElement("a");
  baglanti.href = adres; baglanti.download = dosyaAdi; baglanti.click();
  URL.revokeObjectURL(adres);
}

/** Kimlik doğrulamalı dosyayı ekran içi kullanım için Blob olarak döndürür. */
export async function apiDosyaBlob(yol: string, secenekler: RequestInit = {}): Promise<Blob> {
  let yanit = await istekYap(yol, secenekler, tokenAl());
  if (yanit.status === 401) {
    const yeniToken = await accessTokenYenile();
    if (!yeniToken) return giriseYonlendir();
    yanit = await istekYap(yol, secenekler, yeniToken);
  }
  if (!yanit.ok) {
    // POST önizlemelerinde (FTR-42) sunucunun nedeni gösterilir.
    const govde = (await yanit.json().catch(() => ({}))) as { message?: unknown };
    throw new ApiHata(typeof govde.message === "string" ? govde.message : "Dosya görüntülenemedi", yanit.status);
  }
  return yanit.blob();
}

/**
 * Kimlik doğrulamalı bir PDF'i yeni sekmede açar (EBLG-27). Adres doğrudan
 * açılamaz: uç Authorization başlığı ister, tarayıcı sekmesi bunu göndermez.
 */
export async function apiPdfAc(yol: string): Promise<void> {
  const adres = URL.createObjectURL(await apiDosyaBlob(yol));
  window.open(adres, "_blank");
  // Sekme belgeyi okuyana kadar adres yaşamalı; sonra bellekten düşülür.
  setTimeout(() => URL.revokeObjectURL(adres), 60_000);
}
