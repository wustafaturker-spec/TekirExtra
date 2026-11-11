import { describe, expect, it, vi } from "vitest";
import { baglamlaCalistir } from "../istek-baglami";
import { DAKIKALIK_SINIR, IstemciHataController } from "./istemci-hata.controller";

describe("tarayıcı hata bildirimi (PLT-119)", () => {
  const kur = () => { const kaydet = vi.fn().mockResolvedValue(undefined); return { kaydet, c: new IstemciHataController({ kaydet } as never) }; };
  const calistir = <T>(f: () => Promise<T>, userId = "u1") => baglamlaCalistir({ tenantId: "t1", userId, rol: "muhasebe" } as never, f);

  it("sayfa yolunu sorgusuz ve kimliksiz kaydeder", async () => {
    const { c, kaydet } = kur();
    await calistir(() => c.bildir({ mesaj: "x is undefined", sayfa: "/panel/cari/3fa85f64-5717-4562-b3fc-2c963f66afa6/ekstre?baslangic=2026-01-01#ust" }));
    expect(kaydet).toHaveBeenCalledWith(expect.objectContaining({ kaynak: "web", konum: "/panel/cari/:id/ekstre", tenantId: "t1" }));
  });

  it("bozuk bildirimi sessizce atar; kullanıcı başına dakikalık sınır uygular", async () => {
    const { c, kaydet } = kur();
    await calistir(() => c.bildir({ sayfa: "/panel" }));
    expect(kaydet).not.toHaveBeenCalled();
    for (let i = 0; i < DAKIKALIK_SINIR + 5; i++) await calistir(() => c.bildir({ mesaj: `h${i}`, sayfa: "/panel" }));
    expect(kaydet).toHaveBeenCalledTimes(DAKIKALIK_SINIR);
    await calistir(() => c.bildir({ mesaj: "başka kullanıcı", sayfa: "/panel" }), "u2");
    expect(kaydet).toHaveBeenCalledTimes(DAKIKALIK_SINIR + 1);
  });
});
