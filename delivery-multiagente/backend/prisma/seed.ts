import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de base de datos...');

  // Crear usuarios admin, cocina, repartidor
  const adminHash = await bcrypt.hash('admin123', 10);
  const kitchenHash = await bcrypt.hash('cocina123', 10);
  const driverHash = await bcrypt.hash('repartidor123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@eltrujillano.com' },
    update: {},
    create: {
      name: 'Administrador',
      email: 'admin@eltrujillano.com',
      password_hash: adminHash,
      role: 'ADMIN',
    },
  });

  await prisma.user.upsert({
    where: { email: 'cocina@eltrujillano.com' },
    update: {},
    create: {
      name: 'Cocina Principal',
      email: 'cocina@eltrujillano.com',
      password_hash: kitchenHash,
      role: 'COCINA',
    },
  });

  await prisma.user.upsert({
    where: { email: 'repartidor@eltrujillano.com' },
    update: {},
    create: {
      name: 'Repartidor App',
      email: 'repartidor@eltrujillano.com',
      password_hash: driverHash,
      role: 'REPARTIDOR',
    },
  });

  console.log('✅ Usuarios creados');

  // Crear repartidores
  const drivers = [
    { name: 'Carlos Moya', phone: '987001001' },
    { name: 'Ana Torres', phone: '987001002' },
    { name: 'Juan Ríos', phone: '987001003' },
    { name: 'Repartidor 4', phone: '938749977' },
  ];

  for (const d of drivers) {
    await prisma.driver.upsert({
      where: { phone: d.phone },
      update: {},
      create: d,
    });
  }

  console.log('✅ Repartidores creados');

  // Crear productos del menú
  const products = [
    // Entradas
    { name: 'Ceviche de pescado', category: 'Entradas', description: 'Ceviche fresco con leche de tigre, ají limo y cancha serrana', price: 25.00 },
    { name: 'Causa limeña', category: 'Entradas', description: 'Causa rellena de atún o pollo con mayo y palta', price: 15.00 },
    { name: 'Tequeños de queso', category: 'Entradas', description: '6 unidades de tequeños crocantes rellenos de queso', price: 12.00 },
    { name: 'Anticuchos de corazón', category: 'Entradas', description: '3 palitos de anticuchos con papa y choclo', price: 18.00 },
    // Platos principales
    { name: 'Lomo saltado', category: 'Platos principales', description: 'Tiras de lomo con papas fritas, tomate y cebolla en salsa de soya', price: 30.00 },
    { name: 'Arroz con leche de tigre', category: 'Platos principales', description: 'Arroz con mariscos bañado en leche de tigre', price: 28.00 },
    { name: 'Pollo a la brasa 1/4', category: 'Platos principales', description: '1/4 de pollo a la brasa con papas fritas y ensalada', price: 22.00 },
    { name: 'Pollo a la brasa 1/2', category: 'Platos principales', description: '1/2 pollo a la brasa con papas fritas y ensalada', price: 38.00 },
    { name: 'Trucha frita', category: 'Platos principales', description: 'Trucha frita entera con arroz, papas y ensalada', price: 32.00 },
    { name: 'Ají de gallina', category: 'Platos principales', description: 'Ají de gallina clásico con arroz, papa y huevo', price: 22.00 },
    // Bebidas
    { name: 'Chicha morada', category: 'Bebidas', description: 'Vaso de chicha morada artesanal', price: 5.00 },
    { name: 'Inca Kola', category: 'Bebidas', description: 'Botella 500ml', price: 5.00 },
    { name: 'Agua mineral', category: 'Bebidas', description: 'Botella 625ml', price: 3.00 },
    { name: 'Maracuyá fresco', category: 'Bebidas', description: 'Vaso de jugo de maracuyá natural', price: 6.00 },
    { name: 'Cerveza Pilsen', category: 'Bebidas', description: 'Lata 355ml', price: 7.00 },
    // Postres
    { name: 'Arroz con leche', category: 'Postres', description: 'Porción de arroz con leche con canela', price: 8.00 },
    { name: 'Tres leches', category: 'Postres', description: 'Porción de torta tres leches', price: 10.00 },
    { name: 'Mazamorra morada', category: 'Postres', description: 'Porción de mazamorra morada con arroz con leche', price: 9.00 },
  ];

  for (const p of products) {
    const existing = await prisma.product.findFirst({ where: { name: p.name } });
    if (!existing) {
      await prisma.product.create({ data: p });
    }
  }

  console.log('✅ Productos creados:', products.length, 'items');
  console.log('\n📋 Credenciales de acceso:');
  console.log('  Admin:       admin@eltrujillano.com / admin123');
  console.log('  Cocina:      cocina@eltrujillano.com / cocina123');
  console.log('  Repartidor:  repartidor@eltrujillano.com / repartidor123');
  console.log('\n✅ Seed completado exitosamente.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
