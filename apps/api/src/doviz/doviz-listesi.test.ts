import { DovizCinsi } from "@prisma/client";
import { DOVIZ_CINSLERI } from "@tekirextra/shared";
import { describe, expect, it } from "vitest";

describe("döviz listesi (DVZ-10)", () => {
  it("Prisma DovizCinsi enum'u ortak listeyle aynıdır", () => {
    expect(Object.values(DovizCinsi).sort()).toEqual([...DOVIZ_CINSLERI].sort());
  });
});
