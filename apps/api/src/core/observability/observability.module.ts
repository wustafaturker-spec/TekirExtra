import { Global, Module } from "@nestjs/common";
import { ObservabilityController } from "./observability.controller";
import { MetricsService } from "./metrics.service";
import { HataKayitService } from "./hata-kayit";
import { IstemciHataController } from "./istemci-hata.controller";

@Global()
@Module({ controllers: [ObservabilityController, IstemciHataController], providers: [MetricsService, HataKayitService], exports: [MetricsService, HataKayitService] })
export class ObservabilityModule {}
