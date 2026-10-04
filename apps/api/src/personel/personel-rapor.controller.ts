import { PersonelErisimGuard } from "./personel-erisim.guard";
import { BadRequestException, Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { Roller } from "../auth/roller.decorator";
import { PersonelRaporService } from "./personel-rapor.service";
import { bordroListeFiltreSemasi } from "./personel.semalar";

@Controller("personel/raporlar")
@Roller("muhasebe", "ik")
@UseGuards(PersonelErisimGuard)
export class PersonelRaporController {
  constructor(private readonly service: PersonelRaporService) {}
  @Get("ozet") ozet() { return this.service.ozet(); }
  @Get("maliyet") maliyetRaporu(@Query("yil") yil:string,@Query("ay") ay:string){const f=bordroListeFiltreSemasi.parse({yil,ay});if(!f.yil||!f.ay)throw new BadRequestException("Yıl ve ay zorunludur");return this.service.maliyetRaporu(f.yil,f.ay);}
  @Get("maliyet.xlsx") async maliyet(@Query("yil") yil:string,@Query("ay") ay:string,@Query("departman") departman:string|undefined,@Res() res:Response){const f=bordroListeFiltreSemasi.parse({yil,ay});if(!f.yil||!f.ay)throw new BadRequestException("Yıl ve ay zorunludur");const filtre=departman?.trim().slice(0,250)||undefined;const buffer=await this.service.maliyetExcel(f.yil,f.ay,filtre);res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");res.setHeader("Content-Disposition",`attachment; filename="personel-maliyet-${f.yil}-${String(f.ay).padStart(2,"0")}.xlsx"`);res.send(buffer);}
}
