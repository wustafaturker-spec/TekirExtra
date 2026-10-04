import { Body,Controller,Get,Param,Post,Query } from "@nestjs/common"; import { Roller } from "../auth/roller.decorator"; import { aktifBaglam } from "../core/istek-baglami"; import { bordroListeFiltreSemasi } from "./personel.semalar"; import { bordroHesaplamaSemasi, kabulSenaryosuSemasi, mevzuatSetiSemasi } from "./mevzuat.semalar"; import { MevzuatService } from "./mevzuat.service";
@Controller("personel/mevzuat") @Roller("muhasebe") export class MevzuatController{constructor(private readonly service:MevzuatService){}
@Get() listele(){return this.service.listele(aktifBaglam().tenantId)}
@Get("resmi") resmi(){return this.service.resmiListele(aktifBaglam().tenantId)}
@Post("resmi/:kod/yukle") resmiYukle(@Param("kod")kod:string){const c=aktifBaglam();return this.service.resmiYukle(c.tenantId,c.userId,kod)}
@Post() olustur(@Body() body:unknown){const c=aktifBaglam();return this.service.olustur(c.tenantId,c.userId,mevzuatSetiSemasi.parse(body))}
@Post(":id/aktiflestir") aktiflestir(@Param("id")id:string){const c=aktifBaglam();return this.service.aktiflestir(c.tenantId,id,c.userId)}
@Post(":id/arsivle") arsivle(@Param("id")id:string){return this.service.arsivle(aktifBaglam().tenantId,id)}
@Post("hesapla") hesapla(@Body()body:unknown){return this.service.hesapla(aktifBaglam().tenantId,bordroHesaplamaSemasi.parse(body))}
@Get("kabul-senaryolari") senaryolar(@Query("setId")setId?:string){return this.service.senaryolariListele(aktifBaglam().tenantId,setId)}
@Post("kabul-senaryolari") senaryoOlustur(@Body()body:unknown){return this.service.senaryoOlustur(aktifBaglam().tenantId,kabulSenaryosuSemasi.parse(body))}
@Post("kabul-senaryolari/:id/calistir") senaryoCalistir(@Param("id")id:string){const c=aktifBaglam();return this.service.senaryoCalistir(c.tenantId,id,c.userId)}
@Get("doneme-uygun") donemeUygun(@Query("yil")yil?:string,@Query("ay")ay?:string){const f=bordroListeFiltreSemasi.parse({yil,ay});if(!f.yil||!f.ay)return null;return this.service.donemeUygun(aktifBaglam().tenantId,f.yil,f.ay)} }
