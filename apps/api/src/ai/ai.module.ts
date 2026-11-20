import { Module, forwardRef } from "@nestjs/common";
import "./ai-kullanim.raporlar";
import { AiOnayOzetiController } from "./onay/ai-onay-ozeti.controller";
import { SohbetEkController } from "./ajan/sohbet-ek.controller";
import { EklerModule } from "../ekler/ekler.module";
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
import { AiGorevYurutucu } from "./ayarlar/ai-gorev-yurutucu";
import { AsistanGorevService } from "./ajan/asistan-gorev.service";
import { AiOlayService } from "./olay/ai-olay.service";
import { CariDurumOzetController } from "./cari-ozet/cari-durum-ozet.controller";
import { CariDurumOzetService } from "./cari-ozet/cari-durum-ozet.service";
import { AiIcgoruController } from "./icgoru/ai-icgoru.controller";
import { AiIcgoruService } from "./icgoru/ai-icgoru.service";
import { McpController } from "./mcp/mcp.controller";
import { McpAnahtarController } from "./mcp/mcp-anahtar.controller";
import { McpAnahtarService } from "./mcp/mcp-anahtar.service";
import { AiTelemetriBakimService } from "./ayarlar/ai-telemetri-bakim.service";
import { HafizaController } from "./hafiza/hafiza.controller";
import { HafizaService } from "./hafiza/hafiza.service";
import { TeklifTalebiController } from "./teklif-talebi/teklif-talebi.controller";
import { TeklifTalebiService } from "./teklif-talebi/teklif-talebi.service";
import { BelgeKuyrukController } from "./belge-kuyruk/belge-kuyruk.controller";
import { BelgeKuyrukService } from "./belge-kuyruk/belge-kuyruk.service";
import { HazirlikController } from "./hazirlik/hazirlik.controller";
import { HazirlikService } from "./hazirlik/hazirlik.service";
import { SozlesmeController } from "./sozlesme/sozlesme.controller";
import { SozlesmeService } from "./sozlesme/sozlesme.service";

// Asistan araçları denetleyicilere ModuleRef ile çalışma anında ulaşır
// (UcCagirici); modül importu gerekmez, döngü de oluşmaz.
// MCP (AI-09) kullanıcı başına erişim anahtarıyla çalışır; araçlar asistanla ortak.

@Module({
  imports: [forwardRef(() => BildirimlerModule), EklerModule],
  controllers: [AiController, AiAjanController, SohbetEkController, AiOnayOzetiController, AiOnayController, AiRaporController, TenantAiController, McpController, McpAnahtarController, AiIcgoruController, CariDurumOzetController, TeklifTalebiController, HafizaController, BelgeKuyrukController, HazirlikController, SozlesmeController],
  providers: [AiService, AiAjanService, AiOnayService, UcCagirici, AracYurutucu, AiRaporService, TenantAiService, McpAnahtarService, AiGorevYurutucu, AsistanGorevService, AiOlayService, AiTelemetriBakimService, AiIcgoruService, CariDurumOzetService, TeklifTalebiService, HafizaService, BelgeKuyrukService, HazirlikService, SozlesmeService],
  exports: [AiService, AiAjanService, AiOnayService, AiRaporService, TenantAiService, HafizaService, UcCagirici, AracYurutucu, BelgeKuyrukService, HazirlikService, SozlesmeService],
})
export class AiModule {}
