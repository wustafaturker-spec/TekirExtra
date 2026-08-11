import { BadRequestException, Body, Controller, Headers, Param, Post, UnauthorizedException } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../core/prisma.service";
import { coz } from "../core/kripto";
import { EkstreService } from "./ekstre.service";
import { anahtarEslesir, bankaWebhookSemasi } from "./banka-webhook.semalar";
import { z } from "zod";

@Controller("banka-webhook")
export class BankaWebhookController {
  constructor(private readonly prisma: PrismaService, private readonly ekstre: EkstreService) {}

  @Post(":tenantId/:baglantiId")
  @Public()
  async hareketleriAl(@Param("tenantId") tenantId: string, @Param("baglantiId") baglantiId: string, @Headers("authorization") yetki: string | undefined, @Body() govde: unknown) {
    if (!z.uuid().safeParse(tenantId).success || !z.uuid().safeParse(baglantiId).success) throw new UnauthorizedException("Geçersiz banka bağlantısı");
    const baglanti = await this.prisma.tenantIslem(tenantId, (tx) => tx.baglanti.findFirst({ where: { id: baglantiId, aile: "banka", saglayici: "webhook", durum: "aktif" } }));
    if (!baglanti) throw new UnauthorizedException("Aktif banka bağlantısı bulunamadı");
    const config = JSON.parse(coz(baglanti.sifreliConfig)) as { apiAnahtari?: string; bankaHesapId?: string };
    const verilen = yetki?.startsWith("Bearer ") ? yetki.slice(7) : "";
    if (!config.apiAnahtari || !verilen || !anahtarEslesir(config.apiAnahtari, verilen)) throw new UnauthorizedException("Geçersiz banka bağlantısı anahtarı");
    const sonuc = bankaWebhookSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((i) => i.message).join("; "));
    if (!config.bankaHesapId) throw new BadRequestException("Bağlantıya banka hesabı atanmamış");
    return this.ekstre.webhookHareketleriniAl(tenantId, config.bankaHesapId, baglantiId, sonuc.data.hareketler);
  }
}
