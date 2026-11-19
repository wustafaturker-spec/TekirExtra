import { describe, expect, it, vi } from "vitest";
import { baglamlaCalistir, type IstekBaglami } from "../core/istek-baglami";
import type { PrismaService } from "../core/prisma.service";
import { PanelWidgetController } from "./panel-widget.controller";

const baglam: IstekBaglami = { tenantId: "firma", userId: "kullanici", rol: "muhasebe" };
const widget = { id: "cc066e71-be6e-4ddd-8cde-4a063ac90a32", baslik: "Kritik stok", kaynak: "stok", filtre: "kritik", gorunum: "sayi" };

function kur() {
  const tablo = {
    findUnique: vi.fn().mockResolvedValue(null),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const tenantIslem = vi.fn((_tenant, islem) => islem({ panelWidgetTercihi: tablo }));
  return { tablo, tenantIslem, controller: new PanelWidgetController({ tenantIslem } as unknown as PrismaService) };
}

describe("Panel widget tercihleri", () => {
  it("yalnız oturumdaki firma ve kullanıcıya okur ve ilk kaydı oluşturur", async () => {
    const { controller, tenantIslem, tablo } = kur();
    await baglamlaCalistir(baglam, async () => {
      await expect(controller.getir()).resolves.toEqual({ surum: 0, widgetlar: [] });
      await expect(controller.kaydet({ surum: 0, widgetlar: [widget], tenantId: "başka-firma", userId: "başka-kullanıcı" }))
        .resolves.toEqual({ surum: 1, widgetlar: [widget] });
    });
    expect(tenantIslem).toHaveBeenCalledWith("firma", expect.any(Function));
    expect(tablo.findUnique).toHaveBeenCalledWith({ where: { tenantId_userId: { tenantId: "firma", userId: "kullanici" } } });
    expect(tablo.createMany).toHaveBeenCalledWith({ data: [{ tenantId: "firma", userId: "kullanici", surum: 1, widgetlar: [widget] }], skipDuplicates: true });
  });

  it("pilot ortamında diğer firmaların tercih uçlarını kapatır", async () => {
    vi.stubEnv("PANEL_WIDGET_PILOT_TENANT_ID", "pilot-firma");
    try {
      const { controller, tenantIslem } = kur();
      await baglamlaCalistir(baglam, async () => {
        await expect(controller.getir()).rejects.toMatchObject({ status: 404 });
        await expect(controller.kaydet({ surum: 0, widgetlar: [] })).rejects.toMatchObject({ status: 404 });
      });
      expect(tenantIslem).not.toHaveBeenCalled();
      await expect(baglamlaCalistir({ ...baglam, tenantId: "pilot-firma" }, () => controller.getir()))
        .resolves.toEqual({ surum: 0, widgetlar: [] });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("eski sürüm kaydını çakışma olarak reddeder", async () => {
    const { controller, tablo } = kur();
    await expect(baglamlaCalistir(baglam, () => controller.kaydet({ surum: 2, widgetlar: [] })))
      .rejects.toMatchObject({ status: 409 });
    expect(tablo.updateMany).toHaveBeenCalledWith({ where: { tenantId: "firma", userId: "kullanici", surum: 2 }, data: { surum: 3, widgetlar: [] } });
  });

  it("desteklenmeyen filtre ve yinelenen kart kimliklerini yazmaz", async () => {
    const { controller, tenantIslem } = kur();
    await expect(controller.kaydet({ surum: 0, widgetlar: [{ ...widget, filtre: "hepsi" }] })).rejects.toMatchObject({ status: 400 });
    await expect(controller.kaydet({ surum: 0, widgetlar: [widget, widget] })).rejects.toMatchObject({ status: 400 });
    expect(tenantIslem).not.toHaveBeenCalled();
  });
});
