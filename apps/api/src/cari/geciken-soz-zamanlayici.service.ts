import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { AbonelikErisimService } from "../core/abonelik-erisim.service";
import { PrismaClient } from "@prisma/client";
import { baglamlaCalistir } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { TAHSILAT_MODULU, tahsilatAyariSemasi } from "./tahsilat-erisim";
import { TAHSILAT_OTOMASYONU, tahsilatOtomasyonSemasi } from "./tahsilat-otomasyon-ayari";
import { TahsilatTakibiService } from "./tahsilat-takibi.service";
import { nabizla } from "../core/nabiz/nabiz";

const ARALIK_MS = 15 * 60 * 1000;
const SISTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

@Injectable()
export class GecikenSozZamanlayiciService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GecikenSozZamanlayiciService.name);
  private zamanlayici?: NodeJS.Timeout;
  private ilk?: NodeJS.Immediate;
  private calisiyor = false;
  private kapandi = false;
  constructor(private readonly prisma: PrismaService, private readonly takip: TahsilatTakibiService, @Optional() private readonly erisim?: AbonelikErisimService) {}
  onModuleInit() {
    if (process.env.TEKIR_WORKER !== "1") return;
    this.ilk = setImmediate(() => void nabizla("geciken-soz-zamanlayici", () => this.calistir()));
    this.zamanlayici = setInterval(() => void nabizla("geciken-soz-zamanlayici", () => this.calistir(), ARALIK_MS), ARALIK_MS);
  }
  onModuleDestroy() { this.kapandi = true; if (this.ilk) clearImmediate(this.ilk); if (this.zamanlayici) clearInterval(this.zamanlayici); }

  /** Gerçek sorumlunun güncel kimliğiyle iç operasyon kaydı; dış eylem yok. */
  async taraTenant(tenantId: string) {
    const aday = await baglamlaCalistir({ tenantId, userId: SISTEM_USER_ID, rol: "yonetici" }, () => this.prisma.tenantIslem(tenantId, async (tx) => {
      const ayarlar = await tx.modulAyar.findMany({ where: { tenantId, modul: { in: [TAHSILAT_MODULU, TAHSILAT_OTOMASYONU] } }, select: { modul: true, ayarlar: true } });
      const otomatik = tahsilatOtomasyonSemasi.safeParse(ayarlar.find((a) => a.modul === TAHSILAT_OTOMASYONU)?.ayarlar ?? {});
      const erisim = tahsilatAyariSemasi.safeParse(ayarlar.find((a) => a.modul === TAHSILAT_MODULU)?.ayarlar ?? {});
      if (!otomatik.success || !otomatik.data.acik || !erisim.success || !["pilot", "acik"].includes(erisim.data.mod)) return null;
      const user = await tx.user.findFirst({ where: { tenantId, id: otomatik.data.sorumluUserId!, aktif: true, rol: { in: ["yonetici", "muhasebe"] } }, select: { id: true, rol: true } });
      if (!user || (user.rol !== "yonetici" && user.rol !== "muhasebe")) throw new BadRequestException("Otomatik takip sorumlusu artık uygun değil");
      const [saat] = await tx.$queryRaw<{ zaman: Date }[]>`SELECT clock_timestamp() AS zaman`;
      const bugun = saat.zaman.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
      const cariler = await tx.odemeSozu.findMany({
        where: { tenantId, kayitDurumu: "aktif", sozTarihi: { lt: new Date(bugun) }, takipBaglantisi: null, fatura: { durum: "kesin", tip: "satis" } },
        select: { cariId: true }, distinct: ["cariId"], take: 101,
      });
      if (cariler.length > 100) throw new BadRequestException("Otomatik takip taraması 100 cari sınırını aştı; kısmi tarama yapılmadı");
      return { user: { id: user.id, rol: user.rol as "yonetici" | "muhasebe" }, cariler };
    }));
    let baglanan = 0, olusturulan = 0, hatali = 0;
    if (aday) for (const { cariId } of aday.cariler) {
      if (this.kapandi) break;
      try {
        const sonuc = await baglamlaCalistir({ tenantId, userId: aday.user.id, rol: aday.user.rol }, () => this.takip.gecikenSozleriBagla(cariId));
        baglanan += sonuc.baglanan; olusturulan += sonuc.olusturulan;
      } catch (hata) {
        hatali++;
        this.logger.error(JSON.stringify({ event: "overdue_promise_customer_failed", tenantId, cariId, error: hata instanceof Error ? hata.message : String(hata) }));
      }
    }
    return { baglanan, olusturulan, hatali };
  }

  async calistir() {
    if (this.calisiyor || this.kapandi) return;
    this.calisiyor = true;
    let yonetim: PrismaClient | undefined;
    try {
      if (!process.env.DATABASE_URL_MIGRATE) throw new Error("Otomatik takip tenant keşfi için DATABASE_URL_MIGRATE gerekli");
      // Mevcut worker kalıbı: yönetim bağlantısı yalnız tenant kimliği keşfeder.
      yonetim = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_MIGRATE });
      let imlec: string | undefined;
      while (!this.kapandi) {
        const tenantlar: { id: string }[] = await yonetim.tenant.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: 100, ...(imlec ? { where: { id: { gt: imlec } } } : {}) });
        for (const { id } of tenantlar) {
          if (this.kapandi) break;
          // PLT-05: askıdaki firmada otomatik tahsilat takibi açılmaz.
          if (await this.erisim?.otomasyonDurdu(id, "cari")) continue;
          try { const sonuc = await this.taraTenant(id); this.logger.debug(JSON.stringify({ event: "overdue_promise_scan", tenantId: id, ...sonuc })); }
          catch (hata) { this.logger.error(JSON.stringify({ event: "overdue_promise_tenant_failed", tenantId: id, error: hata instanceof Error ? hata.message : String(hata) })); }
        }
        if (tenantlar.length < 100) break;
        imlec = tenantlar.at(-1)!.id;
      }
    } catch (hata) {
      this.logger.error(JSON.stringify({ event: "overdue_promise_scan_failed", error: hata instanceof Error ? hata.message : String(hata) }));
    } finally { try { await yonetim?.$disconnect(); } finally { this.calisiyor = false; } }
  }
}
