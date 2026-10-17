import { expect, it } from "vitest";
import { takipOlusturSemasi, takipGuncelleSemasi, gorusmeOlusturSemasi, takipListeSemasi } from "./tahsilat-takibi.semalar";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const g = { cariId: id, sorumluUserId: id, konu: "Tahsilat aranacak", neden: "tahsilat", sonrakiIslemTarihi: "2035-01-01", sonrakiIslem: "Telefonla ara", istekAnahtari: id };
it("takip gövdesi UUID ve metni normalleştirir", () => expect(takipOlusturSemasi.parse({ ...g, cariId: id.toUpperCase(), konu: "  Telefon  " })).toMatchObject({ cariId: id, konu: "Telefon" }));
it.each([{ tenantId: id }, { durum: "tamamlandi" }, { surum: 1 }, { konu: " " }, { sonrakiIslemTarihi: "2026-02-30" }, { sonrakiIslem: "" }, { neden: "baska" }])("geçersiz başlangıç alanı reddedilir %j", (fark) => expect(takipOlusturSemasi.safeParse({ ...g, ...fark }).success).toBe(false));
it.each(["acik", "beklemede", "tamamlandi", "iptal"])("%s durumunun sonraki işlem sözleşmesi", (durum) => {
  const aktif = ["acik", "beklemede"].includes(durum);
  const u = { beklenenSurum: 1, sorumluUserId: id, neden: "itiraz", durum, sonrakiIslemTarihi: aktif ? "2035-01-01" : null, sonrakiIslem: aktif ? "Tekrar ara" : null, gerekce: "Müşteri bildirdi" };
  expect(takipGuncelleSemasi.safeParse(u).success).toBe(true);
  expect(takipGuncelleSemasi.safeParse({ ...u, sonrakiIslemTarihi: aktif ? null : "2035-01-01" }).success).toBe(false);
});
it.each([0, -1, 1.5, "1", 2147483647])("görüşme sürümü %s reddedilir", (beklenenSurum) => expect(gorusmeOlusturSemasi.safeParse({ beklenenSurum, kanal: "telefon", gorusmeTarihi: "2026-10-15", not: "Görüşüldü", istekAnahtari: id }).success).toBe(false));
it("liste kapalı olmayan bir görünümü varsayar ve bilinmeyen sorguyu reddeder", () => {
  expect(takipListeSemasi.parse({})).toEqual({ gorunum: "bugun" });
  expect(takipListeSemasi.safeParse({ gorunum: "tum", tenantId: id }).success).toBe(false);
});
