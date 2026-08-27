import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ProjelerService } from "./projeler.service";
import {
  projeAltKirilimSemasi,
  projeAsamaSemasi,
  projeGuncelleSemasi,
  projeNotSemasi,
  projeOlusturSemasi,
} from "./projeler.semalar";

@Controller("projeler")
export class ProjelerController {
  constructor(private readonly projelerService: ProjelerService) {}

  @Get()
  async listele(
    @Query("arama") arama?: string,
    @Query("durum") durum?: string,
  ) {
    return this.projelerService.listele(arama, durum);
  }

  @Get(":id")
  async getir(@Param("id") id: string) {
    return this.projelerService.getir(id);
  }

  @Post()
  async olustur(@Body() govde: unknown) {
    const girdi = projeOlusturSemasi.parse(govde);
    return this.projelerService.olustur(girdi);
  }

  @Patch(":id")
  async guncelle(
    @Param("id") id: string,
    @Body() govde: unknown,
  ) {
    const girdi = projeGuncelleSemasi.parse(govde);
    return this.projelerService.guncelle(id, girdi);
  }

  @Delete(":id")
  async sil(@Param("id") id: string) {
    await this.projelerService.sil(id);
    return { mesaj: "Proje başarıyla silindi" };
  }

  // Aşamalar
  @Post(":id/asamalar")
  async asamaEkle(
    @Param("id") id: string,
    @Body() govde: unknown,
  ) {
    const girdi = projeAsamaSemasi.parse(govde);
    return this.projelerService.asamaEkle(id, girdi);
  }

  @Patch(":id/asamalar/:asamaId")
  async asamaGuncelle(
    @Param("id") id: string,
    @Param("asamaId") asamaId: string,
    @Body() govde: unknown,
  ) {
    const girdi = projeAsamaSemasi.parse(govde);
    return this.projelerService.asamaGuncelle(id, asamaId, girdi);
  }

  @Delete(":id/asamalar/:asamaId")
  async asamaSil(
    @Param("id") id: string,
    @Param("asamaId") asamaId: string,
  ) {
    await this.projelerService.asamaSil(id, asamaId);
    return { mesaj: "Aşama silindi" };
  }

  // Alt Kırılımlar (Analitik Yevmiye)
  @Post(":id/alt-kirilimlar")
  async altKirilimEkle(
    @Param("id") id: string,
    @Body() govde: unknown,
  ) {
    const girdi = projeAltKirilimSemasi.parse(govde);
    return this.projelerService.altKirilimEkle(id, girdi);
  }

  @Delete(":id/alt-kirilimlar/:kirilimId")
  async altKirilimSil(
    @Param("id") id: string,
    @Param("kirilimId") kirilimId: string,
  ) {
    await this.projelerService.altKirilimSil(id, kirilimId);
    return { mesaj: "Analitik alt kırılım silindi" };
  }

  // Notlar
  @Post(":id/notlar")
  async notEkle(
    @Param("id") id: string,
    @Body() govde: unknown,
  ) {
    const girdi = projeNotSemasi.parse(govde);
    return this.projelerService.notEkle(id, girdi);
  }
}
