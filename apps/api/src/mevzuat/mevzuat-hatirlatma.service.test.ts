import { describe, expect, it } from "vitest";
import type { TakvimSatiri } from "@tekirextra/shared";
import { hatirlatmaAnahtari, hatirlatmaEsigi } from "./mevzuat-hatirlatma.service";

const satir = (kalanGun: number, kayitVar = false): TakvimSatiri => ({
  tur: "bordro_parametreleri", anahtar: "genel", ad: "Bordro", etki: "bordro hesaplanamaz", donem: "2027", baslangic: "2027-01-01", kalanGun, kayitVar, durum: "bekliyor",
});

describe("mevzuat hatırlatma eşiği (MVZ-17)", () => {
  it("30/15/7 gün eşiklerinin geçilen en küçüğü, dönem başladıysa 0, kayıt varsa ya da uzaksa yok", () => {
    expect(hatirlatmaEsigi(satir(83))).toBeNull();
    expect(hatirlatmaEsigi(satir(30))).toBe(30);
    expect(hatirlatmaEsigi(satir(20))).toBe(30);
    expect(hatirlatmaEsigi(satir(12))).toBe(15);
    expect(hatirlatmaEsigi(satir(3))).toBe(7);
    expect(hatirlatmaEsigi(satir(0))).toBe(0);
    expect(hatirlatmaEsigi(satir(-10))).toBe(0);
    expect(hatirlatmaEsigi(satir(3, true))).toBeNull();
  });
  it("anahtar değer, dönem ve eşiği taşır (her eşik bir kez)", () => {
    expect(hatirlatmaAnahtari(satir(12), 15)).toBe("bordro_parametreleri/genel/2027/15");
  });
});
