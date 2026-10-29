import { verifySync } from "otplib";

/**
 * TOTP doğrulaması: bir önceki ve bir sonraki 30 saniyelik kod da kabul edilir
 * (RFC 6238 §5.2). Toleranssız doğrulamada pencere sınırında yazılan doğru kod
 * reddediliyordu. Deneme sınırı (GirisDenemeSayaci) ayrıca uygulanır.
 */
export const TOTP_TOLERANS_SN = 30;

export function totpDogrula(secret: string, kod: string): boolean {
  return verifySync({ secret, token: kod, epochTolerance: TOTP_TOLERANS_SN }).valid;
}
