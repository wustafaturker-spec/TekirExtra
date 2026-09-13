import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import type { krediKartiCariOdemeSemasi, krediKartiEkstreOdemeSemasi, krediKartiHareketSemasi, krediKartiOlusturSemasi } from "./kredi-karti.semalar";

const D = (deger: Prisma.Decimal.Value) => new Prisma.Decimal(deger);

/** Ayın aynı gününü korur; kısa aylarda ayın son gününü kullanır. */
function ayEkle(tarih: Date, ay: number): Date {
  const yil = tarih.getUTCFullYear(); const hedefAy = tarih.getUTCMonth() + ay; const gun = tarih.getUTCDate();
  const aySonu = new Date(Date.UTC(yil, hedefAy + 1, 0)).getUTCDate();
  return new Date(Date.UTC(yil, hedefAy, Math.min(gun, aySonu)));
}

function taksitVerileri(tenantId: string, hareketId: string, toplam: Prisma.Decimal, adet: number, ilkTarih: Date) {
  const tabanKurus = toplam.mul(100).div(adet).floor(); const toplamKurus = toplam.mul(100).toDecimalPlaces(0); let dagitilan = D(0);
  return Array.from({ length: adet }, (_, i) => {
    const kurus = i === adet - 1 ? toplamKurus.sub(dagitilan) : tabanKurus; dagitilan = dagitilan.add(kurus);
    return { tenantId, hareketId, sira: i + 1, vadeTarihi: ayEkle(ilkTarih, i), tutar: kurus.div(100) };
  });
}

@Injectable()
export class KrediKartiService {
  constructor(private readonly prisma: PrismaService, private readonly donemKilidi: DonemKilidiService) {}

  async listele() {
    const { tenantId } = aktifBaglam();
    const kartlar = await this.prisma.tenantIslem(tenantId, (tx) => tx.krediKarti.findMany({
      where: { tenantId },
      orderBy: [{ aktif: "desc" }, { ad: "asc" }],
      include: { bagliBankaHesap: { select: { id: true, ad: true } }, hareketler: { orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], include: { cari: { select: { id: true, kod: true, unvan: true } }, fatura: { select: { id: true, no: true } }, taksitler: { orderBy: { sira: "asc" } } } } },
    }));
    return kartlar.map((kart) => {
      const borc = kart.hareketler.reduce((t, h) => t.add(["harcama", "faiz", "aidat"].includes(h.tip) ? h.tutar : h.tutar.negated()), D(0)); const net = Prisma.Decimal.max(0, borc);
      return { ...kart, borc: net, kullanilabilirLimit: Prisma.Decimal.max(0, kart.limit.sub(net)), kullanimOrani: kart.limit.gt(0) ? net.div(kart.limit).mul(100).toDecimalPlaces(1) : D(0) };
    });
  }

  async olustur(girdi: z.infer<typeof krediKartiOlusturSemasi>) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => { if (girdi.bagliBankaHesapId && !await tx.bankaHesap.findUnique({ where: { id: girdi.bagliBankaHesapId } })) throw new BadRequestException("Bağlı banka hesabı bulunamadı"); return tx.krediKarti.create({ data: { ...girdi, tenantId, limit: D(girdi.limit) } }); });
  }

  async hareketEkle(girdi: z.infer<typeof krediKartiHareketSemasi>) {
    const { tenantId } = aktifBaglam();
    await this.donemKilidi.tarihDogrula(tenantId, girdi.tarih, "kredi kartı hareketi oluşturma");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kart = await tx.krediKarti.findUnique({ where: { id: girdi.krediKartiId, tenantId } }); if (!kart?.aktif) throw new NotFoundException("Aktif kredi kartı hesabı bulunamadı");
      const hareket = await tx.krediKartiHareket.create({ data: { ...girdi, tenantId, tarih: new Date(girdi.tarih), tutar: D(girdi.tutar) } });
      if (girdi.tip === "harcama") await tx.krediKartiTaksit.createMany({ data: taksitVerileri(tenantId, hareket.id, D(girdi.tutar), girdi.taksitSayisi, new Date(girdi.tarih)) });
      return hareket;
    });
  }

  async cariOdeme(girdi: z.infer<typeof krediKartiCariOdemeSemasi>) {
    const { tenantId } = aktifBaglam(); const cariTutar = D(girdi.cariOdemeTutari); const komisyon = D(girdi.komisyonTutari); const toplam = cariTutar.add(komisyon); const tarih = new Date(girdi.tarih);
    await this.donemKilidi.tarihDogrula(tenantId, tarih, "kredi kartıyla cari ödeme");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [kart, cari] = await Promise.all([tx.krediKarti.findUnique({ where: { id: girdi.krediKartiId, tenantId } }), tx.cariHesap.findUnique({ where: { id: girdi.cariId } })]);
      if (!kart?.aktif) throw new NotFoundException("Aktif kredi kartı hesabı bulunamadı"); if (!cari?.aktif) throw new NotFoundException("Aktif cari hesap bulunamadı");
      if (kart.dovizCinsi !== cari.dovizCinsi) throw new BadRequestException("Kart ve cari hesabın para birimleri aynı olmalıdır");
      if (girdi.faturaId) {
        const fatura = await tx.fatura.findUnique({ where: { id: girdi.faturaId }, include: { kasaBankaHarekets: { select: { tutar: true } }, krediKartiHareketleri: { select: { cariOdemeTutari: true } } } });
        if (!fatura || fatura.cariId !== cari.id || fatura.durum !== "kesin" || !["alis", "satis_iade"].includes(fatura.tip)) throw new BadRequestException("Yalnızca seçili carinin kesinleşmiş alış borcu ödenebilir");
        if (fatura.dovizCinsi !== kart.dovizCinsi) throw new BadRequestException("Fatura ve kart para birimleri aynı olmalıdır");
        const onceki = fatura.kasaBankaHarekets.reduce((t, h) => t.add(h.tutar), D(0)).add(fatura.krediKartiHareketleri.reduce((t, h) => t.add(h.cariOdemeTutari ?? 0), D(0))); const kalan = Prisma.Decimal.max(fatura.genelToplam.sub(onceki), 0);
        if (cariTutar.gt(kalan)) throw new BadRequestException(`Ödeme kalan ${kalan.toFixed(2)} ${fatura.dovizCinsi} tutarını aşamaz`);
      }
      const hareket = await tx.krediKartiHareket.create({ data: { tenantId, krediKartiId: kart.id, tip: "harcama", tarih, aciklama: girdi.aciklama, tutar: toplam, cariOdemeTutari: cariTutar, komisyonTutari: komisyon, taksitSayisi: girdi.taksitSayisi, ilkTaksitTarihi: new Date(girdi.ilkTaksitTarihi), belgeNo: girdi.belgeNo, cariId: cari.id, faturaId: girdi.faturaId } });
      await tx.krediKartiTaksit.createMany({ data: taksitVerileri(tenantId, hareket.id, toplam, girdi.taksitSayisi, new Date(girdi.ilkTaksitTarihi)) });
      const kartBilgisi = `${kart.ad} •••• ${kart.sonDortHane}${girdi.taksitSayisi > 1 ? ` · ${girdi.taksitSayisi} taksit` : " · tek çekim"}${komisyon.gt(0) ? ` · ${komisyon.toFixed(2)} ${kart.dovizCinsi} komisyon/vade farkı` : ""}`;
      await tx.cariHareket.create({ data: { tenantId, cariId: cari.id, tip: "borc", tutar: cariTutar, dovizCinsi: kart.dovizCinsi, kur: 1, tutarTry: cariTutar, tarih, aciklama: `${girdi.aciklama} · Kredi kartı: ${kartBilgisi}`, kaynakTur: "kredi_karti", kaynakRef: hareket.id } });
      return hareket;
    });
  }

  async ekstreOdeme(girdi: z.infer<typeof krediKartiEkstreOdemeSemasi>) {
    const { tenantId } = aktifBaglam(); const tutar = D(girdi.tutar); const tarih = new Date(girdi.tarih);
    await this.donemKilidi.tarihDogrula(tenantId, tarih, "kredi kartı ekstre ödemesi");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [kart, banka] = await Promise.all([tx.krediKarti.findUnique({ where: { id: girdi.krediKartiId, tenantId }, include: { hareketler: { select: { tip: true, tutar: true } } } }), tx.bankaHesap.findUnique({ where: { id: girdi.bankaHesapId } })]);
      if (!kart?.aktif || !banka?.aktif) throw new NotFoundException("Aktif kredi kartı veya banka hesabı bulunamadı"); if (kart.dovizCinsi !== banka.dovizCinsi) throw new BadRequestException("Kart ve banka hesabı para birimleri aynı olmalıdır");
      const borc = kart.hareketler.reduce((t, h) => t.add(["harcama", "faiz", "aidat"].includes(h.tip) ? h.tutar : h.tutar.negated()), D(0)); if (tutar.gt(Prisma.Decimal.max(0, borc))) throw new BadRequestException(`Ödeme güncel ${Prisma.Decimal.max(0, borc).toFixed(2)} ${kart.dovizCinsi} kart borcunu aşamaz`);
      const bankaHareket = await tx.kasaBankaHareket.create({ data: { tenantId, bankaHesapId: banka.id, tip: "tediye", tutar, dovizCinsi: kart.dovizCinsi, kur: 1, tutarTry: tutar, tarih, aciklama: girdi.aciklama, kaynakTur: "kredi_karti_ekstre" } });
      const hareket = await tx.krediKartiHareket.create({ data: { tenantId, krediKartiId: kart.id, tip: "odeme", tarih, aciklama: girdi.aciklama, tutar, taksitSayisi: 1, belgeNo: girdi.belgeNo, bankaHareketId: bankaHareket.id } });
      await tx.kasaBankaHareket.update({ where: { id: bankaHareket.id }, data: { kaynakRef: hareket.id } }); return hareket;
    });
  }
}
