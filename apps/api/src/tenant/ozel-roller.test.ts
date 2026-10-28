import "reflect-metadata";
import { Controller, Get, Post } from "@nestjs/common";
import { MetadataScanner, Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { Public } from "../auth/public.decorator";
import { Roller } from "../auth/roller.decorator";
import { SablonMatrisiService } from "./ozel-roller.controller";

@Controller("kasa-banka")
@Roller("muhasebe", "salt_okunur")
class KasaDenetleyici {
  @Get("kasalar") kasalar() { return []; }
  @Post("kasalar/:id/onayla") onayla() { return {}; }
}

@Controller("pos")
class PosDenetleyici {
  @Get("tahsilatlar") @Roller("muhasebe") tahsilatlar() { return []; }
  @Get("makbuz/:t/:id/:a") @Public() makbuz() { return ""; }
  @Post("paytr/callback/:t/:id") @Public() geriCagirma() { return "OK"; }
}

const kur = () => {
  const denetleyiciler = [KasaDenetleyici, PosDenetleyici].map((s) => ({ metatype: s, instance: new s() }));
  return new SablonMatrisiService({ getControllers: () => denetleyiciler } as never, new MetadataScanner(), new Reflector());
};

describe("şablon matrisi (KLN-20)", () => {
  it("sınıf düzeyindeki @Roller uygulanır; oturumsuz uçlar matrise sayılmaz", () => {
    const m = kur().matris();
    expect(m.muhasebe).toEqual(["kasa_banka.goruntule", "kasa_banka.onayla"]);
    expect(m.salt_okunur).toEqual(["kasa_banka.goruntule", "kasa_banka.onayla"]);
    // Satış hiçbir kasa-banka ucuna giremez; POS makbuz/geri çağırma (@Public) kutu açmaz.
    expect(m.satis).toEqual([]);
    expect(m.yonetici).toEqual(["kasa_banka.goruntule", "kasa_banka.onayla"]);
  });
});
