import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

/**
 * Rapor V-2: büyüyen işlem tablolarında `take` vermeden geniş koşulla okuma, firma büyüdükçe
 * belleği ve yanıt süresini büyütür (bkz. API ve worker bellek taşmaları). Dosya başına bugünkü
 * sayı tavandır; sayı artarsa sorguya sayfa/sınır ekleyin ya da toplamı veritabanında hesaplayın.
 * Bilinçli bir istisna gerekiyorsa tavanı gerekçesiyle artırın. Sayı azalınca tavanı düşürün.
 */
const BUYUYEN = new Set(["fatura", "faturaSatir", "cariHareket", "stokHareket", "kasaBankaHareket", "belge", "belgeSatir", "gelenEbelge", "gelenEirsaliye", "ebelgeKayit", "auditLog", "bildirim", "bildirimTeslimati", "epostaGonderim", "gelenEposta", "cekSenet", "masraf", "faturaKapama", "crmEtkilesim", "personelBordro", "aiCagriIzi", "belgeDurumGecmisi", "smsGonderim", "posTahsilat", "krediKartiHareket", "bankaEkstreSatir", "odemeSozu", "uretimEmri", "gelenEpostaEki", "eirsaliyeKayit", "duzeltmeKaydi", "pazaryeriSiparis", "pazaryeriKesinti", "satinAlmaTalebi"]);
/** Tek kayda bağlı okuma (kimlik, bağlı kayıt, kaynak referansı) dar sayılır. */
const DAR = /\bid: ?\{ ?in\b|\bid: ?[a-zA-Z]|[a-zA-Z]Id: ?(?!\{ ?not)[a-zA-Z_.!]+[,} ]|[a-zA-Z]Id: ?\{ ?in\b|uuid|anahtar|kaynakRef|\bno: ?\{ ?in|satirOzeti/;

const TAVAN: Record<string, number> = {
  "bildirimler/bildirim-uretici.service.ts": 2, "bildirimler/bildirim.service.ts": 1,
  "belgeler/belgeler.service.ts": 1, "belgeler/irsaliye-eslesme.ts": 3,
  "cari/cari.raporlar.ts": 2, "cari/cari.service.ts": 8, "cari/son-odeme.ts": 1,
  "duzeltmeler/duzeltmeler.service.ts": 3,
  "ebelge/ebelge.service.ts": 3, "ebelge/eirsaliye.service.ts": 3,
  "fatura/denklestirme.ts": 4, "fatura/kur-farki-karsilik.ts": 1, "fatura/fatura.raporlar.ts": 4, "fatura/fatura.service.ts": 4, "fatura/kdv-beyan.ts": 1, "fatura/mahsup.ts": 1, "fatura/teslim-yeri.ts": 1, "fatura/vergi.raporlar.ts": 1,
  "kasa-banka/cek-bordro.service.ts": 1, "kasa-banka/ekstre.service.ts": 4, "kasa-banka/kasa-banka.raporlar.ts": 3, "kasa-banka/kasa-banka.service.ts": 4,
  "mali-musavir/mali-musavir.service.ts": 2, "mali-musavir/muhasebe/fis-okuyucu.ts": 8,
  "nakit-akisi/nakit-akisi.service.ts": 5,
  "pazaryeri/pazaryeri.service.ts": 4, "personel/bordro-pusula.service.ts": 1, "personel/personel-rapor.service.ts": 2, "personel/personel.service.ts": 3, "personel/self-servis.service.ts": 1,
  "pesin-vergi/pesin-vergi-kaynaklari.ts": 1, "projeler/projeler.service.ts": 2,
  "rapor/rapor.service.ts": 3, "rapor/tahakkuk.ts": 3,
  "stok/stok-maliyet.service.ts": 1, "stok/stok.raporlar.ts": 2, "stok/urun-hareket.raporlar.ts": 1,
  "uretim/uretim.service.ts": 3, "vergi-takvimi/vergi-takvimi.okuma.ts": 3,
};

function sinirsizSorgular(kok: string): Map<string, string[]> {
  const sonuc = new Map<string, string[]>();
  const gez = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((g) => g.isDirectory() ? gez(join(d, g.name)) : g.name.endsWith(".ts") && !g.name.endsWith(".test.ts") ? [join(d, g.name)] : []);
  for (const dosya of gez(kok)) {
    const kaynak = ts.createSourceFile(dosya, readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
    const ziyaret = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "findMany"
        && ts.isPropertyAccessExpression(n.expression.expression) && BUYUYEN.has(n.expression.expression.name.text)) {
        const arg = n.arguments[0];
        let sinirli = false, where = "";
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const p of arg.properties) {
            if (ts.isSpreadAssignment(p)) sinirli = true;
            const ad = p.name?.getText(kaynak);
            if (ad === "take" || ad === "distinct") sinirli = true;
            if (ad === "where") where = p.getText(kaynak).replace(/\s+/g, " ");
          }
        } else if (arg) sinirli = true;
        if (!sinirli && !DAR.test(where)) {
          const ad = relative(kok, dosya).replaceAll("\\", "/");
          sonuc.set(ad, [...(sonuc.get(ad) ?? []), `${kaynak.getLineAndCharacterOfPosition(n.getStart()).line + 1}`]);
        }
      }
      ts.forEachChild(n, ziyaret);
    };
    ziyaret(kaynak);
  }
  return sonuc;
}

// Bütün kaynağı ayrıştırır; tam test koşusunda 5 sn varsayılanını aşabiliyor.
vi.setConfig({ testTimeout: 30_000 });

describe("büyüyen tablolarda sınırsız okuma", () => {
  it("dosya başına sayı tavanı aşmaz", () => {
    const bulunan = sinirsizSorgular(join(__dirname, ".."));
    const asanlar = [...bulunan].filter(([d, s]) => s.length > (TAVAN[d] ?? 0)).map(([d, s]) => `${d}: ${s.length} (tavan ${TAVAN[d] ?? 0}; satırlar ${s.join(", ")})`);
    expect(asanlar).toEqual([]);
  });
  it("tavan güncel kalır: azalan dosyanın tavanı da düşürülür", () => {
    const bulunan = sinirsizSorgular(join(__dirname, ".."));
    const fazla = Object.entries(TAVAN).filter(([d, t]) => (bulunan.get(d)?.length ?? 0) < t).map(([d, t]) => `${d}: ${bulunan.get(d)?.length ?? 0} < ${t}`);
    expect(fazla).toEqual([]);
  });
});
