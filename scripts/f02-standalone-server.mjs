import { createRequire } from "node:module";
import { join } from "node:path";
import { adayiDogrula } from "./f02-aday-dogrula.mjs";
if (!process.env.F02_RELEASE_ROOT) throw new Error("F02_RELEASE_ROOT gerekli");
const aday = await adayiDogrula(process.env.F02_RELEASE_ROOT);
createRequire(import.meta.url)(join(aday.aday, "web/apps/web/server.js"));
