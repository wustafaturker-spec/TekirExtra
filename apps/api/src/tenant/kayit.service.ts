import { ConflictException, Injectable } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { tenantKayitSemasi } from "@tekirextra/shared";
import { z } from "zod";
import { PrismaService } from "../core/prisma.service";
import { EpostaService } from "./eposta.service";

/** Kayıt girdisi: paylaşılan onboarding şeması + parola politikası (KLN-01). */
export const kayitSemasi = tenantKayitSemasi.extend({
  parola: z
    .string()
    .min(10, "Parola en az 10 karakter olmalıdır")
    .regex(/[a-zA-Z]/, "Parola harf içermelidir")
    .regex(/\d/, "Parola rakam içermelidir"),
});
export type KayitGirdisi = z.infer<typeof kayitSemasi>;

const DOGRULAMA_GECERLILIK_SAAT = 24;

/** Self-servis firma kaydı — KLN-07. */
@Injectable()
export class KayitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eposta: EpostaService,
  ) {}

  async kaydet(girdi: KayitGirdisi): Promise<{ tenantId: string }> {
    const mevcut = await this.prisma.authKimlik.findUnique({
      where: { eposta: girdi.yoneticiEposta },
    });
    if (mevcut) {
      throw new ConflictException("Bu e-posta ile kayıtlı bir hesap zaten var");
    }
    const tenantId = randomUUID();
    const userId = randomUUID();
    const parolaHash = await argon2.hash(girdi.parola);

    // Firma + ilk yönetici: RLS bağlamı yeni tenant kimliğiyle kurulur;
    // WITH CHECK politikası yalnızca bu kiracıya yazmaya izin verir.
    // VKN tekilliği tenants.vkn @unique ile DB'de zorlanır.
    await this.prisma.tenantIslem(tenantId, async (tx) => {
      await tx.tenant.create({
        data: {
          id: tenantId,
          unvan: girdi.unvan,
          vkn: girdi.vkn,
          vergiDairesi: girdi.vergiDairesi,
        },
      });
      await tx.user.create({
        data: {
          id: userId,
          tenantId,
          eposta: girdi.yoneticiEposta,
          parolaHash,
          adSoyad: girdi.yoneticiAdSoyad,
          rol: "yonetici",
          epostaDogrulandi: true,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          islem: "firma_kaydi",
          varlik: "tenant",
          varlikId: tenantId,
        },
      });
    });
    await this.prisma.authKimlik.create({
      data: { eposta: girdi.yoneticiEposta, tenantId, userId },
    });

    await this.dogrulamaOlusturVeGonder(tenantId, userId, girdi.yoneticiEposta, girdi.yoneticiAdSoyad);
    return { tenantId };
  }

  private async dogrulamaOlusturVeGonder(
    tenantId: string,
    userId: string,
    eposta: string,
    adSoyad: string,
  ): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.epostaDogrulama.create({
      data: {
        tenantId,
        userId,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        gecerlilikSonu: new Date(
          Date.now() + DOGRULAMA_GECERLILIK_SAAT * 60 * 60 * 1000,
        ),
      },
    });
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    await this.eposta.dogrulamaGonder(
      eposta,
      adSoyad,
      `${appUrl}/dogrula?token=${token}`,
    );
  }
}
