import { prisma } from '../lib/prisma';
import { CartItem, OrderCreateInput } from '../types';
import { MenuAgent } from './MenuAgent';
import { Order } from '@prisma/client';

/**
 * OrderAgent
 * Responsabilidad: Capturar productos, estructurar el pedido, registrar en BD,
 * y calcular precios (subtotal, delivery, total).
 */
export class OrderAgent {
  private menuAgent: MenuAgent;
  readonly DELIVERY_FEE = 5.00;

  constructor() {
    this.menuAgent = new MenuAgent();
  }

  async parseAndAddToCart(cart: CartItem[], input: string): Promise<{ success: boolean; message: string }> {
    // Patrones: "2 lomo saltado", "lomo saltado x2", "1 ceviche", "tres leches"
    const patterns = [
      /^(\d+)\s+(.+)$/,
      /^(.+)\s+x(\d+)$/i,
      /^(.+)\s+x\s+(\d+)$/i,
    ];

    let quantity = 1;
    let productQuery = input.trim();

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) {
        if (pattern === patterns[0]) {
          quantity = parseInt(match[1]);
          productQuery = match[2];
        } else {
          productQuery = match[1];
          quantity = parseInt(match[2]);
        }
        break;
      }
    }

    if (quantity < 1 || quantity > 20) {
      return { success: false, message: 'Cantidad inválida (1-20)' };
    }

    const product = await this.menuAgent.findProductByNameOrNumber(productQuery);
    if (!product) {
      return { success: false, message: `Producto no encontrado: "${productQuery}"` };
    }
    if (!product.is_available) {
      return { success: false, message: `Lo sentimos, "${product.name}" no está disponible` };
    }

    const existing = cart.find(i => i.productId === product.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.push({ productId: product.id, productName: product.name, quantity, unitPrice: product.price });
    }
    return { success: true, message: `${quantity}x ${product.name} agregado al carrito` };
  }

  removeFromCart(cart: CartItem[], productName: string): { success: boolean; message: string } {
    const idx = cart.findIndex(i => i.productName.toLowerCase().includes(productName.toLowerCase()));
    if (idx === -1) return { success: false, message: `Producto no encontrado en carrito: "${productName}"` };
    const removed = cart.splice(idx, 1)[0];
    return { success: true, message: `${removed.productName} eliminado del carrito` };
  }

  getCartSummary(cart: CartItem[]): string {
    if (cart.length === 0) return '_(carrito vacío)_';
    return cart.map(i => `• ${i.quantity}x ${i.productName} — S/ ${(i.quantity * i.unitPrice).toFixed(2)}`).join('\n');
  }

  async createOrder(input: OrderCreateInput): Promise<Order> {
    const subtotal = input.cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const deliveryFee = 5.00;
    const total = subtotal + deliveryFee;

    const order = await prisma.order.create({
      data: {
        customer_name: input.customerName,
        customer_phone: input.customerPhone,
        delivery_address: input.deliveryAddress,
        delivery_reference: input.deliveryReference,
        subtotal,
        delivery_fee: deliveryFee,
        total,
        status: 'COTIZACION',
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
    return order;
  }

  async getOrderById(orderId: string) {
    return prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, driver: true, payments: true },
    });
  }

  async updateOrderStatus(orderId: string, status: any) {
    return prisma.order.update({ where: { id: orderId }, data: { status } });
  }

  calculateSubtotal(cart: CartItem[]): number {
    return cart.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  }

  calculateTotal(cart: CartItem[]): number {
    return Math.round((this.calculateSubtotal(cart) + this.DELIVERY_FEE) * 100) / 100;
  }

  generatePriceSummary(cart: CartItem[]): string {
    const subtotal = this.calculateSubtotal(cart);
    const total = this.calculateTotal(cart);
    const lines = cart.map(i => `• ${i.quantity}x ${i.productName} = S/ ${(i.quantity * i.unitPrice).toFixed(2)}`);
    return [
      ...lines,
      '─────────────────────',
      `💰 Subtotal:   S/ ${subtotal.toFixed(2)}`,
      `🛵 Delivery:   S/ ${this.DELIVERY_FEE.toFixed(2)}`,
      `💵 *TOTAL:     S/ ${total.toFixed(2)}*`,
    ].join('\n');
  }
}
