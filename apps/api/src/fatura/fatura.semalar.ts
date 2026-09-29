import { z } from "zod";
import { guncellemeSemasi } from "../core/sema";
import { idisEngelleri, ihracKayitliHatalari, ozelMatrahHatalari, senaryoHatalari, ytbEngelleri } from "@tekirextra/shared";

const pozitifOndalik = z
  .union([z.string(), z.number()])
  .transform((val) => String(val))
  .pipe(z.string().regex(/^\d{1,13}(\.\d{1,6})?$/, "Pozitif sayısal değer gerekli"));
const yuzde = pozitifOndalik.refine((deger) => Number(deger) <= 100, "Oran %100'ü aşamaz");

const partiBilgisiSemasi = z.object({
  lotNo: z.string().min(1).max(100), seriNo: z.string().min(1).max(160).optional().nullable(),
  sonKullanmaTarihi: z.string().date().optional().nullable(), uretimTarihi: z.string().date().optional().nullable(),
  miktar: pozitifOndalik,
});

export const faturaSatirSemasi = z.object({
  stokId: z.string().uuid(),
  varyantId: z.string().uuid().optional().nullable(),
  partiBilgileri: z.array(partiBilgisiSemasi).optional(),
  miktar: pozitifOndalik,
  birim: z.string().min(1).max(20).default("adet"),
  birimFiyat: pozitifOndalik,
  iskontoOrani: yuzde.default("0"),
  kdvOrani: yuzde.default("20"),
  /**
   * Tevkifat GİB koduyla girilir; oran koddan türer (FTR-18). Pay/payda artık
   * girdi değildir, servis bunları koddan hesaplayıp saklar.
   */
  tevkifatKodu: z.string().max(10).optional().nullable(),
  /** Yalnız `650 Diğerleri` için anlamlı; diğer kodlarda oran tektir. */
  tevkifatOrani: z.string().max(10).optional().nullable(),
  gibIstisnaKodu: z.string().max(20).optional().nullable(),
  /** İDİS etiket numarası (EBLG-72): 2 harf + 7 rakam. */
  idisEtiketNo: z.string().max(20).optional().nullable(),
  /** SARJANLIK faturasında şarj ünitesinin seri numarası (EBLG-71). */
  sarjUniteSeriNo: z.string().max(60).optional().nullable(),
  /** EBLG-78: yatırım teşvik harcama tipi (01–04) ve makine-teçhizat bilgileri. */
  ytbHarcamaTipi: z.string().max(2).optional().nullable(),
  ytbMakineAdi: z.string().max(200).optional().nullable(),
  ytbMakineId: z.string().max(60).optional().nullable(),
  ytbMakineSiraNo: z.string().max(60).optional().nullable(),
  projeId: z.string().uuid().optional().nullable(),
  projeAltKirilimId: z.string().uuid().optional().nullable(),
});

const tarihSemasi = z
  .string()
  .transform((val) => (val.includes("T") ? val.slice(0, 10) : val))
  .pipe(z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)"));

const faturaOlusturGovde = z.object({
  tip: z.enum(["satis", "alis", "satis_iade", "alis_iade", "proforma"]),
  gelirTuru: z.enum(["ticari_satis", "kira_geliri", "varlik_satisi", "yansitma", "hizmet_diger"]).optional().nullable(),
  no: z.string().trim().max(100).optional().nullable(),
  tarih: tarihSemasi,
  vadeTarihi: tarihSemasi.optional().nullable(),
  siparisNo: z.string().trim().max(100).optional().nullable(),
  siparisTarihi: tarihSemasi.optional().nullable(),
  /** FTR-31: müşterinin talep referansı; sipariş numarası yoksa e-Belgede OrderReference olur. */
  talepNo: z.string().trim().max(100).optional().nullable(),
  talepTarihi: tarihSemasi.optional().nullable(),
  cariId: z.string().uuid(),
  /**
   * e-Fatura profili (FTR-19). Boş bırakılırsa cari kartındaki varsayılan
   * kullanılır; UBL'e `ProfileID` olarak bu değer yazılır.
   */
  efaturaProfili: z.enum(["temel", "ticari"]).optional().nullable(),
  /**
   * e-Arşiv teslim şekli (EBLG-26). Boş bırakılırsa cari kartındaki varsayılan
   * kullanılır; e-Belge sihirbazında da değiştirilebilir.
   */
  earsivGonderimSekli: z.enum(["elektronik", "kagit"]).optional().nullable(),
  /** EBLG-60: ihraç kayıtlı satış kodu (701/702); doluysa KDV tahsil edilmez. */
  ihracKayitliKodu: z.string().optional().nullable(),
  /** İDİS sevkiyat numarası (EBLG-72): doluysa belge IDIS profiliyle gider. */
  idisSevkiyatNo: z.string().max(20).optional().nullable(),
  /** EBLG-78: yatırım teşvik belge no/tarihi; no doluysa profil YATIRIMTESVIK. */
  ytbNo: z.string().max(40).optional().nullable(),
  ytbTarihi: z.string().date("Geçersiz tarih formatı (YYYY-MM-DD)").optional().nullable(),
  /** Özel matrah (KDV K. 23): kod, KDV'nin hesaplandığı matrah ve oranı. */
  ozelMatrahKodu: z.string().optional().nullable(),
  ozelMatrahTutari: pozitifOndalik.optional().nullable(),
  ozelMatrahOrani: yuzde.optional().nullable(),
  /** STK-07: stok hareketlerinin işleneceği depo; boşsa varsayılan depo */
  depoId: z.string().uuid().optional().nullable(),
  /** FTR-30: teslim yeri; adres, il ve ilçe birlikte girilir. */
  teslimatAdres: z.string().trim().max(500).optional().nullable(),
  teslimatIl: z.string().trim().max(60).optional().nullable(),
  teslimatIlce: z.string().trim().max(60).optional().nullable(),
  teslimatPostaKodu: z.string().trim().max(10).optional().nullable(),
  /** FTR-30: elle girilen teslim yeri carinin sevk adreslerine de eklensin. Saklanmaz. */
  teslimatAdresiniCariyeKaydet: z.boolean().optional(),
  dovizCinsi: z.enum(["TRY", "USD", "EUR"]).default("TRY"),
  kur: pozitifOndalik.default("1"),
  genelIskontoYuzdesi: yuzde.default("0"),
  genelIskontoTutari: pozitifOndalik.default("0"),
  aciklama: z.string().max(500).optional().nullable(),
  notlar: z.string().max(2000).optional().nullable(),
  satirlar: z.array(faturaSatirSemasi).min(1, "Faturada en az bir satır bulunmalıdır"),
});
/**
 * GİB senaryo kuralları (FTR-17, FTR-18). Kural kümesi `@tekirextra/shared`
 * içindedir; arayüz kaydetmeden önce aynı işlevi çağırır, böylece iki taraf
 * kuralı ayrı ayrı yorumlamaz.
 */
const senaryolariDogrula = (
  fatura: { satirlar?: Array<{ kdvOrani?: string; tevkifatKodu?: string | null; tevkifatOrani?: string | null; gibIstisnaKodu?: string | null }> },
  ctx: z.RefinementCtx,
) => {
  const satirlar = (fatura.satirlar ?? []).map((satir) => ({
    kdvOrani: Number(satir.kdvOrani ?? 0),
    tevkifatKodu: satir.tevkifatKodu,
    tevkifatOrani: satir.tevkifatOrani,
    gibIstisnaKodu: satir.gibIstisnaKodu,
  }));
  for (const hata of senaryoHatalari(satirlar, Boolean((fatura as { ozelMatrahKodu?: string | null }).ozelMatrahKodu))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["satirlar", hata.satirIndeksi, hata.alan], message: hata.mesaj });
  }
};
const faturaFinansalDogrula = (fatura: { teslimatAdres?: string | null; teslimatIl?: string | null; teslimatIlce?: string | null; teslimatPostaKodu?: string | null; idisSevkiyatNo?: string | null; ytbNo?: string | null; ytbTarihi?: string | null; ozelMatrahKodu?: string | null; ozelMatrahTutari?: string | null; ozelMatrahOrani?: string | null; satirlar?: Array<{ miktar?: string; birimFiyat?: string; iskontoOrani?: string; kdvOrani?: string; tevkifatKodu?: string | null; tevkifatOrani?: string | null; gibIstisnaKodu?: string | null }>; genelIskontoTutari?: string; dovizCinsi?: string; kur?: string; tip?: string; ihracKayitliKodu?: string | null }, ctx: z.RefinementCtx) => {
  senaryolariDogrula(fatura, ctx);
  // FTR-30: yarım teslim yeri belgeye yazılamaz (il ve ilçe GİB adresinde zorunlu).
  const teslim = [fatura.teslimatAdres, fatura.teslimatIl, fatura.teslimatIlce, fatura.teslimatPostaKodu];
  if (teslim.some((x) => x?.trim()) && !(fatura.teslimatAdres?.trim() && fatura.teslimatIl?.trim() && fatura.teslimatIlce?.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["teslimatAdres"], message: "Teslim yerinde adres, il ve ilçe birlikte girilmelidir" });
  }
  // İDİS: sevkiyat no girilmişse biçimi ve her satırın etiket numarası burada
  // denetlenir; gönderim aynı listeyi yeniden üretir (EBLG-72).
  for (const engel of idisEngelleri({
    sevkiyatNo: fatura.idisSevkiyatNo,
    satirlar: (fatura.satirlar ?? []).map((satir, index) => ({ sira: index + 1, etiketNo: (satir as { idisEtiketNo?: string | null }).idisEtiketNo })),
  })) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [engel.alan === "sevkiyatNo" ? "idisSevkiyatNo" : "satirlar"], message: engel.mesaj });
  }
  // EBLG-78: yatırım teşvik belge no girilmişse harcama tipi, istisna kodu ve
  // makine kimlikleri burada denetlenir; gönderim aynı listeyi yeniden üretir.
  for (const engel of ytbEngelleri({
    ytbNo: fatura.ytbNo,
    ytbTarihi: fatura.ytbTarihi,
    satirlar: (fatura.satirlar ?? []).map((satir, index) => {
      const ytb = satir as { ytbHarcamaTipi?: string | null; ytbMakineAdi?: string | null; ytbMakineId?: string | null; ytbMakineSiraNo?: string | null };
      return {
        sira: index + 1,
        harcamaTipi: ytb.ytbHarcamaTipi,
        makineAdi: ytb.ytbMakineAdi,
        makineId: ytb.ytbMakineId,
        makineSiraNo: ytb.ytbMakineSiraNo,
        kdvOrani: Number(satir.kdvOrani ?? 0),
        gibIstisnaKodu: satir.gibIstisnaKodu,
      };
    }),
  })) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: engel.satirIndeksi === undefined ? [engel.alan === "ytbTarihi" ? "ytbTarihi" : "ytbNo"] : ["satirlar", engel.satirIndeksi],
      message: engel.mesaj,
    });
  }
  // Özel matrah: kod, matrah ve satır kuralları tek yerden (shared) denetlenir.
  if (fatura.ozelMatrahKodu && fatura.tip) {
    for (const mesaj of ozelMatrahHatalari({
      tip: fatura.tip,
      ozelMatrahKodu: fatura.ozelMatrahKodu,
      ozelMatrahTutari: fatura.ozelMatrahTutari,
      ozelMatrahOrani: fatura.ozelMatrahOrani,
      satirlar: (fatura.satirlar ?? []).map((s) => ({ kdvOrani: s.kdvOrani ?? 0, tevkifatKodu: s.tevkifatKodu })),
    })) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ozelMatrahKodu"], message: mesaj });
    }
  }
  // Güncellemede tip gelmeyebilir; kural tam hâliyle serviste yeniden uygulanır.
  if (fatura.ihracKayitliKodu && fatura.tip) {
    for (const mesaj of ihracKayitliHatalari({ tip: fatura.tip, ihracKayitliKodu: fatura.ihracKayitliKodu, satirlar: fatura.satirlar ?? [] })) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ihracKayitliKodu"], message: mesaj });
    }
  }
  // EBLG-57: dövizli belgede 1 "tutar zaten TL" demektir; e-belgenin TL
  // karşılığı ve cari/rapor tutarları yanlış çıkar (masraf ve gelirle aynı kural).
  if (fatura.dovizCinsi !== undefined && fatura.dovizCinsi !== "TRY" && Number(fatura.kur ?? 1) === 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["kur"], message: "Dövizli faturada belge tarihindeki kur girilmelidir" });
  }
  const araToplam = (fatura.satirlar ?? []).reduce((toplam, satir) => toplam + Number(satir.miktar ?? 0) * Number(satir.birimFiyat ?? 0) * (1 - Number(satir.iskontoOrani ?? 0) / 100), 0);
  if (Number(fatura.genelIskontoTutari ?? 0) > araToplam + 0.01) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["genelIskontoTutari"], message: "Genel iskonto tutarı ara toplamı aşamaz" });
};
export const faturaOlusturSemasi = faturaOlusturGovde.superRefine((fatura, ctx) => faturaFinansalDogrula(fatura, ctx));
export const faturaGuncelleSemasi = guncellemeSemasi(faturaOlusturGovde).superRefine((fatura, ctx) => faturaFinansalDogrula(fatura, ctx));

export const faturaSeriSemasi = z.object({
  seri: z.string().regex(/^[A-Z]{3}$/, "Seri 3 büyük harf olmalıdır (örn. TKR)"),
  yil: z.number().int().min(2000).max(2100),
  sonSira: z.number().int().min(0).optional().default(0),
});

export const tekrarlayanFaturaSemasi = z.object({
  ad: z.string().trim().min(1).max(100),
  sablonFaturaId: z.string().uuid(),
  siklik: z.enum(["haftalik", "aylik", "yillik"]),
  aralik: z.number().int().min(1).max(36).default(1),
  sonrakiTarih: z.string().date(),
  bitisTarihi: z.string().date().optional().nullable(),
});

export const tekrarlayanFaturaGuncelleSemasi = z.object({
  ad: z.string().trim().min(1).max(100).optional(),
  aktif: z.boolean().optional(),
  sonrakiTarih: z.string().date().optional(),
  bitisTarihi: z.string().date().optional().nullable(),
});
