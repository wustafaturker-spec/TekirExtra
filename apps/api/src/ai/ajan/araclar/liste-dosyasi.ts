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
 * Satır sınırı aşılırsa dosya kesilmez: kullanıcıdan süzgeci daraltması ya da isteği arka
 * plan göreviyle (AI-105) göndermesi istenir; arka planda sınır ARKA_PLAN_SATIR_SINIRI.
 */
export const LISTE_SATIR_SINIRI = 5000;
/** AI-118 (c): arka plan görevinde (AI-105) Excel sınırı. */
export const ARKA_PLAN_SATIR_SINIRI = 50_000;
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
  /** Uç imleçsiz dizi döndürür ve en çok bu kadar satır verir (ekranın sınırı); dolarsa dosya o sınırda kesilir ve not düşülür. */
  diziSiniri?: number;
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
  gelen_efatura: {
    ad: "Gelen e-Faturalar",
    uc: UC.gelenEfaturaSayfa,
    argumanlar: (s, imlec) => [Object.fromEntries(Object.entries({ durum: s.durum, arama: s.arama, baslangic: s.baslangic, bitis: s.bitis, imlec, adet: String(SAYFA) }).filter(([, v]) => v))],
    kolonlar: [
      { alan: "belgeNo", baslik: "Belge no", tip: "metin" }, { alan: "tarih", baslik: "Tarih", tip: "tarih" }, { alan: "gonderenUnvan", baslik: "Gönderen", tip: "metin" },
      { alan: "gonderenVkn", baslik: "VKN/TCKN", tip: "metin" }, { alan: "profilId", baslik: "Profil", tip: "metin" }, { alan: "durum", baslik: "Durum", tip: "metin" },
      { alan: "yanit", baslik: "Yanıt", tip: "metin" }, { alan: "fatura", baslik: "Alış faturası", tip: "metin" },
      { alan: "genelToplam", baslik: "Genel toplam", tip: "para", dovizAlani: "dovizCinsi" }, { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    ],
    satir: (k) => ({ belgeNo: yaz(k.belgeNo), tarih: gun(k.tarih), gonderenUnvan: yaz(k.gonderenUnvan), gonderenVkn: yaz(k.gonderenVkn), profilId: yaz(k.profilId), durum: yaz(k.durum), yanit: yaz(k.yanit), fatura: yaz(k.fatura?.no), genelToplam: sayi(k.genelToplam), dovizCinsi: yaz(k.dovizCinsi) }),
  },
  banka_ekstresi: {
    ad: "Banka ekstresi satırları",
    uc: UC.ekstreSatirListe,
    argumanlar: (s) => [s.durum, s.bankaHesabi, s.arama, s.baslangic, s.bitis, s.yon === "tahsilat" || s.yon === "tediye" ? s.yon : undefined],
    diziSiniri: 1000,
    kolonlar: [
      { alan: "tarih", baslik: "Tarih", tip: "tarih" }, { alan: "hesap", baslik: "Banka hesabı", tip: "metin" }, { alan: "yon", baslik: "Yön", tip: "metin" },
      { alan: "aciklama", baslik: "Açıklama", tip: "metin" }, { alan: "karsiUnvan", baslik: "Karşı taraf", tip: "metin" }, { alan: "dekontNo", baslik: "Dekont no", tip: "metin" },
      { alan: "durum", baslik: "Durum", tip: "metin" }, { alan: "cari", baslik: "Eşleşen cari", tip: "metin" },
      { alan: "tutar", baslik: "Tutar", tip: "para", dovizAlani: "dovizCinsi" }, { alan: "dovizCinsi", baslik: "Döviz", tip: "metin" },
    ],
    satir: (k) => ({ tarih: gun(k.tarih), hesap: yaz(k.bankaHesap?.ad), yon: yaz(k.yon), aciklama: yaz(k.aciklama), karsiUnvan: yaz(k.karsiUnvan), dekontNo: yaz(k.dekontNo), durum: yaz(k.durum), cari: yaz(k.cari?.unvan), tutar: sayi(k.tutar), dovizCinsi: yaz(k.bankaHesap?.dovizCinsi ?? "TRY") }),
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
export async function listeyiOku(b: AracBaglami, tanim: ListeTanimi, suzgec: Record<string, string | undefined>, sinir = LISTE_SATIR_SINIRI): Promise<{ kayitlar: Kayit[]; sinirAsildi: boolean; kesildi?: boolean }> {
  if (tanim.diziSiniri) {
    const r = await cagir<Kayit[]>(b, tanim.uc, tanim.argumanlar(suzgec, undefined));
    const kayitlar = Array.isArray(r) ? r : [];
    return { kayitlar, sinirAsildi: false, kesildi: kayitlar.length >= tanim.diziSiniri };
  }
  const kayitlar: Kayit[] = [];
  let imlec: string | undefined;
  for (;;) {
    const r = await cagir<{ kayitlar?: Kayit[]; sonrakiImlec?: string | null }>(b, tanim.uc, tanim.argumanlar(suzgec, imlec));
    kayitlar.push(...(r?.kayitlar ?? []));
    if (kayitlar.length > sinir) return { kayitlar: [], sinirAsildi: true };
    if (!r?.sonrakiImlec || !(r.kayitlar ?? []).length) return { kayitlar, sinirAsildi: false };
    imlec = r.sonrakiImlec;
  }
}

export const LISTE_DOSYASI_ARACI = arac({
  ad: "liste_dosyasi",
  aciklama:
    "Fatura, belge (teklif/sipariş/irsaliye), cari, kasa/banka hareketi, masraf, gelen e-Fatura ya da banka ekstresi satırı listesini süzgeçlerle Excel dosyası olarak hazırlar ve sohbete ekler. Kullanıcı 'bu listeyi Excel'e ver' derse ekran durumundaki ekranı ve süzgeçleri aynen kullan. Rapor kataloğundaki raporlar için rapor_dosyasi kullan.",
  sinif: "okuma",
  girdi: z.object({
    ekran: z.enum(LISTE_EKRANLARI).describe("Liste: faturalar, belgeler, cariler, kasa_banka_hareketleri, masraflar, gelen_efatura, banka_ekstresi"),
    suzgecler: z.object({
      arama: z.string().max(100).optional(), durum: z.string().max(40).optional(), tip: z.string().max(40).optional(), tur: z.string().max(40).optional(),
      yon: z.string().max(10).optional(), ebelge: z.string().max(40).optional(), bakiye: z.string().max(40).optional(), grup: z.string().uuid().optional(),
      kategori: z.string().uuid().optional(), cariId: z.string().uuid().optional(),
      hesap: z.string().regex(/^(kasa|banka):[0-9a-f-]{36}$/i).optional(), ihracKayitli: z.string().max(10).optional(),
      bankaHesabi: z.string().uuid().optional().describe("banka_ekstresi: banka hesabı kimliği"),
      baslangic: tarih("Başlangıç").optional(), bitis: tarih("Bitiş").optional(),
    }).optional(),
  }),
  uc: UC.faturaListe,
  async calistir(b, g) {
    const tanim = LISTELER[g.ekran];
    if (!tanim) throw new BadRequestException("Bu liste dosya olarak verilemez.");
    const sinir = b.arkaPlan ? ARKA_PLAN_SATIR_SINIRI : LISTE_SATIR_SINIRI;
    const { kayitlar, sinirAsildi, kesildi } = await listeyiOku(b, tanim, g.suzgecler ?? {}, sinir);
    if (sinirAsildi) {
      const binlik = (n: number) => n.toLocaleString("tr-TR");
      return b.arkaPlan || b.kaynak !== "asistan"
        ? { basarili: false, not: `Liste ${binlik(sinir)} satırı aşıyor; dosya hazırlanmadı. Kullanıcıdan dönem ya da süzgeçle daraltmasını iste.` }
        : { basarili: false, not: `Liste ${binlik(sinir)} satırı aşıyor; dosya hazırlanmadı. Kullanıcıya iki yol söyle: süzgeci ya da dönemi daraltmak veya aynı isteği mesaj kutusundaki "Arka planda" seçeneğiyle göndermek (arka planda en çok ${binlik(ARKA_PLAN_SATIR_SINIRI)} satır; hazır olunca bildirim gelir).` };
    }
    const kitap = new ExcelJS.Workbook();
    const bilgiler = Object.entries(g.suzgecler ?? {}).filter(([, v]) => v).map(([a, v]) => `${a}: ${v}`);
    const kesikNotu = kesildi ? `Ekran en çok ${tanim.diziSiniri} satır gösterir; dosya ilk ${kayitlar.length} satırı içerir. Tamamı için dönemi daraltın.` : null;
    if (kesikNotu) bilgiler.push(kesikNotu);
    raporSayfasiEkle(kitap, { ad: tanim.ad, kolonlar: tanim.kolonlar }, kayitlar.map(tanim.satir), { bilgiler });
    const tampon = Buffer.from((await kitap.xlsx.writeBuffer()) as ArrayBuffer);
    const dosyaAdi = guvenliDosyaAdi(`${tanim.ad}-${new Date().toISOString().slice(0, 10)}`, "xlsx");
    return {
      _dosya: { tampon, dosyaAdi, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      basarili: true, dosyaAdi, satirSayisi: kayitlar.length,
      mesaj: `${dosyaAdi} (${kayitlar.length} satır) hazırlandı ve sohbete eklendi. İçeriği yanıtta tekrar etme.${kesikNotu ? ` ${kesikNotu}` : ""}`,
    };
  },
});
