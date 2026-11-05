import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { tenantKayitSemasi } from "@tekirextra/shared";
import { z } from "zod";
import { parolaSemasi } from "../auth/parola-kurali";
import { PrismaService } from "../core/prisma.service";
import { EpostaService } from "./eposta.service";

/** Kayıt girdisi: paylaşılan onboarding şeması + parola politikası (KLN-01). */
export const kayitSemasi = tenantKayitSemasi.extend({
  parola: parolaSemasi,
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

  async acikSatisPaketleri() {
    return this.prisma.$queryRaw<{ surumId: string; planKodu: string; kosullar: unknown; paketAdi: string; denemeGunSayisi: number }[]>`
      SELECT p.surum_id AS "surumId",p.plan_kodu AS "planKodu",p.kosullar,p.paket_adi AS "paketAdi",d.gun_sayisi AS "denemeGunSayisi"
      FROM abonelik_acik_satis_bagi() p JOIN abonelik_acik_satis_deneme_gunleri() d USING (surum_id)
      ORDER BY p.paket_adi,p.surum_id`;
  }

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
    const secilebilirler = await this.acikSatisPaketleri();
    const secilenPaket = girdi.paketSurumId
      ? secilebilirler.find((p) => p.surumId === girdi.paketSurumId)
      : undefined;
    if (girdi.paketSurumId && !secilenPaket) {
      throw new ConflictException("Seçtiğiniz paket satıştan kalkmış. Sayfayı yenileyip tekrar deneyin.");
    }

    // Firma + ilk yönetici: RLS bağlamı yeni tenant kimliğiyle kurulur;
    // WITH CHECK politikası yalnızca bu kiracıya yazmaya izin verir.
    // VKN tekilliği tenants.vkn @unique ile DB'de zorlanır; ön sorgu RLS
    // bağlamında başka firmayı göremeyeceği için ihlal yakalanır.
    try {
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
        const simdi = new Date();
        const denemeBitisi = secilenPaket && secilenPaket.denemeGunSayisi > 0
          ? new Date(simdi.getTime() + secilenPaket.denemeGunSayisi * 86_400_000) : null;
        await tx.tenantAbonelik.create({
          data: {
            tenantId,
            planKodu: secilenPaket?.planKodu ?? "v1",
            ...(secilenPaket ? {
              paketSurumId: secilenPaket.surumId,
              paketKosullari: secilenPaket.kosullar as Prisma.InputJsonValue,
            } : {}),
            durum: denemeBitisi ? "deneme" : "aktif",
            ...(denemeBitisi ? { donemBaslangici: simdi, donemSonu: denemeBitisi } : {}),
            faturaEpostasi: girdi.yoneticiEposta,
            faturalandirmaUnvani: girdi.unvan,
          },
        });
        // STK-07: her firmada en az bir depo bulunur. Tek depolu firmalarda
        // arayüz depo seçimi göstermez; stok akışları bu varsayılana yazar.
        await tx.depo.create({
          data: {
            tenantId,
            kod: "MERKEZ",
            ad: "Merkez Depo",
            varsayilan: true,
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
    } catch (hata) {
      if (hata instanceof Prisma.PrismaClientKnownRequestError && hata.code === "P2002") {
        throw new ConflictException("Bu VKN/TCKN ile kayıtlı bir firma zaten var");
      }
      throw hata;
    }
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
