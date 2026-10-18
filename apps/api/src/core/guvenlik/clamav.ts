import { connect } from "node:net";

/**
 * ClamAV (clamd) INSTREAM taraması. `CLAMAV_HOST` tanımlı değilse tarama
 * atlanır ("kapali"); tanımlıysa her yükleme taranır ve tarama yapılamazsa
 * ("hata") çağıran yüklemeyi reddeder. Docker'da `clamav` servisi
 * `tarama` profiliyle açılır: `docker compose --profile tarama up -d clamav`
 * (docker-compose.yml).
 */
export type TaramaSonucu = { durum: "kapali" | "temiz" | "hata" } | { durum: "zararli"; imza: string };

const PARCA = 64 * 1024;

export function clamavTara(icerik: Buffer, zamanAsimiMs = Number(process.env.CLAMAV_ZAMAN_ASIMI_MS ?? 30_000)): Promise<TaramaSonucu> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return Promise.resolve({ durum: "kapali" });
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve) => {
    let yanit = "";
    let bitti = false;
    const bitir = (s: TaramaSonucu) => { if (!bitti) { bitti = true; soket.destroy(); resolve(s); } };
    const soket = connect({ host, port }, () => {
      soket.write("zINSTREAM\0");
      for (let i = 0; i < icerik.length; i += PARCA) {
        const parca = icerik.subarray(i, i + PARCA);
        const boy = Buffer.alloc(4);
        boy.writeUInt32BE(parca.length);
        soket.write(boy);
        soket.write(parca);
      }
      soket.write(Buffer.alloc(4)); // sıfır uzunluk: akış sonu
    });
    soket.setTimeout(zamanAsimiMs, () => bitir({ durum: "hata" }));
    soket.on("data", (d) => { yanit += d.toString("utf8"); });
    soket.on("error", () => bitir({ durum: "hata" }));
    soket.on("close", () => {
      const s = yanit.replace(/\0/g, "").trim();
      if (/:\s*OK$/.test(s)) bitir({ durum: "temiz" });
      else if (/FOUND$/.test(s)) bitir({ durum: "zararli", imza: s.replace(/^.*?:\s*/, "").replace(/\s*FOUND$/, "") });
      else bitir({ durum: "hata" });
    });
  });
}
