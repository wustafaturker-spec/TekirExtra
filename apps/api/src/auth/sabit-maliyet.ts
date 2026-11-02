import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";

let sahteHash: Promise<string> | undefined;

/**
 * SEC-12: hesap yokken ya da parola denenemeyecek durumdayken de gerçek girişle
 * aynı argon2 maliyeti harcanır; yanıt süresinden hesabın varlığı anlaşılmaz.
 * Hash sabit yazılmaz: aynı parametrelerle üretildiği için kütüphane varsayılanı
 * değişse de maliyet gerçek hash'lerle aynı kalır. Sonuç önemsizdir, çağıran her
 * durumda aynı hatayı döner.
 */
export async function sahteParolaDogrula(parola: string): Promise<void> {
  sahteHash ??= argon2.hash(randomBytes(32).toString("base64url"));
  await argon2.verify(await sahteHash, parola).catch(() => false);
}
