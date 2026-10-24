import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Roller } from '../auth/roller.decorator';
import { IhtiyacService } from './ihtiyac.service';
import { SiparisGirisTarihiService } from './siparis-giris-tarihi.service';
import { IhtiyacUretimTalebiService } from './ihtiyac-uretim-talebi.service';
import { IhtiyacPlanService } from './ihtiyac-plan.service';
@Controller('stok/ihtiyac-plani')
export class IhtiyacController{
 constructor(@Inject(IhtiyacService) private readonly service:IhtiyacService,@Inject(SiparisGirisTarihiService) private readonly giris:SiparisGirisTarihiService,@Inject(IhtiyacUretimTalebiService) private readonly uretim:IhtiyacUretimTalebiService,@Inject(IhtiyacPlanService) private readonly plan:IhtiyacPlanService){}
 @Post('pilot-onizle') @HttpCode(200) @Header('Cache-Control','no-store') @Roller('yonetici','muhasebe','depo')
 pilotOnizle(@Body() body:unknown){return this.service.pilotOnizle(body);}
 @Get('uretim-talepleri/:kalemId') @Header('Cache-Control','no-store') @Roller('yonetici','muhasebe','depo')
 uretimTalebiOku(@Param('kalemId',ParseUUIDPipe) id:string){return this.uretim.oku(id);}
 @Put('uretim-talepleri/:kalemId') @Roller('yonetici','muhasebe','depo')
 uretimTalebiKaydet(@Param('kalemId',ParseUUIDPipe) id:string,@Body() body:unknown){return this.uretim.kaydet(id,body);}
 @Post('planlar') @Roller('yonetici','muhasebe','depo')
 planKaydet(@Body() body:unknown){return this.plan.kaydet(body);}
 @Get('planlar') @Header('Cache-Control','no-store') @Roller('yonetici','muhasebe','depo')
 planListele(@Query() sorgu:unknown){return this.plan.listele(sorgu);}
 @Get('planlar/:id') @Header('Cache-Control','no-store') @Roller('yonetici','muhasebe','depo')
 planOku(@Param('id',ParseUUIDPipe) id:string){return this.plan.oku(id);}
 @Get('tarihli-onizle') @Header('Cache-Control','no-store') @Roller('yonetici','muhasebe','depo')
 tarihliOnizle(@Query() body:unknown){return this.service.onizle(body,true);}
 @Get('giris-tarihleri/:satirId') @Header('Cache-Control','no-store') @Roller('yonetici','muhasebe','depo')
 girisTarihiOku(@Param('satirId',ParseUUIDPipe) id:string){return this.giris.oku(id);}
 @Put('giris-tarihleri/:satirId') @Roller('yonetici','muhasebe')
 girisTarihiKaydet(@Param('satirId',ParseUUIDPipe) id:string,@Body() body:unknown){return this.giris.kaydet(id,body);}
 @Get('onizle') @Roller('yonetici','muhasebe','depo')
 onizle(@Query() body:unknown){return this.service.onizle(body);}
}
