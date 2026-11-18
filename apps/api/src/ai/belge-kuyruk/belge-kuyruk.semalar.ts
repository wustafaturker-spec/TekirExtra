import { z } from "zod";

export const BelgeKuyrukDurumuSemasi = z.enum([
  "KUYRUKTA",
  "ISLENIYOR",
  "TAMAMLANDI",
  "KISMI_BASARI",
  "HATA",
]);
export type BelgeKuyrukDurumu = z.infer<typeof BelgeKuyrukDurumuSemasi>;

export const BelgeOcrDurumuSemasi = z.enum([
  "KUYRUKTA",
  "ISLENIYOR",
  "INCELENECEK",
  "ONAYLANDI",
  "ISLENDI",
  "REDDEDILDI",
  "HATA",
]);
export type BelgeOcrDurumu = z.infer<typeof BelgeOcrDurumuSemasi>;

export interface AlanKaniti {
  sayfa?: number;
  alinti?: string;
  guven: number;
}

export type BelgeAlanKanitlari = Record<string, AlanKaniti>;

export interface BelgeDogrulamaSonucu {
  gecerli: boolean;
  matematikselUyumlu: boolean;
  hesaplananToplam: number;
  genelToplam: number;
  fark: number;
  kdvKirilimMatrahUyumlu: boolean;
  eslesmeKesinligi: "TAM_VKN" | "UNVAN_BENZERLIGI" | "ESLESMEDI";
  eslesenCari: { id: string; unvan: string; kod: string } | null;
  uyarilar: string[];
  hatalar: string[];
  celiskiler: string[];
}

export const kullaniciDuzeltmeSemasi = z.object({
  belgeTuru: z.enum(["FIS", "FATURA", "E_ARSIV", "E_FATURA", "BILINMIYOR"]).optional(),
  belgeNo: z.string().max(50).nullable().optional(),
  tarih: z.string().date().nullable().optional(),
  saticiUnvan: z.string().min(1).max(255).optional(),
  saticiVknTckn: z.string().max(20).nullable().optional(),
  saticiVergiDairesi: z.string().max(100).nullable().optional(),
  saticiAdres: z.string().max(500).nullable().optional(),
  paraBirimi: z.string().length(3).optional(),
  toplamMatrah: z.number().min(0).optional(),
  toplamKdv: z.number().min(0).optional(),
  genelToplam: z.number().min(0.01).optional(),
  kdvKirilimi: z.array(z.object({
    oran: z.number().min(0).max(100),
    matrah: z.number().min(0),
    kdvTutari: z.number().min(0),
  })).optional(),
  onerilenMasrafKategorisi: z.string().max(100).nullable().optional(),
  eslesenCariId: z.string().uuid().nullable().optional(),
  mukerrerOnaylandi: z.boolean().optional(),
});
export type KullaniciDuzeltmesi = z.infer<typeof kullaniciDuzeltmeSemasi>;

export const belgeAktarSemasi = z.object({
  hedef: z.enum(["MASRAF", "ALIS_FATURASI"]),
  kasaBankaHesapId: z.string().uuid().optional(),
  masrafKategorisi: z.string().max(100).optional(),
  aciklama: z.string().max(500).optional(),
});
export type BelgeAktarGirdisi = z.infer<typeof belgeAktarSemasi>;
