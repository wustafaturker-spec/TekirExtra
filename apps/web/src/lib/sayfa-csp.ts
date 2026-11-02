/**
 * SEC-15: sayfaların CSP'si (SEC-10'un devamı). `script-src`'te `'unsafe-inline'`
 * yoktur: araya sızan satır içi betik ve olay özniteliği çalışmaz. Stil tarafında
 * satır içi izin sürer. Gelen e-postadaki uzak görseller için img-src https açıktır.
 * Belge görünümleri kendi CSP'siyle `/belge-cerceve.html` içinde çalışır.
 */
export function sayfaCsp(nonce: string, gelistirme: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${gelistirme ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${gelistirme ? " ws: wss:" : ""}`,
    "frame-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}
