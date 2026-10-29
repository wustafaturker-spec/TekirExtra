import { BadRequestException, ConflictException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { AbonelikDurumu, Prisma } from "@prisma/client";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

export type LimitAnahtari = "kullanici" | "cari" | "stok" | "aylikFatura";

/**
 * Abonelik kaydı yoksa açılan plan. Şemadaki varsayılanla aynıdır ve
 * `profesyonel` plana eşlenir.
 */
export const VARSAYILAN_PLAN_KODU = "v1";

export const ABONELIK_PLANLARI = [
  { kod: "baslangic", ad: "Başlangıç", aciklama: "Küçük ekipler için temel finans ve stok yönetimi.", aylikFiyat: 399, limitler: { kullanici: 3, cari: 250, stok: 500, aylikFatura: 100 }, ozellikler: ["Cari, fatura ve stok", "Kasa ve banka", "Temel raporlar"] },
  { kod: "profesyonel", ad: "Profesyonel", aciklama: "Büyüyen işletmeler için geniş limitler ve entegrasyonlar.", aylikFiyat: 999, onerilen: true, limitler: { kullanici: 10, cari: 2500, stok: 5000, aylikFatura: 1000 }, ozellikler: ["Başlangıç planındaki her şey", "e-Belge ve banka bağlantıları", "Pazaryeri ve POS", "Gelişmiş raporlar"] },
  { kod: "kurumsal", ad: "Kurumsal", aciklama: "Yüksek hacimli ekipler için limitsiz kullanım.", aylikFiyat: null, limitler: { kullanici: null, cari: null, stok: null, aylikFatura: null }, ozellikler: ["Profesyonel planındaki her şey", "Limitsiz kayıt ve kullanıcı", "Öncelikli destek"] },
] as const;

@Injectable()
export class AbonelikService {
  constructor(
    private readonly prisma: PrismaService,
    // Elle kurulan testlerde yok; durum değişince salt okunur kuralı hemen tazelenir.
    @Optional() private readonly erisim?: AbonelikErisimService,
  ) {}

  private plan(kod: string) {
    const plan = ABONELIK_PLANLARI.find((p) => p.kod === kod);
    if (!plan) throw new BadRequestException("Geçersiz abonelik planı");
    return plan;
  }

  /**
   * Kiracının abonelik kaydını döndürür, yoksa varsayılan planla açar.
   *
   * Abonelik kaydı yalnızca web kayıt akışında yazılıyordu; betikle ya da elle
   * açılan kiracıda kayıt bulunmadığı için cari, stok ve fatura oluşturma
   * "abonelik aktif değil" diye kilitleniyordu. Kaydın yokluğu bir veri eksiği,
   * askıya alma değildir: gerçek askıya alma `durum` alanıyla yapılır ve bu yol
   * onu değiştirmez.
   */
  private async abonelikSagla(tx: any, tenantId: string) {
    return tx.tenantAbonelik.upsert({
      where: { tenantId },
      create: { tenantId, planKodu: VARSAYILAN_PLAN_KODU, durum: AbonelikDurumu.aktif },
      update: {},
    });
  }

  private async kullanimSay(tx: any) {
    const ayBasi = new Date();
    ayBasi.setDate(1); ayBasi.setHours(0, 0, 0, 0);
    const [kullanici, cari, stok, aylikFatura] = await Promise.all([
      // PRS-21: çalışan self-servis hesapları kullanıcı sınırına sayılmaz.
      tx.user.count({ where: { aktif: true, rol: { not: "calisan" } } }),
      tx.cariHesap.count({ where: { aktif: true } }),
      tx.stokKart.count({ where: { aktif: true } }),
      tx.fatura.count({ where: { createdAt: { gte: ayBasi } } }),
    ]);
    return { kullanici, cari, stok, aylikFatura };
  }

  async ozet() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const abonelik = await this.abonelikSagla(tx, tenantId);
      const kullanim = await this.kullanimSay(tx);
      const plan = this.plan(abonelik.planKodu === "v1" ? "profesyonel" : abonelik.planKodu);
      // Platform P0-1: bekleyen talep ve son karar ekranda gösterilir.
      const sonTalep = await tx.abonelikTalebi.findFirst({ orderBy: { createdAt: "desc" } });
      return { abonelik, plan, planlar: ABONELIK_PLANLARI, kullanim, sonTalep };
    });
  }

  /**
   * Platform P0-1: plan değişikliği talep olarak açılır, platform ekibi onaylar
   * (PLT-12: yeni fiyat bir sonraki ödemeden geçerlidir). Daha küçük plana
   * geçişte aşılan sınırlar baştan söylenir.
   */
  async planTalebi(yeniPlanKodu: string, aciklama?: string) {
    const { tenantId, userId } = aktifBaglam();
    const yeniPlan = this.plan(yeniPlanKodu);
    try {
      return await this.prisma.tenantIslem(tenantId, async (tx) => {
        const mevcut = await this.abonelikSagla(tx, tenantId);
        const mevcutKod = mevcut.planKodu === VARSAYILAN_PLAN_KODU ? "profesyonel" : mevcut.planKodu;
        if (mevcutKod === yeniPlan.kod) throw new BadRequestException("Zaten bu plandasınız");
        if (mevcut.durum === AbonelikDurumu.askida) throw new ForbiddenException("Askıdaki abonelikte plan talebi açılamaz; bizimle iletişime geçin");
        const kullanim = await this.kullanimSay(tx);
        const asimlar = Object.entries(yeniPlan.limitler).filter(([anahtar, limit]) => limit !== null && kullanim[anahtar as LimitAnahtari] > limit);
        if (asimlar.length) {
          throw new BadRequestException("Bu plana geçmek için önce limit aşımını giderin: " + asimlar.map(([a, l]) => `${a} ${kullanim[a as LimitAnahtari]}/${l}`).join(", "));
        }
        const talep = await tx.abonelikTalebi.create({ data: { tenantId, mevcutPlan: mevcut.planKodu, istenenPlan: yeniPlan.kod, aciklama: aciklama?.trim() || null, isteyenUserId: userId } });
        await tx.auditLog.create({ data: { tenantId, userId, islem: "abonelik_talebi_olusturuldu", varlik: "abonelik_talebi", varlikId: talep.id, detay: { mevcutPlan: mevcut.planKodu, istenenPlan: yeniPlan.kod } } });
        return talep;
      });
    } catch (hata) {
      // Firma başına tek bekleyen talep (kısmi benzersiz indeks).
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") throw new ConflictException("Bekleyen bir plan talebiniz var; önce onu geri çekin");
      throw hata;
    }
  }

  async talebiGeriCek() {
    const { tenantId, userId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const talep = await tx.abonelikTalebi.findFirst({ where: { durum: "bekliyor" } });
      if (!talep) throw new BadRequestException("Bekleyen plan talebi yok");
      await tx.abonelikTalebi.update({ where: { id: talep.id }, data: { durum: "geri_cekildi", kararAt: new Date() } });
      await tx.auditLog.create({ data: { tenantId, userId, islem: "abonelik_talebi_geri_cekildi", varlik: "abonelik_talebi", varlikId: talep.id } });
      return { mesaj: "Plan talebi geri çekildi" };
    });
  }

  async iletisimGuncelle(girdi: { faturaEpostasi?: string; faturalandirmaUnvani?: string }) {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      await this.abonelikSagla(tx, tenantId);
      return tx.tenantAbonelik.update({ where: { tenantId }, data: girdi });
    });
  }

  async durumDegistir(yeniDurum: "aktif" | "iptal") {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const mevcut = await this.abonelikSagla(tx, tenantId);
      // Platform P0-1: askıya almayı yalnız platform ekibi kaldırır.
      if (mevcut.durum === AbonelikDurumu.askida) throw new ForbiddenException("Askıdaki abonelik yalnız TekirExtra ekibi tarafından açılabilir; bizimle iletişime geçin");
      const abonelik = await tx.tenantAbonelik.update({ where: { tenantId }, data: { durum: yeniDurum, iptalTarihi: yeniDurum === "iptal" ? new Date() : null } });
      await tx.abonelikDegisikligi.create({ data: { tenantId, oncekiPlan: mevcut.planKodu, yeniPlan: mevcut.planKodu, oncekiDurum: mevcut.durum, yeniDurum, neden: yeniDurum === "iptal" ? "Dönem sonunda iptal talebi" : "Abonelik yeniden etkinleştirildi" } });
      return abonelik;
    }).finally(() => this.erisim?.unut(tenantId));
  }

  async gecmis() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, (tx) => tx.abonelikDegisikligi.findMany({ orderBy: { createdAt: "desc" }, take: 50 }));
  }

  async limitDogrula(anahtar: LimitAnahtari) {
    const { tenantId } = aktifBaglam();
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      const abonelik = await this.abonelikSagla(tx, tenantId);
      if (abonelik.durum === AbonelikDurumu.askida) throw new BadRequestException("Abonelik askıya alınmış");
      const plan = this.plan(abonelik.planKodu === "v1" ? "profesyonel" : abonelik.planKodu);
      const limit = plan.limitler[anahtar];
      if (limit === null) return;
      const kullanim = await this.kullanimSay(tx);
      if (kullanim[anahtar] >= limit) throw new BadRequestException(`${plan.ad} planının ${anahtar} limiti doldu (${limit})`);
    });
  }
}
