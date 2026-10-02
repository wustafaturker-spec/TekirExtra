import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { bugunTR } from "@tekirextra/shared";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { DonemKilidiService } from "../donem-kapatma/donem-kilidi.service";
import { faturaKilitleVeKalaniGetir, mahsupAyir } from "../fatura/odeme-durumu";
import { kurZorunlu } from "../doviz/kur-coz";
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
      include: { bagliBankaHesap: { select: { id: true, ad: true } }, hareketler: { orderBy: [{ tarih: "desc" }, { createdAt: "desc" }], include: { cari: { select: { id: true, kod: true, unvan: true } }, fatura: { select: { id: true, no: true } }, taksitler: { orderBy: { sira: "asc" } }, masrafOdemesi: { select: { id: true } } } } },
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
      // KSB-07: faturaya kalan kadar mahsup edilir, artanı tedarikçide avans kalır.
      let faturaMahsubu: Prisma.Decimal | null = null;
      if (girdi.faturaId) {
        const fatura = await faturaKilitleVeKalaniGetir(tx, girdi.faturaId);
        if (fatura.cariId !== cari.id || fatura.durum !== "kesin" || !["alis", "satis_iade"].includes(fatura.tip)) throw new BadRequestException("Yalnızca seçili carinin kesinleşmiş alış borcu ödenebilir");
        if (fatura.dovizCinsi !== kart.dovizCinsi) throw new BadRequestException("Fatura ve kart para birimleri aynı olmalıdır");
        if (fatura.kalan.isZero()) throw new BadRequestException(`${fatura.no ?? "Fatura"} zaten kapanmış; ödemeyi faturaya bağlamadan cariye işleyin`);
        faturaMahsubu = mahsupAyir(cariTutar, fatura.kalan).mahsup;
      }
      const hareket = await tx.krediKartiHareket.create({ data: { tenantId, krediKartiId: kart.id, tip: "harcama", tarih, aciklama: girdi.aciklama, tutar: toplam, cariOdemeTutari: cariTutar, faturaMahsubu, komisyonTutari: komisyon, taksitSayisi: girdi.taksitSayisi, ilkTaksitTarihi: new Date(girdi.ilkTaksitTarihi), belgeNo: girdi.belgeNo, cariId: cari.id, faturaId: girdi.faturaId } });
      await tx.krediKartiTaksit.createMany({ data: taksitVerileri(tenantId, hareket.id, toplam, girdi.taksitSayisi, new Date(girdi.ilkTaksitTarihi)) });
      const kartBilgisi = `${kart.ad} •••• ${kart.sonDortHane}${girdi.taksitSayisi > 1 ? ` · ${girdi.taksitSayisi} taksit` : " · tek çekim"}${komisyon.gt(0) ? ` · ${komisyon.toFixed(2)} ${kart.dovizCinsi} komisyon/vade farkı` : ""}`;
      // Dövizli kartta TL karşılığı işlem günü kuruyla hesaplanır; kur 1 varsayılmaz.
      const kur = kart.dovizCinsi === "TRY" ? D(1) : await kurZorunlu(tx, kart.dovizCinsi, tarih);
      await tx.cariHareket.create({ data: { tenantId, cariId: cari.id, tip: "borc", tutar: cariTutar, dovizCinsi: kart.dovizCinsi, kur, tutarTry: cariTutar.mul(kur).toDecimalPlaces(2), tarih, aciklama: `${girdi.aciklama} · Kredi kartı: ${kartBilgisi}`, kaynakTur: "kredi_karti", kaynakRef: hareket.id } });
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
      const kur = kart.dovizCinsi === "TRY" ? D(1) : await kurZorunlu(tx, kart.dovizCinsi, tarih);
      const bankaHareket = await tx.kasaBankaHareket.create({ data: { tenantId, bankaHesapId: banka.id, tip: "tediye", tutar, dovizCinsi: kart.dovizCinsi, kur, tutarTry: tutar.mul(kur).toDecimalPlaces(2), tarih, aciklama: girdi.aciklama, kaynakTur: "kredi_karti_ekstre" } });
      const hareket = await tx.krediKartiHareket.create({ data: { tenantId, krediKartiId: kart.id, tip: "odeme", tarih, aciklama: girdi.aciklama, tutar, taksitSayisi: 1, belgeNo: girdi.belgeNo, bankaHareketId: bankaHareket.id } });
      await tx.kasaBankaHareket.update({ where: { id: bankaHareket.id }, data: { kaynakRef: hareket.id } }); return hareket;
    });
  }

  /**
   * KSB-08: kredi kartı hareketini geri alır. Açık dönemde hareket; taksitleri,
   * cari hareketi ve (ekstre ödemesiyse) banka fişiyle birlikte silinir ve
   * görüntüsü denetim izine yazılır. Kapalı dönemde bugün tarihli ters hareket
   * atılır, vadesi gelmemiş taksitler plandan düşer. Masraf ekranından kartla
   * ödenen harcama oradan geri alınır.
   */
  async hareketGeriAl(id: string, neden: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM kredi_karti_hareketleri WHERE id = ${id}::uuid FOR UPDATE`;
      const h = await tx.krediKartiHareket.findUnique({
        where: { id },
        include: { masrafOdemesi: { select: { id: true } }, taksitler: true, bankaHareket: { include: { ekstreSatir: { select: { id: true } } } } },
      });
      if (!h) throw new NotFoundException("Kredi kartı hareketi bulunamadı");
      if (h.geriAlinanHareketId) throw new BadRequestException("Ters kayıt geri alınamaz; gerekiyorsa işlemi yeniden girin");
      if (h.masrafOdemesi) throw new BadRequestException("Bu harcama Masraflar ekranında kartla ödendi; ödemeyi oradan geri alın");
      if (await tx.krediKartiHareket.findUnique({ where: { geriAlinanHareketId: id }, select: { id: true } })) throw new ConflictException("Bu hareket zaten geri alındı");

      const cariHareketleri = await tx.cariHareket.findMany({ where: { kaynakTur: "kredi_karti", kaynakRef: id } });
      const iz = (islem: string, ek: Record<string, unknown> = {}) => tx.auditLog.create({
        data: { tenantId, userId, islem, varlik: "kredi-kartlari", varlikId: id, detay: JSON.parse(JSON.stringify({ neden, hareket: h, cariHareketleri, ...ek })) as Prisma.InputJsonValue },
      });

      if (!(await this.donemKapaliMi(tenantId, h.tarih))) {
        await tx.cariHareket.deleteMany({ where: { id: { in: cariHareketleri.map((c) => c.id) } } });
        await tx.krediKartiHareket.delete({ where: { id } }); // taksitler zincirleme silinir
        if (h.bankaHareket) {
          if (h.bankaHareket.ekstreSatir) {
            await tx.bankaEkstreSatir.update({ where: { id: h.bankaHareket.ekstreSatir.id }, data: { durum: "beklemede", cariId: null, faturaId: null, hareketId: null } });
          }
          await tx.kasaBankaHareket.delete({ where: { id: h.bankaHareket.id } });
        }
        await iz("kredi_karti_hareketi_silindi");
        return { yontem: "silindi" as const };
      }

      const bugun = bugunTR();
      await this.donemKilidi.tarihDogrula(tenantId, bugun, "ters kayıt");
      const tarih = new Date(bugun);
      // Ödeme ve iade borcu azaltmıştı, tersi borcu geri yazar; diğerleri iadeyle sıfırlanır.
      const tersTip = h.tip === "odeme" || h.tip === "iade" ? "harcama" : "iade";
      const bankaTersi = h.bankaHareket
        ? await tx.kasaBankaHareket.create({
          data: {
            tenantId, bankaHesapId: h.bankaHareket.bankaHesapId, tip: h.bankaHareket.tip === "tediye" ? "tahsilat" : "tediye",
            tutar: h.bankaHareket.tutar, dovizCinsi: h.bankaHareket.dovizCinsi, kur: h.bankaHareket.kur, tutarTry: h.bankaHareket.tutarTry, tarih,
            aciklama: `Ters kayıt: ${h.bankaHareket.aciklama ?? "kredi kartı ekstre ödemesi"} — ${neden}`.slice(0, 500), kaynakTur: "ters_kayit", kaynakRef: h.bankaHareket.id,
          },
        })
        : null;
      const ters = await tx.krediKartiHareket.create({
        data: {
          tenantId, krediKartiId: h.krediKartiId, tip: tersTip, tarih, aciklama: `Ters kayıt: ${h.aciklama} — ${neden}`.slice(0, 200), tutar: h.tutar, taksitSayisi: 1,
          cariId: h.cariId, faturaId: h.faturaId, faturaMahsubu: h.faturaMahsubu?.negated() ?? null, bankaHareketId: bankaTersi?.id ?? null, geriAlinanHareketId: h.id,
        },
      });
      await tx.krediKartiTaksit.deleteMany({ where: { hareketId: h.id, vadeTarihi: { gte: tarih } } });
      for (const c of cariHareketleri) {
        await tx.cariHareket.create({
          data: {
            tenantId, cariId: c.cariId, tip: c.tip === "borc" ? "alacak" : "borc", tutar: c.tutar, dovizCinsi: c.dovizCinsi, kur: c.kur, tutarTry: c.tutarTry, tarih,
            aciklama: `Ters kayıt: ${c.aciklama ?? "kredi kartı"}`.slice(0, 500), kaynakTur: "kredi_karti", kaynakRef: ters.id,
          },
        });
      }
      await iz("kredi_karti_hareketi_ters_kayit", { tersHareketId: ters.id });
      return { yontem: "ters_kayit" as const };
    });
  }

  private async donemKapaliMi(tenantId: string, tarih: Date): Promise<boolean> {
    try {
      await this.donemKilidi.tarihDogrula(tenantId, tarih, "geri alma");
      return false;
    } catch (hata) {
      if (hata instanceof ConflictException) return true;
      throw hata;
    }
  }
}
