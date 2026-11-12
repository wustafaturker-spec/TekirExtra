import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { AsistanSoruModule } from "../asistan-soru/asistan-soru.module";
import { TelegramBildirimService } from "./telegram-bildirim.service";
import { TelegramKanalService } from "./telegram-kanal.service";
import { TelegramController } from "./telegram.controller";
import { TelegramService } from "./telegram.service";

/**
 * CNL (aşama A): panel uçları API sürecinde; yoklama döngüsü yalnız `main.telegram.ts`
 * sürecinde (`TEKIR_TELEGRAM=1`) başlar. Bot anahtarı yalnız o sürece verilir.
 */
@Module({ imports: [AiModule, AsistanSoruModule], controllers: [TelegramController], providers: [TelegramService, TelegramKanalService, TelegramBildirimService], exports: [TelegramService] })
export class TelegramModule {}
