import { Controller, Get, Header } from "@nestjs/common";
import { Public } from "../../auth/public.decorator";
import { MetricsService } from "./metrics.service";

@Controller("metrics")
export class ObservabilityController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Public()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metricsEndpoint(): string { return this.metrics.render(); }
}
