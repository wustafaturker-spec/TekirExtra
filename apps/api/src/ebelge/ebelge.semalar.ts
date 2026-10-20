import { AZAMI_KAP_ADEDI, ON_DENETIM_KODLARI, IADE_REFERANS_UST_SINIRI, KAP_NO_UZUNLUGU, kapCinsiGecerliMi, odemeSekliGecerliMi, SEVKIYAT_YONTEM_KODLARI, tasimaSekliGecerliMi, teslimSartiGecerliMi } from "@tekirextra/shared";
import { z } from "zod";

export const gelenFiyatAnaliziSemasi = z.object({
  satirEslesmeleri: z.array(z.object({
    siraNo: z.number().int().min(1), stokId: z.string().uuid(), varyantId: z.string().uuid().nullish(),
  }).strict()).min(1).max(100),
}).strict().refine((g) => new Set(g.satirEslesmeleri.map((s) => s.siraNo)).size === g.satirEslesmeleri.length,
  "Aynı satır birden fazla eşleştirilemez");

/** EBLG-05: onay ekranından gelen satır → stok kartı eşleştirmeleri. */
export const gelenOnaySemasi = z.object({
  satirEslesmeleri: z
    .array(
      z.object({
        siraNo: z.number().int().min(1),
        stokId: z.string().uuid(),
        varyantId: z.string().uuid().nullish(),
      }),
    )
    .min(1, "En az bir satır eşleştirmesi gerekli"),
  yeniCariOnay: z.boolean().optional(),
});

/** EBLG-06: ticari faturaya kabul/ret yanıtı. */
export const gelenYanitSemasi = z
  .object({
    yanit: z.enum(["kabul", "ret"]),
    gerekce: z.string().max(500).optional().nullable(),
  })
  .refine((g) => g.yanit !== "ret" || Boolean(g.gerekce?.trim()), {
    message: "Ret yanıtı için gerekçe zorunludur",
    path: ["gerekce"],
  });

/** EBLG-26/53: sihirbazda seçilen e-Arşiv teslim şekli ve ihracat alanları; boşsa faturadaki kalır. */
export const ebelgeGonderSemasi = z.object({
  /**
   * EBLG-141: ön denetim uyarılarını gördüm onayı. `anahtarlar` onaylanan
   * uyarıların kural:satır anahtarlarıdır; sunucu o anki uyarılarla karşılaştırır.
   */
  onDenetimOnayi: z
    .object({
      anahtarlar: z.array(z.string().max(80)).max(500),
      gerekce: z.string().trim().max(300, "Gerekçe en çok 300 karakter olabilir").optional(),
    })
    .optional(),
  /**
   * EBLG-76: sevkiyatın nasıl belgelendiği. `irsaliye` seçilen e-İrsaliyelere
   * bağlanır, `fatura_once` sonra kesilecek irsaliyeyi bekler,
   * `irsaliye_yerine` fiili sevk anını ister (fatura irsaliye yerine geçer).
   */
  sevkiyat: z
    .object({
      yontem: z.enum(SEVKIYAT_YONTEM_KODLARI),
      irsaliyeIds: z.array(z.string().uuid()).max(50).default([]),
      fiiliSevkZamani: z.iso.datetime({ offset: true, message: "Geçersiz sevk tarihi/saati" }).nullable().optional(),
    })
    .optional(),
  earsivGonderimSekli: z.enum(["elektronik", "kagit"]).optional(),
  ihracat: z
    .object({
      teslimTarihi: z.coerce.date().nullable().optional(),
      teslimSarti: z.string().refine(teslimSartiGecerliMi, "Tanımsız teslim şartı").nullable().optional(),
      tasimaSekli: z.string().refine(tasimaSekliGecerliMi, "Tanımsız taşıma şekli").nullable().optional(),
      /** EBLG-103: kalem bazında kap bilgisi; listede olmayan satır olduğu gibi kalır. */
      satirlar: z
        .array(
          z.object({
            id: z.string().uuid(),
            kapCinsi: z.string().refine(kapCinsiGecerliMi, "Tanımsız kap cinsi").nullable().optional(),
            kapNo: z.string().trim().max(KAP_NO_UZUNLUGU, `Kap numarası en çok ${KAP_NO_UZUNLUGU} karakter olabilir`).nullable().optional(),
            kapAdet: z.number().int("Kap adedi tam sayı olmalıdır").min(1, "Kap adedi en az 1 olmalıdır").max(AZAMI_KAP_ADEDI).nullable().optional(),
          }),
        )
        .max(1000)
        .optional(),
    })
    .optional(),
  /** EBLG-56: internet satışı işareti ve alan grubu; işaret kalkarsa alanlar temizlenir. */
  internetSatisi: z
    .object({
      internetSatisi: z.boolean(),
      webAdresi: z.string().max(200).nullable().optional(),
      odemeSekli: z.string().refine(odemeSekliGecerliMi, "Tanımsız ödeme şekli").nullable().optional(),
      odemeTarihi: z.coerce.date().nullable().optional(),
      odemeAracisi: z.string().max(100).nullable().optional(),
      tasiyiciUnvan: z.string().max(200).nullable().optional(),
      tasiyiciVkn: z.string().regex(/^\d{10}$|^\d{11}$/, "Taşıyıcı VKN/TCKN 10 ya da 11 haneli olmalıdır").nullable().optional(),
      gonderiTarihi: z.coerce.date().nullable().optional(),
    })
    .optional(),
  /** Yolcu beraberi (tax-free): işaret, yolcu kimliği ve aracı kurum. */
  yolcuBeraberi: z
    .object({
      isaretli: z.boolean(),
      yolcu: z
        .object({
          ad: z.string().max(100).nullable().optional(),
          soyad: z.string().max(100).nullable().optional(),
          uyruk: z.string().max(2).nullable().optional(),
          pasaportNo: z.string().max(40).nullable().optional(),
          pasaportTarihi: z.string().max(10).nullable().optional(),
          sehir: z.string().max(80).nullable().optional(),
          ulke: z.string().max(2).nullable().optional(),
          bankaHesapNo: z.string().max(40).nullable().optional(),
          bankaAdi: z.string().max(120).nullable().optional(),
        })
        .optional(),
      araciKurum: z
        .object({
          vkn: z.string().max(10).nullable().optional(),
          etiket: z.string().max(200).nullable().optional(),
          unvan: z.string().max(200).nullable().optional(),
        })
        .optional(),
    })
    .optional(),
  /** KAMU senaryosu: ödemeyi yapacak harcama birimi ve ödemenin yapılacağı IBAN. */
  kamu: z
    .object({
      harcamaBirimiVkn: z.string().max(10).nullable().optional(),
      harcamaBirimiAdi: z.string().max(200).nullable().optional(),
      iban: z.string().max(40).nullable().optional(),
    })
    .optional(),
  /** Şarj faturası: plaka, şarj süresi ve ESU rapor kimlikleri (EBLG-71). */
  sarj: z
    .object({
      plaka: z.string().max(20).nullable().optional(),
      baslangic: z.string().max(16).nullable().optional(),
      bitis: z.string().max(16).nullable().optional(),
      esuRaporlari: z.array(z.object({ raporId: z.string().max(40), tarih: z.string().max(10) })).max(50).optional(),
    })
    .optional(),
  /** SGK faturası: grup, Kurum'daki kod/ad, dosya no ve fatura dönemi (EBLG-70). */
  sgk: z
    .object({
      ilaveFaturaTipi: z.string().max(20).nullable().optional(),
      mukellefKodu: z.string().max(40).nullable().optional(),
      mukellefAdi: z.string().max(200).nullable().optional(),
      dosyaNo: z.string().max(40).nullable().optional(),
      donemBaslangic: z.string().max(10).nullable().optional(),
      donemBitis: z.string().max(10).nullable().optional(),
    })
    .optional(),
  /**
   * EBLG-58: alış iadesinde iade edilen faturalar. Listeden seçilen fatura
   * kimliğiyle gelir; sistemde olmayan fatura numarası ve tarihiyle girilir.
   */
  iade: z
    .object({
      referanslar: z
        .array(
          z.object({
            kaynakFaturaId: z.string().uuid().nullable().optional(),
            belgeNo: z.string().max(16).nullable().optional(),
            tarih: z.coerce.date().nullable().optional(),
          }),
        )
        .max(IADE_REFERANS_UST_SINIRI, `En çok ${IADE_REFERANS_UST_SINIRI} fatura referans verilebilir`),
    })
    .optional(),
});

/** EBLG-54: gümrük beyanname bilgisi; belge gönderildikten sonra da girilebilir. */
export const gumrukBeyannameSemasi = z.object({
  no: z.string().max(40).nullable().optional(),
  tarih: z.coerce.date().nullable().optional(),
});

export const earsivIptalSemasi = z.object({
  iptalTarihi: z.coerce.date(),
  sube: z.string().max(50).optional(),
});

export const earsivRaporAralikSemasi = z.object({
  baslangic: z.coerce.date(),
  bitis: z.coerce.date(),
}).superRefine((g, ctx) => {
  if (g.baslangic > g.bitis) ctx.addIssue({ code: "custom", path: ["bitis"], message: "Başlangıç tarihi bitişten sonra olamaz" });
  if (g.bitis.getTime() - g.baslangic.getTime() > 366 * 86400000) ctx.addIssue({ code: "custom", path: ["bitis"], message: "Rapor aralığı en fazla 366 gün olabilir" });
});

export const gelenXmlYukleSemasi = z.object({
  xml: z.string().min(10, "Geçerli bir XML içeriği girilmelidir"),
});

/** EBLG-141: cari başına ön denetim kuralını susturma. */
export const onDenetimSusturmaSemasi = z.object({
  cariId: z.string().uuid(),
  kod: z.enum(ON_DENETIM_KODLARI),
});
