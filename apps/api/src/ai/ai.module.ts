import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { AiAjanController } from "./ajan/ai-ajan.controller";
import { AiAjanService } from "./ajan/ai-ajan.service";
import { AiRaporController } from "./rapor/ai-rapor.controller";
import { AiRaporService } from "./rapor/ai-rapor.service";
import { TenantAiController } from "./ayarlar/tenant-ai.controller";
import { TenantAiService } from "./ayarlar/tenant-ai.service";
import { McpController } from "./mcp/mcp.controller";
import { McpService } from "./mcp/mcp.service";

@Module({
  controllers: [AiController, AiAjanController, AiRaporController, TenantAiController, McpController],
  providers: [AiService, AiAjanService, AiRaporService, TenantAiService, McpService],
  exports: [AiService, AiAjanService, AiRaporService, TenantAiService, McpService],
})
export class AiModule {}
