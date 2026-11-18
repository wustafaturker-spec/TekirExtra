import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { Roller } from "../../auth/roller.decorator";
import { aktifBaglam } from "../../core/istek-baglami";
import {
  SOZLESME_DURUMLARI,
  SOZLESME_TURLERI,
  type SozlesmeDurumu,
  type SozlesmeTuru,
} from "./sozlesme.kurallari";
import { SozlesmeService } from "./sozlesme.service";

const yukleSemasi = z.object({
  baslik: z.string().trim().min(2, "Başlık en az 2 karakter olmalıdır").max(200),
  tur: z.enum(SOZLESME_TURLERI as unknown as [string, ...string[]]).optional(),
  cariId: z.string().uuid("Geçerli bir cari seçilmelidir").optional().nullable(),
  yetkiliRoller: z.array(z.string()).optional(),
  gecerlilikBitis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD formatında olmalıdır").optional(),
  dosyaBase64: z.string().min(10, "Dosya içeriği gereklidir"),
  dosyaAdi: z.string().min(1, "Dosya adı gereklidir").max(255),
  mimeTip: z.string().min(1, "MIME tipi gereklidir").max(100),
});

const yeniSurumSemasi = z.object({
  baslik: z.string().trim().min(2).max(200).optional(),
  tur: z.enum(SOZLESME_TURLERI as unknown as [string, ...string[]]).optional(),
  cariId: z.string().uuid().optional().nullable(),
  yetkiliRoller: z.array(z.string()).optional(),
  gecerlilikBitis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dosyaBase64: z.string().min(10),
  dosyaAdi: z.string().min(1).max(255),
  mimeTip: z.string().min(1).max(100),
});

const araSemasi = z.object({
  sorgu: z.string().trim().min(2, "Arama sorgusu en az 2 karakter olmalıdır"),
  belgeId: z.string().uuid().optional(),
  cariId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

const sorSemasi = z.object({
  soru: z.string().trim().min(3, "Soru en az 3 karakter olmalıdır"),
  belgeId: z.string().uuid().optional(),
  cariId: z.string().uuid().optional(),
});

const listeSemasi = z.object({
  tur: z.enum(SOZLESME_TURLERI as unknown as [string, ...string[]]).optional(),
  durum: z.enum(SOZLESME_DURUMLARI as unknown as [string, ...string[]]).optional(),
  cariId: z.string().uuid().optional(),
  arama: z.string().trim().optional(),
});

const coz = <T>(sema: z.ZodType<T>, girdi: unknown): T => {
  const s = sema.safeParse(girdi ?? {});
  if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; "));
  return s.data;
};

/**
 * P-10: Sürümlü ve yetkili sözleşme / şartname RAG kontrolcüsü.
 */
@Controller("ai/sozlesme")
@Roller("yonetici", "muhasebe", "satis")
export class SozlesmeController {
  constructor(private readonly sozlesme: SozlesmeService) {}

  @Post("yukle")
  async yukle(@Body() govde: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const veri = coz(yukleSemasi, govde);
    const buffer = Buffer.from(veri.dosyaBase64, "base64");

    return this.sozlesme.yukle(
      tenantId,
      userId,
      {
        buffer,
        dosyaAdi: veri.dosyaAdi,
        mimeTip: veri.mimeTip,
      },
      {
        baslik: veri.baslik,
        tur: veri.tur as SozlesmeTuru | undefined,
        cariId: veri.cariId ?? undefined,
        yetkiliRoller: veri.yetkiliRoller,
        gecerlilikBitis: veri.gecerlilikBitis,
      },
    );
  }

  @Get()
  liste(@Query() sorgu: Record<string, string>) {
    const { tenantId, rol } = aktifBaglam();
    const filtre = coz(listeSemasi, sorgu);
    return this.sozlesme.listele(tenantId, rol, {
      tur: filtre.tur as SozlesmeTuru | undefined,
      durum: filtre.durum as SozlesmeDurumu | undefined,
      cariId: filtre.cariId,
      arama: filtre.arama,
    });
  }

  @Get(":id")
  detay(@Param("id", ParseUUIDPipe) id: string) {
    const { tenantId, rol } = aktifBaglam();
    return this.sozlesme.detay(tenantId, id, rol);
  }

  @Post("ara")
  ara(@Body() govde: unknown) {
    const { tenantId, rol } = aktifBaglam();
    const { sorgu, belgeId, cariId, limit } = coz(araSemasi, govde);
    return this.sozlesme.ara(tenantId, rol, sorgu, { belgeId, cariId, limit });
  }

  @Post("sor")
  sor(@Body() govde: unknown) {
    const { tenantId, userId, rol } = aktifBaglam();
    const { soru, belgeId, cariId } = coz(sorSemasi, govde);
    return this.sozlesme.sor(tenantId, userId, rol, soru, { belgeId, cariId });
  }

  @Post(":id/yeni-surum")
  async yeniSurum(@Param("id", ParseUUIDPipe) id: string, @Body() govde: unknown) {
    const { tenantId, userId } = aktifBaglam();
    const veri = coz(yeniSurumSemasi, govde);
    const buffer = Buffer.from(veri.dosyaBase64, "base64");

    return this.sozlesme.yeniSurum(
      tenantId,
      userId,
      id,
      {
        buffer,
        dosyaAdi: veri.dosyaAdi,
        mimeTip: veri.mimeTip,
      },
      {
        baslik: veri.baslik,
        tur: veri.tur as SozlesmeTuru | undefined,
        cariId: veri.cariId ?? undefined,
        yetkiliRoller: veri.yetkiliRoller,
        gecerlilikBitis: veri.gecerlilikBitis,
      },
    );
  }

  @Delete(":id")
  sil(@Param("id", ParseUUIDPipe) id: string) {
    const { tenantId, rol, userId } = aktifBaglam();
    return this.sozlesme.sil(tenantId, id, rol, userId);
  }
}
