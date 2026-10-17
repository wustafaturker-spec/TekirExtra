import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, type DuzeltmeDurumu } from "@prisma/client";
import { z } from "zod";
import { maliyetBilinmiyor, type SatisSatiri } from "../stok/satis-ozeti";
import { maliyetEksigiSorgusu, maliyetKaynaklariniOku } from "./maliyet-eksikleri";
import { MALIYET_TAKIP_NEDENI } from "./maliyet-takibi";

export function maliyetIzlemeSorgusu(veri: unknown) {
  const r = z.object({ baslangic: z.string(), bitis: z.string() }).strict().safeParse(veri);
  if (!r.success) throw new BadRequestException("İnceleme özeti yalnız başlangıç ve bitiş tarihiyle alınabilir.");
  return maliyetEksigiSorgusu(r.data);
}
type Kayit = { kaynakRef: string; durum: DuzeltmeDurumu; createdAt: Date; olaylar: { createdAt: Date }[] };
/** Kaynak tarihine göre kohort; inceleme açılış/kapanış tarihiyle yeniden filtrelenmez. */
export function maliyetIzlemeOzeti(satirlar: SatisSatiri[], kayitlar: Kayit[]) {
  const kaynaklar = new Set(satirlar.filter((s) => s.tip === "satis" && s.stokTip !== "hizmet" && s.ciro.gt(0)).map((s) => s.faturaSatirId!));
  const uyari = satirlar.filter(maliyetBilinmiyor);
  const aktifKaynaklar = new Set<string>(), takipliKaynaklar = new Set<string>();
  const durumlar = { acik: 0, incelemede: 0, beklemede: 0, dogrulanmisKapanis: 0, digerKapanis: 0, yoksayildi: 0 };
  const sureler: number[] = [];
  let sureDisiKayit = 0;
  for (const k of kayitlar) {
    if (!kaynaklar.has(k.kaynakRef)) continue;
    takipliKaynaklar.add(k.kaynakRef);
    if (k.durum === "cozuldu") {
      const olay = k.olaylar[0];
      if (!olay) { durumlar.digerKapanis++; continue; }
      durumlar.dogrulanmisKapanis++;
      const sure = olay.createdAt.getTime() - k.createdAt.getTime();
      if (Number.isFinite(sure) && sure >= 0) sureler.push(sure); else sureDisiKayit++;
    } else if (k.durum === "yoksayildi") durumlar.yoksayildi++;
    else { durumlar[k.durum]++; aktifKaynaklar.add(k.kaynakRef); }
  }
  sureler.sort((a, b) => a - b);
  const orta = Math.floor(sureler.length / 2);
  const medyanMs = !sureler.length ? null : sureler.length % 2 ? sureler[orta] : (sureler[orta - 1] + sureler[orta]) / 2;
  return {
    kapsam: { malSatisSatiri: kaynaklar.size, takipliKaynakSatiri: takipliKaynaklar.size,
      kaynakKimlikOzeti: createHash("sha256").update(JSON.stringify([...kaynaklar].sort())).digest("hex") },
    uyari: { satir: uyari.length, ciro: uyari.reduce((t, s) => t.add(s.ciro), new Prisma.Decimal(0)).toFixed(2),
      aktifTakipliSatir: uyari.filter((s) => aktifKaynaklar.has(s.faturaSatirId!)).length,
      aktifTakipsizSatir: uyari.filter((s) => !aktifKaynaklar.has(s.faturaSatirId!)).length },
    incelemeler: { ...durumlar, toplam: Object.values(durumlar).reduce((a, b) => a + b, 0),
      medyanSureSaniye: medyanMs === null ? null : new Prisma.Decimal(medyanMs).div(1000).toFixed(3),
      sureOrnekSayisi: sureler.length, sureDisiKayit },
  };
}
export async function maliyetIzlemesiniOku(tx: Prisma.TransactionClient, tenantId: string, q: ReturnType<typeof maliyetIzlemeSorgusu>) {
  const satirlar = await maliyetKaynaklariniOku(tx, tenantId, q);
  const ids = satirlar.filter((s) => s.tip === "satis" && s.stokTip !== "hizmet" && s.ciro.gt(0)).map((s) => s.faturaSatirId!);
  const kayitlar = ids.length ? await tx.duzeltmeKaydi.findMany({
    where: { tenantId, tur: "stok", kaynakTur: "fatura_satiri", nedenKodu: MALIYET_TAKIP_NEDENI, kaynakRef: { in: ids } },
    take: 20001,
    select: { kaynakRef: true, durum: true, createdAt: true, olaylar: {
      where: { tenantId, olayTuru: "kayitli_maliyet_dogrulandi", yeniDurum: "cozuldu" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { createdAt: true },
    } },
  }) : [];
  if (kayitlar.length > 20000) throw new BadRequestException("Bu dönemde 20.000 inceleme kaydı aşılıyor. Tarih aralığını daraltın.");
  return maliyetIzlemeOzeti(satirlar, kayitlar);
}
