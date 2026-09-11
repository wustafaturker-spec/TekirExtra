import { z } from "zod";

/** NAK-02: yalnız 7, 30 ve 90 günlük ufuk. */
export const nakitAkisiSorguSemasi = z.object({
  ufuk: z.enum(["7", "30", "90"], "Ufuk 7, 30 ya da 90 gün olmalıdır").default("30").transform((v) => Number(v) as 7 | 30 | 90),
});
