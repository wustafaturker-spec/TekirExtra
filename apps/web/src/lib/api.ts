"use client";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const ACCESS_TOKEN_ANAHTARI = "tekir_access";

/**
 * SEC-16: erişim token'ı HttpOnly çerezdedir, betikler okuyamaz. Sekmede yalnız
 * "oturum açık" işareti durur. Tek istisna destek sekmesi: çerez bütün sekmelerde
 * ortak olduğundan firma oturumuna karışmaması için kendi token'ını Bearer gönderir.
 */
export const OTURUM_ACIK = "cerez";

export function tokenAl(): string | null {
  if (typeof window === "undefined") return null;
  // Önceki sürümlerden kalan token'lar silinir, yerine işaret konur (çerez ilk yenilemede gelir).
  const eskiToken = window.localStorage.getItem(ACCESS_TOKEN_ANAHTARI);
  if (eskiToken) window.localStorage.removeItem(ACCESS_TOKEN_ANAHTARI);
  const deger = window.sessionStorage.getItem(ACCESS_TOKEN_ANAHTARI) ?? eskiToken;
  if (!deger) return null;
  if (destekSekmesiMi()) return deger;
  if (deger !== OTURUM_ACIK) window.sessionStorage.setItem(ACCESS_TOKEN_ANAHTARI, OTURUM_ACIK);
  return OTURUM_ACIK;
}

/** Oturum işaretini yazar; destek sekmesinde (önce `destekSekmesiYaz`) token'ın kendisini. */
export function tokenYaz(token: string | null): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_TOKEN_ANAHTARI);
  if (token) window.sessionStorage.setItem(ACCESS_TOKEN_ANAHTARI, destekSekmesiMi() ? token : OTURUM_ACIK);
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

/**
 * KLN-22: firma hareketsizlik süresi seçtiyse sunucu, son yenilemesi süreden
 * eski oturumu yenilemez. Arka plan yoklamaları (bildirim, sayaç) kullanıcı
 * hareketsizken oturumu uzatmasın diye yenileme yalnız son etkinlik süre
 * içindeyse yapılır; etkin kullanıcının oturumu `oturumuTazele` ile tazelenir.
 */
const SON_ETKINLIK_ANAHTARI = "tekir_son_etkinlik";
let hareketsizlikMs: number | null = null;
let sonYenilemeAt = Date.now();

export function hareketsizlikAyarla(dakika: number | null): void {
  hareketsizlikMs = dakika ? dakika * 60_000 : null;
}

/** Sekmeler arası ortak: başka sekmede çalışan kullanıcı bu sekmede de etkindir. */
export function sonEtkinlikAl(): number {
  try {
    const kayit = Number(window.localStorage.getItem(SON_ETKINLIK_ANAHTARI));
    if (Number.isFinite(kayit) && kayit > 0) return kayit;
  } catch { /* depo erişilemezse sayfa açılışı esas alınır */ }
  return sonYenilemeAt;
}

export function sonEtkinlikKaydet(an = Date.now()): void {
  try { window.localStorage.setItem(SON_ETKINLIK_ANAHTARI, String(an)); } catch { /* yalnız bu sekmede izlenir */ }
}

function hareketsizMi(): boolean {
  return hareketsizlikMs !== null && Date.now() - sonEtkinlikAl() >= hareketsizlikMs;
}

/** Etkin kullanıcının oturumunu, son yenilemeden en az `enAzMs` geçtiyse tazeler. */
export async function oturumuTazele(enAzMs: number): Promise<void> {
  if (Date.now() - sonYenilemeAt < enAzMs || hareketsizMi()) return;
  await accessTokenYenile();
}

async function accessTokenYenile(): Promise<string | null> {
  if (destekSekmesiMi()) return null;
  if (!yenilemeIstegi) {
    const yenile = (): Promise<string | null> => fetch(`${API_URL}/auth/yenile`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then((yanit) => {
        if (!yanit.ok) return null;
        tokenYaz(OTURUM_ACIK);
        sonYenilemeAt = Date.now();
        return OTURUM_ACIK;
      });
    // SEC-16: sekmeler çerezleri paylaşır ve yenileme token'ı tek kullanımlıktır; sekmeler sırayla yeniler.
    const kilitler = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const sirayla = async (): Promise<string | null> => (kilitler ? await kilitler.request("tekir_oturum_yenileme", yenile) : yenile());
    yenilemeIstegi = sirayla()
      .catch(() => null)
      .finally(() => { yenilemeIstegi = null; });
  }
  return yenilemeIstegi;
}

/** PLT-10: bu sekme TekirExtra destek oturumu; yenileme yoktur, süre dolunca kapanır. */
const DESTEK_ANAHTARI = "tekir_destek";
export function destekSekmesiMi(): boolean {
  try { return typeof window !== "undefined" && window.sessionStorage.getItem(DESTEK_ANAHTARI) === "1"; } catch { return false; }
}
export function destekSekmesiYaz(acik: boolean): void {
  try { if (acik) window.sessionStorage.setItem(DESTEK_ANAHTARI, "1"); else window.sessionStorage.removeItem(DESTEK_ANAHTARI); } catch { /* sekme depolaması yoksa yönlendirme yine çalışır */ }
}

function giriseYonlendir(neden = "sona-erdi"): Promise<never> {
  // Destek sekmesi tarayıcıdaki başka bir firma oturumuna (yenileme çerezi) düşmez.
  if (destekSekmesiMi()) {
    tokenYaz(null);
    destekSekmesiYaz(false);
    window.location.replace("/destek?bitti=1");
    return new Promise<never>(() => undefined);
  }
  tokenYaz(null);
  if (typeof window !== "undefined") {
    const donus = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/giris?oturum=${neden}&donus=${encodeURIComponent(donus)}`);
  }
  // Sayfa yönlendirilirken mevcut React effect'lerinin hata üretmesini önler.
  return new Promise<never>(() => undefined);
}

async function istekYap(yol: string, secenekler: RequestInit, token: string | null): Promise<Response> {
  const formVerisi = typeof FormData !== "undefined" && secenekler.body instanceof FormData;
  const basliklar = new Headers(secenekler.headers);
  if (!formVerisi && !basliklar.has("Content-Type")) basliklar.set("Content-Type", "application/json");
  if (formVerisi) basliklar.delete("Content-Type");
  if (token && destekSekmesiMi()) basliklar.set("Authorization", `Bearer ${token}`);
  // SEC-16: çerezle gelen yazma isteklerinin CSRF denetimi; başka site bu başlığı gönderemez (CORS).
  basliklar.set("X-Tekir-Istek", "1");
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

export const IKI_ADIM_KURULUMU_GEREKLI = "IKI_ADIM_KURULUMU_GEREKLI";
export const IKI_ADIM_KURULUM_YOLU = "/panel/ayarlar/hesap";
/** Hesap Güvenliği'nde 2FA etkinleşince yayılır; panel kısıtı kaldırır. */
export const IKI_ADIM_KURULDU_OLAYI = "tekir:iki-adim-kuruldu";

/** KLN-22: hareketsizlik süresi dolunca oturum sunucuda da kapatılır, giriş ekranına dönülür. */
export async function hareketsizlikleCik(): Promise<never> {
  await fetch(`${API_URL}/auth/cikis`, { method: "POST", credentials: "include" }).catch(() => undefined);
  return giriseYonlendir("hareketsizlik");
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
  // PLT-10: destek sekmesinde her 401 (panelin /auth/ben yoklaması dahil) oturumun bittiği demektir.
  if (yanit.status === 401 && destekSekmesiMi()) return giriseYonlendir();
  // SEC-16: /auth/ben gibi oturumlu uçlarda da çerez süresi dolmuş olabilir; giriş hatası ise yenilenmez.
  if (yanit.status === 401 && !/^\/auth\/(giris|yenile|cikis)\b/.test(yol)) {
    if (hareketsizMi()) return hareketsizlikleCik();
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
    // KLN-21: zorunlu 2FA kurulmadan yalnız Hesap Güvenliği açıktır.
    if (yanit.status === 403 && govde.kod === IKI_ADIM_KURULUMU_GEREKLI && typeof window !== "undefined" && window.location.pathname !== IKI_ADIM_KURULUM_YOLU) {
      window.location.replace(`${IKI_ADIM_KURULUM_YOLU}?iki-adim=zorunlu`);
      return new Promise<never>(() => undefined);
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

/**
 * PLT-119: arka plan isteği (hata bildirimi). Yanıt beklenmez, oturum yenilenmez ve 401'de
 * giriş sayfasına yönlendirilmez; her hata yutulur.
 */
export function arkaPlanIstegi(yol: string, govde: unknown): void {
  void istekYap(yol, { method: "POST", body: JSON.stringify(govde), keepalive: true }, tokenAl()).catch(() => undefined);
}

/** Ham yanıt gereken istekler (yükleme, ikili yanıt): oturum başlıkları ve 401'de bir kez yenileme. */
export async function kimlikliFetch(yol: string, secenekler: RequestInit = {}): Promise<Response> {
  const yanit = await istekYap(yol, secenekler, tokenAl());
  if (yanit.status !== 401) return yanit;
  const yeniToken = await accessTokenYenile();
  if (!yeniToken) return giriseYonlendir();
  return istekYap(yol, secenekler, yeniToken);
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
 * Kimlik doğrulamalı bir PDF'i yeni sekmede açar (EBLG-27). Süresi dolan çerez
 * yenilenebilsin diye doğrudan adres yerine önce içerik alınır.
 */
export async function apiPdfAc(yol: string): Promise<void> {
  const adres = URL.createObjectURL(await apiDosyaBlob(yol));
  window.open(adres, "_blank");
  // Sekme belgeyi okuyana kadar adres yaşamalı; sonra bellekten düşülür.
  setTimeout(() => URL.revokeObjectURL(adres), 60_000);
}
