import { prisma } from '../lib/prisma';
import { AgentResponse, CartItem, ChatSession, ChatState } from '../types';
import { MenuAgent } from './MenuAgent';
import { OrderAgent } from './OrderAgent';
import { PaymentAgent } from './PaymentAgent';
import { KitchenAgent } from './KitchenAgent';
import { NotificationAgent } from './NotificationAgent';

/**
 * OrchestratorAgent
 * Responsabilidad: Coordinar el flujo completo del pedido.
 * Mantiene el estado de cada sesión de chat y delega a los subagentes.
 */
export class OrchestratorAgent {
  private sessions: Map<string, ChatSession> = new Map();
  private menuAgent: MenuAgent;
  private orderAgent: OrderAgent;
  private paymentAgent: PaymentAgent;
  private kitchenAgent: KitchenAgent;
  private notificationAgent: NotificationAgent;

  constructor() {
    this.menuAgent = new MenuAgent();
    this.orderAgent = new OrderAgent();
    this.paymentAgent = new PaymentAgent();
    this.kitchenAgent = new KitchenAgent();
    this.notificationAgent = new NotificationAgent();
    // Limpiar sesiones inactivas cada 30 minutos
    setInterval(() => this.cleanInactiveSessions(), 30 * 60 * 1000);
  }

  private getSession(sessionId: string): ChatSession {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        chatState: 'GREETING',
        cart: [],
        lastActivity: new Date(),
      });
    }
    const session = this.sessions.get(sessionId)!;
    session.lastActivity = new Date();
    return session;
  }

  private cleanInactiveSessions() {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 horas
    for (const [id, session] of this.sessions.entries()) {
      if (session.lastActivity < cutoff) this.sessions.delete(id);
    }
  }

  async process(sessionId: string, message: string, attachmentUrl?: string): Promise<AgentResponse> {
    const session = this.getSession(sessionId);
    const msg = message.trim().toLowerCase();

    // Comando global: reiniciar sesión
    if (msg === 'reiniciar' || msg === 'reset' || msg === 'nuevo pedido') {
      const newSession: ChatSession = { sessionId, chatState: 'GREETING', cart: [], lastActivity: new Date() };
      this.sessions.set(sessionId, newSession);
      return this.handleGreeting(newSession, '');
    }

    // Si hay un pedido activo, verificar actualizaciones de estado externas
    if (session.orderId && session.chatState === 'AWAITING_VALIDATION') {
      const order = await prisma.order.findUnique({ where: { id: session.orderId } });
      if (order?.status === 'PAGO_VALIDADO' || order?.status === 'EN_COCINA') {
        session.chatState = 'ORDER_ACTIVE';
        return {
          message: `✅ *¡Tu pago fue confirmado!* 🎉\n\nTu pedido #${session.orderId.slice(-6).toUpperCase()} está ahora en cocina siendo preparado.\n\nEscribe *"estado"* en cualquier momento para ver el progreso.`,
          type: 'status',
          orderId: session.orderId,
        };
      }
      if (order?.status === 'PAGO_RECHAZADO') {
        session.chatState = 'WAITING_PROOF';
        return {
          message: `❌ Tu comprobante fue rechazado por el administrador.\n\nPor favor, adjunta una nueva foto clara de tu pago por Yape o Plin.`,
          type: 'text',
        };
      }
    }

    switch (session.chatState) {
      case 'GREETING':       return this.handleGreeting(session, msg);
      case 'COLLECTING_NAME': return this.handleCollectingName(session, msg);
      case 'MENU':           return this.handleMenu(session, msg);
      case 'SELECTING':      return this.handleSelecting(session, msg);
      case 'COLLECTING_PHONE':    return this.handleCollectingPhone(session, msg);
      case 'COLLECTING_ADDRESS':  return this.handleCollectingAddress(session, msg);
      case 'COLLECTING_REFERENCE': return this.handleCollectingReference(session, msg);
      case 'CONFIRMING_ORDER':    return this.handleConfirmingOrder(session, msg);
      case 'PAYMENT_INSTRUCTIONS': return this.handlePaymentInstructions(session, msg, attachmentUrl);
      case 'WAITING_PROOF':       return this.handleWaitingProof(session, msg, attachmentUrl);
      case 'AWAITING_VALIDATION': return this.handleAwaitingValidation(session, msg);
      case 'ORDER_ACTIVE':        return this.handleOrderActive(session, msg);
      case 'SURVEY':              return this.handleSurvey(session, msg);
      default:
        session.chatState = 'GREETING';
        return this.handleGreeting(session, '');
    }
  }

  // ── HANDLERS ──────────────────────────────────────────────────────────────

  private async handleGreeting(session: ChatSession, msg: string): Promise<AgentResponse> {
    if (msg.length > 1) {
      session.chatState = 'COLLECTING_NAME';
      return this.handleCollectingName(session, msg);
    }
    return {
      message: `👋 ¡Bienvenido a *Restaurante El Trujillano*! 🍽️\n\nEl mejor sabor de Trujillo directo a tu puerta.\n\n¿Cómo te llamas?`,
      type: 'text',
    };
  }

  private async handleCollectingName(session: ChatSession, msg: string): Promise<AgentResponse> {
    session.customerName = msg.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    session.chatState = 'MENU';
    const menu = await this.menuAgent.getFormattedMenu();
    return {
      message: `¡Hola, *${session.customerName}*! 😊\n\nAquí está nuestro menú:\n\n${menu}\n\nEscribe la *cantidad + nombre del producto* para agregar al carrito.\nEjemplo: *"2 lomo saltado"* o *"1 ceviche"*`,
      type: 'menu',
      quickReplies: ['Ver menú completo', 'Ver carrito'],
    };
  }

  private async handleMenu(session: ChatSession, msg: string): Promise<AgentResponse> {
    session.chatState = 'SELECTING';
    return this.handleSelecting(session, msg);
  }

  private async handleSelecting(session: ChatSession, msg: string): Promise<AgentResponse> {
    if (msg === 'ver carrito' || msg === 'carrito' || msg === 'mi pedido') {
      return this.buildCartResponse(session);
    }
    if (msg === 'ver menú' || msg === 'ver menu' || msg === 'menu') {
      const menu = await this.menuAgent.getFormattedMenu();
      return { message: `📋 *Menú El Trujillano:*\n\n${menu}`, type: 'menu', quickReplies: ['Ver carrito'] };
    }
    if (['confirmar', 'listo', 'finalizar', 'continuar', 'pedir'].includes(msg)) {
      if (session.cart.length === 0) {
        return { message: '🛒 Tu carrito está vacío. Agrega al menos un producto.\n\nEjemplo: *"2 lomo saltado"*', type: 'text' };
      }
      session.chatState = 'COLLECTING_PHONE';
      return {
        message: `✅ ¡Perfecto! Tu carrito tiene *${session.cart.length} producto(s)*.\n\n📱 Para continuar, necesito tu número de teléfono (9 dígitos).\n\nEjemplo: *987654321*`,
        type: 'text',
      };
    }
    if (msg.startsWith('quitar ') || msg.startsWith('eliminar ')) {
      const productName = msg.replace(/^(quitar|eliminar)\s+/, '');
      const result = this.orderAgent.removeFromCart(session.cart, productName);
      return { message: result.success ? `✅ ${result.message}` : `❌ ${result.message}`, type: 'text', quickReplies: ['Ver carrito', 'Confirmar pedido'] };
    }

    const result = await this.orderAgent.parseAndAddToCart(session.cart, msg);
    if (result.success) {
      session.chatState = 'SELECTING';
      const subtotal = this.orderAgent.calculateSubtotal(session.cart);
      return {
        message: `✅ *${result.message}*\n\n🛒 Carrito:\n${this.orderAgent.getCartSummary(session.cart)}\n\n💰 Subtotal: S/ ${subtotal.toFixed(2)}\n\nSigue agregando o escribe *"confirmar"* para continuar.`,
        type: 'text',
        quickReplies: ['Confirmar pedido', 'Ver menú', 'Ver carrito'],
      };
    }

    const menu = await this.menuAgent.getFormattedMenu();
    return {
      message: `❌ No encontré ese producto.\n\nUsa el formato: *"cantidad nombre"*\nEjemplo: *"2 lomo saltado"*\n\n${menu}`,
      type: 'menu',
      quickReplies: ['Ver carrito'],
    };
  }

  private buildCartResponse(session: ChatSession): AgentResponse {
    if (session.cart.length === 0) {
      return { message: '🛒 Tu carrito está vacío.\n\nEscribe el nombre del producto para agregar.', type: 'text' };
    }
    const summary = this.orderAgent.generatePriceSummary(session.cart);
    return {
      message: `🛒 *Tu carrito:*\n\n${summary}\n\nEscribe *"confirmar"* para continuar o sigue agregando productos.`,
      type: 'summary',
      quickReplies: ['Confirmar pedido', 'Ver menú'],
    };
  }

  private handleCollectingPhone(session: ChatSession, msg: string): AgentResponse {
    const phone = msg.replace(/[\s\-]/g, '');
    if (!/^\d{9}$/.test(phone)) {
      return { message: `❌ Número inválido. Ingresa 9 dígitos.\nEjemplo: *987654321*`, type: 'text' };
    }
    session.customerPhone = phone;
    session.chatState = 'COLLECTING_ADDRESS';
    return {
      message: `✅ Número guardado: *${phone}*\n\n📍 ¿Cuál es tu dirección de entrega?\n\nEjemplo: *"Av. España 1234, Trujillo"*`,
      type: 'text',
    };
  }

  private handleCollectingAddress(session: ChatSession, msg: string): AgentResponse {
    if (msg.length < 8) {
      return { message: '❌ Por favor ingresa una dirección más completa.', type: 'text' };
    }
    session.deliveryAddress = msg;
    session.chatState = 'COLLECTING_REFERENCE';
    return {
      message: `✅ Dirección: *${msg}*\n\n🏠 ¿Alguna referencia para el repartidor?\n\nEjemplo: *"Frente al parque central, portón rojo"*\n\nO escribe *"ninguna"*.`,
      type: 'text',
    };
  }

  private async handleCollectingReference(session: ChatSession, msg: string): Promise<AgentResponse> {
    session.deliveryReference = msg.toLowerCase() === 'ninguna' ? undefined : msg;
    session.chatState = 'CONFIRMING_ORDER';
    const summary = this.orderAgent.generatePriceSummary(session.cart);
    return {
      message: [
        `📋 *Resumen de tu pedido:*`,
        ``,
        `👤 Cliente: ${session.customerName}`,
        `📱 Teléfono: ${session.customerPhone}`,
        `📍 Dirección: ${session.deliveryAddress}`,
        session.deliveryReference ? `🏠 Referencia: ${session.deliveryReference}` : '',
        ``,
        summary,
        ``,
        `¿Confirmas el pedido? Escribe *"sí"* o *"no"*.`,
      ].filter(Boolean).join('\n'),
      type: 'summary',
      quickReplies: ['Sí, confirmar', 'No, modificar'],
    };
  }

  private async handleConfirmingOrder(session: ChatSession, msg: string): Promise<AgentResponse> {
    const affirm = ['sí', 'si', 'confirmar', 'ok', 'yes', 'sí, confirmar'].includes(msg);
    const deny = ['no', 'no, modificar', 'modificar', 'cambiar'].includes(msg);

    if (affirm) {
      const order = await this.orderAgent.createOrder({
        customerName: session.customerName!,
        customerPhone: session.customerPhone!,
        deliveryAddress: session.deliveryAddress!,
        deliveryReference: session.deliveryReference,
        cart: session.cart,
      });
      session.orderId = order.id;
      await this.notificationAgent.saveNotification(order.id, `📋 Pedido creado por ${session.customerName}`);

      // Cambiar estado a PAGO_PENDIENTE
      await prisma.order.update({ where: { id: order.id }, data: { status: 'PAGO_PENDIENTE' } });
      session.chatState = 'PAYMENT_INSTRUCTIONS';

      const instructions = this.paymentAgent.getPaymentInstructions(order.total);
      return { message: instructions, type: 'payment', quickReplies: ['Adjuntar comprobante'], orderId: order.id };
    }
    if (deny) {
      session.chatState = 'SELECTING';
      return {
        message: `Entendido. Puedes modificar tu pedido.\n\n${this.orderAgent.getCartSummary(session.cart)}\n\nAgrega o quita productos, luego escribe *"confirmar"*.`,
        type: 'text',
        quickReplies: ['Ver carrito', 'Confirmar pedido'],
      };
    }
    return {
      message: `Por favor escribe *"sí"* para confirmar o *"no"* para modificar.`,
      type: 'text',
      quickReplies: ['Sí, confirmar', 'No, modificar'],
    };
  }

  private async handlePaymentInstructions(session: ChatSession, msg: string, attachmentUrl?: string): Promise<AgentResponse> {
    if (attachmentUrl) {
      session.chatState = 'WAITING_PROOF';
      return this.handleWaitingProof(session, msg, attachmentUrl);
    }
    if (['adjuntar comprobante', 'comprobante', 'ya pague', 'ya pagué', 'listo'].includes(msg)) {
      session.chatState = 'WAITING_PROOF';
      return { message: `📸 ¡Perfecto! Adjunta la foto o captura de tu pago (Yape/Plin).`, type: 'text' };
    }
    const order = session.orderId ? await prisma.order.findUnique({ where: { id: session.orderId } }) : null;
    const instructions = this.paymentAgent.getPaymentInstructions(order?.total ?? 0);
    return { message: instructions, type: 'payment', quickReplies: ['Adjuntar comprobante'] };
  }

  private async handleWaitingProof(session: ChatSession, msg: string, attachmentUrl?: string): Promise<AgentResponse> {
    if (attachmentUrl && session.orderId) {
      await this.paymentAgent.saveProof(session.orderId, attachmentUrl);
      await this.notificationAgent.saveNotification(session.orderId, '📸 Comprobante enviado por el cliente.');
      session.chatState = 'AWAITING_VALIDATION';

      return {
        message: `✅ *¡Comprobante recibido!* 📸\n\nNuestro equipo está validando tu pago.\n⏱️ Tiempo estimado: 1-3 minutos.\n\nTe notificaremos cuando se confirme. ¡Gracias ${session.customerName}! 😊`,
        type: 'status',
        orderId: session.orderId,
      };
    }
    return {
      message: `📸 Adjunta la *foto o captura de pantalla* de tu comprobante de pago (Yape o Plin).`,
      type: 'text',
    };
  }

  private async handleAwaitingValidation(session: ChatSession, msg: string): Promise<AgentResponse> {
    if (session.orderId) {
      const order = await prisma.order.findUnique({ where: { id: session.orderId } });
      if (order?.status === 'PAGO_VALIDADO' || order?.status === 'EN_COCINA') {
        session.chatState = 'ORDER_ACTIVE';
        return {
          message: `✅ *¡Pago confirmado!*\n\n🍳 Tu pedido está en cocina.\nEscribe *"estado"* para ver el progreso.`,
          type: 'status',
          orderId: session.orderId,
        };
      }
      if (order?.status === 'PAGO_RECHAZADO') {
        session.chatState = 'WAITING_PROOF';
        return { message: `❌ Comprobante rechazado. Adjunta uno nuevo.`, type: 'text' };
      }
    }
    return {
      message: `⏳ Tu pago está siendo verificado. Escribe *"estado"* para consultar.`,
      type: 'status',
      orderId: session.orderId,
    };
  }

  private async handleOrderActive(session: ChatSession, msg: string): Promise<AgentResponse> {
    if (['estado', 'mi pedido', 'dónde está', 'donde esta'].includes(msg) && session.orderId) {
      const order = await prisma.order.findUnique({ where: { id: session.orderId }, include: { driver: true } });
      if (!order) return { message: 'No encontré tu pedido.', type: 'text' };

      const statusMap: Partial<Record<string, string>> = {
        EN_COCINA: '🍳 Tu pedido está en cocina siendo preparado.',
        LISTO_PARA_REPARTO: '📦 Tu pedido está listo. Asignando repartidor.',
        EN_REPARTO: `🛵 Tu pedido está en camino${order.driver ? ` con ${order.driver.name}` : ''}.`,
        ENTREGADO: '✅ ¡Tu pedido fue entregado! Esperamos que lo disfrutes.',
        CERRADO: '🌟 Pedido cerrado. ¡Gracias por preferirnos!',
      };
      return { message: statusMap[order.status] ?? `Estado: ${order.status}`, type: 'status', orderId: session.orderId };
    }

    if (msg.startsWith('calificaci') || msg.startsWith('rating') || /^[1-5]$/.test(msg)) {
      session.chatState = 'SURVEY';
      return this.handleSurvey(session, msg);
    }
    return {
      message: `🍳 Tu pedido está en proceso.\n\nEscribe *"estado"* para ver el avance.\n\nGracias por tu paciencia, ${session.customerName}! 😊`,
      type: 'status',
    };
  }

  private async handleSurvey(session: ChatSession, msg: string): Promise<AgentResponse> {
    const rating = parseInt(msg);
    if (session.orderId && !isNaN(rating) && rating >= 1 && rating <= 5) {
      await prisma.survey.upsert({
        where: { order_id: session.orderId },
        update: { rating },
        create: { order_id: session.orderId, rating },
      });
      const emojis = ['😞', '😕', '😐', '😊', '🤩'];
      return {
        message: `${emojis[rating - 1]} *¡Gracias por tu calificación de ${rating}/5!*\n\n¿Deseas agregar un comentario? (o escribe *"no"*)`,
        type: 'survey',
      };
    }
    if (msg !== 'no' && msg.length > 2 && session.orderId) {
      await prisma.survey.upsert({
        where: { order_id: session.orderId },
        update: { comment: msg },
        create: { order_id: session.orderId, comment: msg },
      });
    }
    session.chatState = 'GREETING';
    session.cart = [];
    session.orderId = undefined;
    return {
      message: `🌟 *¡Muchas gracias, ${session.customerName}!*\n\nTu opinión nos ayuda a mejorar. Esperamos verte pronto.\n\n_Escribe cualquier mensaje para hacer un nuevo pedido._`,
      type: 'survey',
    };
  }

  getSession(sessionId: string): ChatSession {
    return this.sessions.get(sessionId) ?? { sessionId, chatState: 'GREETING', cart: [], lastActivity: new Date() };
  }

  async getOrderStatus(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session?.orderId) return null;
    return prisma.order.findUnique({
      where: { id: session.orderId },
      include: { items: { include: { product: true } }, driver: true },
    });
  }
}
