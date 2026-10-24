/** Oturum listesinde ham User-Agent yerine "Chrome · Windows" gibi kısa ad. */
export function tarayiciAdi(ua: string | null | undefined): string {
  if (!ua) return "Bilinmeyen cihaz";
  const tarayici = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|node|undici|python/i.test(ua) ? "Program/istemci" : "Tarayıcı";
  const sistem = /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return sistem ? `${tarayici} · ${sistem}` : tarayici;
}
