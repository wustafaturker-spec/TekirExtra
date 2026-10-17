// Geliştirmede izleme modu: `tsc --watch` derler, ilk derleme bitince
// `node --watch` uygulamayı başlatır; sonraki her derlemede süreç kendiliğinden
// yeniden başlar. Kullanım: node scripts/dev-izle.mjs [main|worker]
import { spawn, spawnSync } from "node:child_process";

const giris = process.argv[2] === "worker" ? "dist/main.worker.js" : "dist/main.js";
const yigin = process.env.NODE_OPTIONS?.includes("max-old-space-size") ? process.env.NODE_OPTIONS : `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=6144`.trim();

const uret = spawnSync("pnpm", ["exec", "prisma", "generate"], { stdio: "inherit" });
if (uret.status !== 0) process.exit(uret.status ?? 1);

const tsc = spawn("pnpm", ["exec", "tsc", "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"], {
  stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, NODE_OPTIONS: yigin },
});

let uygulama = null;
tsc.stdout.on("data", (parca) => {
  const metin = parca.toString();
  process.stdout.write(metin);
  // tsc her derleme turunun sonunda "Found N errors. Watching for file changes." yazar.
  if (!uygulama && /Watching for file changes/.test(metin)) {
    uygulama = spawn(process.execPath, ["--watch-path=dist", "--watch-preserve-output", giris], { stdio: "inherit" });
    uygulama.on("exit", (kod) => { if (kod !== null && kod !== 0) console.error(`[dev-izle] ${giris} ${kod} koduyla çıktı; kaynak düzeltilince yeniden başlar.`); });
  }
});

const kapat = () => { uygulama?.kill("SIGTERM"); tsc.kill("SIGTERM"); process.exit(0); };
process.on("SIGINT", kapat);
process.on("SIGTERM", kapat);
tsc.on("exit", (kod) => { uygulama?.kill("SIGTERM"); process.exit(kod ?? 0); });
