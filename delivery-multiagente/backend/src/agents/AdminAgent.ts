import { prisma } from '../lib/prisma';
import { AdminMetrics } from '../types';
import { PaymentAgent } from './PaymentAgent';
import { KitchenAgent } from './KitchenAgent';
import { DeliveryAgent } from './DeliveryAgent';
import { NotificationAgent } from './NotificationAgent';
import { OrderStatus } from '@prisma/client';

/**
 * AdminAgent
 * Responsabilidad: Gestión administrativa del restaurante.
 */
export class AdminAgent {
  private paymentAgent: PaymentAgent;
  private kitchenAgent: KitchenAgent;
  private deliveryAgent: DeliveryAgent;
  private notificationAgent: NotificationAgent;

  constructor() {
    this.paymentAgent = new PaymentAgent();
    this.kitchenAgent = new KitchenAgent();
    this.deliveryAgent = new DeliveryAgent();
    this.notificationAgent = new NotificationAgent();
  }

  async getOrders(status?: OrderStatus | OrderStatus[]) {
    const where = status
      ? { status: Array.isArray(status) ? { in: status } : status }
      : {};
    return prisma.order.findMany({
      where,
      include: {
        items: { include: { product: true } },
        driver: true,
        payments: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async validatePayment(orderId: string, approve: boolean, adminNotes?: string) {
    await this.paymentAgent.validatePayment(orderId, approve, adminNotes);
    if (approve) {
      await this.kitchenAgent.receiveOrder(orderId);
    }
    return { success: true, approved: approve };
  }

  async getMetrics(): Promise<AdminMetrics> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, pending, delivered, todayOrders] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: { in: ['PAGO_ENVIADO', 'PAGO_PENDIENTE'] } } }),
      prisma.order.count({ where: { status: { in: ['ENTREGADO', 'CERRADO'] } } }),
      prisma.order.findMany({ where: { created_at: { gte: today } } }),
    ]);

    const estimatedRevenue = todayOrders
      .filter(o => ['ENTREGADO', 'CERRADO', 'EN_REPARTO', 'EN_COCINA', 'LISTO_PARA_REPARTO', 'PAGO_VALIDADO'].includes(o.status))
      .reduce((s, o) => s + o.total, 0);

    return {
      totalOrders: total,
      pendingOrders: pending,
      deliveredOrders: delivered,
      estimatedRevenue,
      ordersToday: todayOrders.length,
    };
  }

  async getProducts() {
    return prisma.product.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  async updateProduct(id: string, data: { name?: string; price?: number; is_available?: boolean; description?: string }) {
    return prisma.product.update({ where: { id }, data });
  }

  async createProduct(data: { name: string; category: string; price: number; description?: string }) {
    return prisma.product.create({ data });
  }

  async getDrivers() {
    return prisma.driver.findMany({ orderBy: { name: 'asc' } });
  }

  async updateDriver(id: string, data: { name?: string; phone?: string; is_available?: boolean }) {
    return prisma.driver.update({ where: { id }, data });
  }

  async createDriver(data: { name: string; phone: string }) {
    return prisma.driver.create({ data });
  }

  async getPendingPayments() {
    // Incluye: pendientes de validación manual + auto-validados recientemente para auditoría
    return prisma.order.findMany({
      where: {
        status: {
          in: ['PAGO_ENVIADO', 'PAGO_PENDIENTE', 'PAGO_VALIDADO', 'PAGO_RECHAZADO'],
        },
        payments: { some: { proof_url: { not: null } } },
      },
      include: {
        items: { include: { product: true } },
        payments: { orderBy: { created_at: 'desc' }, take: 1 },
      },
      orderBy: { updated_at: 'desc' },
    });
  }

  async assignDriverToOrder(orderId: string) {
    return this.deliveryAgent.assignDriver(orderId);
  }
}
