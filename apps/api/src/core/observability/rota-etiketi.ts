/**
 * Metrik etiketi için isteğin rotası. Ham yol kullanılırsa her kayıt kimliği
 * ayrı bir sayaç açar ve bellekteki sayaç tablosu sınırsız büyür; bu yüzden
 * eşleşen rota kalıbı (`/api/v1/belgeler/:id`) alınır. Rota eşleşmediyse
 * (404, hız sınırı reddi) yoldaki kimlik parçaları maskelenir.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAYI = /^\d+$/;
/** Belge/fatura numarası gibi harf önekli uzun kimlikler (TKF2026000015, GBZ2026000800031). */
const BELGE_NO = /^[A-Z0-9]{3}\d{9,}$/i;

export function rotaEtiketi(req: { route?: { path?: unknown }; baseUrl?: string; path?: string }): string {
  if (typeof req.route?.path === "string") return `${req.baseUrl ?? ""}${req.route.path}`;
  if (!req.path) return "unknown";
  return req.path
    .split("/")
    .map((parca) => (UUID.test(parca) || SAYI.test(parca) || BELGE_NO.test(parca) ? ":id" : parca))
    .join("/");
}
