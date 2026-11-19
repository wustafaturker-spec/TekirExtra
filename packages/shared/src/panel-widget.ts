import { z } from "zod";

export const PANEL_WIDGET_SINIRI = 8;
export const tahsilatDonemiSemasi = z.enum(["bugun", "dun", "bu_hafta", "bu_ay"]);
export const vadeDonemiSemasi = z.enum(["bu_hafta", "bu_ay"]);
export type VadeDonemi = z.infer<typeof vadeDonemiSemasi>;
export type TahsilatDonemi = z.infer<typeof tahsilatDonemiSemasi>;

export function tahsilatTrendiDonemeUygun(donem: string): boolean {
  return donem === "bu_hafta" || donem === "bu_ay";
}

export const panelWidgetSemasi = z.object({
  id: z.uuid(),
  baslik: z.string().trim().min(1).max(60),
}).and(z.discriminatedUnion("kaynak", [
  z.object({ kaynak: z.literal("vade"), filtre: z.enum(["alacak", "borc", "alacak_bu_hafta", "borc_bu_hafta", "alacak_bu_ay", "borc_bu_ay"]), gorunum: z.enum(["tutar", "sayi", "liste"]) }),
  z.object({ kaynak: z.literal("tahsilat"), filtre: tahsilatDonemiSemasi, gorunum: z.enum(["tutar", "sayi", "trend"]) }),
  z.object({ kaynak: z.literal("stok"), filtre: z.literal("kritik"), gorunum: z.literal("sayi") }),
  z.object({ kaynak: z.literal("sabah"), filtre: z.literal("bekleyen"), gorunum: z.enum(["sayi", "liste"]) }),
])).refine(
  (widget) => widget.gorunum !== "trend" || tahsilatTrendiDonemeUygun(widget.filtre),
  { path: ["gorunum"], message: "Tahsilat trendi haftalık veya aylık dönem gerektirir." },
);

export const panelWidgetTercihiSemasi = z.object({
  surum: z.number().int().min(0).max(2_147_483_646),
  widgetlar: z.array(panelWidgetSemasi).max(PANEL_WIDGET_SINIRI)
    .refine((widgetlar) => new Set(widgetlar.map(({ id }) => id)).size === widgetlar.length, "Widget kimlikleri benzersiz olmalıdır"),
});

export type PanelWidget = z.infer<typeof panelWidgetSemasi>;
export type PanelWidgetTercihi = z.infer<typeof panelWidgetTercihiSemasi>;
