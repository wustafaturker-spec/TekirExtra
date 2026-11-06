import { createHmac, timingSafeEqual } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";

const GORSEL_YOLU = "/api/v1/duyurular/gorseller/";
function anahtar() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new ServiceUnavailableException("Duyuru görsel imza anahtarı tanımlı değil.");
  return secret;
}
export function gorselImzala(id: string, simdi = Math.floor(Date.now() / 1000)) {
  const bitis = simdi + 5 * 60;
  const imza = createHmac("sha256", anahtar()).update(`${id}:${bitis}`).digest("hex");
  return `${GORSEL_YOLU}${id}?e=${bitis}&h=${imza}`;
}
export function gorselImzasiGecerli(id: string, bitis: number, imza: string, simdi = Math.floor(Date.now() / 1000)) {
  if (!Number.isSafeInteger(bitis) || bitis < simdi || bitis > simdi + 5 * 60 + 30 || !/^[a-f0-9]{64}$/u.test(imza)) return false;
  const beklenen = createHmac("sha256", anahtar()).update(`${id}:${bitis}`).digest();
  const gelen = Buffer.from(imza, "hex");
  return gelen.length === beklenen.length && timingSafeEqual(gelen, beklenen);
}
export function gorselIceriginiImzala(html: string) {
  return html.replace(/(<img\b[^>]*\bsrc=")(\/api\/v1\/duyurular\/gorseller\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))("[^>]*>)/giu,
    (_m, bas: string, _yol: string, id: string, son: string) => `${bas}${gorselImzala(id)}${son}`);
}
