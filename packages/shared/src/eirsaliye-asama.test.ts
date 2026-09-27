import { describe, expect, it } from "vitest";
import { eirsaliyeAsamaAciklamasi, eirsaliyeAsamasi } from "./eirsaliye-asama";

describe("eirsaliyeAsamasi (EBLG-106)", () => {
  it("NES'in bekleme aşamalarını taslak / entegratörde / GİB'de diye ayırır", () => {
    expect(eirsaliyeAsamasi("Waiting")).toBe("taslak");
    expect(eirsaliyeAsamasi("WaitingToBeSigned")).toBe("entegratorde");
    expect(eirsaliyeAsamasi("WaitingToBeSend")).toBe("entegratorde");
    expect(eirsaliyeAsamasi("EnvelopeIsWaitingToBeSendedToReceiverByGib")).toBe("gibde");
    expect(eirsaliyeAsamasi("EnvelopeIsBeenWaitingToBeTransferredToReceiverByGib")).toBe("gibde");
  });

  it("bilinmeyen ya da boş durumda aşama uydurmaz", () => {
    expect(eirsaliyeAsamasi("UnknownStatus")).toBeNull();
    expect(eirsaliyeAsamasi(null)).toBeNull();
    expect(eirsaliyeAsamaAciklamasi(undefined)).toBeNull();
    expect(eirsaliyeAsamaAciklamasi("Waiting")).toContain("alıcı etiketi");
  });
});
