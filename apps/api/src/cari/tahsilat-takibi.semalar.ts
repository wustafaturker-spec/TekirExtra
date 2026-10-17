import { z } from "zod";
export const takipKimligi = z.uuid().transform((v) => v.toLowerCase());
const metin = (max: number) => z.string().trim().min(2).max(max);
const gun = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Geçersiz takvim günü");
export const takipDurumu = z.enum(["acik", "beklemede", "tamamlandi", "iptal"]);
export const takipNedeni = z.enum(["tahsilat", "itiraz"]);
export const takipOlusturSemasi = z.object({ cariId: takipKimligi, sorumluUserId: takipKimligi, konu: metin(200), neden: takipNedeni, sonrakiIslemTarihi: gun, sonrakiIslem: metin(200), istekAnahtari: takipKimligi }).strict();
export const takipGuncelleSemasi = z.object({ beklenenSurum: z.number().int().positive().max(2147483646), sorumluUserId: takipKimligi, neden: takipNedeni, durum: takipDurumu, sonrakiIslemTarihi: gun.nullable(), sonrakiIslem: metin(200).nullable(), gerekce: metin(2000) }).strict().refine((v) => {
  const aktif = ["acik", "beklemede"].includes(v.durum);
  return aktif ? v.sonrakiIslemTarihi !== null && v.sonrakiIslem !== null : v.sonrakiIslemTarihi === null && v.sonrakiIslem === null;
}, "Açık/bekleyen takipte sonraki işlem ve gün zorunlu; kapalı takipte boş olmalı");
export const gorusmeOlusturSemasi = z.object({ beklenenSurum: z.number().int().positive().max(2147483646), kanal: z.enum(["telefon", "eposta", "ziyaret", "not"]), gorusmeTarihi: gun, not: metin(2000), istekAnahtari: takipKimligi }).strict();
export const takipListeSemasi = z.object({ cariId: takipKimligi.optional(), gorunum: z.enum(["bugun", "itiraz", "tum"]).default("bugun"), sorumluUserId: takipKimligi.optional(), imlec: takipKimligi.optional() }).strict();
