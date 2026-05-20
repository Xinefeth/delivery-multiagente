import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const driver = await prisma.driver.upsert({
    where: { phone: '938749977' },
    update: { name: 'Diego Tirado', is_available: true },
    create: { name: 'Diego Tirado', phone: '938749977', is_available: true },
  });
  console.log('✅ Repartidor creado/actualizado:', driver);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
