import { Module } from "@nestjs/common";
import { EbelgeModule } from "../ebelge/ebelge.module";
import { SistemSagligiController } from "./sistem-sagligi.controller";
import { SistemSagligiService } from "./sistem-sagligi.service";

/** PLT-16…19: sistem sağlığı ekranı ve alarmı. */
@Module({ imports: [EbelgeModule], controllers: [SistemSagligiController], providers: [SistemSagligiService] })
export class SistemSagligiModule {}
