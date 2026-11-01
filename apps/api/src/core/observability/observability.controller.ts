import { Controller, Get, Header, Headers, UnauthorizedException } from "@nestjs/common";
import { Public } from "../../auth/public.decorator";
import { MetricsService } from "./metrics.service";

@Controller("metrics")
export class ObservabilityController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Public()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metricsEndpoint(@Headers("authorization") authHeader?: string): string {
    const requiredToken = process.env.METRICS_TOKEN?.trim();
    if (requiredToken) {
      const providedToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
      if (providedToken !== requiredToken) {
        throw new UnauthorizedException("Geçersiz veya eksik metrik erişim anahtarı");
      }
    }
    return this.metrics.render();
  }
}
