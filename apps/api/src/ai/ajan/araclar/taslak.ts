import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { faturaKurTipi } from "@tekirextra/shared";
import { adres, arac, BUGUN, cagir, sayiMetni, sec, tarih, uuid, type AracBaglami } from "./arac";
import { UC } from "./uclar";

export const satirGirdisi = z.object({
  stokId: uuid("Stok kartı kimliği (stok_ara sonucundaki id)"),
  varyantId: uuid("Varyantlı üründe varyant kimliği (zorunlu)").optional(),
  miktar: sayiMetni("Miktar"),
  birimFiyat: sayiMetni("KDV hariç birim fiyat, belge dövizinde. Verilmezse fiyat listesi/kart fiyatı kullanılır").optional(),
  iskontoOrani: sayiMetni("Satır iskonto yüzdesi").optional(),
  birim: z.string().optional().describe("Verilmezse kartın ana birimi"),
});
type SatirGirdisi = z.infer<typeof satirGirdisi>;

export const dovizGirdisi = z.string().length(3).optional().describe("Belge dövizi (TRY, USD, EUR…); varsayılan TRY");

/** Döviz kuru, ekranın kullandığı kur ucundan (kur tipi fatura kuralıyla). */
export async function kurBul(b: AracBaglami, doviz: string, gun: string, faturaTipi: string): Promise<string> {
  if (doviz === "TRY") return "1";
  const k = await cagir(b, UC.dovizKuru, [gun, faturaKurTipi(faturaTipi)]);
  const deger = k?.kurlar?.[doviz];
  if (!deger) throw new BadRequestException(`${gun} için ${doviz} kuru bulunamadı; Ayarlar > Döviz Kurları ekranından girin.`);
  return String(deger);
}

/**
 * Satırı ekranın yaptığı gibi doldurur: KDV oranı ve birim karttan, fiyat
 * verilmemişse fiyat önerisi ucundan (fiyat listesi, döviz çevrimi).
 * KDV dışı vergiler gönderilmez; sunucu kart vergilerini uygular.
 */
export async function satirHazirla(
  b: AracBaglami,
  s: SatirGirdisi,
  ortam: { cariId: string; yon: string; doviz: string; kur: string; gun: string; faturaTipi: string },
) {
  const stok = await cagir(b, UC.stokGetir, [s.stokId]);
  let birimFiyat = s.birimFiyat;
  let iskontoOrani = s.iskontoOrani;
  if (birimFiyat === undefined) {
    const oneri = (urunKuru?: string) =>
      cagir(b, UC.stokTavsiyeFiyat, [s.stokId, ortam.cariId, ortam.yon, ortam.doviz, undefined, ortam.kur, urunKuru, s.varyantId]);
    let f = await oneri();
    // Fiyat başka dövizdeyse ekran gibi ürün dövizinin kurunu verip çevirtir
    // (canlıda 0,38 USD'lik liste fiyatı çevrilmeden 0,38 TL yazılmıştı).
    if (f?.cevrilebilir === false && f.kaynakDoviz && f.kaynakDoviz !== ortam.doviz) {
      f = await oneri(await kurBul(b, f.kaynakDoviz, ortam.gun, ortam.faturaTipi));
    }
    if (f?.cevrilebilir === false || f?.birimFiyat === null || f?.birimFiyat === undefined || Number(f.birimFiyat) <= 0) {
      throw new BadRequestException(`${stok.ad} için kayıtlı fiyat yok ya da belge dövizine çevrilemiyor; birim fiyatı kullanıcıdan alın.`);
    }
    birimFiyat = Number(f.birimFiyat).toFixed(4);
    // Fiyat listesinin iskontosu, kullanıcı başka oran vermediyse uygulanır (ekrandaki gibi).
    if (iskontoOrani === undefined && Number(f.iskontoOrani) > 0) iskontoOrani = String(f.iskontoOrani);
  }
  return {
    stokId: s.stokId,
    varyantId: s.varyantId ?? null,
    miktar: s.miktar,
    birim: s.birim ?? stok.anaBirim ?? "adet",
    birimFiyat,
    iskontoOrani: iskontoOrani ?? "0",
    kdvOrani: String(stok.kdvOrani ?? "20"),
  };
}

export const TASLAK_ARACLARI = [
  arac({
    ad: "belge_taslagi_olustur",
    aciklama:
      "Taslak teklif, sipariş veya irsaliye açar (onaylamaz). Fiyat verilmezse fiyat listesi/kart fiyatı kullanılır; KDV oranı karttan gelir. Numara onayda verilir.",
    sinif: "taslak",
    girdi: z.object({
      tur: z.enum(["teklif", "siparis", "irsaliye"]),
      yon: z.enum(["satis", "alis"]).optional().describe("Varsayılan satış"),
      cariId: uuid("Cari kimliği"),
      tarih: tarih("Belge tarihi; varsayılan bugün").optional(),
      gecerlilikTarihi: tarih("Teklifin geçerlilik tarihi").optional(),
      odemeVadeGun: z.number().int().min(0).max(365).optional().describe("Ödeme vadesi (gün)"),
      dovizCinsi: dovizGirdisi,
      aciklama: z.string().max(500).optional(),
      satirlar: z.array(satirGirdisi).min(1),
    }),
    uc: UC.belgeOlustur,
    async calistir(b, g) {
      const yon = g.yon ?? "satis";
      const gun = g.tarih ?? BUGUN();
      const doviz = (g.dovizCinsi ?? "TRY").toUpperCase();
      const kur = await kurBul(b, doviz, gun, yon);
      const satirlar = [];
      for (const s of g.satirlar) satirlar.push(await satirHazirla(b, s, { cariId: g.cariId, yon, doviz, kur, gun, faturaTipi: yon }));
      const belge = await cagir(b, UC.belgeOlustur, [{
        tur: g.tur, yon, tarih: gun, gecerlilikTarihi: g.gecerlilikTarihi ?? null, odemeVadeGun: g.odemeVadeGun ?? null,
        cariId: g.cariId, dovizCinsi: doviz, kur, aciklama: g.aciklama ?? null, satirlar,
      }]);
      return { ...sec(belge, ["id", "tur", "yon", "durum", "dovizCinsi", "toplamMatrah", "toplamKdv", "genelToplam"]), adres: adres.belge(belge.id) };
    },
  }),
  arac({
    ad: "fatura_taslagi_olustur",
    aciklama:
      "Taslak satış/alış faturası açar (kesinleştirmez, e-Belge göndermez). Fiyat verilmezse fiyat listesi/kart fiyatı kullanılır; KDV oranı karttan gelir.",
    sinif: "taslak",
    girdi: z.object({
      tip: z.enum(["satis", "alis", "satis_iade", "alis_iade"]),
      cariId: uuid("Cari kimliği"),
      tarih: tarih("Fatura tarihi; varsayılan bugün").optional(),
      vadeTarihi: tarih("Vade tarihi").optional(),
      dovizCinsi: dovizGirdisi,
      aciklama: z.string().max(500).optional(),
      satirlar: z.array(satirGirdisi).min(1),
    }),
    uc: UC.faturaOlustur,
    async calistir(b, g) {
      const gun = g.tarih ?? BUGUN();
      const doviz = (g.dovizCinsi ?? "TRY").toUpperCase();
      const kur = await kurBul(b, doviz, gun, g.tip);
      const fiyatYonu = g.tip === "alis" || g.tip === "alis_iade" ? "alis" : "satis";
      const satirlar = [];
      for (const s of g.satirlar) satirlar.push(await satirHazirla(b, s, { cariId: g.cariId, yon: fiyatYonu, doviz, kur, gun, faturaTipi: g.tip }));
      const fatura = await cagir(b, UC.faturaOlustur, [{
        tip: g.tip, tarih: gun, vadeTarihi: g.vadeTarihi ?? null, cariId: g.cariId, dovizCinsi: doviz, kur, aciklama: g.aciklama ?? null, satirlar,
      }]);
      return { ...sec(fatura, ["id", "tip", "durum", "dovizCinsi", "toplamMatrah", "toplamKdv", "genelToplam"]), adres: adres.fatura(fatura.id) };
    },
  }),
  arac({
    ad: "masraf_taslagi_olustur",
    aciklama: "Taslak masraf kaydı açar (onaylamaz, ödemez). Tutar KDV dahil verilir; matrah ve KDV hesaplanır.",
    sinif: "taslak",
    girdi: z.object({
      kategoriId: uuid("Masraf kategorisi (masraf_kategorileri)"),
      belgeTuru: z.enum(["fis", "fatura", "kira", "dekont", "serbest_meslek_makbuzu", "diger"]),
      tarih: tarih("Belge tarihi; varsayılan bugün").optional(),
      belgeNo: z.string().max(100).optional(),
      saticiUnvan: z.string().max(255).optional(),
      vknTckn: z.string().max(11).optional(),
      cariId: uuid("Varsa satıcı carisi").optional(),
      aciklama: z.string().max(1000).optional(),
      toplam: z.number().positive().describe("KDV dahil toplam"),
      kdvOrani: z.number().min(0).max(100),
      dovizCinsi: dovizGirdisi,
    }),
    uc: UC.masrafOlustur,
    async calistir(b, g) {
      const gun = g.tarih ?? BUGUN();
      const doviz = (g.dovizCinsi ?? "TRY").toUpperCase();
      const kur = Number(await kurBul(b, doviz, gun, "alis"));
      const matrah = Math.round((g.toplam / (1 + g.kdvOrani / 100)) * 100) / 100;
      const masraf = await cagir(b, UC.masrafOlustur, [{
        kategoriId: g.kategoriId, cariId: g.cariId ?? null, belgeTuru: g.belgeTuru, belgeNo: g.belgeNo ?? null, tarih: gun,
        saticiUnvan: g.saticiUnvan ?? null, vknTckn: g.vknTckn ?? null, aciklama: g.aciklama ?? null,
        matrah, kdvOrani: g.kdvOrani, kdvTutari: Math.round((g.toplam - matrah) * 100) / 100, toplam: g.toplam, dovizCinsi: doviz, kur,
      }]);
      return { ...sec(masraf, ["id", "durum", "matrah", "kdvTutari", "toplam", "dovizCinsi"]), adres: adres.masraf() };
    },
  }),
  arac({
    ad: "crm_gorevi_olustur",
    aciklama: "Bir cari için CRM takip görevi açar (arama, toplantı, hatırlatma).",
    sinif: "taslak",
    girdi: z.object({
      cariId: uuid("Cari kimliği"),
      baslik: z.string().min(2).max(200),
      aciklama: z.string().max(4000).optional(),
      sonTarih: tarih("Son tarih"),
      oncelik: z.enum(["dusuk", "normal", "yuksek"]).optional(),
    }),
    uc: UC.cariCrmGorev,
    async calistir(b, g) {
      const gorev = await cagir(b, UC.cariCrmGorev, [g.cariId, {
        baslik: g.baslik, aciklama: g.aciklama ?? null, sonTarih: `${g.sonTarih}T17:00:00+03:00`, oncelik: g.oncelik ?? "normal",
      }], g.cariId);
      return { ...sec(gorev, ["id", "baslik", "sonTarih", "oncelik", "durum"]), adres: adres.cari(g.cariId) };
    },
  }),
];
