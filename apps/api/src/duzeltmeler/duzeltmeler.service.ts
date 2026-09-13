import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { DuzeltmeDurumu, DuzeltmeOnemi, DuzeltmeTuru, Prisma } from "@prisma/client";
import type { z } from "zod";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import type { duzeltmeListeSemasi } from "./duzeltmeler.semalar";

type ListeGirdisi = z.infer<typeof duzeltmeListeSemasi>;
type Tespit = {
  tur: DuzeltmeTuru;
  onem: DuzeltmeOnemi;
  kaynakTur: string;
  kaynakRef: string;
  nedenKodu: string;
  aciklama: string;
  onerilenEylem: string;
};

@Injectable()
export class DuzeltmelerService {
  constructor(private readonly prisma: PrismaService) {}

  async listele(girdi: ListeGirdisi) {
    const { tenantId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const where: Prisma.DuzeltmeKaydiWhereInput = {
        ...this.rolKapsami(rol),
        ...(girdi.tur ? { tur: girdi.tur } : {}),
        ...(girdi.onem ? { onem: girdi.onem } : {}),
        ...(girdi.durum ? { durum: girdi.durum } : {}),
        ...(girdi.atananUserId ? { atananUserId: girdi.atananUserId } : {}),
        ...(girdi.kaynak ? { OR: [{ kaynakTur: { contains: girdi.kaynak, mode: "insensitive" } }, { kaynakRef: { contains: girdi.kaynak, mode: "insensitive" } }] } : {}),
        ...(girdi.baslangic || girdi.bitis ? { createdAt: { ...(girdi.baslangic ? { gte: girdi.baslangic } : {}), ...(girdi.bitis ? { lte: girdi.bitis } : {}) } } : {}),
      };
      const [toplam, kayitlar] = await Promise.all([
        tx.duzeltmeKaydi.count({ where }),
        tx.duzeltmeKaydi.findMany({
          where,
          include: { atanan: { select: { id: true, adSoyad: true } } },
          orderBy: [{ onem: "desc" }, { createdAt: "asc" }],
          skip: (girdi.sayfa - 1) * girdi.limit,
          take: girdi.limit,
        }),
      ]);
      return { kayitlar, toplam, sayfa: girdi.sayfa, limit: girdi.limit, toplamSayfa: Math.ceil(toplam / girdi.limit) };
    });
  }

  async ozet() {
    const { tenantId, userId, rol } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kapsam = this.rolKapsami(rol); const gunBaslangici = new Date(); gunBaslangici.setHours(0, 0, 0, 0);
      const [gruplar, banaAtanan, slaAsan, bugunOlusan] = await Promise.all([
        tx.duzeltmeKaydi.groupBy({ by: ["durum", "onem"], where: kapsam, _count: { _all: true } }),
        tx.duzeltmeKaydi.count({ where: { ...kapsam, atananUserId: userId, durum: { in: ["acik", "incelemede", "beklemede"] } } }),
        tx.duzeltmeKaydi.count({ where: { ...kapsam, sonTarih: { lt: new Date() }, durum: { in: ["acik", "incelemede", "beklemede"] } } }),
        tx.duzeltmeKaydi.count({ where: { ...kapsam, createdAt: { gte: gunBaslangici } } }),
      ]);
      const say = (durumlar: DuzeltmeDurumu[], onem?: DuzeltmeOnemi) => gruplar.filter((g) => durumlar.includes(g.durum) && (!onem || g.onem === onem)).reduce((n, g) => n + g._count._all, 0);
      return { acik: say(["acik", "incelemede", "beklemede"]), kritik: say(["acik", "incelemede", "beklemede"], "kritik"), bugunOlusan, banaAtanan, slaAsan };
    });
  }

  async secenekler() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.user.findMany({
      where: { aktif: true, rol: { in: ["yonetici", "muhasebe"] } },
      select: { id: true, adSoyad: true, eposta: true },
      orderBy: { adSoyad: "asc" },
    }));
  }

  async getir(id: string) {
    const { tenantId, rol } = aktifBaglam();
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => tx.duzeltmeKaydi.findFirst({
      where: { id, ...this.rolKapsami(rol) },
      include: {
        atanan: { select: { id: true, adSoyad: true, eposta: true } },
        cozen: { select: { id: true, adSoyad: true } },
        olaylar: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, adSoyad: true } } } },
      },
    }));
    if (!kayit) throw new NotFoundException("Düzeltme kaydı bulunamadı");
    return kayit;
  }

  async tara() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const beklemeEsigi = new Date(Date.now() - 15 * 60 * 1000);
      const bugun = new Date(); bugun.setUTCHours(0, 0, 0, 0);
      const [ekstreler, masraflar, kartHarcamalari, posTahsilatlari, ebelgeler, negatifStoklar, sayimlar, vadesiGecenEvraklar, faturalar] = await Promise.all([
        tx.bankaEkstreSatir.findMany({ where: { durum: "beklemede" }, select: { id: true, aciklama: true, tutar: true }, take: 2_000 }),
        tx.masraf.findMany({ where: { durum: "onaylandi", odemeDurumu: { not: "odendi" }, odemeler: { none: {} } }, select: { id: true, belgeNo: true, saticiUnvan: true, toplam: true }, take: 2_000 }),
        tx.krediKartiHareket.findMany({ where: { tenantId, tip: "harcama", masrafOdemesi: null, faturaId: null }, select: { id: true, aciklama: true, tutar: true }, take: 2_000 }),
        tx.posTahsilat.findMany({ where: { durum: "odendi", hareketId: null }, select: { id: true, tutar: true, saglayiciOdemeId: true }, take: 2_000 }),
        tx.ebelgeKayit.findMany({ where: { OR: [{ durum: "hata" }, { durum: "kuyrukta", createdAt: { lt: beklemeEsigi } }] }, select: { id: true, faturaId: true, durum: true, hataMesaji: true }, take: 2_000 }),
        tx.stokDepoBakiye.findMany({ where: { mevcutMiktar: { lt: 0 } }, select: { id: true, mevcutMiktar: true, stok: { select: { kod: true, ad: true } }, depo: { select: { ad: true } } }, take: 2_000 }),
        tx.sayim.findMany({ where: { durum: "taslak" }, select: { id: true, tarih: true, aciklama: true, depo: { select: { ad: true } }, kalemler: { select: { sistemMiktar: true, fiiliMiktar: true } } }, take: 2_000 }),
        tx.cekSenet.findMany({ where: { vadeTarihi: { lt: bugun }, durum: { in: ["portfoyde", "tahsile_verildi", "teminata_verildi", "ciro_edildi", "verildi"] } }, select: { id: true, portfoyNo: true, vadeTarihi: true, tutar: true, durum: true }, take: 2_000 }),
        tx.fatura.findMany({ where: { durum: "kesin" }, select: { id: true, no: true, genelToplam: true, kasaBankaHarekets: { select: { tutar: true } }, krediKartiHareketleri: { select: { cariOdemeTutari: true } } }, take: 2_000 }),
      ]);
      const odemesiAsanFaturalar = faturalar.flatMap((fatura) => {
        const odenen = fatura.kasaBankaHarekets.reduce((toplam, hareket) => toplam + Number(hareket.tutar), 0)
          + fatura.krediKartiHareketleri.reduce((toplam, hareket) => toplam + Number(hareket.cariOdemeTutari ?? 0), 0);
        return odenen > Number(fatura.genelToplam) + 0.01 ? [{ ...fatura, odenen }] : [];
      });
      const farkliTaslakSayimlar = sayimlar.flatMap((sayim) => {
        const farkliKalem = sayim.kalemler.filter((kalem) => !kalem.fiiliMiktar.equals(kalem.sistemMiktar));
        return farkliKalem.length ? [{ ...sayim, farkliKalem: farkliKalem.length }] : [];
      });
      const tespitler: Tespit[] = [
        ...ekstreler.map((satir) => ({ tur: "banka_ekstre" as const, onem: "uyari" as const, kaynakTur: "banka_ekstre_satiri", kaynakRef: satir.id, nedenKodu: "ESLESMEMIS_EKSTRE", aciklama: `${satir.aciklama} (${satir.tutar.toString()} TRY) eşleştirme bekliyor.`, onerilenEylem: "Satırı cari veya faturayla eşleştirin ya da güvenle yoksayın." })),
        ...masraflar.map((masraf) => ({ tur: "masraf" as const, onem: "uyari" as const, kaynakTur: "masraf", kaynakRef: masraf.id, nedenKodu: "ODEME_BAGLANTISI_YOK", aciklama: `${masraf.belgeNo || masraf.saticiUnvan || "Onaylı masraf"} için ${masraf.toplam.toString()} tutarında ödeme bağlantısı yok.`, onerilenEylem: "Masrafa kasa, banka veya kredi kartı ödemesi bağlayın." })),
        ...kartHarcamalari.map((hareket) => ({ tur: "kredi_karti" as const, onem: "uyari" as const, kaynakTur: "kredi_karti_hareketi", kaynakRef: hareket.id, nedenKodu: "BELGESIZ_KART_HARCAMASI", aciklama: `${hareket.aciklama} kart harcamasının ${hareket.tutar.toString()} tutarı bir masraf veya faturaya bağlı değil.`, onerilenEylem: "Kart harcamasını masraf belgesiyle ilişkilendirin." })),
        ...posTahsilatlari.map((tahsilat) => ({ tur: "pos" as const, onem: "kritik" as const, kaynakTur: "pos_tahsilat", kaynakRef: tahsilat.id, nedenKodu: "POS_FINANS_HAREKETI_EKSIK", aciklama: `${tahsilat.saglayiciOdemeId || tahsilat.id} referanslı ${tahsilat.tutar.toString()} POS tahsilatının finans hareketi yok.`, onerilenEylem: "Sağlayıcı sonucunu doğrulayın ve tahsilat hareketini idempotent olarak yeniden oluşturun." })),
        ...ebelgeler.map((belge) => ({ tur: "ebelge" as const, onem: belge.durum === "hata" ? "kritik" as const : "uyari" as const, kaynakTur: "ebelge", kaynakRef: belge.faturaId, nedenKodu: belge.durum === "hata" ? "EBELGE_HATALI" : "EBELGE_UZUN_BEKLIYOR", aciklama: belge.hataMesaji || "e-Belge 15 dakikadan uzun süredir kuyrukta bekliyor.", onerilenEylem: "e-Belge operasyon kuyruğundan hata ayrıntısını inceleyip güvenli yeniden deneme başlatın." })),
        ...negatifStoklar.map((bakiye) => ({ tur: "stok" as const, onem: "kritik" as const, kaynakTur: "stok_depo_bakiyesi", kaynakRef: bakiye.id, nedenKodu: "NEGATIF_STOK", aciklama: `${bakiye.stok.kod} · ${bakiye.stok.ad}, ${bakiye.depo.ad} deposunda ${bakiye.mevcutMiktar.toString()} bakiyeye düştü.`, onerilenEylem: "Eksik giriş/transfer hareketini düzeltin veya kontrollü sayım farkı onayı oluşturun." })),
        ...farkliTaslakSayimlar.map((sayim) => ({ tur: "stok" as const, onem: "uyari" as const, kaynakTur: "stok_sayim", kaynakRef: sayim.id, nedenKodu: "SAYIM_FARKI_ONAYSIZ", aciklama: `${sayim.depo.ad} deposundaki ${sayim.farkliKalem} sayım farkı henüz onaylanmadı.`, onerilenEylem: "Sayım farklarını inceleyip sayımı onaylayın veya taslağı düzeltin." })),
        ...vadesiGecenEvraklar.map((evrak) => ({ tur: "cek_senet" as const, onem: "uyari" as const, kaynakTur: "cek_senet", kaynakRef: evrak.id, nedenKodu: "VADE_GECTI_DURUM_ACIK", aciklama: `${evrak.portfoyNo} portföy numaralı ${evrak.tutar.toString()} tutarlı evrakın vadesi ${evrak.vadeTarihi.toLocaleDateString("tr-TR")} tarihinde geçti; durumu ${evrak.durum}.`, onerilenEylem: "Tahsilat/ödeme sonucunu kaydedin veya evrak durumunu güncelleyin." })),
        ...odemesiAsanFaturalar.map((fatura) => ({ tur: "fatura_cari" as const, onem: "kritik" as const, kaynakTur: "fatura", kaynakRef: fatura.id, nedenKodu: "FATURA_ODEME_TOPLAMI_ASIMI", aciklama: `${fatura.no || fatura.id} numaralı faturada ödeme toplamı ${fatura.odenen.toFixed(2)}, fatura toplamı ${fatura.genelToplam.toString()}.`, onerilenEylem: "Faturaya bağlı tahsilat/ödeme hareketlerini inceleyip fazla veya yinelenen kaydı geri alın." })),
      ];

      const aktifAnahtarlar = new Set<string>();
      for (const tespit of tespitler) {
        const anahtar = `${tespit.nedenKodu}:${tespit.kaynakTur}:${tespit.kaynakRef}`;
        aktifAnahtarlar.add(anahtar);
        await tx.duzeltmeKaydi.upsert({
          where: { tenantId_tekillikAnahtari: { tenantId, tekillikAnahtari: anahtar } },
          create: { tenantId, ...tespit, tekillikAnahtari: anahtar, sonTarih: new Date(Date.now() + 24 * 60 * 60 * 1000) },
          update: { ...tespit, sonTespitTarihi: new Date() },
        });
      }

      const mevcutlar = await tx.duzeltmeKaydi.findMany({ where: { nedenKodu: { in: ["ESLESMEMIS_EKSTRE", "ODEME_BAGLANTISI_YOK", "BELGESIZ_KART_HARCAMASI", "POS_FINANS_HAREKETI_EKSIK", "EBELGE_HATALI", "EBELGE_UZUN_BEKLIYOR", "NEGATIF_STOK", "SAYIM_FARKI_ONAYSIZ", "VADE_GECTI_DURUM_ACIK", "FATURA_ODEME_TOPLAMI_ASIMI"] }, durum: { in: ["acik", "incelemede", "beklemede"] }, tekillikAnahtari: { not: null } }, select: { id: true, tekillikAnahtari: true, durum: true } });
      let otomatikCozulen = 0;
      for (const kayit of mevcutlar) {
        if (kayit.tekillikAnahtari && aktifAnahtarlar.has(kayit.tekillikAnahtari)) continue;
        await tx.duzeltmeKaydi.update({ where: { id: kayit.id }, data: { durum: "cozuldu", cozulmeTarihi: new Date(), tekillikAnahtari: null } });
        await tx.duzeltmeOlayi.create({ data: { tenantId, duzeltmeKaydiId: kayit.id, oncekiDurum: kayit.durum, yeniDurum: "cozuldu", olayTuru: "otomatik_cozum", aciklama: "Kaynak sorun yeniden taramada bulunamadı." } });
        otomatikCozulen++;
      }
      return { taranan: ekstreler.length + masraflar.length + kartHarcamalari.length + posTahsilatlari.length + ebelgeler.length + negatifStoklar.length + sayimlar.length + vadesiGecenEvraklar.length + faturalar.length, bulunan: tespitler.length, otomatikCozulen };
    });
  }

  async ata(id: string, userId: string | null) {
    const { tenantId, userId: yapan } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.kayitDogrula(tx, id);
      if (userId && !(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new NotFoundException("Atanacak kullanıcı bulunamadı");
      const kayit = await tx.duzeltmeKaydi.update({ where: { id }, data: { atananUserId: userId } });
      await tx.duzeltmeOlayi.create({ data: { tenantId, duzeltmeKaydiId: id, userId: yapan, olayTuru: "atama", aciklama: userId ? "Kayıt kullanıcıya atandı." : "Kayıt ataması kaldırıldı." } });
      return kayit;
    });
  }

  async topluAta(ids: string[], userId: string | null) {
    const { tenantId, userId: yapan } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      if (userId && !(await tx.user.findFirst({ where: { id: userId, aktif: true, rol: { in: ["yonetici", "muhasebe"] } }, select: { id: true } }))) throw new NotFoundException("Atanacak aktif kullanıcı bulunamadı");
      const kayitlar = await tx.duzeltmeKaydi.findMany({ where: { id: { in: ids }, durum: { in: ["acik", "incelemede", "beklemede"] } }, select: { id: true } });
      if (kayitlar.length !== ids.length) throw new BadRequestException("Seçimde bulunamayan veya kapanmış düzeltme kaydı var");
      await tx.duzeltmeKaydi.updateMany({ where: { id: { in: ids } }, data: { atananUserId: userId } });
      await tx.duzeltmeOlayi.createMany({ data: kayitlar.map((kayit) => ({ tenantId, duzeltmeKaydiId: kayit.id, userId: yapan, olayTuru: "toplu_atama", aciklama: userId ? "Kayıt toplu olarak kullanıcıya atandı." : "Kayıt ataması toplu olarak kaldırıldı." })) });
      return { guncellenen: kayitlar.length };
    });
  }

  async topluYoksay(ids: string[], aciklama: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const kayitlar = await tx.duzeltmeKaydi.findMany({ where: { id: { in: ids }, durum: { in: ["acik", "incelemede", "beklemede"] } }, select: { id: true, tur: true, durum: true } });
      if (kayitlar.length !== ids.length) throw new BadRequestException("Seçimde bulunamayan veya kapanmış düzeltme kaydı var");
      if (kayitlar.some((kayit) => kayit.tur !== "banka_ekstre")) throw new BadRequestException("Toplu yoksayma yalnız banka ekstresi bulgularında kullanılabilir");
      const cozulmeTarihi = new Date();
      await tx.duzeltmeKaydi.updateMany({ where: { id: { in: ids } }, data: { durum: "yoksayildi", cozenUserId: userId, cozulmeTarihi, tekillikAnahtari: null } });
      await tx.duzeltmeOlayi.createMany({ data: kayitlar.map((kayit) => ({ tenantId, duzeltmeKaydiId: kayit.id, userId, oncekiDurum: kayit.durum, yeniDurum: "yoksayildi", olayTuru: "toplu_yoksayma", aciklama })) });
      return { guncellenen: kayitlar.length };
    });
  }

  async notEkle(id: string, aciklama: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.kayitDogrula(tx, id);
      return tx.duzeltmeOlayi.create({ data: { tenantId, duzeltmeKaydiId: id, userId, olayTuru: "not", aciklama } });
    });
  }

  async durumDegistir(id: string, durum: Exclude<DuzeltmeDurumu, "acik" | "cozuldu">, aciklama?: string) {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const onceki = await this.kayitDogrula(tx, id);
      if (onceki.durum === "cozuldu" || onceki.durum === "yoksayildi") throw new BadRequestException("Kapanmış düzeltme kaydının durumu değiştirilemez");
      const kapali = durum === "yoksayildi";
      const kayit = await tx.duzeltmeKaydi.update({ where: { id }, data: { durum, ...(kapali ? { cozenUserId: userId, cozulmeTarihi: new Date(), tekillikAnahtari: null } : {}) } });
      await tx.duzeltmeOlayi.create({ data: { tenantId, duzeltmeKaydiId: id, userId, oncekiDurum: onceki.durum, yeniDurum: durum, olayTuru: "durum", aciklama } });
      return kayit;
    });
  }

  private async kayitDogrula(tx: Prisma.TransactionClient, id: string) {
    const kayit = await tx.duzeltmeKaydi.findUnique({ where: { id }, select: { id: true, durum: true } });
    if (!kayit) throw new NotFoundException("Düzeltme kaydı bulunamadı");
    return kayit;
  }

  private rolKapsami(rol: string): Prisma.DuzeltmeKaydiWhereInput {
    if (rol === "mali_musavir") return { tur: "fatura_cari" };
    if (rol === "salt_okunur") return { tur: { in: ["banka_ekstre", "kredi_karti", "pos", "stok", "cek_senet", "fatura_cari"] } };
    return {};
  }
}
