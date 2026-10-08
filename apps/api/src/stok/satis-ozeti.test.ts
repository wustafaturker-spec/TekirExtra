import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { fifoDegerleri, urunBazinda, type SatisSatiri } from "./satis-ozeti";

const D = (v: number) => new Prisma.Decimal(v);
const h = (id: string, miktar: number, maliyet: number) => ({ id, miktar: D(miktar), maliyet: D(maliyet) });

describe("satış özeti (STK-32)", () => {
  it("FIFO çıkışı en eski girişten tüketir; kuyruk biterse kayıtlı maliyet", () => {
    const d = fifoDegerleri([h("g1", 10, 10), h("g2", 10, 30), h("c1", -15, 20), h("c2", -10, 25)]);
    expect(d.get("c1")!.toNumber()).toBe(10 * 10 + 5 * 30);
    expect(d.get("c2")!.toNumber()).toBe(5 * 30 + 5 * 25);
  });
  it("ürün başına toplar; iade eksi satırı düşer", () => {
    const satir = (miktar: number, ciro: number, maliyet: number, tip: "satis" | "satis_iade"): SatisSatiri => ({ faturaId: "f", faturaNo: "", tarih: new Date(), cariUnvan: "", tip, stokId: "s", kod: "K", ad: "A", mevcutMiktar: D(0), miktar: D(miktar), ciro: D(ciro), maliyet: D(maliyet), hareketPaylari: [] });
    const [u] = urunBazinda([satir(10, 1000, 400, "satis"), satir(-2, -200, -80, "satis_iade")]);
    expect([u.miktar.toNumber(), u.ciro.toNumber(), u.maliyet.toNumber()]).toEqual([8, 800, 320]);
  });
});
