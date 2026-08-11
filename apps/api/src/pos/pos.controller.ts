import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post } from "@nestjs/common";
import { Roller } from "../auth/roller.decorator"; import { Public } from "../auth/public.decorator";
import { posTahsilatBaslatSemasi } from "./pos.semalar"; import { PosService } from "./pos.service";
@Controller("pos") export class PosController { constructor(private readonly service: PosService) {}
  @Get("tahsilatlar") @Roller("yonetici", "muhasebe") listele() { return this.service.listele(); }
  @Post("tahsilatlar") @Roller("yonetici", "muhasebe") baslat(@Body() govde: unknown) { const s = posTahsilatBaslatSemasi.safeParse(govde); if (!s.success) throw new BadRequestException(s.error.issues.map((i) => `${i.path.join(".") || "alan"}: ${i.message}`).join("; ")); return this.service.baslat(s.data); }
  @Post("tahsilatlar/:id/eposta") @Roller("yonetici", "muhasebe") epostaYenidenGonder(@Param("id") id: string) { return this.service.epostaYenidenGonder(id); }
  @Post("tahsilatlar/:id/sms") @Roller("yonetici", "muhasebe") smsYenidenGonder(@Param("id") id: string) { return this.service.smsYenidenGonder(id); }
  @Post("iyzico/callback/:tenantId/:tahsilatId") @Public() callback(@Param("tenantId") tenantId: string, @Param("tahsilatId") tahsilatId: string, @Body() govde: unknown) { const token = typeof (govde as any)?.token === "string" ? (govde as any).token : ""; if (!token) throw new BadRequestException("Callback tokenı eksik"); return this.service.callback(tenantId, tahsilatId, token); }
  @Post("paytr/callback/:tenantId/:tahsilatId") @Public() @HttpCode(200) @Header("Content-Type", "text/plain") paytrCallback(@Param("tenantId") tenantId: string, @Param("tahsilatId") tahsilatId: string, @Body() govde: any) { return this.service.paytrCallback(tenantId, tahsilatId, govde); }
}
