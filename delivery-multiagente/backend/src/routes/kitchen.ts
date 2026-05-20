import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth';
import { KitchenAgent } from '../agents/KitchenAgent';

const router = Router();
const kitchenAgent = new KitchenAgent();

router.use(authMiddleware, requireRole('ADMIN', 'COCINA'));

// Pedidos en cocina
router.get('/orders', async (_req, res, next) => {
  try { res.json(await kitchenAgent.getPendingOrders()); } catch (err) { next(err); }
});

// Marcar pedido como listo
router.post('/orders/:id/ready', async (req, res, next) => {
  try {
    const result = await kitchenAgent.markOrderReady(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
