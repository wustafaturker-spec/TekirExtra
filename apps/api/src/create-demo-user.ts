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
  const vkn = "1234567890";

  let tenant = await prisma.tenant.findUnique({ where: { vkn } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        id: randomUUID(),
        unvan: "TekirExtra Demo Şirketi",
        vkn,
        vergiDairesi: "Kadıköy VD",
      },
    });
  }

  const parolaHash = await argon2.hash(parola);
  let user = await prisma.user.findFirst({ where: { eposta } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        eposta,
        parolaHash,
        adSoyad: "Demo Yönetici",
        rol: "yonetici",
        epostaDogrulandi: true,
      },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { parolaHash, epostaDogrulandi: true },
    });
  }

  const kimlik = await prisma.authKimlik.findUnique({ where: { eposta } });
  if (!kimlik) {
    await prisma.authKimlik.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        tenantId: tenant.id,
        eposta,
      },
    });
  }

  console.log("DEMO_KULLANICI_OLUSTURULDU");
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
