import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$connect();
    console.log("✅ Conectado");

    // Consulta con el client generado (si existe el modelo User)
    try {
      const users = await prisma.user.findMany({ take: 5 });
      console.log("Users sample:", users);
    } catch (e) {
      console.log("No se pudo ejecutar prisma.user.findMany() — quizás no hay datos:", e.message || e);
    }

    // Consulta raw segura: SELECT 1
    try {
      const select1 = await prisma.$queryRaw`SELECT 1 as result`;
      console.log("Raw query SELECT 1:", select1);
    } catch (e) {
      console.log("Error en $queryRaw:", e.message || e);
    }
  } finally {
    await prisma.$disconnect();
    console.log("✅ Desconectado");
  }
}

main().catch(e => { console.error(e); process.exit(1); });