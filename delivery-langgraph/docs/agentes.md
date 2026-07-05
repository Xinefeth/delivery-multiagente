# Agentes del Sistema Multiagente — El Trujillano

Sistema de delivery automatizado para restaurante peruano en Trujillo.  
**Stack:** Node.js · TypeScript · Express · Prisma ORM · PostgreSQL · Claude AI (Anthropic)

---

## Índice

1. [OrchestratorAgent](#1-orchestratoragent)
2. [ChatbotAgent](#2-chatbotagent)
3. [MenuAgent](#3-menuagent)
4. [OrderAgent](#4-orderagent)
5. [PricingAgent](#5-pricingagent)
6. [PaymentAgent](#6-paymentagent)
7. [PaymentValidationAgent](#7-paymentvalidationagent)
8. [KitchenAgent](#8-kitchenagent)
9. [DeliveryAgent](#9-deliveryagent)
10. [NotificationAgent](#10-notificationagent)
11. [AdminAgent](#11-adminagent)

---

## 1. OrchestratorAgent

**Responsabilidad:** Coordina el flujo completo del pedido mediante una máquina de estados. Mantiene sesiones en memoria y delega a los subagentes según el estado actual del chat.

**Estados del chat:** `GREETING → COLLECTING_NAME → MENU → SELECTING → COLLECTING_PHONE → COLLECTING_ADDRESS → COLLECTING_REFERENCE → CONFIRMING_ORDER → PAYMENT_INSTRUCTIONS → WAITING_PROOF → AWAITING_VALIDATION → ORDER_ACTIVE → SURVEY`

```typescript
import { prisma } from '../lib/prisma';
import { AgentResponse, CartItem, ChatSession, ChatState } from '../types';
import { MenuAgent } from './MenuAgent';
import { OrderAgent } from './OrderAgent';
import { PricingAgent } from './PricingAgent';
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
  private pricingAgent: PricingAgent;
  private paymentAgent: PaymentAgent;
  private kitchenAgent: KitchenAgent;
  private notificationAgent: NotificationAgent;

  constructor() {
    this.menuAgent = new MenuAgent();
    this.orderAgent = new OrderAgent();
    this.pricingAgent = new PricingAgent();
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
      const subtotal = this.pricingAgent.calculateSubtotal(session.cart);
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
    const summary = this.pricingAgent.generateSummary(session.cart);
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
    const summary = this.pricingAgent.generateSummary(session.cart);
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
```

---

## 2. ChatbotAgent

**Responsabilidad:** Clasifica la intención del cliente usando Claude AI (NLP). Recibe el mensaje, el estado del carrito, el historial reciente y el catálogo, y devuelve un JSON con la intención detectada.

**Modelo:** `claude-haiku-4-5-20251001` (configurable via `CLAUDE_MODEL`)

```typescript
import claudeClient from '../clients/claudeClient';
import { CartItem } from '../types';
import { Product } from '@prisma/client';

export type ChatIntent =
  | 'GREETING'
  | 'SHOW_MENU'
  | 'SHOW_CATEGORY'
  | 'ADD_PRODUCT'
  | 'REMOVE_PRODUCT'
  | 'REMOVE_PRODUCT_BY_NEGATION'
  | 'REMOVE_PRODUCT_QUANTITY'
  | 'VIEW_CART'
  | 'CONFIRM_ORDER'
  | 'REJECT_ADDITION'
  | 'CANCEL_CONFIRMATION'
  | 'CUSTOMER_CORRECTION'
  | 'CUSTOMER_REJECTION'
  | 'MODIFY_ORDER'
  | 'REQUEST_PAYMENT'
  | 'SELECT_PAYMENT_YAPE'
  | 'SELECT_PAYMENT_PLIN'
  | 'UPLOAD_PAYMENT_PROOF'
  | 'CHECK_ORDER_STATUS'
  | 'CANCEL_ORDER'
  | 'START_NEW_ORDER'
  | 'OUT_OF_SCOPE'
  | 'UNKNOWN';

export interface ClaudeIntentResponse {
  intent: ChatIntent;
  confidence: number;
  product_name?: string;
  quantity?: number;
  category?: string;
  user_message: string;
}

interface ChatbotAgentParams {
  sessionId: string;
  message: string;
  cart: CartItem[];
  orderStatus: string;
  products: Product[];
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const SYSTEM_PROMPT = `Eres el asistente virtual de "El Trujillano", restaurante de comida peruana en Trujillo, Perú.
Clasifica la intención del cliente y responde en español de forma amable, breve y orientada a cerrar el pedido.

RESPONDE SOLO con JSON válido, sin markdown, sin texto adicional.

INTENCIONES VÁLIDAS:
- GREETING: saludo o inicio de conversación
- SHOW_MENU: pide ver el menú completo
- SHOW_CATEGORY: pide una categoría específica (ej: "¿qué sopas tienen?")
- ADD_PRODUCT: quiere agregar un producto al carrito
- REMOVE_PRODUCT: quiere quitar TODAS las unidades de un producto
- REMOVE_PRODUCT_BY_NEGATION: rechaza un producto con negación usando artículo definido
- REMOVE_PRODUCT_QUANTITY: quiere reducir solo UNA PARTE de la cantidad usando artículo indefinido o número
- VIEW_CART: quiere ver su carrito actual
- CONFIRM_ORDER: confirma el pedido de forma explícita e inequívoca
- REJECT_ADDITION: responde "no" cuando el bot preguntó si desea agregar algo más
- CANCEL_CONFIRMATION: cancela o rechaza la confirmación
- CUSTOMER_CORRECTION: corrige algo del pedido
- CUSTOMER_REJECTION: rechaza el resumen o el registro
- MODIFY_ORDER: quiere modificar el pedido en general sin especificar qué
- REQUEST_PAYMENT: pregunta cómo pagar en general
- SELECT_PAYMENT_YAPE: elige pagar por Yape
- SELECT_PAYMENT_PLIN: elige pagar por Plin
- UPLOAD_PAYMENT_PROOF: indica que va a enviar el comprobante
- CHECK_ORDER_STATUS: pregunta por el estado de su pedido
- CANCEL_ORDER: quiere cancelar todo el pedido
- START_NEW_ORDER: quiere hacer un nuevo pedido diferente
- OUT_OF_SCOPE: pregunta no relacionada con el restaurante
- UNKNOWN: no se puede determinar con certeza

REGLAS CRÍTICAS DE CLASIFICACIÓN:
1. ARTÍCULO INDEFINIDO = cantidad parcial → REMOVE_PRODUCT_QUANTITY
2. ARTÍCULO DEFINIDO = eliminar todo → REMOVE_PRODUCT o REMOVE_PRODUCT_BY_NEGATION
3. CONFIRM_ORDER SOLO con frases completamente inequívocas
4. Si el bot preguntó "¿Deseas agregar algo más?" y el cliente dice "no" → REJECT_ADDITION
5. Si el cliente dice "quiero cambiar algo" sin especificar → MODIFY_ORDER
6. NUNCA uses CONFIRM_ORDER si el cliente está eliminando o rechazando productos
7. Si el cliente escribe en MAYÚSCULAS, user_message debe ser calmado y empático

FORMATO (JSON estricto):
{
  "intent": "INTENT_TYPE",
  "confidence": 0.95,
  "product_name": "nombre del producto (solo para ADD/REMOVE)",
  "quantity": 1,
  "category": "categoría (solo para SHOW_CATEGORY)",
  "user_message": "respuesta breve y amable en español"
}`;

export class ChatbotAgent {
  async processMessage(params: ChatbotAgentParams): Promise<ClaudeIntentResponse> {
    const { message, cart, orderStatus, products, history } = params;

    const catalog = this.buildCatalog(products);
    const cartSummary = cart.length === 0
      ? 'vacío'
      : cart.map(i => `${i.quantity}x ${i.productName} (S/ ${i.unitPrice.toFixed(2)})`).join(', ');

    const context = `ESTADO ACTUAL: ${orderStatus}
CARRITO: ${cartSummary}

CATÁLOGO:
${catalog}`;

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history.slice(-6),
      { role: 'user', content: `${context}\n\nMensaje: "${message}"` },
    ];

    const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

    const response = await claudeClient.messages.create({
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages,
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    try {
      return JSON.parse(cleaned) as ClaudeIntentResponse;
    } catch {
      console.error('[ChatbotAgent] JSON parse error. Raw:', raw);
      return { intent: 'UNKNOWN', confidence: 0, user_message: '¿En qué más puedo ayudarte?' };
    }
  }

  private buildCatalog(products: Product[]): string {
    const grouped = products.reduce((acc, p) => {
      if (!acc[p.category]) acc[p.category] = [];
      acc[p.category].push(p);
      return acc;
    }, {} as Record<string, Product[]>);

    return Object.entries(grouped)
      .map(([cat, items]) => `${cat}:\n${items.map(p => `  - ${p.name}: S/ ${p.price.toFixed(2)}`).join('\n')}`)
      .join('\n');
  }
}
```

---

## 3. MenuAgent

**Responsabilidad:** Consulta productos disponibles, formatea el menú agrupado por categoría y permite buscar productos por nombre o número.

```typescript
import { prisma } from '../lib/prisma';
import { Product } from '@prisma/client';

/**
 * MenuAgent
 * Responsabilidad: Mostrar menú, listar productos, validar disponibilidad.
 */
export class MenuAgent {
  async getProducts(): Promise<Product[]> {
    return prisma.product.findMany({
      where: { is_available: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async getFormattedMenu(): Promise<string> {
    const products = await this.getProducts();
    const grouped = this.groupByCategory(products);
    let menu = '';
    let index = 1;

    for (const [category, items] of Object.entries(grouped)) {
      menu += `*📌 ${category}*\n`;
      for (const item of items) {
        menu += `  ${index}. ${item.name} — S/ ${item.price.toFixed(2)}\n`;
        if (item.description) menu += `     _${item.description}_\n`;
        index++;
      }
      menu += '\n';
    }
    return menu.trim();
  }

  async findProductByNameOrNumber(input: string): Promise<Product | null> {
    const products = await this.getProducts();
    const num = parseInt(input);
    if (!isNaN(num)) {
      const sorted = products.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      return sorted[num - 1] ?? null;
    }
    const lower = input.toLowerCase().trim();
    return (
      products.find(p => p.name.toLowerCase() === lower) ??
      products.find(p => p.name.toLowerCase().includes(lower)) ??
      null
    );
  }

  async validateProductAvailability(productId: string): Promise<boolean> {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    return product?.is_available ?? false;
  }

  async getProductById(id: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { id } });
  }

  private groupByCategory(products: Product[]): Record<string, Product[]> {
    return products.reduce((acc, p) => {
      if (!acc[p.category]) acc[p.category] = [];
      acc[p.category].push(p);
      return acc;
    }, {} as Record<string, Product[]>);
  }
}
```

---

## 4. OrderAgent

**Responsabilidad:** Parsea mensajes del cliente para agregar productos al carrito, gestiona las modificaciones y crea el pedido en la base de datos.

```typescript
import { prisma } from '../lib/prisma';
import { CartItem, OrderCreateInput } from '../types';
import { MenuAgent } from './MenuAgent';
import { Order } from '@prisma/client';

/**
 * OrderAgent
 * Responsabilidad: Capturar productos, estructurar el pedido, registrar en BD.
 */
export class OrderAgent {
  private menuAgent: MenuAgent;

  constructor() {
    this.menuAgent = new MenuAgent();
  }

  async parseAndAddToCart(cart: CartItem[], input: string): Promise<{ success: boolean; message: string }> {
    // Patrones: "2 lomo saltado", "lomo saltado x2", "1 ceviche"
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

    return prisma.order.create({
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
}
```

---

## 5. PricingAgent

**Responsabilidad:** Calcula subtotal, costo de delivery fijo (S/ 5.00) y total del pedido. Genera el resumen de precios formateado para el cliente.

```typescript
import { CartItem } from '../types';

/**
 * PricingAgent
 * Responsabilidad: Calcular subtotal, costo de delivery y total del pedido.
 */
export class PricingAgent {
  private readonly DELIVERY_FEE = 5.00;

  calculateSubtotal(cart: CartItem[]): number {
    return cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }

  calculateDeliveryFee(_address?: string): number {
    // Tarifa fija de delivery en Trujillo
    return this.DELIVERY_FEE;
  }

  calculateTotal(subtotal: number, deliveryFee: number): number {
    return Math.round((subtotal + deliveryFee) * 100) / 100;
  }

  generateSummary(cart: CartItem[]): string {
    const subtotal = this.calculateSubtotal(cart);
    const deliveryFee = this.calculateDeliveryFee();
    const total = this.calculateTotal(subtotal, deliveryFee);

    const lines = cart.map(i => `• ${i.quantity}x ${i.productName} = S/ ${(i.quantity * i.unitPrice).toFixed(2)}`);
    return [
      ...lines,
      '─────────────────────',
      `💰 Subtotal:   S/ ${subtotal.toFixed(2)}`,
      `🛵 Delivery:   S/ ${deliveryFee.toFixed(2)}`,
      `💵 *TOTAL:     S/ ${total.toFixed(2)}*`,
    ].join('\n');
  }

  validateCalculation(subtotal: number, deliveryFee: number, total: number): boolean {
    const expected = Math.round((subtotal + deliveryFee) * 100) / 100;
    return Math.abs(expected - total) < 0.01;
  }
}
```

---

## 6. PaymentAgent

**Responsabilidad:** Genera instrucciones de pago (Yape/Plin), persiste comprobantes en la BD, y gestiona los cambios de estado del pago (validado/rechazado) tanto automática como manualmente.

```typescript
import { prisma } from '../lib/prisma';
import { ValidationResult } from './PaymentValidationAgent';

/**
 * PaymentAgent
 * Responsabilidad: Instrucciones de pago, persistencia de comprobantes, actualización de estados.
 */
export class PaymentAgent {
  readonly YAPE_NUMBER = '938749977';
  readonly PLIN_NUMBER = '938749977';
  readonly ACCOUNT_NAME = 'El Trujillano';

  getPaymentInstructions(total: number): string {
    return [
      `💳 *Instrucciones de Pago*`,
      ``,
      `Monto a pagar: *S/ ${total.toFixed(2)}*`,
      ``,
      `📱 *YAPE:*`,
      `   Número: ${this.YAPE_NUMBER}`,
      `   Nombre: ${this.ACCOUNT_NAME}`,
      ``,
      `📱 *PLIN:*`,
      `   Número: ${this.PLIN_NUMBER}`,
      `   Nombre: ${this.ACCOUNT_NAME}`,
      ``,
      `✅ Realiza tu pago y luego *adjunta el comprobante* (foto o captura).`,
      `⚠️ El pedido se enviará a cocina únicamente tras validar el pago.`,
    ].join('\n');
  }

  /** Crea registro de pago en estado EN_VERIFICACION antes de validar */
  async createPendingPayment(orderId: string, proofUrl: string, method: string) {
    const total = await this.getOrderTotal(orderId);
    return prisma.payment.create({
      data: {
        order_id: orderId,
        method: method.toUpperCase(),
        amount: total,
        proof_url: proofUrl,
        status: 'EN_VERIFICACION',
      },
    });
  }

  /** Marca pago como VALIDADO y actualiza pedido a PAGO_VALIDADO */
  async markAsValidated(paymentId: string, orderId: string, result: ValidationResult) {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'VALIDADO',
          detected_amount: result.detectedAmount ?? undefined,
          detected_method: result.detectedMethod,
          detected_receiver_number: result.detectedReceiverNumber ?? undefined,
          validation_confidence: result.confidence,
          rejection_reason: null,
          validated_automatically: true,
          validated_at: new Date(),
        },
      }),
      prisma.order.update({
        where: { id: orderId },
        data: { status: 'PAGO_VALIDADO' },
      }),
    ]);
  }

  /** Marca pago como RECHAZADO y mantiene pedido en PAGO_PENDIENTE */
  async markAsRejected(paymentId: string, orderId: string, result: ValidationResult) {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'RECHAZADO',
          detected_amount: result.detectedAmount ?? undefined,
          detected_method: result.detectedMethod,
          detected_receiver_number: result.detectedReceiverNumber ?? undefined,
          validation_confidence: result.confidence,
          rejection_reason: result.rejectionReason,
          validated_automatically: true,
          validated_at: new Date(),
        },
      }),
      prisma.order.update({
        where: { id: orderId },
        data: { status: 'PAGO_PENDIENTE' },
      }),
    ]);
  }

  /** Validación manual por el administrador */
  async validatePayment(orderId: string, approve: boolean, adminNotes?: string) {
    const payment = await prisma.payment.findFirst({
      where: { order_id: orderId },
      orderBy: { created_at: 'desc' },
    });
    if (!payment) throw new Error('Pago no encontrado');

    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: approve ? 'VALIDADO' : 'RECHAZADO',
          admin_notes: adminNotes,
          validated_automatically: false,
          validated_at: new Date(),
        },
      }),
      prisma.order.update({
        where: { id: orderId },
        data: { status: approve ? 'PAGO_VALIDADO' : 'PAGO_RECHAZADO' },
      }),
    ]);
  }

  async getOrderTotal(orderId: string): Promise<number> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    return order?.total ?? 0;
  }
}
```

---

## 7. PaymentValidationAgent

**Responsabilidad:** Valida automáticamente los comprobantes de pago usando **Claude Vision** (IA). Extrae monto, método y número receptor de la imagen. Si Claude falla, usa un fallback por nombre de archivo (modo demo académico).

**Modelo:** `claude-haiku-4-5-20251001` con input de imagen en base64.

```typescript
import fs from 'fs';
import path from 'path';
import claudeClient from '../clients/claudeClient';
import { prisma } from '../lib/prisma';

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  detectedAmount: number | null;
  detectedMethod: 'YAPE' | 'PLIN' | 'UNKNOWN';
  detectedReceiverNumber: string | null;
  rejectionReason: string | null;
  validationDetails: {
    amountMatches: boolean;
    receiverMatches: boolean;
    methodMatches: boolean;
    duplicateProof: boolean;
  };
}

export interface ValidateParams {
  orderId: string;
  paymentId: string;
  proofUrl: string;
  expectedAmount: number;
  expectedMethod: string;
  expectedReceiverNumber: string;
}

const OFFICIAL_NUMBER = '938749977';
const AMOUNT_TOLERANCE = 0.10; // S/ 0.10 de tolerancia por redondeo
const VALID_NAMES = ['diego jar', 'el trujillano', 'trujillano'];

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function getLastDigits(value: string, length = 3): string {
  return normalizePhone(value).slice(-length);
}

/**
 * Valida número receptor contra el número oficial.
 * Acepta número completo, enmascarado (*** *** 977) o solo los últimos 3 dígitos.
 */
function validateReceiverNumber(detected: string | null, official: string): boolean {
  if (!detected) return true;

  const detectedDigits = normalizePhone(detected);
  const officialDigits = normalizePhone(official);

  if (!detectedDigits) return true;
  if (detectedDigits === officialDigits) return true;
  if (detectedDigits.length < officialDigits.length && officialDigits.endsWith(detectedDigits)) {
    return true;
  }
  return false;
}

/**
 * PaymentValidationAgent
 * Valida automáticamente el comprobante usando Claude Vision.
 * Fallback: heurísticas por nombre de archivo (modo demo académico).
 */
export class PaymentValidationAgent {

  async validatePaymentProof(params: ValidateParams): Promise<ValidationResult> {
    // 1. Comprobante duplicado
    if (await this.checkDuplicate(params.proofUrl, params.orderId)) {
      return this.reject(
        'Este comprobante ya fue utilizado en otro pedido.',
        null, 'UNKNOWN', null,
        { amountMatches: false, receiverMatches: false, methodMatches: false, duplicateProof: true },
        1.0,
      );
    }

    // 2. Extraer datos (Claude Vision → fallback por filename)
    const extracted = (await this.extractWithClaude(params.proofUrl))
      ?? this.simulateFromFilename(params.proofUrl, params.expectedAmount);

    // 3. Comparar
    return this.compare(extracted, params);
  }

  private async extractWithClaude(proofUrl: string) {
    try {
      const filePath = path.join(process.cwd(), proofUrl.startsWith('/') ? proofUrl.slice(1) : proofUrl);
      if (!fs.existsSync(filePath)) return null;

      const base64 = fs.readFileSync(filePath).toString('base64');
      const ext = path.extname(filePath).toLowerCase();
      const mediaType = (MIME_MAP[ext] ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

      const response = await claudeClient.messages.create({
        model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            {
              type: 'text',
              text: `Analiza esta imagen de comprobante de pago (Yape, Plin u otro).
Extrae los datos tal como aparecen en pantalla, incluyendo números enmascarados.

Responde SOLO con JSON válido sin markdown:
{
  "is_payment_proof": true/false,
  "amount": número del monto pagado (null si no visible),
  "method": "YAPE" | "PLIN" | "UNKNOWN",
  "receiver_number": "número destino tal como aparece, incluso si tiene asteriscos (null si no visible)",
  "receiver_name": "nombre del destinatario tal como aparece (null si no visible)",
  "operation_code": "código de operación (null si no visible)"
}

IMPORTANTE: Si el número aparece como "*** *** 977", incluye ese texto completo en receiver_number.`,
            },
          ],
        }],
      });

      const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const data = JSON.parse(cleaned);

      if (!data.is_payment_proof) return null;

      const rawReceiver = data.receiver_number ? String(data.receiver_number) : null;
      const methodStr = String(data.method ?? '').toUpperCase();

      return {
        amount: typeof data.amount === 'number' ? data.amount : null,
        method: (['YAPE', 'PLIN'].includes(methodStr) ? methodStr : 'UNKNOWN') as 'YAPE' | 'PLIN' | 'UNKNOWN',
        receiver_number: rawReceiver,
        receiver_name: data.receiver_name ? String(data.receiver_name).toLowerCase() : null,
      };
    } catch (e) {
      console.error('[PaymentValidationAgent] Claude Vision error:', (e as Error).message);
      return null;
    }
  }

  private simulateFromFilename(proofUrl: string, expectedAmount: number) {
    const name = proofUrl.toLowerCase();
    let amount: number | null = expectedAmount;
    let method: 'YAPE' | 'PLIN' | 'UNKNOWN' = 'YAPE';
    let receiver_number: string | null = '*** *** 977';
    let receiver_name: string | null = 'diego jar*';

    if (name.includes('monto_menor') || name.includes('monto-menor')) amount = expectedAmount - 2;
    if (name.includes('numero_incorrecto') || name.includes('numero-incorrecto')) receiver_number = '*** *** 123';
    if (name.includes('plin')) method = 'PLIN';
    if (name.includes('invalido') || name.includes('invalid') || name.includes('rechazado')) amount = null;

    return { amount, method, receiver_number, receiver_name };
  }

  private compare(
    extracted: { amount: number | null; method: 'YAPE' | 'PLIN' | 'UNKNOWN'; receiver_number: string | null; receiver_name: string | null },
    params: ValidateParams,
  ): ValidationResult {
    if (extracted.amount === null) {
      return this.reject(
        'No se pudo leer el monto del comprobante. Por favor, envía una imagen más clara.',
        null, extracted.method, extracted.receiver_number,
        { amountMatches: false, receiverMatches: false, methodMatches: false, duplicateProof: false },
        0.4,
      );
    }

    const amountMatches = Math.abs(extracted.amount - params.expectedAmount) <= AMOUNT_TOLERANCE;
    const receiverMatches = validateReceiverNumber(extracted.receiver_number, params.expectedReceiverNumber);
    const methodMatches = extracted.method === 'UNKNOWN'
      || extracted.method.toUpperCase() === params.expectedMethod.toUpperCase();
    const nameMatches = !extracted.receiver_name
      || VALID_NAMES.some(n => extracted.receiver_name!.includes(n));

    const details = { amountMatches, receiverMatches, methodMatches, duplicateProof: false };

    if (!amountMatches) {
      return this.reject(
        `El monto pagado (S/ ${extracted.amount.toFixed(2)}) no coincide con el total del pedido (S/ ${params.expectedAmount.toFixed(2)}).`,
        extracted.amount, extracted.method, extracted.receiver_number, details, 0.95,
      );
    }

    if (!receiverMatches) {
      const lastDigits = getLastDigits(params.expectedReceiverNumber);
      return this.reject(
        `El número de destino no corresponde al número de El Trujillano. Se esperaba un número que termine en ${lastDigits}.`,
        extracted.amount, extracted.method, extracted.receiver_number, details, 0.95,
      );
    }

    if (!nameMatches) {
      return this.reject(
        `El nombre del destinatario no corresponde a El Trujillano.`,
        extracted.amount, extracted.method, extracted.receiver_number, details, 0.85,
      );
    }

    return {
      isValid: true,
      confidence: 0.92,
      detectedAmount: extracted.amount,
      detectedMethod: extracted.method,
      detectedReceiverNumber: extracted.receiver_number,
      rejectionReason: null,
      validationDetails: details,
    };
  }

  private reject(
    reason: string,
    amount: number | null,
    method: 'YAPE' | 'PLIN' | 'UNKNOWN',
    receiver: string | null,
    details: ValidationResult['validationDetails'],
    confidence: number,
  ): ValidationResult {
    return {
      isValid: false,
      confidence,
      detectedAmount: amount,
      detectedMethod: method,
      detectedReceiverNumber: receiver,
      rejectionReason: reason,
      validationDetails: details,
    };
  }

  private async checkDuplicate(proofUrl: string, currentOrderId: string): Promise<boolean> {
    const existing = await prisma.payment.findFirst({
      where: { proof_url: proofUrl, status: 'VALIDADO', order_id: { not: currentOrderId } },
    });
    return !!existing;
  }
}
```

---

## 8. KitchenAgent

**Responsabilidad:** Recibe pedidos con estado `PAGO_VALIDADO`, los pone `EN_COCINA` y notifica a cocina. El staff marca manualmente `LISTO_PARA_REPARTO` cuando el pedido está preparado, lo que desencadena la asignación automática del repartidor.

> **Regla crítica:** Solo acepta pedidos con estado `PAGO_VALIDADO`.

```typescript
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
```

---

## 9. DeliveryAgent

**Responsabilidad:** Asigna el primer repartidor disponible a un pedido `LISTO_PARA_REPARTO`, envía un mensaje de WhatsApp al repartidor con los detalles del pedido, y confirma la entrega al cliente.

```typescript
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
```

---

## 10. NotificationAgent

**Responsabilidad:** Centraliza y persiste todas las notificaciones del sistema en la base de datos. Define los mensajes estándar por cada cambio de estado del pedido.

**Canales:** `chatbot` (cliente) · `kitchen` (pantalla de cocina)

```typescript
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
```

---

## 11. AdminAgent

**Responsabilidad:** Panel de administración del restaurante. Orquesta la validación de pagos (delegando a `PaymentAgent` y `KitchenAgent`), expone métricas del día, y permite gestionar productos, repartidores y pedidos.

```typescript
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
    return prisma.order.findMany({
      where: {
        status: { in: ['PAGO_ENVIADO', 'PAGO_PENDIENTE', 'PAGO_VALIDADO', 'PAGO_RECHAZADO'] },
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
```

---

## Resumen de dependencias entre agentes

```
OrchestratorAgent
├── MenuAgent
├── OrderAgent → MenuAgent
├── PricingAgent
├── PaymentAgent
├── KitchenAgent → NotificationAgent, DeliveryAgent
└── NotificationAgent

ChatbotAgent (Claude AI — clasificación de intenciones)

PaymentValidationAgent (Claude Vision — análisis de imágenes)

AdminAgent
├── PaymentAgent
├── KitchenAgent
├── DeliveryAgent → NotificationAgent, WhatsApp API
└── NotificationAgent

DeliveryAgent → NotificationAgent, WhatsApp API (CallMeBot)
```
