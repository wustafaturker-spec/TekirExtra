import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

/**
 * S3 uyumlu dosya deposu (4. aşama S-01 kararı: MinIO). Meta veri `ekler`
 * tablosunda, gövde burada; anahtarlar kiracı kimliğiyle öneklenir.
 */
@Injectable()
export class DepoService implements OnModuleInit {
  private readonly logger = new Logger(DepoService.name);
  private readonly kova = process.env.S3_KOVA ?? "tekirextra-ekler";
  private readonly istemci = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9002",
    region: process.env.S3_BOLGE ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.S3_ERISIM_ANAHTARI ?? "tekir",
      secretAccessKey: process.env.S3_GIZLI_ANAHTAR ?? "tekir-minio-dev",
    },
    // MinIO sanal alan adı değil, yol tabanlı adresleme bekler
    forcePathStyle: true,
  });

  /** Kova yoksa oluşturur; depo erişilemezse uygulamayı düşürmez. */
  async onModuleInit(): Promise<void> {
    try {
      await this.istemci.send(new HeadBucketCommand({ Bucket: this.kova }));
    } catch {
      try {
        await this.istemci.send(new CreateBucketCommand({ Bucket: this.kova }));
        this.logger.log(`'${this.kova}' kovası oluşturuldu`);
      } catch (hata) {
        this.logger.warn(
          `Dosya deposuna erişilemiyor (${String(hata)}); ek yükleme istekleri başarısız olur`,
        );
      }
    }
  }

  async yukle(anahtar: string, icerik: Buffer, mime: string): Promise<void> {
    await this.istemci.send(
      new PutObjectCommand({
        Bucket: this.kova,
        Key: anahtar,
        Body: icerik,
        ContentType: mime,
      }),
    );
  }

  async indir(anahtar: string): Promise<Buffer> {
    const sonuc = await this.istemci.send(
      new GetObjectCommand({ Bucket: this.kova, Key: anahtar }),
    );
    const bytes = await sonuc.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Depo nesnesi okunamadı: ${anahtar}`);
    return Buffer.from(bytes);
  }

  async sil(anahtar: string): Promise<void> {
    await this.istemci.send(
      new DeleteObjectCommand({ Bucket: this.kova, Key: anahtar }),
    );
  }
}
