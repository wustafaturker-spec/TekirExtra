import { BadRequestException } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { z } from "zod";
import { raporSayfasiEkle } from "../../../core/raporlar/rapor-excel";
import type { RaporKolon, RaporSatiri } from "../../../core/raporlar/rapor-kayit";
import { arac, cagir, tarih, type AracBaglami } from "./arac";
import { guvenliDosyaAdi } from "./dosya";
import type { UcTanimi } from "../uc-cagirici";
import { UC } from "./uclar";

/**
 * AI-118: "bu listeyi Excel'e ver". Ekranın kendi liste ucu kullanıcının rolüyle ve
 * ekrandaki süzgeçlerle sayfa sayfa okunur (ekranla aynı yetki, paket ve özel rol
 * denetimi); dosya rapor dışa aktarımının sayfa biçimiyle yazılır. İçerik modele gitmez.
 * Satır sınırı aşılırsa dosya kesilmez, kullanıcıdan süzgeci daraltması istenir (büyük
 * dosyanın arka planda hazırlanması AI-105 ile gelecek).
 */
export const LISTE_SATIR_SINIRI = 5000;
const SAYFA = 200;

type Kayit = Record<string, any>;
const yaz = (v: unknown) => (v === null || v === undefined ? null : String(v));
const sayi = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const gun = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : null);

interface ListeTanimi {
  ad: string;
  uc: UcTanimi;
  /** Ucun konumsal argümanları (imleç ve sayfa adedi dahil). */
  argumanlar: (s: Record<string, string | undefined>, imlec: string | undefined) => unknown[];
  kolonlar: RaporKolon[];
  satir: (k: Kayit) => RaporSatiri;
}

const LISTELER: Record<string, ListeTanimi> = {
  faturalar: {
    ad: "Faturalar",
    uc: UC.faturaListe,
    argumanlar: (s, imlec) => [s.arama, s.tip, s.durum, imlec, String(SAYFA), s.yon, s.ebelge, s.cariId, s.baslangic, s.bitis, s.ihracKayitli],
    kolonlar: [
      { alan: "no", baslik: "Fatura no", tip: "metin" }, { alan: "tarih", baslik: "Tarih", tip: "tarih" }, { alan: "vadeTarihi", baslik: "Vade", tip: "tarih" },
      { alan: "cari", baslik: "Cari", tip: "metin" }, { alan: "tip", baslik: "Tip", tip: "metin" }, { alan: "durum", baslik: "Durum", tip: "metin" },
      { alan: "genelToplam", baslik: "Genel toplam", tip: "para", dovizAlani: "dovizCinsi" }, { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    ],
    satir: (k) => ({ no: yaz(k.no), tarih: gun(k.tarih), vadeTarihi: gun(k.vadeTarihi), cari: yaz(k.cari?.unvan), tip: yaz(k.tip), durum: yaz(k.durum), genelToplam: sayi(k.genelToplam), dovizCinsi: yaz(k.dovizCinsi) }),
  },
  belgeler: {
    ad: "Teklif, sipariş ve irsaliyeler",
    uc: UC.belgeListe,
    argumanlar: (s, imlec) => [s.tur, s.yon, s.durum, s.arama, s.baslangic, s.bitis, imlec],
    kolonlar: [
      { alan: "no", baslik: "Belge no", tip: "metin" }, { alan: "tur", baslik: "Tür", tip: "metin" }, { alan: "yon", baslik: "Yön", tip: "metin" },
      { alan: "tarih", baslik: "Tarih", tip: "tarih" }, { alan: "cari", baslik: "Cari", tip: "metin" }, { alan: "durum", baslik: "Durum", tip: "metin" },
      { alan: "genelToplam", baslik: "Genel toplam", tip: "para", dovizAlani: "dovizCinsi" }, { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    ],
    satir: (k) => ({ no: yaz(k.no), tur: yaz(k.tur), yon: yaz(k.yon), tarih: gun(k.tarih), cari: yaz(k.cari?.unvan), durum: yaz(k.durum), genelToplam: sayi(k.genelToplam), dovizCinsi: yaz(k.dovizCinsi) }),
  },
  cariler: {
    ad: "Cariler",
    uc: UC.cariListe,
    argumanlar: (s, imlec) => [s.arama, imlec, String(SAYFA), s.tip, undefined, s.bakiye, undefined, undefined, undefined, s.grup],
    kolonlar: [
      { alan: "kod", baslik: "Kod", tip: "metin" }, { alan: "unvan", baslik: "Unvan", tip: "metin" }, { alan: "tip", baslik: "Tip", tip: "metin" },
      { alan: "bakiye", baslik: "Bakiye", tip: "para", dovizAlani: "dovizCinsi" }, { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    ],
    // Cari birden çok dövizde bakiye taşıyabilir: her döviz ayrı satır.
    satir: (k) => ({ kod: yaz(k.kod), unvan: yaz(k.unvan), tip: yaz(k.tip), bakiye: sayi(k.bakiyeler?.[0]?.bakiye), dovizCinsi: yaz(k.bakiyeler?.[0]?.dovizCinsi ?? "TRY") }),
  },
  kasa_banka_hareketleri: {
    ad: "Kasa/banka hareketleri",
    uc: UC.kasaBankaHareketListe,
    argumanlar: (s, imlec) => {
      const [hesapTuru, hesapId] = (s.hesap ?? "").split(":");
      return [{ ...(hesapTuru === "kasa" ? { kasaId: hesapId } : hesapTuru === "banka" ? { bankaHesapId: hesapId } : {}), baslangic: s.baslangic, bitis: s.bitis, tur: s.tur, arama: s.arama, imlec, adet: String(SAYFA) }];
    },
    kolonlar: [
      { alan: "tarih", baslik: "Tarih", tip: "tarih" }, { alan: "hesap", baslik: "Hesap", tip: "metin" }, { alan: "tur", baslik: "Tür", tip: "metin" },
      { alan: "cari", baslik: "Cari", tip: "metin" }, { alan: "aciklama", baslik: "Açıklama", tip: "metin" },
      { alan: "tutar", baslik: "Tutar", tip: "para", dovizAlani: "dovizCinsi" }, { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    ],
    satir: (k) => ({ tarih: gun(k.tarih), hesap: yaz(k.kasa?.ad ?? k.bankaHesap?.ad ?? k.posHesap?.ad), tur: yaz(k.tur), cari: yaz(k.cari?.unvan), aciklama: yaz(k.aciklama), tutar: sayi(k.tutar), dovizCinsi: yaz(k.dovizCinsi) }),
  },
  masraflar: {
    ad: "Masraflar",
    uc: UC.masrafListe,
    argumanlar: (s, imlec) => [Object.fromEntries(Object.entries({ durum: s.durum, kategoriId: s.kategori, arama: s.arama, imlec, adet: String(SAYFA) }).filter(([, v]) => v))],
    kolonlar: [
      { alan: "tarih", baslik: "Tarih", tip: "tarih" }, { alan: "belgeNo", baslik: "Belge no", tip: "metin" }, { alan: "kategori", baslik: "Kategori", tip: "metin" },
      { alan: "satici", baslik: "Satıcı", tip: "metin" }, { alan: "durum", baslik: "Durum", tip: "metin" }, { alan: "odemeDurumu", baslik: "Ödeme", tip: "metin" },
      { alan: "toplam", baslik: "Toplam", tip: "para", dovizAlani: "dovizCinsi" }, { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    ],
    satir: (k) => ({ tarih: gun(k.tarih), belgeNo: yaz(k.belgeNo), kategori: yaz(k.kategori?.ad), satici: yaz(k.cari?.unvan ?? k.saticiUnvan), durum: yaz(k.durum), odemeDurumu: yaz(k.odemeDurumu), toplam: sayi(k.toplam), dovizCinsi: yaz(k.dovizCinsi) }),
  },
};

export const LISTE_EKRANLARI = Object.keys(LISTELER) as [string, ...string[]];

/** Liste ucunu imleçle sonuna (ya da sınıra) kadar okur. */
export async function listeyiOku(b: AracBaglami, tanim: ListeTanimi, suzgec: Record<string, string | undefined>): Promise<{ kayitlar: Kayit[]; sinirAsildi: boolean }> {
  const kayitlar: Kayit[] = [];
  let imlec: string | undefined;
  for (;;) {
    const r = await cagir<{ kayitlar?: Kayit[]; sonrakiImlec?: string | null }>(b, tanim.uc, tanim.argumanlar(suzgec, imlec));
    kayitlar.push(...(r?.kayitlar ?? []));
    if (kayitlar.length > LISTE_SATIR_SINIRI) return { kayitlar: [], sinirAsildi: true };
    if (!r?.sonrakiImlec || !(r.kayitlar ?? []).length) return { kayitlar, sinirAsildi: false };
    imlec = r.sonrakiImlec;
  }
}

export const LISTE_DOSYASI_ARACI = arac({
  ad: "liste_dosyasi",
  aciklama:
    "Fatura, belge (teklif/sipariş/irsaliye), cari, kasa/banka hareketi ya da masraf listesini süzgeçlerle Excel dosyası olarak hazırlar ve sohbete ekler. Kullanıcı 'bu listeyi Excel'e ver' derse ekran durumundaki ekranı ve süzgeçleri aynen kullan. Rapor kataloğundaki raporlar için rapor_dosyasi kullan.",
  sinif: "okuma",
  girdi: z.object({
    ekran: z.enum(LISTE_EKRANLARI).describe("Liste: faturalar, belgeler, cariler, kasa_banka_hareketleri, masraflar"),
    suzgecler: z.object({
      arama: z.string().max(100).optional(), durum: z.string().max(40).optional(), tip: z.string().max(40).optional(), tur: z.string().max(40).optional(),
      yon: z.string().max(10).optional(), ebelge: z.string().max(40).optional(), bakiye: z.string().max(40).optional(), grup: z.string().uuid().optional(),
      kategori: z.string().uuid().optional(), cariId: z.string().uuid().optional(),
      hesap: z.string().regex(/^(kasa|banka):[0-9a-f-]{36}$/i).optional(), ihracKayitli: z.string().max(10).optional(),
      baslangic: tarih("Başlangıç").optional(), bitis: tarih("Bitiş").optional(),
    }).optional(),
  }),
  uc: UC.faturaListe,
  async calistir(b, g) {
    const tanim = LISTELER[g.ekran];
    if (!tanim) throw new BadRequestException("Bu liste dosya olarak verilemez.");
    const { kayitlar, sinirAsildi } = await listeyiOku(b, tanim, g.suzgecler ?? {});
    if (sinirAsildi) {
      return { basarili: false, not: `Liste ${LISTE_SATIR_SINIRI} satırı aşıyor; dosya hazırlanmadı. Kullanıcıdan dönem ya da süzgeçle daraltmasını iste.` };
    }
    const kitap = new ExcelJS.Workbook();
    const bilgiler = Object.entries(g.suzgecler ?? {}).filter(([, v]) => v).map(([a, v]) => `${a}: ${v}`);
    raporSayfasiEkle(kitap, { ad: tanim.ad, kolonlar: tanim.kolonlar }, kayitlar.map(tanim.satir), { bilgiler });
    const tampon = Buffer.from((await kitap.xlsx.writeBuffer()) as ArrayBuffer);
    const dosyaAdi = guvenliDosyaAdi(`${tanim.ad}-${new Date().toISOString().slice(0, 10)}`, "xlsx");
    return {
      _dosya: { tampon, dosyaAdi, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      basarili: true, dosyaAdi, satirSayisi: kayitlar.length,
      mesaj: `${dosyaAdi} (${kayitlar.length} satır) hazırlandı ve sohbete eklendi. İçeriği yanıtta tekrar etme.`,
    };
  },
});
