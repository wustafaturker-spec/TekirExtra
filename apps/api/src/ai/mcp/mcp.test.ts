import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { baglamAl, istekBaglami } from "../../core/istek-baglami";
import { McpAnahtarService } from "./mcp-anahtar.service";
import { McpController } from "./mcp.controller";

const TENANT = "3f2b6c1e-8d4a-4c2b-9a1e-5b7c8d9e0f12";
const KULLANICI = "7a1d2e3f-4b5c-4d6e-8f70-81920a1b2c3d";
const ozet = (a: string) => createHash("sha256").update(a).digest("hex");
const olarak = <T>(fn: () => Promise<T>, rol = "satis", userId = KULLANICI) => istekBaglami.run({ deger: { tenantId: TENANT, userId, rol: rol as never } }, fn);

function anahtarServisi(kayit: Record<string, unknown> | null = null, etkin = 0) {
  const tx = {
    // KLN-21/22: politika kaydı yok → varsayılanlar.
    tenant: { findUnique: vi.fn(async () => null) },
    aiMcpAnahtari: {
      count: vi.fn().mockResolvedValue(etkin),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "k1", createdAt: new Date(), ...data })),
      findUnique: vi.fn().mockResolvedValue(kayit),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...kayit, ...data })),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const prisma = { tenantIslem: vi.fn((tenantId: string, fn: (t: typeof tx) => unknown) => { prisma.sonKiraci = tenantId; return fn(tx); }), sonKiraci: "" };
  return { service: new McpAnahtarService(prisma as never), tx, prisma };
}

describe("MCP erişim anahtarı (AI-09)", () => {
  it("anahtar bir kez döner, yalnız özeti saklanır; biçimde kiracı vardır", async () => {
    const { service, tx } = anahtarServisi();
    const y = await olarak(() => service.olustur("Claude Desktop"));
    expect(y.anahtar).toMatch(/^tkx_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    expect(y.anahtar).toContain(TENANT.replace(/-/g, ""));
    const data = tx.aiMcpAnahtari.create.mock.calls[0][0].data;
    expect(data.ozet).toBe(ozet(y.anahtar));
    expect(JSON.stringify(data)).not.toContain(y.anahtar);
  });

  it("çalışan rolü anahtar oluşturamaz; etkin anahtar sınırı vardır", async () => {
    await expect(olarak(() => anahtarServisi().service.olustur("x1"), "calisan")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(olarak(() => anahtarServisi(null, 10).service.olustur("x1"))).rejects.toThrow(/En çok 10/);
  });

  it("doğrulama: kiracı anahtardan çözülür, güncel rol kullanılır; iptal/pasif/bozuk anahtar reddedilir", async () => {
    const anahtar = `tkx_${TENANT.replace(/-/g, "")}_${"a".repeat(43)}`;
    const temel = { id: "k1", tenantId: TENANT, userId: KULLANICI, iptalAt: null, sonKullanim: null, user: { rol: "muhasebe", aktif: true } };
    const ok = anahtarServisi(temel);
    expect(await ok.service.dogrula(anahtar)).toEqual({ tenantId: TENANT, userId: KULLANICI, rol: "muhasebe", anahtarId: "k1" });
    expect(ok.prisma.sonKiraci).toBe(TENANT);
    expect(ok.tx.aiMcpAnahtari.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { ozet: ozet(anahtar) } }));
    expect(await anahtarServisi({ ...temel, iptalAt: new Date() }).service.dogrula(anahtar)).toBeNull();
    expect(await anahtarServisi({ ...temel, user: { rol: "muhasebe", aktif: false } }).service.dogrula(anahtar)).toBeNull();
    expect(await anahtarServisi({ ...temel, user: { rol: "calisan", aktif: true } }).service.dogrula(anahtar)).toBeNull();
    expect(await anahtarServisi(temel).service.dogrula("tkx_bozuk")).toBeNull();
    expect(await anahtarServisi(temel).service.dogrula(TENANT)).toBeNull();
  });

  it("başkasının anahtarını yalnız yönetici iptal eder", async () => {
    const k = { id: "k1", userId: "baska", iptalAt: null };
    await expect(olarak(() => anahtarServisi(k).service.iptal("k1"))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(olarak(() => anahtarServisi(k).service.iptal("k1"), "yonetici")).resolves.toMatchObject({ id: "k1" });
  });
});

describe("MCP ucu (AI-09)", () => {
  function kur(kimlik: unknown = { tenantId: TENANT, userId: KULLANICI, rol: "muhasebe", anahtarId: "k1" }) {
    const anahtarlar = { dogrula: vi.fn().mockResolvedValue(kimlik) };
    const yurutucu = {
      izinliAraclar: vi.fn(() => [
        { ad: "cari_ara", aciklama: "Cari arar", sinif: "okuma", girdi: { "~standard": {} } },
        { ad: "belge_onayla", aciklama: "Belge onaylar", sinif: "onay", girdi: { "~standard": {} } },
      ]),
      yurut: vi.fn(async () => ({ icerik: '{"durum":"onay_bekliyor"}', talep: { id: "t1" } })),
    };
    const aiAracIstegi = { create: vi.fn().mockResolvedValue({ id: "i1" }), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) };
    const prisma = { tenantIslem: vi.fn((_t: string, fn: (tx: { aiAracIstegi: typeof aiAracIstegi }) => unknown) => fn({ aiAracIstegi })) };
    const res = { setHeader: vi.fn(), status: vi.fn() };
    const c = new McpController(anahtarlar as never, yurutucu as never, prisma as never);
    const istek = (govde: unknown, yetki = "Bearer tkx_x", idempotencyKey?: string) => istekBaglami.run({}, async () => ({ sonuc: await c.istek(yetki, idempotencyKey, govde, res as never), baglam: baglamAl() }));
    return { c, anahtarlar, yurutucu, aiAracIstegi, res, istek };
  }

  it("anahtarsız ya da geçersiz anahtarla 401", async () => {
    await expect(kur(null).istek({ jsonrpc: "2.0", id: 1, method: "ping" })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(kur().istek({ jsonrpc: "2.0", id: 1, method: "ping" }, "")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("kimliği anahtardan istek bağlamına kurar ve initialize yanıtlar", async () => {
    const { sonuc, baglam } = await kur().istek({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(baglam).toEqual({ tenantId: TENANT, userId: KULLANICI, rol: "muhasebe" });
    expect(sonuc).toMatchObject({ id: 1, result: { protocolVersion: "2025-03-26", serverInfo: { name: "TekirExtra" } } });
  });

  it("araç çağrısı ortak yürütücüye MCP kaynağıyla gider", async () => {
    const k = kur();
    const { sonuc } = await k.istek({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "belge_onayla", arguments: { belgeId: "x" } } }, undefined, "mcp-call-0001");
    expect(k.yurutucu.izinliAraclar).toHaveBeenCalledWith("muhasebe");
    expect(k.yurutucu.yurut).toHaveBeenCalledWith({ ad: "belge_onayla", girdi: { belgeId: "x" } }, expect.any(Map), { kaynak: "mcp" });
    expect(sonuc).toMatchObject({ result: { content: [{ type: "text" }], isError: false } });
    expect(k.aiAracIstegi.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ istekAnahtari: "mcp-call-0001", arac: "belge_onayla", kaynak: "mcp" }) }));
    expect(k.aiAracIstegi.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durum: "tamamlandi" }) }));
  });

  it("yan etkili araçta idempotency anahtarı ister; okuma aracında istemez", async () => {
    const k = kur();
    const eksik = await k.istek({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "belge_onayla", arguments: {} } });
    expect(eksik.sonuc).toMatchObject({ error: { code: -32602 } });
    expect(k.yurutucu.yurut).not.toHaveBeenCalled();
    const okuma = await k.istek({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "cari_ara", arguments: {} } });
    expect(okuma.sonuc).toHaveProperty("result");
  });

  it("bildirim gövdesiz 202 döner; bilinmeyen yöntem hata", async () => {
    const k = kur();
    const { sonuc } = await k.istek({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(sonuc).toBeUndefined();
    expect(k.res.status).toHaveBeenCalledWith(202);
    expect((await k.istek({ jsonrpc: "2.0", id: 3, method: "resources/list" })).sonuc).toMatchObject({ error: { code: -32601 } });
  });
});
