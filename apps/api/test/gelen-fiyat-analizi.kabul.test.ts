import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, type Prisma, type FaturaDurum, type FaturaTip } from "@prisma/client";
import { afterAll, expect, it } from "vitest";
import { EbelgeService } from "../src/ebelge/ebelge.service";
import { baglamlaCalistir } from "../src/core/istek-baglami";
const envDosyasi = resolve(__dirname, "../.env");
if (existsSync(envDosyasi)) process.loadEnvFile(envDosyasi);
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
afterAll(() => db.$disconnect());

const xml = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>TEST2026000000001</cbc:ID><cbc:IssueDate>2026-10-14</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount>1000</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount>900</cbc:TaxExclusiveAmount><cbc:PayableAmount>1080</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount>100</cbc:Amount></cac:AllowanceCharge>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>1000</cbc:LineExtensionAmount><cac:Item><cbc:Name>Ürün</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount>100</cbc:PriceAmount></cac:Price></cac:InvoiceLine></Invoice>`;

it("gerçek UBL ve PostgreSQL ile fiyat, tedarikçi/yıllık geçmiş ve tenant izolasyonu tutarlıdır; test verileri rollback edilir", async () => {
  const tenantA = randomUUID(), tenantB = randomUUID(), userId = randomUUID();
  const rollback = new Error("Fiyat testi rollback");
  let tamam = false;
  try {
    await db.$transaction(async (tx) => {
      const baglam = (id: string) => tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
      async function kur(tenantId: string) {
        await baglam(tenantId);
        await tx.tenant.create({ data: { id: tenantId, unvan: "Fiyat analiz testi", vkn: tenantId } });
        const stok = await tx.stokKart.create({ data: { tenantId, kod: "URUN", ad: "Ürün" } });
        const cari = await tx.cariHesap.create({ data: { tenantId, kod: "TED1", unvan: "Tedarikçi 1", tip: "tedarikci", vknTckn: "1234567890" } });
        const gelen = await tx.gelenEbelge.create({ data: { tenantId, uuid: randomUUID(), belgeNo: "TEST2026000000001",
          gonderenVkn: "1234567890", gonderenUnvan: "Tedarikçi 1", tarih: new Date("2026-10-14"), xmlIcerik: xml } });
        return { stok, cari, gelen };
      }
      const b = await kur(tenantB), a = await kur(tenantA);
      async function alis(tarih: string, matrah: number, durum: FaturaDurum = "kesin", tip: FaturaTip = "alis", cariId = a.cari.id) {
        return tx.fatura.create({ data: { tenantId: tenantA, tip, durum, tarih: new Date(tarih), cariId,
          toplamBrut: matrah, toplamSatirIskontosu: 0, genelIskontoToplam: 0, toplamMatrah: matrah,
          toplamKdv: 0, toplamTevkifat: 0, toplamNetKdv: 0, genelToplam: matrah,
          satirlar: { create: { tenantId: tenantA, stokId: a.stok.id, miktar: 10, birim: "adet", birimFiyat: matrah / 10,
            matrah, kdvTutari: 0, netKdvTutari: 0, toplamTutar: matrah } } } });
      }
      await alis("2025-01-01", 640);
      const son = await alis("2026-09-01", 800);
      await alis("2026-09-02", 10, "taslak"); await alis("2026-09-03", 10, "iptal");
      await alis("2026-09-04", 10, "kesin", "satis"); await alis("2026-10-14", 10);
      const diger = await tx.cariHesap.create({ data: { tenantId: tenantA, kod: "TED2", unvan: "Tedarikçi 2", tip: "tedarikci" } });
      await alis("2026-09-05", 600, "kesin", "alis", diger.id);
      const once = await tx.fatura.count({ where: { tenantId: tenantA } });
      const prisma = { tenantIslem: async (id: string, fn: (islem: Prisma.TransactionClient) => Promise<unknown>) => {
        await baglam(id); return fn(tx);
      } };
      const service = Object.assign(Object.create(EbelgeService.prototype), { prisma }) as EbelgeService;
      const analiz = (tenantId: string, belgeId: string, stokId: string) => baglamlaCalistir({ tenantId, userId, rol: "muhasebe" },
        () => service.gelenFiyatAnalizi(belgeId, [{ siraNo: 1, stokId }]));
      const s = await analiz(tenantA, a.gelen.id, a.stok.id);
      expect(s.satirlar[0].analiz).toMatchObject({ netBirimFiyat: "90.000000",
        sonAlis: { faturaId: son.id, farkYuzde: "12.50" }, tedarikciYillik: { artisYuzde: "25.00" } });
      expect(s.satirlar[0].analiz?.tedarikciler.map((g) => g.unvan)).toEqual(["Tedarikçi 2", "Tedarikçi 1"]);
      expect(await tx.fatura.count({ where: { tenantId: tenantA } })).toBe(once);
      expect(await tx.gelenEbelge.findUnique({ where: { id: a.gelen.id } })).toMatchObject({ durum: "beklemede", faturaId: null });
      await expect(analiz(tenantB, a.gelen.id, a.stok.id)).rejects.toThrow("bulunamadı");
      await expect(analiz(tenantA, a.gelen.id, b.stok.id)).rejects.toThrow("eşleştirmesini");
      tamam = true;
      throw rollback;
    }, { timeout: 30000 });
  } catch (h) { if (h !== rollback) throw h; }
  expect(tamam).toBe(true);
  for (const tenantId of [tenantA, tenantB]) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      expect(await tx.tenant.findUnique({ where: { id: tenantId } })).toBeNull();
    });
  }
});
