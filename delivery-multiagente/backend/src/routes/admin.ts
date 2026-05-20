import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth';
import { AdminAgent } from '../agents/AdminAgent';

const router = Router();
const adminAgent = new AdminAgent();

router.use(authMiddleware, requireRole('ADMIN'));

// Pedidos
router.get('/orders', async (req, res, next) => {
  try {
    const { status } = req.query;
    const orders = await adminAgent.getOrders(status as any);
    res.json(orders);
  } catch (err) { next(err); }
});

router.get('/metrics', async (_req, res, next) => {
  try {
    const metrics = await adminAgent.getMetrics();
    res.json(metrics);
  } catch (err) { next(err); }
});

// Validar pago
router.post('/orders/:id/validate-payment', async (req, res, next) => {
  try {
    const { approve, adminNotes } = req.body;
    const result = await adminAgent.validatePayment(req.params.id, approve, adminNotes);
    res.json(result);
  } catch (err) { next(err); }
});

// Asignar repartidor
router.post('/orders/:id/assign-driver', async (req, res, next) => {
  try {
    const result = await adminAgent.assignDriverToOrder(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

// Productos
router.get('/products', async (_req, res, next) => {
  try { res.json(await adminAgent.getProducts()); } catch (err) { next(err); }
});

router.post('/products', async (req, res, next) => {
  try { res.status(201).json(await adminAgent.createProduct(req.body)); } catch (err) { next(err); }
});

router.patch('/products/:id', async (req, res, next) => {
  try { res.json(await adminAgent.updateProduct(req.params.id, req.body)); } catch (err) { next(err); }
});

// Repartidores
router.get('/drivers', async (_req, res, next) => {
  try { res.json(await adminAgent.getDrivers()); } catch (err) { next(err); }
});

router.post('/drivers', async (req, res, next) => {
  try { res.status(201).json(await adminAgent.createDriver(req.body)); } catch (err) { next(err); }
});

router.patch('/drivers/:id', async (req, res, next) => {
  try { res.json(await adminAgent.updateDriver(req.params.id, req.body)); } catch (err) { next(err); }
});

// Pagos pendientes
router.get('/pending-payments', async (_req, res, next) => {
  try { res.json(await adminAgent.getPendingPayments()); } catch (err) { next(err); }
});

export default router;
