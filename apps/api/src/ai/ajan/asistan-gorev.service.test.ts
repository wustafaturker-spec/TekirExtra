import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AiBosYanitHatasi } from "../saglayici/ai-bos-yanit";
import { AiSinirHatasi } from "../saglayici/ai-butce";
import { SaglayiciHatasi } from "../saglayici/aracli-ortak";
import { yenidenDenenir } from "./asistan-gorev.service";

describe("arka plan görevi yeniden deneme kuralı (AI-105)", () => {
  it("sağlayıcı/model hatası ve çökme yeniden denenir", () => {
    expect(yenidenDenenir(new SaglayiciHatasi("503", "SAGLAYICI_HTTP_503" as never))).toBe(true);
    expect(yenidenDenenir(new AiBosYanitHatasi("boş" as never))).toBe(true);
    expect(yenidenDenenir(new Error("bağlantı koptu"))).toBe(true);
  });
  it("bütçe/sınır, yetki ve girdi hatası denenmez", () => {
    expect(yenidenDenenir(new AiSinirHatasi("bütçe doldu"))).toBe(false);
    expect(yenidenDenenir(new ForbiddenException("yetki yok"))).toBe(false);
    expect(yenidenDenenir(new BadRequestException("sohbet arşivlendi"))).toBe(false);
  });
});
