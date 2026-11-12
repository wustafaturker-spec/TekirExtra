import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { KasaBankaModule } from "../kasa-banka/kasa-banka.module";
import { TenantModule } from "../tenant/tenant.module";
import { AsistanSoruController } from "./asistan-soru.controller";
import { AsistanSoruService } from "./asistan-soru.service";

/** CNL-09/10: asistanın soruları; üretim bildirim taramasına eklenir, yanıt panelden ya da Telegram'dan. */
@Module({ imports: [AiModule, BildirimlerModule, KasaBankaModule, TenantModule], controllers: [AsistanSoruController], providers: [AsistanSoruService], exports: [AsistanSoruService] })
export class AsistanSoruModule {}
