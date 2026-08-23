import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

const D = (deger: string | number | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(deger);

@Injectable()
export class RaporService {
  constructor(private readonly prisma: PrismaService) {}

  // Kar-zarar analizi RPR-06 araç setine taşındı: fatura.kar-marji (FTR-15).

  // ─── FİNANSAL DURUM ÖZETİ (RPR-01/04) ─────────────────────────────────────

  async finansalOzet() {
    const { tenantId } = aktifBaglam();

    return this.prisma.tenantIslem(tenantId, async (tx) => {
      // 1. Kasa ve Banka Toplam Bakiyesi (TRY Karşılığı)
      const hareketler = await tx.kasaBankaHareket.groupBy({
        by: ["tip"],
        where: { tenantId },
        _sum: { tutarTry: true },
      });

      let kasaBankaBorc = D(0);
      let kasaBankaAlacak = D(0);

      hareketler.forEach((h) => {
        const sumVal = D(h._sum.tutarTry ?? 0);
        if (h.tip === "tahsilat" || h.tip === "virman_gelis") {
          kasaBankaBorc = kasaBankaBorc.add(sumVal);
        } else {
          kasaBankaAlacak = kasaBankaAlacak.add(sumVal);
        }
      });

      const nakitVarliklar = kasaBankaBorc.sub(kasaBankaAlacak);

      // 2. Toplam Stok Envanter Değeri
      const stoklar = await tx.stokKart.findMany({
        where: { tenantId, aktif: true },
        select: { mevcutMiktar: true, ortalamaMaliyet: true },
      });

      let envanterDegeri = D(0);
      stoklar.forEach((s) => {
        envanterDegeri = envanterDegeri.add(s.mevcutMiktar.mul(s.ortalamaMaliyet));
      });

      // 3. Cari Borç ve Alacak Toplamları (Alacaklar & Borçlar)
      const cariler = await tx.cariHesap.findMany({
        where: { tenantId, aktif: true },
        include: {
          hareketler: { select: { tip: true, tutarTry: true } },
        },
      });

      let toplamAlacaklar = D(0); // Müşterilerden alacağımız (pozitif bakiye)
      let toplamBorclar = D(0);    // Satıcılara borcumuz (negatif bakiye)

      cariler.forEach((c) => {
        let borcSum = D(0);
        let alacakSum = D(0);

        c.hareketler.forEach((h) => {
          if (h.tip === "borc") {
            borcSum = borcSum.add(h.tutarTry);
          } else {
            alacakSum = alacakSum.add(h.tutarTry);
          }
        });

        const cariBakiye = borcSum.sub(alacakSum); // borç > alacak ise müşteri borçludur (bizim alacağımız)
        if (cariBakiye.greaterThan(0)) {
          toplamAlacaklar = toplamAlacaklar.add(cariBakiye);
        } else if (cariBakiye.lessThan(0)) {
          toplamBorclar = toplamBorclar.add(cariBakiye.abs());
        }
      });

      return {
        nakitVarliklar: nakitVarliklar.toFixed(2),
        envanterDegeri: envanterDegeri.toFixed(2),
        toplamAlacaklar: toplamAlacaklar.toFixed(2),
        toplamBorclar: toplamBorclar.toFixed(2),
        netVarlikDegeri: nakitVarliklar
          .add(envanterDegeri)
          .add(toplamAlacaklar)
          .sub(toplamBorclar)
          .toFixed(2),
      };
    });
  }

  async gunlukOzet(tarihMetni?: string) {
    const tarih = tarihMetni && /^\d{4}-\d{2}-\d{2}$/.test(tarihMetni)
      ? new Date(`${tarihMetni}T00:00:00.000Z`)
      : new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
    const tarihIso = tarih.toISOString().slice(0, 10);
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const [satislar, hareketler, cekler] = await Promise.all([
        tx.fatura.findMany({
          where: { tenantId, tarih, durum: "kesin", tip: { in: ["satis", "satis_iade"] } },
          select: { id: true, no: true, tarih: true, tip: true, genelToplam: true, dovizCinsi: true, kur: true, cari: { select: { unvan: true } } },
          orderBy: { createdAt: "desc" },
        }),
        tx.kasaBankaHareket.findMany({
          where: { tenantId, tarih, tip: "tahsilat" },
          select: { id: true, tarih: true, tutar: true, tutarTry: true, dovizCinsi: true, aciklama: true, kaynakTur: true, kaynakRef: true, kasa: { select: { ad: true } }, bankaHesap: { select: { ad: true } }, posHesap: { select: { ad: true } }, cari: { select: { unvan: true } }, fatura: { select: { id: true, no: true } } },
          orderBy: { createdAt: "desc" },
        }),
        tx.cekSenet.findMany({
          where: { tenantId, islemTarihi: tarih, yon: "alinan", durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi", "tahsil_edildi"] } },
          select: { id: true, tur: true, portfoyNo: true, tutar: true, tutarTry: true, dovizCinsi: true, borclu: true, cari: { select: { unvan: true } } },
        }),
      ]);
      const satisTry = satislar.reduce((toplam, fatura) => toplam.add(fatura.genelToplam.mul(fatura.kur)), D(0));
      const hareketKaynaklari = new Set(hareketler.map((h) => h.kaynakRef).filter(Boolean));
      const yeniCekler = cekler.filter((cek) => !hareketKaynaklari.has(cek.id));
      const tahsilatTry = hareketler.reduce((toplam, hareket) => toplam.add(hareket.tutarTry), D(0)).add(yeniCekler.reduce((toplam, cek) => toplam.add(cek.tutarTry), D(0)));
      return {
        tarih: tarihIso,
        satis: { toplam: satisTry.toFixed(2), adet: satislar.length },
        tahsilat: { toplam: tahsilatTry.toFixed(2), adet: hareketler.length + yeniCekler.length },
        tahsilatlar: [...hareketler.map((h) => ({ ...h, hesap: h.kasa?.ad ?? h.bankaHesap?.ad ?? h.posHesap?.ad ?? "Diğer", tutar: h.tutar.toFixed(2), tutarTry: h.tutarTry.toFixed(2) })), ...yeniCekler.map((cek) => ({ id: cek.id, tarih, tutar: cek.tutar.toFixed(2), tutarTry: cek.tutarTry.toFixed(2), dovizCinsi: cek.dovizCinsi, aciklama: `${cek.tur.toUpperCase()} tahsilatı · ${cek.portfoyNo}`, kaynakTur: "cek_senet", hesap: "Çek / Senet", cari: cek.cari, fatura: null }))],
      };
    });
  }

  /** Vadesi geçmiş, halen açık satış ve alış faturaları (panel özeti). */
  async vadesiGecenler() {
    const { tenantId } = aktifBaglam();
    const bugun = new Date();
    const bugunBaslangic = new Date(Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth(), bugun.getUTCDate()));
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const faturalar = await tx.fatura.findMany({
        where: { tenantId, durum: "kesin", tip: { in: ["satis", "alis"] }, vadeTarihi: { lt: bugunBaslangic } },
        orderBy: { vadeTarihi: "asc" }, take: 200,
        select: { id: true, no: true, tip: true, vadeTarihi: true, genelToplam: true, kur: true, cari: { select: { id: true, unvan: true } }, kasaBankaHarekets: { select: { tutarTry: true } }, krediKartiHareketleri: { select: { cariOdemeTutari: true } } },
      });
      const satirlar = faturalar.map((f) => {
        const odenenTry = f.kasaBankaHarekets.reduce((t, h) => t.add(h.tutarTry), D(0)).add(f.krediKartiHareketleri.reduce((t, h) => t.add(D(h.cariOdemeTutari ?? 0).mul(f.kur)), D(0)));
        const toplamTry = f.genelToplam.mul(f.kur).toDecimalPlaces(2);
        const kalanTry = Prisma.Decimal.max(toplamTry.sub(odenenTry), 0).toDecimalPlaces(2);
        const vade = f.vadeTarihi ?? bugunBaslangic;
        const gecikmeGun = Math.max(1, Math.floor((bugunBaslangic.getTime() - vade.getTime()) / 86_400_000));
        return { faturaId: f.id, no: f.no, cariId: f.cari.id, cariUnvan: f.cari.unvan, vadeTarihi: vade.toISOString().slice(0, 10), gecikmeGun, kalanTry: kalanTry.toFixed(2), tip: f.tip };
      }).filter((f) => Number(f.kalanTry) > 0);
      const alacaklar = satirlar.filter((f) => f.tip === "satis");
      const borclar = satirlar.filter((f) => f.tip === "alis");
      const toplam = (liste: typeof satirlar) => liste.reduce((t, f) => t.add(f.kalanTry), D(0)).toFixed(2);
      return { alacaklar, borclar, toplamAlacak: toplam(alacaklar), toplamBorc: toplam(borclar) };
    });
  }
}
