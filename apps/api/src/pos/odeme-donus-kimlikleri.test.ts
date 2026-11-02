import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { AbonelikOdemePublicController } from "../abonelik-odeme/abonelik-odeme.controller";
import { PosController } from "./pos.controller";

type ArgUstVerisi = Record<string, { data?: string; pipes?: unknown[] }>;

const UCLAR = [
  ["POS iyzico dönüşü", PosController, "callback"],
  ["POS makbuzu", PosController, "makbuz"],
  ["POS PayTR dönüşü", PosController, "paytrCallback"],
  ["abonelik iyzico dönüşü", AbonelikOdemePublicController, "iyzicoCallback"],
  ["abonelik PayTR formu", AbonelikOdemePublicController, "paytrForm"],
  ["abonelik PayTR sonucu", AbonelikOdemePublicController, "paytrSonuc"],
] as const;

describe("kimliksiz ödeme uçlarında kayıt kimlikleri (SEC-13)", () => {
  it.each(UCLAR)("%s: tenantId ve kayıt kimliği UUID denetiminden geçer", (_ad, sinif, metot) => {
    const argumanlar = Reflect.getMetadata(ROUTE_ARGS_METADATA, sinif, metot) as ArgUstVerisi;
    const kimlikler = Object.values(argumanlar).filter((a) => ["tenantId", "tahsilatId", "denemeId"].includes(a.data ?? ""));
    expect(kimlikler).toHaveLength(2);
    for (const k of kimlikler) expect(k.pipes).toContain(ParseUUIDPipe);
  });

  it("bozuk değer 400 alır, geçerli UUID aynen döner", async () => {
    const boru = new ParseUUIDPipe();
    const meta = { type: "param" } as const;
    await expect(boru.transform("' OR 1=1 --", meta)).rejects.toBeInstanceOf(BadRequestException);
    const kimlik = "3f2b8c1e-7a4d-4e9b-9c11-0d5e6f7a8b9c";
    await expect(boru.transform(kimlik, meta)).resolves.toBe(kimlik);
  });
});
