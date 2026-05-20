import { prisma } from '../lib/prisma';
import { NotificationAgent } from './NotificationAgent';
import { DeliveryAgent } from './DeliveryAgent';

/**
 * KitchenAgent
 * Responsabilidad: Recibir pedidos validados, notificar cocina, marcar como listo.
 * REGLA: Solo recibe pedidos con estado PAGO_VALIDADO.
 */
export class KitchenAgent {
  private notificationAgent: NotificationAgent;

  constructor() {
    this.notificationAgent = new NotificationAgent();
  }

  async receiveOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });

    if (!order) return { success: false, message: 'Pedido no encontrado' };
    if (order.status !== 'PAGO_VALIDADO') {
      return { success: false, message: `Pedido en estado ${order.status}. Solo se aceptan pedidos con PAGO_VALIDADO.` };
    }

    await prisma.order.update({ where: { id: orderId }, data: { status: 'EN_COCINA' } });

    const itemsList = order.items.map(i => `• ${i.quantity}x ${i.product.name}`).join('\n');
    const kitchenMsg = `🔔 NUEVO PEDIDO #${orderId.slice(-6).toUpperCase()}\n\nCliente: ${order.customer_name}\nDirección: ${order.delivery_address}\n\nProductos:\n${itemsList}`;

    await this.notificationAgent.saveNotification(orderId, '🍳 Tu pedido está siendo preparado en cocina.', 'chatbot');
    await this.notificationAgent.saveNotification(orderId, kitchenMsg, 'kitchen');

    return { success: true, message: 'Pedido enviado a cocina correctamente' };
  }

  async markOrderReady(orderId: string): Promise<{ success: boolean; message: string }> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, message: 'Pedido no encontrado' };
    if (order.status !== 'EN_COCINA') {
      return { success: false, message: `El pedido no está en cocina (estado: ${order.status})` };
    }

    await prisma.order.update({ where: { id: orderId }, data: { status: 'LISTO_PARA_REPARTO' } });
    await this.notificationAgent.saveNotification(orderId, '📦 Tu pedido está listo. Asignando repartidor automáticamente...', 'chatbot');

    // Auto-asignar repartidor disponible
    const deliveryAgent = new DeliveryAgent();
    const assignResult = await deliveryAgent.assignDriver(orderId);
    if (!assignResult.success) {
      await this.notificationAgent.saveNotification(
        orderId,
        '⚠️ No hay repartidores disponibles en este momento. Te notificaremos cuando se asigne uno.',
        'chatbot'
      );
    }

    return { success: true, message: 'Pedido listo y repartidor asignado automáticamente' };
  }

  async getPendingOrders() {
    return prisma.order.findMany({
      where: { status: { in: ['EN_COCINA'] } },
      include: { items: { include: { product: true } } },
      orderBy: { created_at: 'asc' },
    });
  }
}
