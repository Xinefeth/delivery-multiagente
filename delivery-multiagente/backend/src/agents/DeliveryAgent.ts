import { prisma } from '../lib/prisma';
import { NotificationAgent } from './NotificationAgent';
import { sendWhatsAppMessage } from '../services/whatsappService';

/**
 * DeliveryAgent
 * Responsabilidad: Asignar repartidor, gestionar entrega, confirmar recepción.
 */
export class DeliveryAgent {
  private notificationAgent: NotificationAgent;

  constructor() {
    this.notificationAgent = new NotificationAgent();
  }

  async assignDriver(orderId: string): Promise<{ success: boolean; message: string; driverName?: string }> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, message: 'Pedido no encontrado' };
    if (order.status !== 'LISTO_PARA_REPARTO') {
      return { success: false, message: `El pedido no está listo para reparto (estado: ${order.status})` };
    }

    const driver = await prisma.driver.findFirst({ where: { is_available: true } });
    if (!driver) return { success: false, message: 'No hay repartidores disponibles en este momento' };

    const orderWithItems = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: { status: 'EN_REPARTO', assigned_driver_id: driver.id },
      }),
      prisma.driver.update({ where: { id: driver.id }, data: { is_available: false } }),
    ]);

    await this.notificationAgent.saveNotification(
      orderId,
      `🛵 Tu pedido está en camino con ${driver.name} (${driver.phone}). ¡Llegará pronto!`,
      'chatbot'
    );

    // Notificación WhatsApp al repartidor
    const testPhone = process.env.DRIVER_TEST_PHONE || driver.phone;
    const peruPhone = `51${testPhone.replace(/\D/g, '')}`;
    const itemsList = orderWithItems?.items.map(i => `• ${i.quantity}x ${i.product.name}`).join('\n') ?? '';
    const whatsappMsg = [
      `🛵 *NUEVO PEDIDO ASIGNADO*`,
      `Pedido #${orderId.slice(-6).toUpperCase()}`,
      ``,
      `*Cliente:* ${orderWithItems?.customer_name}`,
      `*Tel. cliente:* ${orderWithItems?.customer_phone}`,
      `*Dirección:* ${orderWithItems?.delivery_address}`,
      orderWithItems?.delivery_reference ? `*Referencia:* ${orderWithItems.delivery_reference}` : '',
      ``,
      `*Productos:*`,
      itemsList,
      ``,
      `*Total:* S/ ${Number(orderWithItems?.total ?? 0).toFixed(2)}`,
    ].filter(Boolean).join('\n');

    await sendWhatsAppMessage(peruPhone, whatsappMsg);

    return { success: true, message: `Repartidor ${driver.name} asignado`, driverName: driver.name };
  }

  async confirmDelivery(orderId: string, driverId?: string): Promise<{ success: boolean; message: string }> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, message: 'Pedido no encontrado' };
    if (order.status !== 'EN_REPARTO') {
      return { success: false, message: `El pedido no está en reparto (estado: ${order.status})` };
    }

    const dId = driverId ?? order.assigned_driver_id;
    const tx: any[] = [
      prisma.order.update({ where: { id: orderId }, data: { status: 'ENTREGADO' } }),
    ];
    if (dId) {
      tx.push(prisma.driver.update({ where: { id: dId }, data: { is_available: true } }));
    }
    await prisma.$transaction(tx);

    await this.notificationAgent.saveNotification(
      orderId,
      '✅ ¡Tu pedido ha sido entregado! Esperamos que lo disfrutes. 😊',
      'chatbot'
    );

    // Cerrar pedido automáticamente y crear encuesta
    await this.closeOrder(orderId);

    return { success: true, message: 'Entrega confirmada exitosamente' };
  }

  private async closeOrder(orderId: string) {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'CERRADO' } });
    const existing = await prisma.survey.findUnique({ where: { order_id: orderId } });
    if (!existing) await prisma.survey.create({ data: { order_id: orderId } });
    await this.notificationAgent.saveNotification(
      orderId,
      '⭐ ¿Cómo fue tu experiencia? Califica tu pedido del 1 al 5 (ej: "calificación 5").', 'chatbot'
    );
  }

  async getActiveDeliveries() {
    return prisma.order.findMany({
      where: { status: 'EN_REPARTO' },
      include: { driver: true, items: { include: { product: true } } },
    });
  }

  async getAvailableDrivers() {
    return prisma.driver.findMany({ where: { is_available: true } });
  }
}
