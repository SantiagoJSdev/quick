import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const options: any = {
  adapter: { provider: "postgres", url: process.env.DATABASE_URL }
};

const prisma = new PrismaClient(options);

async function main() {
  await prisma.$connect();
  console.log("✅ Conectado a la DB");
  await prisma.$disconnect();
}

main().catch(e => {
  console.error("❌ Error:", e);
  process.exit(1);
});