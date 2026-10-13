import { Module } from "@nestjs/common";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiAjanController } from "./ajan/ai-ajan.controller";
import { AiAjanService } from "./ajan/ai-ajan.service";
import { UcCagirici } from "./ajan/uc-cagirici";
import { AracYurutucu } from "./ajan/arac-yurutucu";
import { AiOnayController } from "./onay/ai-onay.controller";
import { AiOnayService } from "./onay/ai-onay.service";
import { AiRaporController } from "./rapor/ai-rapor.controller";
import { AiRaporService } from "./rapor/ai-rapor.service";
import { TenantAiController } from "./ayarlar/tenant-ai.controller";
import { TenantAiService } from "./ayarlar/tenant-ai.service";
import { McpController } from "./mcp/mcp.controller";
import { McpAnahtarController } from "./mcp/mcp-anahtar.controller";
import { McpAnahtarService } from "./mcp/mcp-anahtar.service";

// Asistan araçları denetleyicilere ModuleRef ile çalışma anında ulaşır
// (UcCagirici); modül importu gerekmez, döngü de oluşmaz.
// MCP (AI-09) kullanıcı başına erişim anahtarıyla çalışır; araçlar asistanla ortak.
@Module({
  imports: [BildirimlerModule],
  controllers: [AiController, AiAjanController, AiOnayController, AiRaporController, TenantAiController, McpController, McpAnahtarController],
  providers: [AiService, AiAjanService, AiOnayService, UcCagirici, AracYurutucu, AiRaporService, TenantAiService, McpAnahtarService],
  exports: [AiService, AiAjanService, AiOnayService, AiRaporService, TenantAiService],
})
export class AiModule {}
