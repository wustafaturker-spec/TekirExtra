import { BadRequestException, ConflictException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { AbonelikDurumu, Prisma } from "@prisma/client";
import { AbonelikErisimService, abonelikErisimiHesapla } from "../core/abonelik-erisim.service";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";

import { ABONELIK_PLANLARI, VARSAYILAN_PLAN_KODU, type LimitAnahtari } from "./abonelik-planlari";
import { abonelikKosullariniOku, etkinAbonelikPlani } from "./abonelik-kosullari";
import { etkinFiyatKosullariniBagla } from "./etkin-fiyat-kosullari";
import { paketKotaAyi, paketKotaDurumu, PAKET_KOTA_KODLARI } from "@tekirextra/shared";
export { ABONELIK_PLANLARI, VARSAYILAN_PLAN_KODU, type LimitAnahtari } from "./abonelik-planlari";

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
    const ay = paketKotaAyi();
    const [kullanici, cari, stok, aylikFatura] = await Promise.all([
      // PRS-21: çalışan self-servis hesapları kullanıcı sınırına sayılmaz.
      tx.user.count({ where: { aktif: true, rol: { not: "calisan" } } }),
      tx.cariHesap.count({ where: { aktif: true } }),
      tx.stokKart.count({ where: { aktif: true } }),
      tx.fatura.count({ where: { createdAt: { gte: ay.baslangic, lt: ay.bitis } } }),
    ]);
    return { kullanici, cari, stok, aylikFatura };
  }

  async ozet() {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const abonelik = (await etkinFiyatKosullariniBagla(tx, tenantId, await this.abonelikSagla(tx, tenantId)))!;
      const kullanim = await this.kullanimSay(tx);
      const plan = etkinAbonelikPlani(abonelik);
      const kosullar = abonelikKosullariniOku(abonelik);
      const kapsam = kosullar?.semaSurumu === 2 ? kosullar.kapsamSozlesmesi : null;
      const kotaDurumlari = Object.fromEntries(PAKET_KOTA_KODLARI.map((kod) => [kod, paketKotaDurumu(kullanim[kod], plan.limitler[kod], kapsam?.kotalar[kod].uyariYuzdesi ?? 90)]));
      // Platform P0-1: bekleyen talep ve son karar ekranda gösterilir.
      const sonTalep = await tx.abonelikTalebi.findFirst({ orderBy: { createdAt: "desc" } });
      return { abonelik, plan, planlar: ABONELIK_PLANLARI, kullanim, kotaDurumlari, sonTalep };
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
        if (abonelikKosullariniOku(mevcut)?.semaSurumu === 2) throw new BadRequestException("Bu abonelikte plan değişikliği kontrollü kapsam ataması gerektirir; platform ekibiyle iletişime geçin.");
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
      if (mevcut.durum === AbonelikDurumu.deneme) throw new ForbiddenException("Deneme aboneliği ödeme ile etkinleştirilir; deneme için iptal işlemi gerekmez.");
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
    const kalan = await this.kalanLimit(anahtar);
    if (kalan.kalan !== null && kalan.kalan <= 0) throw new BadRequestException(`${kalan.planAdi} planının ${anahtar} limiti doldu (${kalan.limit})`);
  }

  /** FTR-43: toplu üretim kaç kayıt açabileceğini bilmelidir; `kalan: null` limitsiz demektir. */
  async kalanLimit(anahtar: LimitAnahtari): Promise<{ kalan: number | null; limit: number | null; planAdi: string }> {
    const { tenantId } = aktifBaglam();
    return this.prisma.tenantIslem(tenantId, async (tx) => {
      const abonelik = (await etkinFiyatKosullariniBagla(tx, tenantId, await this.abonelikSagla(tx, tenantId)))!;
      if (abonelik.durum === AbonelikDurumu.askida) throw new BadRequestException("Abonelik askıya alınmış");
      const erisim = abonelikErisimiHesapla({ durum: abonelik.durum, donemSonu: abonelik.donemSonu ?? null, iptalTarihi: abonelik.iptalTarihi ?? null });
      if (erisim.kisitli) throw new BadRequestException(erisim.neden ?? "Abonelik salt okunur");
      const plan = etkinAbonelikPlani(abonelik);
      const limit = plan.limitler[anahtar];
      if (limit === null) return { kalan: null, limit: null, planAdi: plan.ad };
      const kullanim = await this.kullanimSay(tx);
      return { kalan: Math.max(0, limit - kullanim[anahtar]), limit, planAdi: plan.ad };
    });
  }
}
