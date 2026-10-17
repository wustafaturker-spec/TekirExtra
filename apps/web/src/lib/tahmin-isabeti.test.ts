import { describe, expect, it } from "vitest";
import { mutlakSapmaMetni, sapmaMetni } from "./tahmin-isabeti";

describe("tahmin isabeti metinleri", () => {
  it("sapmanın yönünü söyler", () => {
    expect(sapmaMetni(2.7)).toBe("2,7 gün geç");
    expect(sapmaMetni(-1)).toBe("1 gün erken");
    expect(sapmaMetni(0)).toBe("tahminle aynı");
    expect(sapmaMetni(null)).toBe("—");
    expect(mutlakSapmaMetni(5.2)).toBe("± 5,2 gün");
  });
});
