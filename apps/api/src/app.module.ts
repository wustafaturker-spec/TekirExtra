import "./ayar-tanimlari";
import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { BelgelerModule } from "./belgeler/belgeler.module";
import { CariModule } from "./cari/cari.module";
import { StokModule } from "./stok/stok.module";
import { FiyatListeleriModule } from "./fiyat-listeleri/fiyat-listeleri.module";
import { FaturaModule } from "./fatura/fatura.module";
import { KasaBankaModule } from "./kasa-banka/kasa-banka.module";
import { EbelgeModule } from "./ebelge/ebelge.module";
import { EklerModule } from "./ekler/ekler.module";
import { RaporModule } from "./rapor/rapor.module";
import { AuditInterceptor } from "./core/audit.interceptor";
import { CoreModule } from "./core/core.module";
import { HealthModule } from "./health/health.module";
import { TenantModule } from "./tenant/tenant.module";
import { PazaryeriModule } from "./pazaryeri/pazaryeri.module";
import { PosModule } from "./pos/pos.module";
import { MasraflarModule } from "./masraflar/masraflar.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CoreModule,
    AuthModule,
    TenantModule,
    BelgelerModule,
    CariModule,
    StokModule,
    FiyatListeleriModule,
    FaturaModule,
    KasaBankaModule,
    EbelgeModule,
    EklerModule,
    RaporModule,
    HealthModule,
    PazaryeriModule,
    PosModule,
    MasraflarModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
