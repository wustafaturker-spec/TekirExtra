import "./ayar-tanimlari";
import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { CariModule } from "./cari/cari.module";
import { StokModule } from "./stok/stok.module";
import { FaturaModule } from "./fatura/fatura.module";
import { KasaBankaModule } from "./kasa-banka/kasa-banka.module";
import { EbelgeModule } from "./ebelge/ebelge.module";
import { RaporModule } from "./rapor/rapor.module";
import { AuditInterceptor } from "./core/audit.interceptor";
import { CoreModule } from "./core/core.module";
import { HealthModule } from "./health/health.module";
import { TenantModule } from "./tenant/tenant.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CoreModule,
    AuthModule,
    TenantModule,
    CariModule,
    StokModule,
    FaturaModule,
    KasaBankaModule,
    EbelgeModule,
    RaporModule,
    HealthModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
