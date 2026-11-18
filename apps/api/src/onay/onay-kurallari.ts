import { AsyncLocalStorage } from "node:async_hooks";
import { ConflictException } from "@nestjs/common";
import { z } from "zod";
import { ROLLER, type Rol } from "@tekirextra/shared";

/** ONY-02: ilk sürümde onaya bağlanabilen işlemler. */
export const ONAY_ISLEMLERI = ["fatura_kesinlestir_satis", "fatura_kesinlestir_alis", "belge_onayla_satis", "masraf_onayla", "kasa_banka_odeme", "fiyat_listesi_guncelle"] as const;
export type OnayIslemi = (typeof ONAY_ISLEMLERI)[number];

export const ISLEM_ADLARI: Record<OnayIslemi, string> = {
  fiyat_listesi_guncelle: "Fiyat listesi güncelleme",
  fatura_kesinlestir_satis: "Satış faturası kesinleştirme",
  fatura_kesinlestir_alis: "Alış faturası kesinleştirme",
  belge_onayla_satis: "Satış teklifi / siparişi onaylama",
  masraf_onayla: "Masraf onaylama",
  kasa_banka_odeme: "Kasa/banka ödemesi",
};

/** Hangi koşul hangi işlemde anlamlı (ONY-02). */
export const KOSUL_KAPSAMI: Record<OnayIslemi, { iskonto: boolean; risk: boolean }> = {
  fiyat_listesi_guncelle: { iskonto: false, risk: false },
  fatura_kesinlestir_satis: { iskonto: true, risk: true },
  fatura_kesinlestir_alis: { iskonto: true, risk: false },
  belge_onayla_satis: { iskonto: true, risk: true },
  masraf_onayla: { iskonto: false, risk: false },
  kasa_banka_odeme: { iskonto: false, risk: false },
};

export const onayModulu = "onay";
export const onayAyariSemasi = z.object({ gorevAyriligiKapali: z.boolean() });

const adimSemasi = z.union([z.object({ rol: z.enum(ROLLER as unknown as [Rol, ...Rol[]]) }).strict(), z.object({ kullaniciId: z.uuid() }).strict()]);
export type OnayAdimi = z.infer<typeof adimSemasi>;

export const kuralSemasi = z.object({
  islem: z.enum(ONAY_ISLEMLERI),
  ad: z.string().trim().min(2).max(120),
  aktif: z.boolean().default(true),
  tutarEsigi: z.coerce.number().positive().max(1e13).nullable().optional(),
  iskontoEsigi: z.coerce.number().min(0).max(100).nullable().optional(),
  riskAsimi: z.boolean().default(false),
  adimlar: z.array(adimSemasi).min(1).max(2),
}).superRefine((k, ctx) => {
  if (k.iskontoEsigi != null && !KOSUL_KAPSAMI[k.islem].iskonto) ctx.addIssue({ code: "custom", path: ["iskontoEsigi"], message: "Bu işlemde iskonto koşulu kullanılmaz" });
  if (k.riskAsimi && !KOSUL_KAPSAMI[k.islem].risk) ctx.addIssue({ code: "custom", path: ["riskAsimi"], message: "Bu işlemde risk koşulu kullanılmaz" });
  if (k.adimlar.length === 2 && JSON.stringify(k.adimlar[0]) === JSON.stringify(k.adimlar[1])) ctx.addIssue({ code: "custom", path: ["adimlar"], message: "İki adım aynı olamaz" });
});
export type KuralGirdisi = z.infer<typeof kuralSemasi>;

/** İşlemin ölçüleri; yalnız gerekenler hesaplanır. */
export interface IslemOlculeri {
  tutarTry: number;
  iskontoYuzde?: number;
  riskAsimi?: boolean;
}

export interface KuralSatiri {
  id: string;
  ad: string;
  tutarEsigi: number | null;
  iskontoEsigi: number | null;
  riskAsimi: boolean;
  adimlar: OnayAdimi[];
}

/**
 * ONY-01: kural koşulları "ve" ile bağlanır; koşulsuz kural her işlemde uyar. Birden çok kural
 * uyarsa en çok adımlı olan, eşitse en yüksek tutar eşikli olan seçilir. Dönen nedenler talepte gösterilir.
 */
export function kuralSec(kurallar: KuralSatiri[], o: IslemOlculeri): { kural: KuralSatiri; nedenler: string[] } | null {
  let secilen: { kural: KuralSatiri; nedenler: string[] } | null = null;
  for (const k of kurallar) {
    const nedenler: string[] = [];
    if (k.tutarEsigi !== null) {
      if (!(o.tutarTry >= k.tutarEsigi)) continue;
      nedenler.push(`tutar ${o.tutarTry.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} TL ≥ ${k.tutarEsigi.toLocaleString("tr-TR")} TL`);
    }
    if (k.iskontoEsigi !== null) {
      if (!((o.iskontoYuzde ?? 0) >= k.iskontoEsigi)) continue;
      nedenler.push(`iskonto %${(o.iskontoYuzde ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ≥ %${k.iskontoEsigi.toLocaleString("tr-TR")}`);
    }
    if (k.riskAsimi) {
      if (!o.riskAsimi) continue;
      nedenler.push("cari risk limitini aşıyor");
    }
    if (!nedenler.length) nedenler.push("bu işlem her zaman onay ister");
    const daha = !secilen || k.adimlar.length > secilen.kural.adimlar.length
      || (k.adimlar.length === secilen.kural.adimlar.length && (k.tutarEsigi ?? 0) > (secilen.kural.tutarEsigi ?? 0));
    if (daha) secilen = { kural: k, nedenler };
  }
  return secilen;
}

/**
 * ONY-04: kullanıcı bu adımı onaylayabilir mi. Rol adımını o roldeki ya da yönetici kullanıcılar,
 * kişi adımını yalnız o kişi onaylar; talep eden (görev ayrılığı kapalı değilse) ve önceki adımı
 * onaylayan onaylayamaz.
 */
export function adimiOnaylayabilir(
  adim: OnayAdimi,
  kullanici: { id: string; rol: Rol },
  talep: { talepEdenId: string; oncekiOnaylayanlar: string[] },
  gorevAyriligiKapali: boolean,
): { izin: boolean; neden?: string } {
  const uygun = "kullaniciId" in adim ? adim.kullaniciId === kullanici.id : adim.rol === kullanici.rol || kullanici.rol === "yonetici";
  if (!uygun) return { izin: false, neden: "Bu adımın onaycısı değilsiniz" };
  if (talep.oncekiOnaylayanlar.includes(kullanici.id)) return { izin: false, neden: "Önceki adımı siz onayladınız; aynı kişi iki adımı onaylayamaz" };
  if (talep.talepEdenId === kullanici.id && !gorevAyriligiKapali) return { izin: false, neden: "Kendi talebinizi onaylayamazsınız (görev ayrılığı)" };
  return { izin: true };
}

/** ONY-03: onaylı talebin yürütülmesi; kapı bu bağlamda yeniden tetiklenmez, risk onayı sayılır. */
const yurutme = new AsyncLocalStorage<{ talepId: string }>();
export const onayYurutmesi = () => yurutme.getStore() ?? null;
export const onayliYurut = <T>(talepId: string, fn: () => Promise<T>) => yurutme.run({ talepId }, fn);

/** ONY-03: kurala takılan işlem yapılmaz; istemci bu kodla talebin açıldığını anlar. */
export class OnayGerekliHatasi extends ConflictException {
  constructor(mesaj: string, talepId: string) {
    super({ statusCode: 409, kod: "ONAY_GEREKLI", message: mesaj, onayTalebiId: talepId });
  }
}
