import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { istekBaglami } from "../core/istek-baglami";
import { EklerService } from "./ekler.service";

const servis = new EklerService({} as never, {} as never);
const dene = (rol: string, sahipTur: string, kapali?: string[]) =>
  istekBaglami.run({ deger: { tenantId: "t", userId: "u", rol: rol as never, ...(kapali ? { ozelRol: { id: "o", kapali } } : {}) } }, () => servis.ekErisiminiDenetle(sahipTur as never, "goruntule"));

describe("ek erişimi sahibin ekranına bağlıdır", () => {
  it.each([["kalite", "fatura"], ["uretim_operatoru", "masraf"], ["ik", "cari"], ["depo", "kasa_banka"], ["satis", "cek_senet"]])("%s, %s ekini göremez", (rol, tur) => {
    expect(() => dene(rol, tur)).toThrow(ForbiddenException);
  });
  it.each([["muhasebe", "fatura"], ["satis", "fatura"], ["depo", "masraf"], ["salt_okunur", "cek_senet"], ["kalite", "satin_alma_teklif"], ["kalite", "firma"], ["yonetici", "kasa_banka"]])("%s, %s ekini görür", (rol, tur) => {
    expect(() => dene(rol, tur)).not.toThrow();
  });
  it("özel rolde sahibin modül kutusu uygulanır", () => {
    expect(() => dene("yonetici", "fatura", ["fatura.goruntule"])).toThrow(/kapalı/);
    expect(() => dene("yonetici", "cari", ["fatura.goruntule"])).not.toThrow();
  });
});
