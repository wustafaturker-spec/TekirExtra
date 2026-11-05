import { ForbiddenException, Injectable, Logger, Optional, type CanActivate, type Type } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ModuleRef, Reflector } from "@nestjs/core";
import { ozelRolIstegiKapali, paketApiYoluKapali, type EbelgeUygulamaKodu, type Rol } from "@tekirextra/shared";
import { AbonelikErisimService } from "../../core/abonelik-erisim.service";
import { SALT_OKUMA_ANAHTAR } from "../../auth/public.decorator";
import { ROLLER_ANAHTAR } from "../../auth/roller.decorator";
import { rolUcaYetkili } from "../../auth/roller.guard";
import { aktifBaglam, baglamAl } from "../../core/istek-baglami";
import { PrismaService } from "../../core/prisma.service";
import { EbelgeUygulamalariService } from "../../ebelge/ebelge-uygulamalari.service";
import { ebelgeUygulamasiDenetle } from "../../ebelge/ebelge-uygulamasi.guard";
import { EBELGE_UYGULAMASI_ANAHTAR } from "../../ebelge/ebelge-uygulamasi.decorator";
import { PersonelErisimGuard } from "../../personel/personel-erisim.guard";

/**
 * AI-87: HTTP isteği okumadan, yalnız istek bağlamıyla karar veren korumalar
 * araç çağrısında da çalışır. Listede olmayan korumalı uç araçtan çağrılamaz;
 * yeni bir koruma sessizce atlanmasın diye reddedilir.
 */
const ARACTA_CALISAN_KORUMALAR = new Set<unknown>([PersonelErisimGuard]);

/** Bir aracın dayandığı ekran ucu: denetleyici sınıfı + metot adı. */
export interface UcTanimi {
  denetleyici: Type<object>;
  yontem: string;
  /** Denetim kaydında görünen uç, ör. `POST /belgeler/:id/onayla`. */
  yol: string;
}

export interface CagriIzi {
  kaynak: "asistan" | "mcp" | "otomasyon";
  arac: string;
  talepId?: string;
  varlikId?: string | null;
}

/**
 * AI-02/AI-07: araçlar servisleri değil ekranın denetleyici metotlarını
 * çağırır; girdi doğrulaması, abonelik limiti ve iş kuralları böylece ekranla
 * birebir aynıdır. HTTP guard'ları devrede olmadığı için ucun `@Roller` ve
 * e-Belge uygulaması bilgisi burada aynı fonksiyonlarla denetlenir.
 * Yazan çağrılar denetim kaydına araç ve kaynakla yazılır.
 */
@Injectable()
export class UcCagirici {
  private readonly logger = new Logger(UcCagirici.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Optional() private readonly erisim?: AbonelikErisimService,
  ) {}

  private handler(uc: UcTanimi): (...argumanlar: unknown[]) => Promise<unknown> {
    const fn = (uc.denetleyici.prototype as Record<string, unknown>)[uc.yontem];
    if (typeof fn !== "function") throw new Error(`${uc.denetleyici.name}.${uc.yontem} bulunamadı`);
    return fn as (...argumanlar: unknown[]) => Promise<unknown>;
  }

  /** Rol bu uca ekranda erişebiliyor mu (araç listesini süzmek için). */
  yetkiliMi(uc: UcTanimi, rol: Rol): boolean {
    const gerekli = this.reflector.getAllAndOverride<Rol[] | undefined>(ROLLER_ANAHTAR, [this.handler(uc), uc.denetleyici]);
    if (!rolUcaYetkili(rol, gerekli)) return false;
    const [yontem, yol] = uc.yol.split(" ");
    if (paketApiYoluKapali(baglamAl()?.paketModulleri, yol ?? "")) return false;
    // KLN-20: özel rolün kapattığı kutuya düşen araç modele sunulmaz, çağrılamaz (ekranla aynı matris).
    const kapali = baglamAl()?.ozelRol?.kapali ?? [];
    if (!kapali.length) return true;
    const saltOkuma = Boolean(this.reflector.getAllAndOverride<boolean>(SALT_OKUMA_ANAHTAR, [this.handler(uc), uc.denetleyici]));
    return !ozelRolIstegiKapali(kapali, yontem, yol ?? "", saltOkuma);
  }

  private readonly korumalar = new Map<unknown, Promise<CanActivate>>();

  private async korumalariCalistir(uc: UcTanimi, handler: object): Promise<void> {
    const siniflar = [...(this.reflector.get<unknown[]>(GUARDS_METADATA, uc.denetleyici) ?? []), ...(this.reflector.get<unknown[]>(GUARDS_METADATA, handler as never) ?? [])];
    for (const sinif of siniflar) {
      if (!ARACTA_CALISAN_KORUMALAR.has(sinif)) throw new ForbiddenException(`${uc.yol} asistan aracından çağrılamaz`);
      if (!this.korumalar.has(sinif)) this.korumalar.set(sinif, this.moduleRef.create(sinif as Type<CanActivate>));
      const koruma = await this.korumalar.get(sinif)!;
      if (!(await koruma.canActivate(undefined as never))) throw new ForbiddenException("Bu işlem için yetkiniz yok");
    }
  }

  async cagir<T = unknown>(uc: UcTanimi, argumanlar: unknown[], iz?: CagriIzi): Promise<T> {
    const baglam = aktifBaglam();
    const handler = this.handler(uc);
    if (!this.yetkiliMi(uc, baglam.rol)) throw new ForbiddenException("Bu işlem için yetkiniz yok");
    if (this.erisim && await this.erisim.apiYoluKapali(baglam.tenantId, uc.yol.split(" ")[1] ?? "")) throw new ForbiddenException("Bu modül abonelik paketinizde kapalı.");

    const ebelge = this.reflector.getAllAndOverride<EbelgeUygulamaKodu[] | undefined>(EBELGE_UYGULAMASI_ANAHTAR, [handler, uc.denetleyici]);
    if (ebelge?.length) {
      await ebelgeUygulamasiDenetle(ebelge, this.moduleRef.get(EbelgeUygulamalariService, { strict: false }));
    }

    await this.korumalariCalistir(uc, handler);

    const denetleyici = this.moduleRef.get(uc.denetleyici, { strict: false }) as Record<string, unknown>;
    const sonuc = (await handler.apply(denetleyici, argumanlar)) as T;

    if (iz && !uc.yol.startsWith("GET ")) {
      await this.prisma
        .tenantIslem(baglam.tenantId, (tx) =>
          tx.auditLog.create({
            data: {
              tenantId: baglam.tenantId,
              userId: baglam.userId,
              islem: `AI ${uc.yol}`,
              varlik: uc.yol.split(" ")[1]?.split("/")[1] ?? "",
              varlikId: iz.varlikId ?? null,
              detay: { kaynak: iz.kaynak, arac: iz.arac, ...(iz.talepId ? { talepId: iz.talepId } : {}) },
            },
          }),
        )
        .catch((hata: unknown) => this.logger.error(`Denetim izi yazılamadı: ${String(hata)}`));
    }
    return sonuc;
  }
}
