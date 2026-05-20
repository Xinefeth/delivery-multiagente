import { CartItem } from '../types';

const carts = new Map<string, CartItem[]>();

export const cartService = {
  getCart(sessionId: string): CartItem[] {
    if (!carts.has(sessionId)) carts.set(sessionId, []);
    return carts.get(sessionId)!;
  },

  addItem(sessionId: string, item: CartItem): void {
    const cart = this.getCart(sessionId);
    const existing = cart.find(i => i.productId === item.productId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      cart.push({ ...item });
    }
  },

  /** Elimina todas las unidades del producto. Devuelve false si no estaba en el carrito. */
  removeItem(sessionId: string, productName: string): boolean {
    const cart = this.getCart(sessionId);
    const idx = cart.findIndex(i => i.productName.toLowerCase().includes(productName.toLowerCase()));
    if (idx === -1) return false;
    cart.splice(idx, 1);
    return true;
  },

  /**
   * Reduce qty unidades de un producto. Si qty >= cantidad actual, lo elimina.
   * Devuelve: 'decreased' | 'removed' | 'not_found'
   */
  decreaseItem(sessionId: string, productName: string, qty: number): 'decreased' | 'removed' | 'not_found' {
    const cart = this.getCart(sessionId);
    const idx = cart.findIndex(i => i.productName.toLowerCase().includes(productName.toLowerCase()));
    if (idx === -1) return 'not_found';
    const item = cart[idx];
    if (item.quantity <= qty) {
      cart.splice(idx, 1);
      return 'removed';
    }
    item.quantity -= qty;
    return 'decreased';
  },

  clearCart(sessionId: string): void {
    carts.set(sessionId, []);
  },

  getSubtotal(sessionId: string): number {
    return this.getCart(sessionId).reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  },

  getSummary(sessionId: string): string {
    const cart = this.getCart(sessionId);
    if (cart.length === 0) return 'Tu carrito está vacío.';
    const lines = cart.map(i => `• ${i.quantity}x ${i.productName} — S/ ${(i.quantity * i.unitPrice).toFixed(2)}`);
    const subtotal = this.getSubtotal(sessionId);
    lines.push(`\nSubtotal: S/ ${subtotal.toFixed(2)}`);
    lines.push(`Delivery: S/ 5.00`);
    lines.push(`*Total: S/ ${(subtotal + 5).toFixed(2)}*`);
    return lines.join('\n');
  },
};
