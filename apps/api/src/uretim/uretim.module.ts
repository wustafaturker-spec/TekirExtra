import { Module } from "@nestjs/common";
import { StokModule } from "../stok/stok.module";
import { UretimController } from "./uretim.controller";
import { UretimService } from "./uretim.service";

@Module({ imports: [StokModule], controllers: [UretimController], providers: [UretimService] })
export class UretimModule {}
