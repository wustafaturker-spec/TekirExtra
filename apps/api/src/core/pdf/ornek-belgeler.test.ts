import { describe, expect, it } from "vitest";
import { BELGE_DILLERI } from "@tekirextra/shared";
import { TICARI_BELGE_TURLERI, VARSAYILAN_GORUNUM } from "./belge-gorunumu";
import { ornekBelgeModeli } from "./ornek-belgeler";
import { ticariBelgeHtml } from "./ticari-belge";

describe("Belge Görünümü önizleme örnekleri (FTR-42)", () => {
  it("her tür, her dil ve çift dilde basılır", () => {
    for (const tur of TICARI_BELGE_TURLERI) {
      for (const dil of BELGE_DILLERI) {
        for (const cift of [false, true]) {
          const { html, altBilgi } = ticariBelgeHtml(ornekBelgeModeli(tur, dil, cift && dil !== "tr"), { firma: { unvan: "Örnek A.Ş.", vkn: "1234567801" }, gorunum: VARSAYILAN_GORUNUM });
          expect(html, `${tur}/${dil}/${cift}`).toContain("<table class=\"kalem\">");
          expect(altBilgi).toContain("pageNumber");
        }
      }
    }
  });
});
