import { Controller, Get, Query } from '@nestjs/common';
import { Roller } from '../auth/roller.decorator';
import { IhtiyacService } from './ihtiyac.service';
@Controller('stok/ihtiyac-plani')
export class IhtiyacController{
 constructor(private readonly service:IhtiyacService){}
 @Get('onizle') @Roller('yonetici','muhasebe','depo')
 onizle(@Query() body:unknown){return this.service.onizle(body);}
}
