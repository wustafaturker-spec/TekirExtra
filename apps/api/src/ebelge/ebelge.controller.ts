import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { GelenEbelgeDurum } from "@prisma/client";
import { Roller } from "../auth/roller.decorator";
import { EbelgeService } from "./ebelge.service";
import { earsivIptalSemasi, earsivRaporAralikSemasi, gelenOnaySemasi, gelenYanitSemasi } from "./ebelge.semalar";

const GELEN_DURUMLARI: GelenEbelgeDurum[] = ["beklemede", "islendi", "reddedildi"];

@Controller("ebelge")
export class EbelgeController {
  constructor(private readonly ebelgeService: EbelgeService) {}

  @Post("gonder/:faturaId")
  @Roller("muhasebe")
  async gonder(@Param("faturaId") faturaId: string) {
    return this.ebelgeService.gonder(faturaId);
  }

  @Post("sorgula/:faturaId")
  @Roller("muhasebe")
  async sorgula(@Param("faturaId") faturaId: string) {
    return this.ebelgeService.durumSorgula(faturaId);
  }

  @Post("earsiv/:faturaId/iptal-bildir")
  @Roller("muhasebe")
  async earsivIptal(@Param("faturaId") faturaId: string, @Body() govde: unknown) {
    const sonuc = earsivIptalSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.ebelgeService.earsivIptalBildir(faturaId, sonuc.data);
  }

  @Get("earsiv/raporlar")
  @Roller("muhasebe")
  async earsivRaporlar(@Query("baslangic") baslangic: string, @Query("bitis") bitis: string) {
    const sonuc = earsivRaporAralikSemasi.safeParse({ baslangic, bitis });
    if (!sonuc.success) throw new BadRequestException(sonuc.error.issues.map((s) => s.message).join("; "));
    return this.ebelgeService.earsivRaporListele(sonuc.data.baslangic, sonuc.data.bitis);
  }

  @Get("earsiv/raporlar/:uuid/durum")
  @Roller("muhasebe")
  async earsivRaporDurum(@Param("uuid") uuid: string) {
    return this.ebelgeService.earsivRaporDurum(uuid);
  }

  // ─── GELEN KUTUSU (EBLG-05/06) ─────────────────────────────────────────────

  @Post("gelenleri-cek")
  @Roller("muhasebe")
  async gelenleriCek() {
    return this.ebelgeService.gelenBelgeleriCek();
  }

  @Get("gelen")
  async gelenListele(@Query("durum") durum?: string) {
    if (durum && !GELEN_DURUMLARI.includes(durum as GelenEbelgeDurum)) {
      throw new BadRequestException(
        `Geçersiz durum; beklenen: ${GELEN_DURUMLARI.join(", ")}`,
      );
    }
    return this.ebelgeService.gelenListele(durum as GelenEbelgeDurum | undefined);
  }

  @Get("gelen/:id")
  async gelenGetir(@Param("id") id: string) {
    return this.ebelgeService.gelenGetir(id);
  }

  @Post("gelen/:id/onayla")
  @Roller("muhasebe")
  async gelenOnayla(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = gelenOnaySemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.ebelgeService.gelenOnayla(id, ayristirma.data);
  }

  @Post("gelen/:id/yanit")
  @Roller("muhasebe")
  async gelenYanit(@Param("id") id: string, @Body() govde: unknown) {
    const ayristirma = gelenYanitSemasi.safeParse(govde);
    if (!ayristirma.success) {
      throw new BadRequestException(
        ayristirma.error.issues.map((s) => s.message).join("; "),
      );
    }
    return this.ebelgeService.gelenYanitGonder(id, ayristirma.data);
  }
}
