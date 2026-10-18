import type { Prisma } from "@prisma/client";
import { TEKLIF_TAKIP_MODULU, isGunuEkle, teklifTakipAyariSemasi, trGunu, type TeklifTakipAyari } from "./teklif-takip.kurallari";

type Tx = Prisma.TransactionClient;

export async function takipAyari(tx: Tx, tenantId: string): Promise<TeklifTakipAyari> {
  const kayit = await tx.modulAyar.findUnique({ where: { tenantId_modul: { tenantId, modul: TEKLIF_TAKIP_MODULU } }, select: { ayarlar: true } });
  const sonuc = teklifTakipAyariSemasi.safeParse({ ...(kayit?.ayarlar as object | undefined) });
  return sonuc.success ? sonuc.data : teklifTakipAyariSemasi.parse({});
}

/** Çalışma takviminin tatilleri (personel izinleriyle aynı tablo); tam gün 0, yarım gün 0,5. */
export async function tatiller(tx: Tx, tenantId: string, ilk: string, gunSayisi: number): Promise<Map<string, number>> {
  const son = new Date(new Date(`${ilk}T00:00:00Z`).getTime() + (gunSayisi * 3 + 14) * 86_400_000);
  const gunler = await tx.personelTatilGunu.findMany({ where: { tenantId, tarih: { gte: new Date(`${ilk}T00:00:00Z`), lte: son } }, select: { tarih: true, yarimGun: true } });
  return new Map(gunler.map((g) => [g.tarih.toISOString().slice(0, 10), g.yarimGun ? 0.5 : 0]));
}

export async function hatirlatmaGunu(tx: Tx, tenantId: string, baslangic: Date, isGunu: number): Promise<Date> {
  const gun = trGunu(baslangic);
  return new Date(`${isGunuEkle(gun, isGunu, await tatiller(tx, tenantId, gun, isGunu))}T00:00:00Z`);
}

/**
 * AI-38: teklif gönderimini kaydeder. İlk gönderim takip açar; yeniden
 * gönderim kimliği ekler, sayacı artırır ve hatırlatmayı yeniden kurar.
 * Açık takip görevi takip e-postası gönderilince tamamlanır.
 */
export async function teklifGonderiminiKaydet(
  tx: Tx,
  tenantId: string,
  g: { belgeId: string; kaynak: "eposta" | "elle"; alici: string | null; mesajId: string | null; sorumluUserId: string; zaman?: Date },
) {
  const zaman = g.zaman ?? new Date();
  const ayar = await takipAyari(tx, tenantId);
  const gun = await hatirlatmaGunu(tx, tenantId, zaman, ayar.isGunu);
  const mevcut = await tx.teklifTakibi.findUnique({ where: { belgeId: g.belgeId }, select: { id: true, crmGorevId: true, durum: true } });
  if (mevcut?.crmGorevId) await tx.crmGorev.updateMany({ where: { id: mevcut.crmGorevId, tenantId, durum: "acik" }, data: { durum: "tamamlandi", tamamlanmaZamani: zaman } });
  return tx.teklifTakibi.upsert({
    where: { belgeId: g.belgeId },
    create: {
      tenantId, belgeId: g.belgeId, kaynak: g.kaynak, durum: "yanit_bekliyor", alici: g.alici,
      mesajIdleri: g.mesajId ? [g.mesajId] : [], sorumluUserId: g.sorumluUserId, gonderildiAt: zaman, hatirlatmaGunu: gun,
    },
    update: {
      durum: "yanit_bekliyor", alici: g.alici ?? undefined, sorumluUserId: g.sorumluUserId, gonderildiAt: zaman, hatirlatmaGunu: gun,
      ...(g.mesajId ? { mesajIdleri: { push: g.mesajId } } : {}),
      gonderimSayisi: { increment: 1 }, hatirlatildiAt: null, crmGorevId: null, kapanisNedeni: null, updatedAt: zaman,
    },
  });
}
