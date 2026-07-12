import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  _tumTanimlariTemizle,
  ayarTanimiAl,
  kayitliModuller,
  registerModulAyar,
} from "./ayar-kayit";

const sema = z.object({ tema: z.enum(["acik", "koyu"]) });

describe("ayar kayıt defteri (AYR-01/03)", () => {
  beforeEach(() => _tumTanimlariTemizle());

  it("modül ayarı kaydeder ve listeler", () => {
    registerModulAyar("arayuz", sema, { tema: "acik" });
    expect(kayitliModuller()).toEqual(["arayuz"]);
    expect(ayarTanimiAl("arayuz")?.varsayilanlar).toEqual({ tema: "acik" });
  });

  it("şemaya uymayan varsayılanları reddeder", () => {
    expect(() =>
      registerModulAyar("arayuz", sema, { tema: "mor" }),
    ).toThrow();
  });

  it("aynı modülün ikinci kaydını reddeder", () => {
    registerModulAyar("arayuz", sema, { tema: "acik" });
    expect(() => registerModulAyar("arayuz", sema, { tema: "koyu" })).toThrow(
      /zaten kayıtlı/,
    );
  });
});
