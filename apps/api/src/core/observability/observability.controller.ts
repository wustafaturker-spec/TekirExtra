import { createHash, timingSafeEqual } from "node:crypto";
import { Controller, Get, Header, Headers, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Public } from "../../auth/public.decorator";
import { MetricsService } from "./metrics.service";

const ozet = (deger: string) => createHash("sha256").update(deger).digest();

/**
 * SEC-07: metrik erişimi. Token tanımlıysa Bearer ile zamanlamaya dayanıklı
 * karşılaştırılır; üretimde token yoksa uç hiç yokmuş gibi 404 döner (rota
 * adları, hata oranları, kuyruk boyları dışarı sızmasın). Geliştirmede açıktır.
 */
export function metrikErisimi(beklenen: string | undefined, yetki: string | undefined, ortam = process.env.NODE_ENV): "izinli" | "yok" | "yetkisiz" {
  const token = beklenen?.trim();
  if (!token) return ortam === "production" ? "yok" : "izinli";
  const verilen = yetki?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return verilen && timingSafeEqual(ozet(verilen), ozet(token)) ? "izinli" : "yetkisiz";
}

@Controller("metrics")
export class ObservabilityController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Public()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metricsEndpoint(@Headers("authorization") authHeader?: string): string {
    const erisim = metrikErisimi(process.env.METRICS_TOKEN, authHeader);
    if (erisim === "yok") throw new NotFoundException();
    if (erisim === "yetkisiz") throw new UnauthorizedException("Geçersiz veya eksik metrik erişim anahtarı");
    return this.metrics.render();
  }
}
