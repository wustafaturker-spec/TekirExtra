import "./ayar-tanimlari";
import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { BelgelerModule } from "./belgeler/belgeler.module";
import { CariModule } from "./cari/cari.module";
import { StokModule } from "./stok/stok.module";
import { SevkiyatModule } from "./sevkiyat/sevkiyat.module";
import { FiyatListeleriModule } from "./fiyat-listeleri/fiyat-listeleri.module";
import { FaturaModule } from "./fatura/fatura.module";
import { KasaBankaModule } from "./kasa-banka/kasa-banka.module";
import { EbelgeModule } from "./ebelge/ebelge.module";
import { EklerModule } from "./ekler/ekler.module";
import { RaporModule } from "./rapor/rapor.module";
import { AuditInterceptor } from "./core/audit.interceptor";
import { IdempotencyInterceptor } from "./core/idempotency.interceptor";
import { CoreModule } from "./core/core.module";
import { HealthModule } from "./health/health.module";
import { TenantModule } from "./tenant/tenant.module";
import { PazaryeriModule } from "./pazaryeri/pazaryeri.module";
import { PosModule } from "./pos/pos.module";
import { MasraflarModule } from "./masraflar/masraflar.module";
import { DovizModule } from "./doviz/doviz.module";
import { UretimModule } from "./uretim/uretim.module";
import { CalismaTakvimiModule } from "./calisma-takvimi/calisma-takvimi.module";
import { IsKutusuModule } from "./is-kutusu/is-kutusu.module";
import { ObservabilityModule } from "./core/observability/observability.module";
import { PersonelModule } from "./personel/personel.module";
import { MaliMusavirModule } from "./mali-musavir/mali-musavir.module";
import { CrmFirsatModule } from "./crm/crm-firsat.module";
import { B2bModule } from "./b2b/b2b.module";
import { AiModule } from "./ai/ai.module";

import { GelirlerModule } from "./gelirler/gelirler.module";
import { YedeklemeModule } from "./yedekleme/yedekleme.module";
import { PesinVergiModule } from "./pesin-vergi/pesin-vergi.module";
import { ProjelerModule } from "./projeler/projeler.module";
import { DemirbasModule } from "./demirbas/demirbas.module";
import { AracTakipModule } from "./arac-takip/arac-takip.module";
import { DuzeltmelerModule } from "./duzeltmeler/duzeltmeler.module";
import { DonemKapatmaModule } from "./donem-kapatma/donem-kapatma.module";
import { BildirimlerModule } from "./bildirimler/bildirimler.module";
import { RaporAbonelikModule } from "./rapor-abonelik/rapor-abonelik.module";
import { NakitAkisiModule } from "./nakit-akisi/nakit-akisi.module";
import { ButceModule } from "./butce/butce.module";
import { SatinAlmaModule } from "./satin-alma/satin-alma.module";
import { MevzuatModule } from "./mevzuat/mevzuat.module";
import { AbonelikOdemeModule } from "./abonelik-odeme/abonelik-odeme.module";
import { SistemSagligiModule } from "./sistem-sagligi/sistem-sagligi.module";

@Module({
  imports: [
    SevkiyatModule,
    ConfigModule.forRoot({ isGlobal: true }),
    CoreModule,
    AuthModule,
    MevzuatModule,
    AbonelikOdemeModule,
    SistemSagligiModule,
    YedeklemeModule,
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
    PesinVergiModule,
    ProjelerModule,
    DemirbasModule,
    AracTakipModule,
    DuzeltmelerModule,
    DonemKapatmaModule,
    BildirimlerModule,
    RaporAbonelikModule,
    DovizModule,
    UretimModule,
    CalismaTakvimiModule,
    IsKutusuModule,
    ObservabilityModule,
    PersonelModule,
    MaliMusavirModule,
    CrmFirsatModule,
    B2bModule,
    AiModule,
    NakitAkisiModule,
    ButceModule,
    SatinAlmaModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
