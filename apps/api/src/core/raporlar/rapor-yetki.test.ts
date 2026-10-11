import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import type { Rol } from "@tekirextra/shared";
import { describe, expect, it, vi } from "vitest";
import "../../fatura/fatura.raporlar";
import "../../fatura/vergi.raporlar";
import "../../cari/cari.raporlar";
import "../../stok/stok.raporlar";
import "../../stok/urun-hareket.raporlar";
import "../../kasa-banka/kasa-banka.raporlar";
import { ROLLER_ANAHTAR } from "../../auth/roller.decorator";
import { RaporController } from "../../rapor/rapor.controller";
import { raporErisilebilir, raporTanimlari } from "./rapor-kayit";
import { RaporlarService } from "./raporlar.service";

const baglam = vi.hoisted(() => ({ rol: "depo" as string }));
vi.mock("../istek-baglami", () => ({ aktifBaglam: () => ({ tenantId: "t1", userId: "u1", rol: baglam.rol }) }));

/** Rolün görebildiği raporların modülleri (ve gizli kalan tekil raporlar). */
const gorur = (rol: Rol) => raporTanimlari().filter((t) => raporErisilebilir(t, rol)).map((t) => t.kod);

describe("rapor erişimi (RPR-11)", () => {
  it("yönetici bütün raporları görür", () => {
    expect(gorur("yonetici")).toHaveLength(raporTanimlari().length);
  });

  it("depo yalnız stok raporlarını görür; kâr ve finans raporlarını görmez", () => {
    const kodlar = gorur("depo");
    expect(kodlar.every((k) => k.startsWith("stok."))).toBe(true);
    expect(kodlar).toContain("stok.envanter");
    expect(kodlar).not.toContain("stok.urun-karlilik");
  });

  it("satış fatura ve cari raporlarını görür, kâr marjını ve kâr/zarar özetini görmez", () => {
    const kodlar = gorur("satis");
    expect(kodlar).toContain("fatura.donemsel-ozet");
    expect(kodlar).toContain("cari.yaslandirma");
    expect(kodlar).not.toContain("fatura.kar-marji");
    expect(kodlar).not.toContain("genel.kar-zarar-ozeti");
    expect(kodlar.some((k) => k.startsWith("kasa_banka.") || k.startsWith("vergi.") || k.startsWith("stok."))).toBe(false);
  });

  it("muhasebe ve mali müşavir her raporu görür; salt okunur vergi raporlarını görmez", () => {
    expect(gorur("muhasebe")).toHaveLength(raporTanimlari().length);
    expect(gorur("mali_musavir")).toHaveLength(raporTanimlari().length);
    expect(gorur("salt_okunur").some((k) => k.startsWith("vergi."))).toBe(false);
  });

  it("üretim operatörü, kalite, İK ve bayi hiçbir raporu görmez", () => {
    for (const rol of ["uretim_operatoru", "kalite", "ik", "b2b_bayi"] as Rol[]) expect(gorur(rol)).toEqual([]);
  });

  it("servis yetkisiz rolde listeyi süzer, çalıştırmayı ve görünümleri reddeder", async () => {
    const servis = new RaporlarService({ tenantIslem: vi.fn() } as never, {} as never);
    baglam.rol = "depo";
    expect(servis.listele("fatura")).toEqual([]);
    await expect(servis.calistir("cari.en-yuksek-bakiyeliler", { filtreler: {} })).rejects.toThrow(ForbiddenException);
    await expect(servis.gorunumleriListele("kasa_banka.bakiyeler")).rejects.toThrow(ForbiddenException);
    await expect(servis.excel("fatura.kar-marji", { filtreler: {} })).rejects.toThrow(ForbiddenException);
  });

  it("/rapor uçları rol taşır: finans özeti finans rollerine, günlük özet satışa da açık", () => {
    const roller = (yontem: keyof RaporController) => Reflect.getMetadata(ROLLER_ANAHTAR, RaporController.prototype[yontem]) as Rol[];
    for (const yontem of ["finansalOzet", "vadesiGecenler", "gelirGiderRaporu"] as const) {
      expect(roller(yontem)).toEqual(["muhasebe", "mali_musavir", "salt_okunur"]);
    }
    expect(roller("gunlukOzet")).toContain("satis");
    expect(roller("gunlukOzet")).not.toContain("depo");
    expect(roller("smmAnalizi")).toContain("maliyet_muhasebesi");
    expect(roller("smmAnalizi")).not.toContain("depo");
  });
});
