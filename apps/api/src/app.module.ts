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
import { DovizModule } from "./doviz/doviz.module";
import { UretimModule } from "./uretim/uretim.module";
import { ObservabilityModule } from "./core/observability/observability.module";
import { PersonelModule } from "./personel/personel.module";
import { MaliMusavirModule } from "./mali-musavir/mali-musavir.module";
import { CrmFirsatModule } from "./crm/crm-firsat.module";
import { B2bModule } from "./b2b/b2b.module";
import { AiModule } from "./ai/ai.module";

import { GelirlerModule } from "./gelirler/gelirler.module";
import { ProjelerModule } from "./projeler/projeler.module";
import { DuzeltmelerModule } from "./duzeltmeler/duzeltmeler.module";
import { DonemKapatmaModule } from "./donem-kapatma/donem-kapatma.module";

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
    GelirlerModule,
    ProjelerModule,
    DuzeltmelerModule,
    DonemKapatmaModule,
    DovizModule,
    UretimModule,
    ObservabilityModule,
    PersonelModule,
    MaliMusavirModule,
    CrmFirsatModule,
    B2bModule,
    AiModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
