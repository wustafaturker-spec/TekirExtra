import { describe, expect, it } from "vitest";
import { odemeKarekodu } from "./karekod";

describe("odemeKarekodu", () => {
  it("bağlantıdan SVG karekod üretir", () => {
    const svg = odemeKarekodu("https://sandbox.iyzipay.com/odeme/abc?token=123");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
  });
});
