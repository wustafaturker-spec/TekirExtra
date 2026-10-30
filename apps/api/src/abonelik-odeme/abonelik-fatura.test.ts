import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { abonelikAciklamasi, abonelikMatrahi } from "./abonelik-fatura.service";

describe("abonelik faturası kalemi (PLT-21)", () => {
  it("sağlayıcı ödemesinde kayıtlı matrah, elle ödemede toplamdan geri hesaplanan matrah kullanılır", () => {
    expect(abonelikMatrahi({ tutar: new Prisma.Decimal("478.80"), matrah: new Prisma.Decimal("399.00") }).toFixed(2)).toBe("399.00");
    expect(abonelikMatrahi({ tutar: new Prisma.Decimal("478.80"), matrah: null }).toFixed(2)).toBe("399.00");
    expect(abonelikMatrahi({ tutar: new Prisma.Decimal("1000"), matrah: null }).toFixed(2)).toBe("833.33");
  });

  it("açıklama plan, süre, dönem aralığı ve ödeme yolunu taşır; dönem eski dönem sonundan başlar", () => {
    const ortak = { plan_kodu: "v1", ay_sayisi: 3, yeni_donem_sonu: new Date("2027-02-28T21:00:00Z"), odeme_at: new Date("2026-10-29T10:00:00Z") };
    expect(abonelikAciklamasi({ ...ortak, onceki_donem_sonu: new Date("2026-11-30T21:00:00Z"), kaynak: "saglayici", saglayici: "paytr" }))
      .toBe("TekirExtra Profesyonel abonelik, 3 ay (01.12.2026–01.03.2027); ödeme 29.10.2026, kartla (PayTR)");
    expect(abonelikAciklamasi({ ...ortak, onceki_donem_sonu: null, kaynak: "elle", saglayici: null }))
      .toBe("TekirExtra Profesyonel abonelik, 3 ay (29.10.2026–01.03.2027); ödeme 29.10.2026, havale/elle");
  });
});
