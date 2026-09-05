import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DonemKapatmaController } from "./donem-kapatma.controller";
import { DonemKapatmaService } from "./donem-kapatma.service";
import { DonemKilidiService } from "./donem-kilidi.service";

@Global()
@Module({ imports: [AuthModule], controllers: [DonemKapatmaController], providers: [DonemKapatmaService, DonemKilidiService], exports: [DonemKilidiService] })
export class DonemKapatmaModule {}
