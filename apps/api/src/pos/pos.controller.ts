import { BadRequestException, Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator"; import { Public } from "../auth/public.decorator";
import { posTahsilatBaslatSemasi } from "./pos.semalar"; import { PosService } from "./pos.service";
@Controller("pos") export class PosController { constructor(private readonly service: PosService) {}
  @Get("tahsilatlar") @Roller("yonetici", "muhasebe") listele() { return this.service.listele(); }
  @Post("tahsilatlar") @Roller("yonetici", "muhasebe") baslat(@Body() govde: unknown) { const s = posTahsilatBaslatSemasi.safeParse(govde); if (!s.success) throw new BadRequestException(s.error.issues.map((i) => i.message).join("; ")); return this.service.baslat(s.data); }
  @Post("iyzico/callback/:tenantId/:tahsilatId") @Public() callback(@Param("tenantId") tenantId: string, @Param("tahsilatId") tahsilatId: string, @Body() govde: unknown) { const token = typeof (govde as any)?.token === "string" ? (govde as any).token : ""; if (!token) throw new BadRequestException("Callback tokenı eksik"); return this.service.callback(tenantId, tahsilatId, token); }
}
