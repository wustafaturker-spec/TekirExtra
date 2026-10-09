import { Prisma } from "@prisma/client";
import { metinNormalize, YURT_DISI_ALICI_VKN } from "@tekirextra/shared";
import { kanuniDegerOku } from "../mevzuat/kanuni-deger";

/**
 * CARI-37 (P2-3, karar 2026-10-04): Form BA (alışlar) ve Form BS (satışlar).
 *
 * - Aynı kişiyle bir ayda düzenlenen fatura ve fatura yerine geçen belgelerin
 *   KDV hariç TL toplamı eşiği (Mevzuat Merkezi `kanuni_deger/babs_esigi`, MVZ-13; yoksa 5.000 TL)
 *   aşarsa bildirilir; belge sayısıyla birlikte.
 * - İadeler düzenleyene göre: müşterinin bize kestiği satış iadesi BA'ya,
 *   bizim kestiğimiz alış iadesi BS'ye girer.
 * - BA'ya masraf modülündeki onaylı faturalı giderler ve serbest meslek
 *   makbuzları da girer (fatura yerine geçen belge); fiş, dekont, kira girmez.
 * - Kişi VKN/TCKN ile tekilleşir (aynı VKN'li iki cari tek satır). Yurt dışı
 *   alıcı ve nihai tüketici gibi ortak kimlikler cari başına ayrı satırdır.
 * - Yalnız kesinleşmiş faturalar; iptal ve taslak girmez. Dövizli belge
 *   belgenin kendi kuruyla TL'ye çevrilir.
 */
export type BabsFormu = "ba" | "bs";
export type BabsDurumu = "bildirilir" | "esige_yakin" | "esik_alti";

export const VARSAYILAN_BABS_ESIGI = 5000;
/** Eşiğin bu oranına ulaşan kişi "eşiğe yakın" listesine girer. */
export const ESIGE_YAKIN_ORANI = 0.8;
const ORTAK_KIMLIKLER = new Set([YURT_DISI_ALICI_VKN, "11111111111"]);

export const BABS_BELGE_ADLARI: Record<string, string> = {
  alis: "Alış faturası",
  satis_iade: "Satış iadesi (müşterinin faturası)",
  satis: "Satış faturası",
  alis_iade: "Alış iadesi",
  masraf: "Gider faturası",
  smm: "Serbest meslek makbuzu",
};

export interface BabsKalemi {
  form: BabsFormu;
  belge: keyof typeof BABS_BELGE_ADLARI;
  belgeNo: string | null;
  tarih: Date;
  tutarTry: number;
  cariId: string | null;
  cariKod: string | null;
  unvan: string;
  vknTckn: string | null;
  ulke: string;
}

export interface BabsSatiri {
  form: BabsFormu;
  anahtar: string;
  unvan: string;
  vknTckn: string | null;
  ulke: string;
  cariIdler: string[];
  cariKodlari: string[];
  belgeSayisi: number;
  tutar: number;
  durum: BabsDurumu;
}

export const donemAraligi = (yil: number, ay: number) => ({ gte: new Date(Date.UTC(yil, ay - 1, 1)), lt: new Date(Date.UTC(yil, ay, 1)) });

/** Kişinin BA/BS anahtarı: VKN/TCKN; ortak kimlikte ya da kimliksizde cari (yoksa satıcı unvanı). */
export function kisiAnahtari(k: Pick<BabsKalemi, "vknTckn" | "cariId" | "unvan">): string {
  const vkn = k.vknTckn?.trim();
  if (vkn && !ORTAK_KIMLIKLER.has(vkn)) return `vkn:${vkn}`;
  return k.cariId ? `cari:${k.cariId}` : `unvan:${metinNormalize(k.unvan)}`;
}

/** MVZ-13: dönemin ilk günü yürürlükteki merkezi eşik (kiracı ayarı değildir). */
export async function babsEsigi(tx: Prisma.TransactionClient, yil: number, ay: number): Promise<number> {
  return kanuniDegerOku(tx, "babs_esigi", new Date(Date.UTC(yil, ay - 1, 1)), VARSAYILAN_BABS_ESIGI);
}

const tl = (tutar: Prisma.Decimal, kur: Prisma.Decimal) => Math.round(tutar.mul(kur).toNumber() * 100) / 100;

/** Dönemin BA/BS kalemleri; `cariIdler` verilirse yalnız o carilerin belgeleri. */
export async function babsKalemleri(tx: Prisma.TransactionClient, yil: number, ay: number, cariIdler?: string[]): Promise<BabsKalemi[]> {
  const tarih = donemAraligi(yil, ay);
  const cariSecimi = { select: { id: true, kod: true, unvan: true, vknTckn: true, adresler: { select: { tip: true, ulke: true } } } } as const;
  const ulkesi = (adresler: { tip: string; ulke: string }[]) => (adresler.find((a) => a.tip === "fatura") ?? adresler[0])?.ulke ?? "TR";
  const [faturalar, masraflar] = await Promise.all([
    tx.fatura.findMany({
      where: { durum: "kesin", tip: { in: ["alis", "satis", "satis_iade", "alis_iade"] }, tarih, ...(cariIdler ? { cariId: { in: cariIdler } } : {}) },
      select: { tip: true, no: true, tarih: true, toplamMatrah: true, kur: true, cari: cariSecimi },
    }),
    tx.masraf.findMany({
      where: { durum: "onaylandi", belgeTuru: { in: ["fatura", "serbest_meslek_makbuzu"] }, tarih, ...(cariIdler ? { cariId: { in: cariIdler } } : {}) },
      select: { belgeTuru: true, belgeNo: true, tarih: true, matrah: true, kur: true, saticiUnvan: true, vknTckn: true, cari: cariSecimi },
    }),
  ]);
  return [
    ...faturalar.map((f): BabsKalemi => ({
      form: f.tip === "alis" || f.tip === "satis_iade" ? "ba" : "bs",
      belge: f.tip,
      belgeNo: f.no,
      tarih: f.tarih,
      tutarTry: tl(f.toplamMatrah, f.kur),
      cariId: f.cari.id,
      cariKod: f.cari.kod,
      unvan: f.cari.unvan,
      vknTckn: f.cari.vknTckn,
      ulke: ulkesi(f.cari.adresler),
    })),
    ...masraflar.map((m): BabsKalemi => ({
      form: "ba",
      belge: m.belgeTuru === "fatura" ? "masraf" : "smm",
      belgeNo: m.belgeNo,
      tarih: m.tarih,
      tutarTry: tl(m.matrah, m.kur),
      cariId: m.cari?.id ?? null,
      cariKod: m.cari?.kod ?? null,
      unvan: m.cari?.unvan ?? m.saticiUnvan ?? "Satıcı adı girilmemiş",
      // Karttaki kimlik esastır; masrafta yazılan VKN yalnız cari bağlı değilse kullanılır.
      vknTckn: m.cari?.vknTckn ?? m.vknTckn,
      ulke: m.cari ? ulkesi(m.cari.adresler) : "TR",
    })),
  ];
}

/** Saf: kalemleri form × kişi bazında toplar ve eşikle sınıflar; tutara göre azalan. */
export function babsOzeti(kalemler: BabsKalemi[], esik: number): BabsSatiri[] {
  const gruplar = new Map<string, BabsSatiri>();
  for (const k of kalemler) {
    const anahtar = kisiAnahtari(k);
    const id = `${k.form}|${anahtar}`;
    const s = gruplar.get(id) ?? {
      form: k.form, anahtar, unvan: k.unvan, vknTckn: k.vknTckn?.trim() || null, ulke: k.ulke,
      cariIdler: [], cariKodlari: [], belgeSayisi: 0, tutar: 0, durum: "esik_alti" as BabsDurumu,
    };
    if (k.cariId && !s.cariIdler.includes(k.cariId)) { s.cariIdler.push(k.cariId); if (k.cariKod) s.cariKodlari.push(k.cariKod); }
    s.belgeSayisi += 1;
    s.tutar = Math.round((s.tutar + k.tutarTry) * 100) / 100;
    gruplar.set(id, s);
  }
  for (const s of gruplar.values()) {
    s.durum = s.tutar >= esik ? "bildirilir" : s.tutar >= esik * ESIGE_YAKIN_ORANI ? "esige_yakin" : "esik_alti";
  }
  return [...gruplar.values()].sort((a, b) => b.tutar - a.tutar);
}
