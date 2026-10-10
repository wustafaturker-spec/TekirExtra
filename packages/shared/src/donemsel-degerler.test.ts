import { describe, expect, it } from "vitest";
import { yayinTakvimi } from "./donemsel-degerler";

const k = (tur: string, anahtar: string, yururlukBaslangic: string) => ({ tur, anahtar, yururlukBaslangic });

describe("yayın takvimi (MVZ-17)", () => {
  const kayitlar = [k("bordro_parametreleri", "genel", "2026-05-01"), k("kanuni_deger", "kidem_tavani", "2026-07-01"), k("kanuni_deger", "tevkifat_alt_siniri", "2026-01-01")];

  it("içinde bulunulan dönem kayıtlıysa tamam, sıradaki uzaksa bekliyor", () => {
    const t = yayinTakvimi(kayitlar, "2026-10-10");
    expect(t.filter((s) => s.donem === "2026" || s.donem === "2026/2").every((s) => s.durum === "tamam")).toBe(true);
    const bordro2027 = t.find((s) => s.tur === "bordro_parametreleri" && s.donem === "2027")!;
    expect(bordro2027).toMatchObject({ baslangic: "2027-01-01", kalanGun: 83, durum: "bekliyor", kayitVar: false });
    expect(t.find((s) => s.anahtar === "kidem_tavani" && s.donem === "2027/1")!.durum).toBe("bekliyor");
  });

  it("45 gün kala yaklaşıyor, dönem başladığında kayıt yoksa eksik", () => {
    expect(yayinTakvimi(kayitlar, "2026-11-20").find((s) => s.donem === "2027" && s.tur === "bordro_parametreleri")!.durum).toBe("yaklasiyor");
    const ocak = yayinTakvimi(kayitlar, "2027-01-05");
    expect(ocak.find((s) => s.donem === "2027" && s.tur === "bordro_parametreleri")!).toMatchObject({ durum: "eksik", kalanGun: -4 });
    expect(ocak.find((s) => s.donem === "2027/1")!.durum).toBe("eksik");
  });

  it("dönem içinde sonradan başlayan kayıt da o dönemi karşılar (bordro 2026-05-01)", () => {
    expect(yayinTakvimi(kayitlar, "2026-06-01").find((s) => s.tur === "bordro_parametreleri" && s.donem === "2026")!.durum).toBe("tamam");
  });
});
