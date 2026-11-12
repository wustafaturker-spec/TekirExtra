import { Module } from "@nestjs/common";
import { BildirimlerModule } from "../bildirimler/bildirimler.module";
import { DovizModule } from "../doviz/doviz.module";
import { NakitAkisiController } from "./nakit-akisi.controller";
import { NakitAkisiService } from "./nakit-akisi.service";
import { NakitPozisyonuService } from "./nakit-pozisyonu.service";
import { NakitUyariService } from "./nakit-uyari.service";

// CNL-06: bugün/yarın eksiye düşen nakit bildirim taramasına eklenir.
@Module({ imports: [DovizModule, BildirimlerModule], controllers: [NakitAkisiController], providers: [NakitAkisiService, NakitPozisyonuService, NakitUyariService] })
export class NakitAkisiModule {}
