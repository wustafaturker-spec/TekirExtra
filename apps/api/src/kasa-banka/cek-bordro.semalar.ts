import { z } from "zod";

const tutar = z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,13}(\.\d{1,2})?$/.test(v) && Number(v) > 0, "Pozitif tutar girin");
const tarih = (ad: string) => z.string().date(`${ad} YYYY-MM-DD biçiminde olmalıdır`);
const bosMetin = (azami: number) => z.string().trim().max(azami).optional().nullable().transform((v) => v || null);

/** KSB-11: giriş ve borç çeki çıkışı bordrosu — satır satır yeni evrak. */
export const cekBordroGirisSemasi = z.object({
  tur: z.enum(["giris", "borc_cikis"]),
  tarih: tarih("Bordro tarihi"),
  /** Girişte çeki veren müşteri, borç çekinde lehtar. */
  cariId: z.string().uuid("Cari seçin"),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: tutar.default("1"),
  aciklama: bosMetin(500),
  satirlar: z.array(z.object({
    tur: z.enum(["cek", "senet"]).default("cek"),
    portfoyNo: z.string().trim().max(50).optional().nullable().transform((v) => v || null),
    cekNo: bosMetin(50),
    vadeTarihi: tarih("Vade"),
    tutar,
    /** Alınanda keşideci; borç çekinde boşsa firma unvanı. */
    borclu: bosMetin(255),
    banka: bosMetin(100),
    sube: bosMetin(100),
    hesapNo: bosMetin(50),
    kesideYeri: bosMetin(100),
  })).min(1, "Bordroya en az bir evrak ekleyin").max(200),
}).superRefine((g, ctx) => {
  g.satirlar.forEach((s, i) => {
    if (g.tur === "giris" && !s.borclu) ctx.addIssue({ code: "custom", path: ["satirlar", i, "borclu"], message: `${i + 1}. satırda keşideci gerekli` });
  });
});

/** KSB-11: ciro, tahsile ve teminata verme bordrosu — portföydeki evraklar. */
export const cekBordroCikisSemasi = z.object({
  tur: z.enum(["ciro", "tahsile", "teminata"]),
  tarih: tarih("Bordro tarihi"),
  cariId: z.string().uuid().optional().nullable(),
  bankaHesapId: z.string().uuid().optional().nullable(),
  aciklama: bosMetin(500),
  cekIdleri: z.array(z.string().uuid()).min(1, "Bordroya en az bir evrak seçin").max(200),
}).superRefine((g, ctx) => {
  if (g.tur === "ciro" && !g.cariId) ctx.addIssue({ code: "custom", path: ["cariId"], message: "Ciro edilecek cariyi seçin" });
  if (g.tur !== "ciro" && !g.bankaHesapId) ctx.addIssue({ code: "custom", path: ["bankaHesapId"], message: "Banka hesabını seçin" });
  if (new Set(g.cekIdleri).size !== g.cekIdleri.length) ctx.addIssue({ code: "custom", path: ["cekIdleri"], message: "Aynı evrak iki kez seçilmiş" });
});
