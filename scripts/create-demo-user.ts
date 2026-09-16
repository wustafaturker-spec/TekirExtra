import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_MIGRATE ?? "postgresql://tekir:tekir@localhost:5433/tekirextra",
    },
  },
});

async function main() {
  const eposta = "admin@tekirextra.local";
  const parola = "Tekir2026x";

  const mevcut = await prisma.user.findFirst({ where: { eposta } });
  if (mevcut) {
    console.log(`Demo kullanıcısı zaten mevcut: ${eposta}`);
    return;
  }

  const tenantId = randomUUID();
  const userId = randomUUID();
  const parolaHash = await argon2.hash(parola);

  await prisma.tenant.create({
    data: {
      id: tenantId,
      unvan: "TekirExtra Demo Şirketi",
      vkn: "1234567890",
      vergiDairesi: "Kadıköy VD",
    },
  });

  await prisma.user.create({
    data: {
      id: userId,
      tenantId,
      eposta,
      parolaHash,
      adSoyad: "Demo Yönetici",
      rol: "yonetici",
      epostaDogrulandi: true,
    },
  });

  // Kimlik tablosu yalnız e-postayı kiracıya eşler; parola kullanıcı kaydındadır.
  await prisma.authKimlik.create({
    data: {
      userId,
      tenantId,
      eposta,
    },
  });

  console.log("Demo kullanıcısı başarıyla oluşturuldu!");
  console.log(`E-posta: ${eposta}`);
  console.log(`Parola : ${parola}`);
}

main()
  .catch((err) => {
    console.error("Hata:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
