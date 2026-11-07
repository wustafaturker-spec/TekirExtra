import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { eslesmeOnerisi, FATURA_BEKLEME_GUN, unvanPazaryerineUyar, vknGecerli } from "./pazaryeri-eslestirme";

const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);

/**
 * PZR-07: faturalı pazaryeri kesintilerini pazaryerinin kestiği komisyon
 * e-Faturasıyla eşleştirir. Gider faturadan yazılır (PZR-06); eşleştirme
 * yalnız mutabakattır. Sistem önerir, kullanıcı onaylar; tutmazsa kullanıcı
 * kesintileri elle seçer, fark kayıtta görünür.
 */
@Injectable()
export class PazaryeriEslestirmeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bağlantı başına: VKN (ve önerileri), son faturalar + eşleşme/öneri, aday kesintiler, faturası gelmeyenler. */
  async durum() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const baglantilar = await tx.baglanti.findMany({ where: { aile: "pazaryeri" }, select: { id: true, saglayici: true, durum: true, faturaKesenVkn: true }, orderBy: { createdAt: "asc" } });
      if (!baglantilar.length) return [];
      const gonderenler = await tx.gelenEbelge.groupBy({ by: ["gonderenVkn", "gonderenUnvan"], _count: { _all: true } });
      const sinir = new Date(Date.now() - FATURA_BEKLEME_GUN * 86_400_000);
      const sonuc = [];
      for (const b of baglantilar) {
        const vknOnerileri = gonderenler
          .filter((g) => unvanPazaryerineUyar(b.saglayici, g.gonderenUnvan))
          .map((g) => ({ vkn: g.gonderenVkn, unvan: g.gonderenUnvan, faturaSayisi: g._count._all }))
          .sort((x, y) => y.faturaSayisi - x.faturaSayisi);
        const adaylar = await tx.pazaryeriKesinti.findMany({
          where: { baglantiId: b.id, sinif: "faturali", durum: "bekliyor", gelenEbelgeId: null },
          select: { id: true, tarih: true, tutar: true, dovizCinsi: true, tur: true, siparisNo: true },
          orderBy: [{ tarih: "asc" }, { id: "asc" }], take: 2_000,
        });
        const onerilen = new Set<string>();
        let faturalar: { id: string; belgeNo: string; tarih: Date; toplam: string; dovizCinsi: string; gonderenUnvan: string; eslesen: { adet: number; toplam: string } | null; oneri: { kesintiIds: string[]; toplam: string } | null }[] = [];
        if (b.faturaKesenVkn) {
          const ham = await tx.gelenEbelge.findMany({
            where: { gonderenVkn: b.faturaKesenVkn, genelToplam: { not: null } },
            select: { id: true, belgeNo: true, tarih: true, genelToplam: true, dovizCinsi: true, gonderenUnvan: true },
            orderBy: [{ tarih: "desc" }, { belgeNo: "desc" }], take: 100,
          });
          const eslesen = new Map((await tx.pazaryeriKesinti.groupBy({ by: ["gelenEbelgeId"], where: { gelenEbelgeId: { in: ham.map((f) => f.id) } }, _sum: { tutar: true }, _count: { _all: true } }))
            .map((g) => [g.gelenEbelgeId!, { adet: g._count._all, toplam: D(g._sum.tutar).toFixed(2) }]));
          // Öneriler eskiden yeniye; önerilen kesinti havuzdan düşer, iki faturaya önerilmez.
          const havuz = new Set(adaylar.map((k) => k.id));
          const oneriler = new Map<string, { kesintiIds: string[]; toplam: string }>();
          for (const f of [...ham].reverse()) {
            if (eslesen.has(f.id)) continue;
            const doviz = f.dovizCinsi ?? "TRY";
            const oneri = eslesmeOnerisi({ tarih: f.tarih, toplam: f.genelToplam! }, adaylar.filter((k) => havuz.has(k.id) && k.dovizCinsi === doviz));
            if (oneri) { oneriler.set(f.id, oneri); oneri.kesintiIds.forEach((id) => { havuz.delete(id); onerilen.add(id); }); }
          }
          faturalar = ham.map((f) => ({ id: f.id, belgeNo: f.belgeNo, tarih: f.tarih, toplam: D(f.genelToplam).toFixed(2), dovizCinsi: f.dovizCinsi ?? "TRY", gonderenUnvan: f.gonderenUnvan, eslesen: eslesen.get(f.id) ?? null, oneri: oneriler.get(f.id) ?? null }));
        }
        // "Kesildi ama faturası gelmedi": eski ve hiçbir faturaya önerilmemiş faturalı kesinti.
        const gelmeyen = adaylar.filter((k) => k.tarih < sinir && !onerilen.has(k.id));
        const gelmeyenTutar: Record<string, string> = {};
        for (const k of gelmeyen) gelmeyenTutar[k.dovizCinsi] = D(gelmeyenTutar[k.dovizCinsi]).add(k.tutar).toFixed(2);
        sonuc.push({
          baglantiId: b.id, saglayici: b.saglayici, faturaKesenVkn: b.faturaKesenVkn, vknOnerileri, faturalar,
          adaylar: adaylar.map((k) => ({ ...k, tutar: D(k.tutar).toFixed(2) })),
          faturasiGelmeyen: { adet: gelmeyen.length, tutarlar: gelmeyenTutar, gun: FATURA_BEKLEME_GUN },
          kesintisiOlmayanFatura: faturalar.filter((f) => !f.eslesen && !f.oneri).length,
        });
      }
      return sonuc;
    });
  }

  /** Bağlantının fatura kesen VKN'si (boş: kaldır). */
  async vknAyarla(baglantiId: string, vkn: string | null) {
    const { tenantId } = aktifBaglam();
    if (vkn !== null && !vknGecerli(vkn)) throw new BadRequestException("VKN 10, TCKN 11 haneli olmalıdır");
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const b = await tx.baglanti.findFirst({ where: { id: baglantiId, aile: "pazaryeri" }, select: { id: true } });
      if (!b) throw new NotFoundException("Pazaryeri bağlantısı bulunamadı");
      await tx.baglanti.update({ where: { id: baglantiId }, data: { faturaKesenVkn: vkn } });
      return { baglantiId, faturaKesenVkn: vkn };
    });
  }

  /** Kesintileri faturaya bağlar; tutar farkı engel değildir, döner. */
  async eslestir(girdi: { gelenEbelgeId: string; kesintiIds: string[] }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const fatura = await tx.gelenEbelge.findUnique({ where: { id: girdi.gelenEbelgeId }, select: { id: true, gonderenVkn: true, genelToplam: true, dovizCinsi: true } });
      if (!fatura) throw new NotFoundException("Gelen e-Fatura bulunamadı");
      const kesintiler = await tx.pazaryeriKesinti.findMany({ where: { id: { in: girdi.kesintiIds } }, select: { id: true, baglantiId: true, sinif: true, durum: true, gelenEbelgeId: true, tutar: true, dovizCinsi: true } });
      if (kesintiler.length !== girdi.kesintiIds.length) throw new NotFoundException("Kesinti kayıtlarından biri bulunamadı");
      const baglantiIdleri = new Set(kesintiler.map((k) => k.baglantiId));
      if (baglantiIdleri.size !== 1) throw new BadRequestException("Kesintiler aynı pazaryeri bağlantısından olmalıdır");
      const baglanti = await tx.baglanti.findFirst({ where: { id: [...baglantiIdleri][0] }, select: { faturaKesenVkn: true } });
      if (!baglanti?.faturaKesenVkn) throw new BadRequestException("Önce bağlantının fatura kesen VKN'sini girin");
      if (baglanti.faturaKesenVkn !== fatura.gonderenVkn) throw new BadRequestException("Fatura, bu pazaryeri bağlantısının fatura kesen VKN'sinden gelmemiş");
      if (kesintiler.some((k) => k.sinif !== "faturali")) throw new BadRequestException("Yalnız faturalı kesinti faturayla eşleştirilir");
      if (kesintiler.some((k) => k.durum !== "bekliyor" || k.gelenEbelgeId)) throw new BadRequestException("Seçilen kesintilerden biri bekleyen değil ya da başka faturaya bağlı");
      const doviz = fatura.dovizCinsi ?? "TRY";
      if (kesintiler.some((k) => k.dovizCinsi !== doviz)) throw new BadRequestException(`Kesinti dövizi fatura dövizi (${doviz}) ile aynı olmalıdır`);
      const { count } = await tx.pazaryeriKesinti.updateMany({
        where: { id: { in: girdi.kesintiIds }, durum: "bekliyor", sinif: "faturali", gelenEbelgeId: null },
        data: { durum: "faturayla_eslesti", gelenEbelgeId: fatura.id },
      });
      if (count !== girdi.kesintiIds.length) throw new BadRequestException("Kesintilerden biri bu sırada değişti; listeyi yenileyip yeniden deneyin");
      const bagli = await tx.pazaryeriKesinti.aggregate({ where: { gelenEbelgeId: fatura.id }, _sum: { tutar: true } });
      return { eslesen: count, faturaToplami: D(fatura.genelToplam).toFixed(2), kesintiToplami: D(bagli._sum.tutar).toFixed(2), fark: D(fatura.genelToplam).sub(D(bagli._sum.tutar)).toFixed(2) };
    });
  }

  /** Faturanın eşleşmesini kaldırır; kesintiler bekleyene döner. */
  async eslesmeyiKaldir(gelenEbelgeId: string) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const { count } = await tx.pazaryeriKesinti.updateMany({ where: { gelenEbelgeId, durum: "faturayla_eslesti" }, data: { durum: "bekliyor", gelenEbelgeId: null } });
      return { kaldirilan: count };
    });
  }
}
