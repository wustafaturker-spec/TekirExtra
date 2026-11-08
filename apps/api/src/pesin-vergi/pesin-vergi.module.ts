import { Module } from "@nestjs/common";
import { PesinVergiController } from "./pesin-vergi.controller";
import { PesinVergiService } from "./pesin-vergi.service";

@Module({ controllers: [PesinVergiController], providers: [PesinVergiService] })
export class PesinVergiModule {}
