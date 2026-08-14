const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();

async function main() {
  const updated = await p.store.update({
    where: { id: '0b54c944-28ba-4542-991a-4840c4801906' },
    data: { timezone: 'America/Caracas' },
    select: { id: true, name: true, timezone: true },
  });
  console.log(JSON.stringify(updated, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });
