/**
 * Gelen e-Fatura XML'ini nesne deposuna taşır.
 *   npx tsx --env-file=.env scripts/gelen-xml-tasi.ts kopyala
 *   npx tsx --env-file=.env scripts/gelen-xml-tasi.ts dogrula
 *   npx tsx --env-file=.env scripts/gelen-xml-tasi.ts temizle --onayla
 * `kopyala` ve `dogrula` veritabanındaki içeriği değiştirmez. `temizle` her satırı depodan
 * indirip veritabanı kopyasıyla karşılaştırır, yalnız birebir aynıysa kopyayı boşaltır.
 */
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { gelenXmlAc, gelenXmlAnahtari, gelenXmlOzeti, gelenXmlSikistir } from "../src/ebelge/gelen-xml-kurallari";

const kip = process.argv[2], PARTI = 20;
if (!["kopyala", "dogrula", "temizle"].includes(kip ?? "")) { console.error("Kip: kopyala | dogrula | temizle --onayla"); process.exit(2); }
if (kip === "temizle" && !process.argv.includes("--onayla")) { console.error("temizle veritabanı kopyasını boşaltır; --onayla gerekli"); process.exit(2); }

const url = process.env.DATABASE_URL_MIGRATE;
if (!url) { console.error("DATABASE_URL_MIGRATE gerekli"); process.exit(2); }
const db = new PrismaClient({ datasources: { db: { url } } }); // süper kullanıcı: RLS'e takılmaz
const kova = process.env.S3_KOVA ?? "tekirextra-ekler";
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9002", region: process.env.S3_BOLGE ?? "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ERISIM_ANAHTARI ?? "tekir", secretAccessKey: process.env.S3_GIZLI_ANAHTAR ?? "tekir-minio-dev" } });

interface Satir { id: string; tenant_id: string; uuid: string; xml_icerik: string | null; xml_anahtar: string | null; xml_ozet: string | null }
async function indir(anahtar: string) {
  const r = await s3.send(new GetObjectCommand({ Bucket: kova, Key: anahtar }));
  return Buffer.from((await r.Body!.transformToByteArray()));
}
async function parti(sonId: string): Promise<Satir[]> {
  const kosul = kip === "kopyala" ? `xml_icerik IS NOT NULL AND xml_anahtar IS NULL` : kip === "dogrula" ? `xml_anahtar IS NOT NULL OR xml_icerik IS NOT NULL` : `xml_icerik IS NOT NULL`;
  return db.$queryRawUnsafe<Satir[]>(`SELECT id::text, tenant_id::text, uuid, xml_icerik, xml_anahtar, xml_ozet FROM gelen_ebelgeler WHERE id > $1::uuid AND (${kosul}) ORDER BY id LIMIT ${PARTI}`, sonId);
}

async function main() {
  await s3.send(new HeadBucketCommand({ Bucket: kova })).catch(() => s3.send(new CreateBucketCommand({ Bucket: kova })));
  const say = { islenen: 0, tamam: 0, eksik: 0, hatali: 0, degisen: 0 }, sorunlu: string[] = [];
  let sonId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const satirlar = await parti(sonId);
    if (!satirlar.length) break;
    sonId = satirlar[satirlar.length - 1].id;
    for (const s of satirlar) {
      say.islenen += 1;
      try {
        if (kip === "kopyala") {
          const anahtar = gelenXmlAnahtari(s.tenant_id, s.uuid), xml = s.xml_icerik!;
          await s3.send(new PutObjectCommand({ Bucket: kova, Key: anahtar, Body: gelenXmlSikistir(xml), ContentType: "application/gzip" }));
          // Bu arada belge tazelendiyse yazılmaz; sonraki çalıştırma yeni hâlini alır.
          const n = await db.$executeRaw`UPDATE gelen_ebelgeler SET xml_anahtar = ${anahtar}, xml_ozet = ${gelenXmlOzeti(xml)} WHERE id = ${s.id}::uuid AND xml_anahtar IS NULL AND md5(xml_icerik) = md5(${xml})`;
          if (n === 1) say.tamam += 1; else say.degisen += 1;
          continue;
        }
        if (!s.xml_anahtar || !s.xml_ozet) { say.eksik += 1; sorunlu.push(s.id); continue; }
        const depodaki = gelenXmlAc(await indir(s.xml_anahtar), s.xml_ozet);
        if (s.xml_icerik !== null && depodaki !== s.xml_icerik) { say.hatali += 1; sorunlu.push(s.id); continue; }
        if (kip === "temizle") {
          const n = await db.$executeRaw`UPDATE gelen_ebelgeler SET xml_icerik = NULL WHERE id = ${s.id}::uuid AND xml_ozet = ${s.xml_ozet} AND md5(xml_icerik) = md5(${depodaki})`;
          if (n !== 1) { say.degisen += 1; continue; }
        }
        say.tamam += 1;
      } catch (hata) {
        say.hatali += 1; sorunlu.push(`${s.id}: ${hata instanceof Error ? hata.message : String(hata)}`.slice(0, 160));
      }
    }
    if (say.islenen % 1000 < PARTI) console.log(JSON.stringify({ kip, ...say }));
  }
  console.log(JSON.stringify({ kip, sonuc: say, sorunluIlk20: sorunlu.slice(0, 20) }));
  await db.$disconnect();
  if (say.eksik || say.hatali) process.exit(1);
}
void main().catch((h) => { console.error(h instanceof Error ? h.message : h); process.exit(1); });
