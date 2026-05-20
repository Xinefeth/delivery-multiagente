import { prisma } from '../lib/prisma';
import { OrderStatus } from '@prisma/client';

/**
 * NotificationAgent
 * Responsabilidad: Centralizar y persistir todas las notificaciones del sistema.
 */
export class NotificationAgent {
  private readonly STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
    COTIZACION: '📋 Tu pedido ha sido creado y está listo para el pago.',
    PAGO_ENVIADO: '📸 Comprobante recibido. En proceso de validación.',
    PAGO_VALIDADO: '✅ ¡Pago confirmado! Tu pedido pasa a cocina.',
    PAGO_RECHAZADO: '❌ Comprobante rechazado. Por favor envía uno nuevo.',
    EN_COCINA: '🍳 Tu pedido está siendo preparado en cocina.',
    LISTO_PARA_REPARTO: '📦 ¡Tu pedido está listo! Asignando repartidor.',
    EN_REPARTO: '🛵 Tu pedido está en camino. ¡Casi llega!',
    ENTREGADO: '✅ ¡Pedido entregado! Buen provecho. 🍽️',
    CERRADO: '🌟 Pedido cerrado. ¡Gracias por preferirnos!',
    CANCELADO: '❌ Tu pedido ha sido cancelado.',
  };

  async saveNotification(orderId: string, message: string, channel: string = 'chatbot'): Promise<void> {
    await prisma.notification.create({ data: { order_id: orderId, message, channel } });
  }

  async notifyStatusChange(orderId: string, status: OrderStatus): Promise<void> {
    const message = this.STATUS_MESSAGES[status];
    if (message) await this.saveNotification(orderId, message, 'chatbot');
  }

  async getOrderNotifications(orderId: string) {
    return prisma.notification.findMany({
      where: { order_id: orderId },
      orderBy: { sent_at: 'asc' },
    });
  }

  async getLatestNotification(orderId: string, channel: string = 'chatbot') {
    return prisma.notification.findFirst({
      where: { order_id: orderId, channel },
      orderBy: { sent_at: 'desc' },
    });
  }

  getStatusMessage(status: OrderStatus): string {
    return this.STATUS_MESSAGES[status] ?? `Estado actualizado: ${status}`;
  }

  getSurveyMessage(): string {
    return '⭐ *¿Cómo calificarías tu pedido?*\n\nEscribe un número del 1 al 5:\n1 = Muy malo  |  5 = Excelente\n\nTambién puedes agregar un comentario.';
  }
}
