import { z } from "zod";

/** CARI-40: tek toplu işlemde en çok cari; liste "süzgecin tümü" seçimi de bununla sınırlı. */
export const TOPLU_EN_FAZLA = 2000;
/** Ekstre e-postası sırayla gönderilir; istek süresini sınırlar. */
export const TOPLU_EPOSTA_EN_FAZLA = 100;
/** Web bu işareti görünce açık bakiyeyi sorup isteği `acikBakiyeOnayi` ile yineler. */
export const ACIK_BAKIYE_ISARETI = "yine de pasife almak için onaylayın";

const cariIdler = (enFazla: number) =>
  z.array(z.uuid()).min(1, "En az bir cari seçin").max(enFazla, `Tek seferde en çok ${enFazla} cari seçilebilir`);

export const topluEtiketSemasi = z.object({
  cariIdler: cariIdler(TOPLU_EN_FAZLA),
  etiketId: z.uuid("Etiket seçin"),
  islem: z.enum(["ekle", "kaldir"]),
});

export const topluDurumSemasi = z.object({
  cariIdler: cariIdler(TOPLU_EN_FAZLA),
  aktif: z.boolean(),
  acikBakiyeOnayi: z.boolean().optional(),
});

export const topluKaraListeSemasi = z.object({
  cariIdler: cariIdler(TOPLU_EN_FAZLA),
  karaListe: z.boolean(),
  /** Eklemede kartlara yazılır; boşsa mevcut not korunur. */
  not: z.string().max(500).optional().nullable(),
});

export const topluTemsilciSemasi = z.object({
  cariIdler: cariIdler(TOPLU_EN_FAZLA),
  /** null temsilciyi kaldırır. */
  temsilciUserId: z.uuid().nullable(),
});

export const topluEkstreSemasi = z.object({
  cariIdler: cariIdler(TOPLU_EPOSTA_EN_FAZLA),
  baslangic: z.iso.date().optional(),
  bitis: z.iso.date().optional(),
  /** Döviz ekstresi cari başına döviz seçtirdiği için topluda yok. */
  tur: z.enum(["standart", "ayrintili"]).optional(),
  mutabakat: z.boolean().optional(),
}).refine((g) => !g.baslangic || !g.bitis || g.baslangic <= g.bitis, { message: "Başlangıç tarihi bitiş tarihinden sonra olamaz", path: ["bitis"] });

export const topluExcelSemasi = z.object({ cariIdler: cariIdler(TOPLU_EN_FAZLA) });

export interface TopluAtlanan {
  cariId: string;
  kod: string;
  unvan: string;
  mesaj: string;
}

/** İşlenen sayısı + işlenmeyenler nedenleriyle; "zaten öyle" olanlar işlenmiş sayılır. */
export interface TopluSonuc {
  islenen: number;
  atlananlar: TopluAtlanan[];
}

/** Herhangi bir dövizde ±0,005'ten büyük bakiye açık sayılır. */
export function acikBakiyeVar(bakiyeler: { bakiye: string }[] | undefined): boolean {
  return (bakiyeler ?? []).some((b) => Math.abs(Number(b.bakiye)) > 0.005);
}

/** Ekstre e-postasının CRM etkileşimindeki dönem metni. */
export function ekstreDonemi(baslangic?: string, bitis?: string): string {
  return baslangic || bitis ? `${baslangic ?? "başlangıç"} - ${bitis ?? "bugün"}` : "tüm dönem";
}
