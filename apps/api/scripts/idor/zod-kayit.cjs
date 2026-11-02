"use strict";
/**
 * Yalnız IDOR test kabında `node -r` ile yüklenir. Doğrulaması başarısız olan son
 * zod şemasını :3999 üzerinden verir; tarama bununla geçerli gövde üretir.
 * zod'un dışa aktarımları salt okunur olduğu için parse modülü yüklenirken sarılır.
 */
const http = require("node:http");
const Module = require("node:module");
const istek = Module.createRequire("/runtime/apps/api/dist/main.js");

let son = null;
const kaydet = (sema) => { try { son = istek("zod").toJSONSchema(sema, { unrepresentable: "any", io: "input" }); } catch { son = { hata: true }; } };

let sarili = null;
const asilYukle = Module._load;
Module._load = function (hedef, ust, ...kalan) {
  const m = asilYukle.call(this, hedef, ust, ...kalan);
  if (hedef !== "./parse.cjs" || !ust?.filename?.includes("/zod/v4/classic/")) return m;
  sarili ??= {
    ...m,
    safeParse: (sema, veri, ...k) => { const s = m.safeParse(sema, veri, ...k); if (!s.success) kaydet(sema); return s; },
    parse: (sema, veri, ...k) => { try { return m.parse(sema, veri, ...k); } catch (e) { kaydet(sema); throw e; } },
  };
  return sarili;
};

http.createServer((_i, y) => { const g = son; son = null; y.setHeader("content-type", "application/json"); y.end(JSON.stringify(g)); }).listen(3999).unref();
