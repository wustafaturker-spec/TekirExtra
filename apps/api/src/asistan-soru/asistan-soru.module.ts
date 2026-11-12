import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { KasaBankaModule } from "../kasa-banka/kasa-banka.module";
import { TenantModule } from "../tenant/tenant.module";
import { AsistanSoruController, FikirController } from "./asistan-soru.controller";
import { FikirService } from "./fikir.service";
import { NakitAkisiModule } from "../nakit-akisi/nakit-akisi.module";
import { AsistanSoruService } from "./asistan-soru.service";

/** CNL-09/10/11: asistanın soruları ve haftalık fikirleri; üretim bildirim taramasına eklenir, yanıt panelden ya da Telegram'dan. */
@Module({ imports: [AiModule, BildirimlerModule, KasaBankaModule, TenantModule, NakitAkisiModule], controllers: [AsistanSoruController, FikirController], providers: [AsistanSoruService, FikirService], exports: [AsistanSoruService, FikirService] })
export class AsistanSoruModule {}
