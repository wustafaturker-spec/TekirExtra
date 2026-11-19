import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { AbonelikGuard } from "./abonelik.guard";
import { AuthController } from "./auth.controller";
import { TelefonController } from "./telefon.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { GirisDenemeSayaci } from "./giris-deneme-sayaci";
import { PanelWidgetController } from "./panel-widget.controller";
import { RollerGuard } from "./roller.guard";

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: "15m" },
      }),
    }),
  ],
  controllers: [AuthController, TelefonController, PanelWidgetController],
  providers: [
    AuthService,
    GirisDenemeSayaci,
    // Sıra önemli: önce kimlik (AuthGuard), sonra rol (RollerGuard)
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RollerGuard },
    // Rol denetiminden sonra: yetkisiz istek önce 403 rol hatası alır.
    { provide: APP_GUARD, useClass: AbonelikGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
