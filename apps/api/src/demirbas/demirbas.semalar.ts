import { z } from "zod";
import { registerModulAyar } from "../core/ayarlar/ayar-kayit";

export const DEMIRBAS_MODULU = "demirbas";
/** DMR-05: defter türü — bilanço esasında azalan bakiyeler seçilebilir. */
export const demirbasAyariSemasi = z.object({ defterTuru: z.enum(["bilanco", "isletme"]) });
export type DemirbasAyari = z.infer<typeof demirbasAyariSemasi>;
registerModulAyar(DEMIRBAS_MODULU, demirbasAyariSemasi, { defterTuru: "bilanco" });

export const DEMIRBAS_SINIFLARI = ["bina", "tesis_makine", "tasit", "demirbas", "hak", "ozel_maliyet"] as const;
export type DemirbasSinifi = (typeof DEMIRBAS_SINIFLARI)[number];

const tarih = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır");
const tutar = z.coerce.number().positive("Tutar sıfırdan büyük olmalıdır").max(1e13);
const hesapKodu = z.string().trim().regex(/^[0-9][0-9A-Za-z.\-_]{0,39}$/, "Hesap kodu rakamla başlamalı (en çok 40 karakter)");
const metin = (azami: number) => z.string().trim().max(azami);

const kartAlanlari = {
  kod: metin(40).min(1).optional(),
  ad: metin(200).min(1, "Ad zorunludur"),
  sinif: z.enum(DEMIRBAS_SINIFLARI),
  hesapKodu: hesapKodu.nullable().optional(),
  giderHesapKodu: hesapKodu.nullable().optional(),
  listeKodu: metin(20).nullable().optional(),
  faydaliOmur: z.coerce.number().int().min(1).max(100),
  yontem: z.enum(["normal", "azalan"]).default("normal"),
  binekOto: z.boolean().default(false),
  binekVergili: z.boolean().default(false),
  binekSinirYok: z.boolean().default(false),
  seriNo: metin(100).nullable().optional(),
  konum: metin(200).nullable().optional(),
  aciklama: metin(1000).nullable().optional(),
};

/**
 * DMR-01/02/11: kart açma. `faturaSatirId` verilirse bedel, tarih ve tedarikçi
 * faturadan gelir (adet > 1 ise satır o kadar karta bölünür); verilmezse elle.
 */
export const demirbasOlusturSemasi = z
  .object({
    ...kartAlanlari,
    faturaSatirId: z.string().uuid().nullable().optional(),
    adet: z.coerce.number().int().min(1).max(500).default(1),
    edinmeTarihi: tarih.optional(),
    edinmeBedeli: tutar.optional(),
    tedarikciCariId: z.string().uuid().nullable().optional(),
    acilis: z.boolean().default(false),
    acilisBirikmis: z.coerce.number().min(0).default(0),
    acilisSonYil: z.coerce.number().int().min(1950).max(2100).nullable().optional(),
    /** DMR-03: doğrudan gider uyarısı görülüp yine de kart açılsın. */
    uyarilariKabulEt: z.boolean().default(false),
  })
  .superRefine((g, ctx) => {
    if (!g.faturaSatirId && (!g.edinmeTarihi || g.edinmeBedeli == null)) ctx.addIssue({ code: "custom", message: "Faturasız kartta edinme tarihi ve bedeli zorunludur" });
    if (g.faturaSatirId && g.acilis) ctx.addIssue({ code: "custom", message: "Açılış kartı faturaya bağlanmaz" });
    if (g.acilis && g.acilisBirikmis > 0 && g.acilisSonYil == null) ctx.addIssue({ code: "custom", message: "Birikmiş amortismanın son yılı zorunludur" });
    if (!g.faturaSatirId && g.adet > 1) ctx.addIssue({ code: "custom", message: "Adete bölme yalnız fatura satırından açılan kartta yapılır" });
    if (g.binekOto && g.yontem === "azalan") ctx.addIssue({ code: "custom", message: "Binek otoda bu sürümde azalan bakiyeler yöntemi desteklenmez" });
  });

export const demirbasGuncelleSemasi = z
  .object({
    ...kartAlanlari,
    yontem: z.enum(["normal", "azalan"]),
    binekOto: z.boolean(),
    binekVergili: z.boolean(),
    binekSinirYok: z.boolean(),
    edinmeTarihi: tarih,
    edinmeBedeli: tutar,
    tedarikciCariId: z.string().uuid().nullable(),
    acilisBirikmis: z.coerce.number().min(0),
    acilisSonYil: z.coerce.number().int().min(1950).max(2100).nullable(),
  })
  .partial();
export type DemirbasGuncelle = z.infer<typeof demirbasGuncelleSemasi>;

export const ilaveBedelSemasi = z
  .object({
    faturaSatirId: z.string().uuid().nullable().optional(),
    tarih: tarih.optional(),
    tutar: tutar.optional(),
    aciklama: metin(300).min(1, "Açıklama zorunludur"),
  })
  .refine((g) => g.faturaSatirId || (g.tarih && g.tutar != null), "Faturasız ilave bedelde tarih ve tutar zorunludur");

export const normaleGecisSemasi = z.object({ yil: z.coerce.number().int().min(1950).max(2100) });

export const cikisSemasi = z
  .object({
    tur: z.enum(["satis", "hurda", "kayip", "bagis"]),
    tarih: tarih.optional(),
    faturaSatirId: z.string().uuid().nullable().optional(),
    /** Satışta satırın bu karta düşen TL matrahı; boşsa satırın kalan tutarı. */
    bedel: z.coerce.number().min(0).optional(),
    gerekce: metin(500).min(3, "Gerekçe zorunludur"),
  })
  .superRefine((g, ctx) => {
    if (g.tur === "satis" && !g.faturaSatirId) ctx.addIssue({ code: "custom", message: "Satışta satış faturası satırı seçilmelidir" });
    if (g.tur !== "satis" && !g.tarih) ctx.addIssue({ code: "custom", message: "Çıkış tarihi zorunludur" });
  });

export const zimmetSemasi = z
  .object({
    personelId: z.string().uuid().nullable().optional(),
    konum: metin(200).nullable().optional(),
    baslangic: tarih,
    aciklama: metin(500).nullable().optional(),
  })
  .refine((g) => g.personelId || g.konum, "Personel ya da konum seçilmelidir");

export const zimmetIadeSemasi = z.object({ bitis: tarih, aciklama: metin(500).nullable().optional() });

export const geriAlSemasi = z.object({ gerekce: metin(500).min(3, "Gerekçe zorunludur") });

export const listeSorgusuSemasi = z.object({
  durum: z.enum(["kullanimda", "elden_cikti", "tumu"]).default("kullanimda"),
  sinif: z.enum(DEMIRBAS_SINIFLARI).optional(),
  ara: metin(100).optional(),
  personelId: z.string().uuid().optional(),
  konum: metin(200).optional(),
});
export type ListeSorgusu = z.infer<typeof listeSorgusuSemasi>;
