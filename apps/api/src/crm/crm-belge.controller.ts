import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator";
import { CrmBelgeService } from "./crm-belge.service";
@Controller("crm/firsatlar/:firsatId/belgeler")
export class CrmBelgeController {
 constructor(private readonly service: CrmBelgeService) {}
 @Get() @Roller("yonetici", "satis", "muhasebe")
 listele(@Param("firsatId") id: string) { return this.service.listele(id); }
 @Get("faturalar/:faturaId/kapama-paylari") @Roller("yonetici","satis","muhasebe")
 kapamaPaylari(@Param("firsatId") id:string,@Param("faturaId") faturaId:string){return this.service.kapamaPaylari(id,faturaId);}
 @Post("faturalar/:faturaId/kapama-paylari") @Roller("yonetici","muhasebe")
 kapamaPayiYaz(@Param("firsatId") id:string,@Param("faturaId") faturaId:string,@Body() body:unknown){return this.service.kapamaPayiYaz(id,faturaId,body);}
 @Get("adaylar") @Roller("yonetici", "satis")
 adaylar(@Param("firsatId") id: string, @Query() query: unknown) { return this.service.adaylar(id,query); }
 @Post("teklif") @Roller("yonetici", "satis")
 teklifOlustur(@Param("firsatId") id: string, @Body() body: unknown) { return this.service.teklifOlustur(id,body); }
 @Post() @Roller("yonetici", "satis")
 bagla(@Param("firsatId") id: string, @Body() body: unknown) { return this.service.bagla(id,body); }
 @Post(":bagId/coz") @Roller("yonetici", "satis")
 coz(@Param("firsatId") id: string, @Param("bagId") bagId: string, @Body() body: unknown) { return this.service.coz(id,bagId,body); }
}
