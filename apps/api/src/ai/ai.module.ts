import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiAjanController } from "./ajan/ai-ajan.controller";
import { AiAjanService } from "./ajan/ai-ajan.service";
import { AiRaporController } from "./rapor/ai-rapor.controller";
import { AiRaporService } from "./rapor/ai-rapor.service";
import { TenantAiController } from "./ayarlar/tenant-ai.controller";
import { TenantAiService } from "./ayarlar/tenant-ai.service";

// MCP sunucusu (mcp/) kapalı: uçları kimlik doğrulamasız ve kiracıyı istemciye
// seçtiriyordu. Kiracıya özel, iptal edilebilir erişim anahtarıyla yeniden
// açılana kadar modüle bağlanmaz.
@Module({
  controllers: [AiController, AiAjanController, AiRaporController, TenantAiController],
  providers: [AiService, AiAjanService, AiRaporService, TenantAiService],
  exports: [AiService, AiAjanService, AiRaporService, TenantAiService],
})
export class AiModule {}
