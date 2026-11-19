import { panelWidgetSemasi } from "@tekirextra/shared";
import { describe, expect, it } from "vitest";
import { widgetSablonlari } from "./panel-widget-sablonlari";

describe("Panel widget şablonları", () => {
  it("yönetim, muhasebe ve satışa farklı başlangıç seçenekleri sunar", () => {
    const kaynaklar = ["vade", "tahsilat", "stok", "sabah"] as const;
    expect(widgetSablonlari("yonetici", kaynaklar).map(({ kod }) => kod)).toEqual(["aylikTahsilat", "haftalikAlacak", "bekleyenler"]);
    expect(widgetSablonlari("muhasebe", kaynaklar).map(({ kod }) => kod)).toEqual(["haftalikAlacak", "haftalikBorc", "aylikTahsilat"]);
    expect(widgetSablonlari("satis", ["sabah"]).map(({ kod }) => kod)).toEqual(["sabahListesi", "bekleyenler"]);
  });

  it("kapalı kaynakları ve kaynağı olmayan rolleri göstermez", () => {
    expect(widgetSablonlari("muhasebe", ["tahsilat"]).map(({ kod }) => kod)).toEqual(["aylikTahsilat"]);
    expect(widgetSablonlari("yonetici", [])).toEqual([]);
    expect(widgetSablonlari("depo", ["stok"])[0].widget).toMatchObject({ kaynak: "stok", filtre: "kritik" });
  });

  it("hazır seçenekleri normal widget doğrulamasından geçirir", () => {
    for (const rol of ["yonetici", "muhasebe", "satis", "depo"]) {
      for (const { widget } of widgetSablonlari(rol, ["vade", "tahsilat", "stok", "sabah"])) {
        expect(panelWidgetSemasi.safeParse({ ...widget, id: "cc066e71-be6e-4ddd-8cde-4a063ac90a32" }).success).toBe(true);
      }
    }
  });
});
