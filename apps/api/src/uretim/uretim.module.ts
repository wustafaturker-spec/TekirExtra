import { Module } from "@nestjs/common";
import { CalismaTakvimiModule } from "../calisma-takvimi/calisma-takvimi.module";
import { StokModule } from "../stok/stok.module";
import { UretimController } from "./uretim.controller";
import { UretimService } from "./uretim.service";

@Module({ imports: [StokModule, CalismaTakvimiModule], controllers: [UretimController], providers: [UretimService] })
export class UretimModule {}
