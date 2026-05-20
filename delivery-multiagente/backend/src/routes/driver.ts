import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth';
import { DeliveryAgent } from '../agents/DeliveryAgent';
import { prisma } from '../lib/prisma';

const router = Router();
const deliveryAgent = new DeliveryAgent();

router.use(authMiddleware, requireRole('ADMIN', 'REPARTIDOR'));

// Pedidos en reparto
router.get('/active', async (_req, res, next) => {
  try { res.json(await deliveryAgent.getActiveDeliveries()); } catch (err) { next(err); }
});

// Pedidos listos para asignar
router.get('/ready-orders', async (_req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: 'LISTO_PARA_REPARTO' },
      include: { items: { include: { product: true } } },
    });
    res.json(orders);
  } catch (err) { next(err); }
});

// Confirmar entrega
router.post('/orders/:id/confirm-delivery', async (req, res, next) => {
  try {
    const result = await deliveryAgent.confirmDelivery(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

// Pedidos completados (historial del día)
router.get('/completed', async (_req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: { in: ['ENTREGADO', 'CERRADO'] } },
      include: { items: { include: { product: true } }, driver: true },
      orderBy: { updated_at: 'desc' },
      take: 30,
    });
    res.json(orders);
  } catch (err) { next(err); }
});

// Repartidores disponibles
router.get('/available-drivers', async (_req, res, next) => {
  try { res.json(await deliveryAgent.getAvailableDrivers()); } catch (err) { next(err); }
});

export default router;
