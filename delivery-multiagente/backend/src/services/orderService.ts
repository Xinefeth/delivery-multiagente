import { prisma } from '../lib/prisma';
import { CartItem } from '../types';
import { Order } from '@prisma/client';

export interface CreateOrderInput {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryReference: string;
  cart: CartItem[];
}

export const orderService = {
  async createOrder(input: CreateOrderInput): Promise<Order> {
    const subtotal = input.cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const deliveryFee = 5.0;
    const total = subtotal + deliveryFee;

    return prisma.order.create({
      data: {
        customer_name: input.customerName,
        customer_phone: input.customerPhone,
        delivery_address: input.deliveryAddress,
        delivery_reference: input.deliveryReference,
        subtotal,
        delivery_fee: deliveryFee,
        total,
        status: 'PAGO_PENDIENTE',
        items: {
          create: input.cart.map(i => ({
            product_id: i.productId,
            quantity: i.quantity,
            unit_price: i.unitPrice,
            subtotal: i.quantity * i.unitPrice,
          })),
        },
      },
    });
  },

  async getStatus(orderId: string) {
    return prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        customer_name: true,
        total: true,
        driver: { select: { name: true, phone: true } },
      },
    });
  },

  async saveProof(orderId: string, proofUrl: string) {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAGO_ENVIADO' } });
    await prisma.payment.create({
      data: { order_id: orderId, method: 'yape_plin', proof_url: proofUrl, amount: 0 },
    });
  },
};
