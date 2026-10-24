import { z } from "zod";

/** KLN-01 parola politikası: kayıt, kullanıcı ekleme, sıfırlama ve değiştirme aynı kuralı kullanır. */
export const parolaSemasi = z
  .string()
  .min(10, "Parola en az 10 karakter olmalıdır")
  .max(200, "Parola en fazla 200 karakter olabilir")
  .regex(/[a-zA-Z]/, "Parola harf içermelidir")
  .regex(/\d/, "Parola rakam içermelidir");
