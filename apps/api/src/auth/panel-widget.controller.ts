import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Put } from "@nestjs/common";
import { panelWidgetTercihiSemasi, type PanelWidgetTercihi } from "@tekirextra/shared";
import { aktifBaglam } from "../core/istek-baglami";
import { PrismaService } from "../core/prisma.service";
import { SaltOkumadaAcik } from "./public.decorator";

@Controller("panel-widgetlar")
export class PanelWidgetController {
  constructor(private readonly prisma: PrismaService) {}

  private pilotErisiminiDogrula(tenantId: string) {
    const pilotTenantId = process.env.PANEL_WIDGET_PILOT_TENANT_ID;
    if (pilotTenantId && pilotTenantId !== tenantId) throw new NotFoundException();
  }

  @Get()
  async getir(): Promise<PanelWidgetTercihi> {
    const { tenantId, userId } = aktifBaglam();
    this.pilotErisiminiDogrula(tenantId);
    const tercih = await this.prisma.tenantIslem(tenantId, (tx) =>
      tx.panelWidgetTercihi.findUnique({ where: { tenantId_userId: { tenantId, userId } } }),
    );
    return tercih ? panelWidgetTercihiSemasi.parse(tercih) : { surum: 0, widgetlar: [] };
  }

  @Put()
  @SaltOkumadaAcik()
  async kaydet(@Body() govde: unknown): Promise<PanelWidgetTercihi> {
    const sonuc = panelWidgetTercihiSemasi.safeParse(govde);
    if (!sonuc.success) throw new BadRequestException("Widget ayarları geçersiz.");

    const { tenantId, userId } = aktifBaglam();
    this.pilotErisiminiDogrula(tenantId);
    const { surum, widgetlar } = sonuc.data;
    const yeni = { surum: surum + 1, widgetlar };
    const kayit = await this.prisma.tenantIslem(tenantId, (tx) => surum === 0
      ? tx.panelWidgetTercihi.createMany({ data: [{ tenantId, userId, ...yeni }], skipDuplicates: true })
      : tx.panelWidgetTercihi.updateMany({ where: { tenantId, userId, surum }, data: yeni }),
    );
    if (kayit.count !== 1) {
      throw new ConflictException("Panel düzeni başka bir oturumda değişti. Güncel düzeni yükleyip tekrar deneyin.");
    }
    return yeni;
  }
}
