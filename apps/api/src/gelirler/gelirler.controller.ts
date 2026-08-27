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
import { GelirlerService } from "./gelirler.service";
import {
  gelirKategoriGuncelleSemasi,
  gelirKategoriOlusturSemasi,
  gelirKaydiOlusturSemasi,
} from "./gelirler.semalar";

@Controller("gelirler")
export class GelirlerController {
  constructor(private readonly gelirlerService: GelirlerService) {}

  @Get("kategoriler")
  kategoriListele() {
    return this.gelirlerService.kategoriListele();
  }

  @Post("kategoriler")
  kategoriOlustur(@Body() govde: unknown) {
    const girdi = gelirKategoriOlusturSemasi.parse(govde);
    return this.gelirlerService.kategoriOlustur(girdi);
  }

  @Patch("kategoriler/:id")
  kategoriGuncelle(@Param("id") id: string, @Body() govde: unknown) {
    const girdi = gelirKategoriGuncelleSemasi.parse(govde);
    return this.gelirlerService.kategoriGuncelle(id, girdi);
  }

  @Delete("kategoriler/:id")
  kategoriSil(@Param("id") id: string) {
    return this.gelirlerService.kategoriSil(id);
  }

  @Get()
  listele(
    @Query("baslangic") baslangic?: string,
    @Query("bitis") bitis?: string,
    @Query("kategoriId") kategoriId?: string,
  ) {
    return this.gelirlerService.listele({ baslangic, bitis, kategoriId });
  }

  @Post()
  olustur(@Body() govde: unknown) {
    const girdi = gelirKaydiOlusturSemasi.parse(govde);
    return this.gelirlerService.olustur(girdi);
  }

  @Delete(":id")
  sil(@Param("id") id: string) {
    return this.gelirlerService.sil(id);
  }
}
