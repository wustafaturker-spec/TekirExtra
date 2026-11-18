import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { aktifBaglam } from "../../core/istek-baglami";
import { Roller } from "../../auth/roller.decorator";
import { BelgeKuyrukService } from "./belge-kuyruk.service";
import {
  belgeAktarSemasi,
  kullaniciDuzeltmeSemasi,
} from "./belge-kuyruk.semalar";

interface YuklenenDosya {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}

@Controller("ai/belge-kuyruk")
@Roller("muhasebe")
export class BelgeKuyrukController {
  constructor(private readonly service: BelgeKuyrukService) {}

  /**
   * P-09: Çoklu fiş/fatura yükler ve OCR kuyruğuna ekler.
   * Azami 20 dosya, dosya başı azami 15 MB.
   */
  @Post("yukle")
  @UseInterceptors(
    FilesInterceptor("dosyalar", 20, {
      limits: { fileSize: 15 * 1024 * 1024, files: 20 },
    }),
  )
  async yukle(
    @UploadedFiles() dosyalar: YuklenenDosya[] | undefined,
  ) {
    if (!dosyalar || dosyalar.length === 0) {
      throw new BadRequestException("En az bir dosya ('dosyalar' alanında) yüklemelisiniz.");
    }
    const { tenantId, userId, rol } = aktifBaglam();
    return this.service.kuyrugaEkle(
      tenantId,
      userId,
      rol,
      dosyalar.map((d) => ({ ad: d.originalname, buffer: d.buffer })),
    );
  }

  /**
   * Kuyruk işlerini sayfalanmış olarak listeler.
   */
  @Get("isler")
  async isleriListele(
    @Query("sayfa") sayfaStr?: string,
    @Query("limit") limitStr?: string,
  ) {
    const { tenantId } = aktifBaglam();
    const sayfa = Math.max(1, parseInt(sayfaStr || "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(limitStr || "20", 10) || 20));
    return this.service.isleriListele(tenantId, sayfa, limit);
  }

  /**
   * Tek bir kuyruk işinin belgelerini ve özet durumunu getirir.
   */
  @Get("isler/:id")
  async isDetay(@Param("id", ParseUUIDPipe) id: string) {
    const { tenantId } = aktifBaglam();
    return this.service.isDetay(tenantId, id);
  }

  /**
   * Tek bir taranan belgenin ayrıntısını ve alan kanıtlarını getirir.
   */
  @Get("belgeler/:id")
  async belgeDetay(@Param("id", ParseUUIDPipe) id: string) {
    const { tenantId } = aktifBaglam();
    return this.service.belgeDetay(tenantId, id);
  }

  /**
   * Belge üzerindeki alanlar için kullanıcı düzeltmesini kaydeder.
   * Orijinal çıkarım korunur; çelişkiler çözülmüşse durum ONAYLANDI olur.
   */
  @Patch("belgeler/:id/duzelt")
  async belgeDuzelt(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { tenantId } = aktifBaglam();
    const duzeltme = kullaniciDuzeltmeSemasi.parse(body);
    return this.service.belgeDuzelt(tenantId, id, duzeltme);
  }

  /**
   * Onaylanmış belgeyi Masraf veya Alış Faturası taslağına aktarır.
   * P-09: Çelişkiler çözülmeden aktarım engellenir.
   */
  @Post("belgeler/:id/aktar")
  async belgeAktar(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { tenantId, userId } = aktifBaglam();
    const girdi = belgeAktarSemasi.parse(body);
    return this.service.belgeAktar(tenantId, userId, id, girdi);
  }

  /**
   * Belgeyi reddeder.
   */
  @Post("belgeler/:id/reddet")
  async belgeReddet(@Param("id", ParseUUIDPipe) id: string) {
    const { tenantId } = aktifBaglam();
    return this.service.belgeReddet(tenantId, id);
  }
}
