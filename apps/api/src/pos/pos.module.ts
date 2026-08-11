import { Module } from "@nestjs/common"; import { TenantModule } from "../tenant/tenant.module"; import { PosController } from "./pos.controller"; import { PosService } from "./pos.service";
@Module({ imports: [TenantModule], controllers: [PosController], providers: [PosService] }) export class PosModule {}
