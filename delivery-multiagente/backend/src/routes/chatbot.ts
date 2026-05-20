import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { OrchestratorAgent } from '../agents/OrchestratorAgent';
import { prisma } from '../lib/prisma';
import { ChatbotAgent } from '../agents/ChatbotAgent';
import { PaymentAgent } from '../agents/PaymentAgent';
import { KitchenAgent } from '../agents/KitchenAgent';
import { cartService } from '../services/cartService';
import { productService } from '../services/productService';
import { orderService } from '../services/orderService';

const router = Router();

// ── Helpers de detección de intención negativa ────────────────────────────────

const SPANISH_NUMS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
};

interface ProductAction {
  productName: string;
  quantity: number; // 0 = eliminar todas las unidades
}

/**
 * Extrae producto y cantidad de frases de remoción.
 * Artículo indefinido (un/una/dos...) → cantidad parcial.
 * Artículo definido (el/la/los/las) o ausente → eliminar todo (qty=0).
 */
function parseProductAction(message: string): ProductAction | null {
  const msg = message.trim();

  // Remoción parcial: artículo indefinido o número explícito
  const PARTIAL: RegExp[] = [
    /(?:deseo|quiero|quisiera)\s+eliminar\s+(un|uno|una|dos|tres|cuatro|cinco|seis|\d+)\s+(.+)/i,
    /(?:elimina[r]?|quita[r]?|saca[r]?|retira[r]?|borra[r]?)\s+(un|uno|una|dos|tres|cuatro|cinco|seis|\d+)\s+(.+)/i,
    /no\s+quiero\s+(un|uno|una|dos|tres|cuatro|cinco|seis|\d+)\s+(.+)/i,
    /menos\s+(un|uno|una|dos|tres|cuatro|cinco|seis|\d+)\s+(.+)/i,
  ];
  for (const p of PARTIAL) {
    const m = msg.match(p);
    if (m?.[2]) {
      const qStr = m[1].toLowerCase();
      const qty = parseInt(qStr) || SPANISH_NUMS[qStr] || 1;
      return { productName: m[2].trim().replace(/[.!?,\s]+$/, ''), quantity: qty };
    }
  }

  // Remoción total: artículo definido o negación directa
  const FULL: RegExp[] = [
    /(?:te\s+he?\s+dicho\s+que\s+)?no\s+quiero\s+(?:el|la|los|las)\s+(.+)/i,
    /ya\s+no\s+quiero\s+(?:el|la|los|las)?\s*(.+)/i,
    /(?:deseo|quiero|quisiera)\s+eliminar\s+(?:el|la|los|las)\s+(.+)/i,
    /elimina[r]?(?:me)?\s+(?:el|la|los|las)\s+(.+)/i,
    /quita[r]?(?:me)?\s+(?:el|la|los|las)\s+(.+)/i,
    /saca[r]?(?:me)?\s+(?:el|la|los|las)\s+(.+)/i,
    /retira[r]?(?:me)?\s+(?:el|la|los|las)\s+(.+)/i,
    /sin\s+(?:el|la|los|las)\s+(.+)/i,
    /me\s+equivoqu[eé]\s+con\s+(?:el|la|los|las)?\s*(.+)/i,
  ];
  for (const p of FULL) {
    const m = msg.match(p);
    if (m?.[1]) return { productName: m[1].trim().replace(/[.!?,\s]+$/, ''), quantity: 0 };
  }

  return null;
}

/** Detecta si el mensaje expresa rechazo o corrección del pedido. */
function isRejectionOrCorrection(message: string): boolean {
  return /cancela(?:r|do)?|no\s+(confirmo|acepto|procede|quiero\s+ese\s+pedido)|no\s+est[áa]\s+(bien|correcto|así|asi)|incorrecto|me\s+equivoqu[eé]|quiero\s+cambi[ar]|modifi[ck]ar?\s*(el\s+)?pedido|eso\s+(no|está)\s+(correcto|mal|bien)/i
    .test(message);
}

/** Detecta tono de enojo (mayúsculas y exclamaciones). */
function isAngryTone(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 4 && trimmed === trimmed.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(trimmed);
}

// Singleton del orquestador (mantiene sesiones en memoria)
const orchestrator = new OrchestratorAgent();
const chatbotAgent = new ChatbotAgent();
const paymentAgent = new PaymentAgent();
const kitchenAgent = new KitchenAgent();

// Sesiones para el chatbot inteligente
interface SmartSession {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  orderStatus: string;
  activeOrderId?: string;
  confirmedOrderId?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryReference?: string;
  selectedPaymentMethod?: string;
  lastRejectionReason?: string;
  lastPrompt?: 'ASK_ADD_OR_CONFIRM' | 'ASK_CONFIRMATION';
  pendingDataStep?: 'NAME' | 'PHONE' | 'ADDRESS' | 'REFERENCE' | 'CONFIRMING';
  driverNotified?: boolean;
  lastActivity: Date;
}
const smartSessions = new Map<string, SmartSession>();

function getSmartSession(sessionId: string): SmartSession {
  if (!smartSessions.has(sessionId)) {
    smartSessions.set(sessionId, {
      history: [],
      orderStatus: 'INICIO',
      lastActivity: new Date(),
    });
  }
  const s = smartSessions.get(sessionId)!;
  s.lastActivity = new Date();
  return s;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

// POST /api/chat — Enviar mensaje al chatbot
router.post('/', upload.single('attachment'), async (req: Request, res: Response) => {
  try {
    const { sessionId, message = '' } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId requerido' });

    let attachmentUrl: string | undefined;
    if (req.file) {
      attachmentUrl = `/uploads/${req.file.filename}`;
    }

    const response = await orchestrator.process(sessionId, message, attachmentUrl);
    res.json(response);
  } catch (err: any) {
    console.error('[Chatbot]', err);
    res.status(500).json({ message: 'Error procesando tu mensaje. Intenta de nuevo.', type: 'text' });
  }
});

// GET /api/chat/status/:sessionId — Estado del pedido actual
router.get('/status/:sessionId', async (req: Request, res: Response) => {
  try {
    const order = await orchestrator.getOrderStatus(req.params.sessionId);
    const session = orchestrator.getSession(req.params.sessionId);
    res.json({ order, chatState: session.chatState });
  } catch (err) {
    res.status(500).json({ error: 'Error consultando estado' });
  }
});

// POST /api/chat/message — Chatbot inteligente con Claude
router.post('/message', upload.single('attachment'), async (req: Request, res: Response) => {
  try {
    const { sessionId, message = '' } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId requerido' });

    const session = getSmartSession(sessionId);
    const products = await productService.getAll();
    const cart = cartService.getCart(sessionId);

    const reply = (msg: string, extra: object = {}) => {
      session.history.push({ role: 'assistant', content: msg });
      return res.json({
        message: msg,
        type: 'text',
        orderStatus: session.orderStatus,
        orderId: session.activeOrderId ?? session.confirmedOrderId,
        ...extra,
      });
    };

    const pushUser = (msg: string) => session.history.push({ role: 'user', content: msg });

    // ── COMPROBANTE DE PAGO ──────────────────────────────────────────────────
    if (req.file) {
      const proofUrl = `/uploads/${req.file.filename}`;
      pushUser('[Envió comprobante de pago]');

      // Ya fue validado antes
      if (session.orderStatus === 'PAGO_VALIDADO') {
        return reply('Tu pago ya fue validado ✅ Tu pedido está en cocina. Te avisaremos cuando esté listo.');
      }

      if (session.orderStatus === 'PAGO_EN_VERIFICACION') {
        return reply('Ya tenemos tu comprobante y está en proceso de validación. Te avisaremos en breve.');
      }

      // Estado incorrecto: sin pedido activo pendiente de pago
      if (session.orderStatus !== 'PAGO_PENDIENTE' || !session.activeOrderId) {
        return reply('Recibí la imagen, pero todavía no tenemos un pedido registrado. Confirmemos primero tu pedido y datos de entrega. ¿Continuamos?');
      }

      // ── VALIDACIÓN AUTOMÁTICA ──────────────────────────────────────────────
      session.orderStatus = 'PAGO_EN_VERIFICACION';

      const expectedMethod = session.selectedPaymentMethod ?? 'YAPE';
      const { approved, rejectionReason } = await paymentAgent.processProof(
        session.activeOrderId,
        proofUrl,
        expectedMethod,
      );

      if (approved) {
        session.confirmedOrderId = session.activeOrderId;
        session.activeOrderId = undefined;
        session.orderStatus = 'PAGO_VALIDADO';

        await kitchenAgent.receiveOrder(session.confirmedOrderId);

        const msg = [
          'Pago validado correctamente ✅',
          '',
          'Tu comprobante coincide con el pedido.',
          'Tu pedido ya fue enviado a cocina y te avisaremos cuando esté listo para reparto. 🍽️',
        ].join('\n');
        return reply(msg);
      } else {
        session.orderStatus = 'PAGO_PENDIENTE';
        session.lastRejectionReason = rejectionReason ?? undefined;

        const orderData = await orderService.getStatus(session.activeOrderId);
        const expectedAmount = Number((orderData as any)?.total ?? 0);

        const msg = [
          'Tu comprobante no pudo ser aceptado ❌',
          '',
          `Motivo: ${rejectionReason}`,
          '',
          `Por favor, verifica que el pago sea por el monto exacto de *S/ ${expectedAmount.toFixed(2)}* y enviado al número *938749977* de El Trujillano.`,
          '',
          'Cuando tengas el comprobante correcto, envíalo nuevamente por aquí.',
        ].join('\n');
        return reply(msg);
      }
    }

    // ── DETECCIÓN AUTOMÁTICA DE PEDIDO CERRADO → ENCUESTA ───────────────────
    if (session.confirmedOrderId && session.orderStatus === 'PAGO_VALIDADO') {
      const orderCheck = await orderService.getStatus(session.confirmedOrderId);
      if (orderCheck?.status === 'CERRADO' || orderCheck?.status === 'ENTREGADO') {
        session.orderStatus = 'ENCUESTA';
      }
    }

    // ── FLUJO DE ENCUESTA DE SATISFACCIÓN ───────────────────────────────────
    if (session.orderStatus === 'ENCUESTA') {
      pushUser(message);
      const ratingMatch = message.trim().match(/^[1-5]/);
      const rating = ratingMatch ? parseInt(ratingMatch[0]) : NaN;
      if (!isNaN(rating)) {
        if (session.confirmedOrderId) {
          await prisma.survey.upsert({
            where: { order_id: session.confirmedOrderId },
            update: { rating },
            create: { order_id: session.confirmedOrderId, rating },
          });
        }
        session.orderStatus = 'ENCUESTA_COMENTARIO';
        const emojis = ['😞', '😕', '😐', '😊', '🤩'];
        return reply(`${emojis[rating - 1]} *¡Gracias por tu calificación de ${rating}/5!*\n\n¿Deseas dejarnos un comentario? Escríbelo o di *"no"*.`);
      }
      return reply('Por favor califica tu experiencia con un número del 1 al 5.\n\n1 = Muy malo  •  5 = Excelente');
    }

    if (session.orderStatus === 'ENCUESTA_COMENTARIO') {
      pushUser(message);
      const trimmed = message.trim().toLowerCase();
      if (trimmed !== 'no' && trimmed.length > 1 && session.confirmedOrderId) {
        await prisma.survey.upsert({
          where: { order_id: session.confirmedOrderId },
          update: { comment: message.trim() },
          create: { order_id: session.confirmedOrderId, comment: message.trim() },
        });
      }
      const name = session.customerName ? `, ${session.customerName}` : '';
      session.orderStatus = 'INICIO';
      session.confirmedOrderId = undefined;
      return reply(`🌟 *¡Muchas gracias${name}!*\n\nTu opinión nos ayuda a seguir mejorando. ¡Esperamos verte pronto en El Trujillano! 🍽️\n\n_Escribe cualquier mensaje para hacer un nuevo pedido._`);
    }

    // ── RECOPILACIÓN ESTRUCTURADA DE DATOS ──────────────────────────────────
    if (session.pendingDataStep) {
      const trimmed = message.trim();
      pushUser(message);
      const calm = isAngryTone(message) ? 'Disculpa 🙏 ' : '';

      // ── Escape hatch: detección de rechazo o corrección durante recopilación de datos
      if (session.pendingDataStep !== 'CONFIRMING') {
        const productAction = parseProductAction(trimmed);
        if (productAction || isRejectionOrCorrection(trimmed)) {
          if (productAction) {
            if (productAction.quantity === 0) {
              cartService.removeItem(sessionId, productAction.productName);
            } else {
              cartService.decreaseItem(sessionId, productAction.productName, productAction.quantity);
            }
          }
          session.pendingDataStep = undefined;
          const updatedCart = cartService.getCart(sessionId);
          if (updatedCart.length === 0 || !productAction) {
            session.orderStatus = 'INICIO';
            return reply(
              `${calm}Entendido, cancelo el proceso 🙏 ¿Deseas ver el menú para armar tu pedido desde cero?`,
              { quickReplies: ['Ver el menú', 'Ver mi carrito'] },
            );
          }
          session.orderStatus = 'CARRITO_ACTIVO';
          const label = productAction.quantity > 0
            ? `${productAction.quantity}x ${productAction.productName}`
            : productAction.productName;
          return reply(
            `${calm}Listo, retiré *${label}* ✅\n\n${cartService.getSummary(sessionId)}\n\n¿Confirmamos o deseas agregar algo más?`,
            { quickReplies: ['Confirmar pedido', 'Agregar más productos'] },
          );
        }
      }

      if (session.pendingDataStep === 'NAME') {
        if (!trimmed) return reply('Por favor dime tu nombre completo.');
        session.customerName = trimmed;
        session.pendingDataStep = 'PHONE';
        return reply(`Gracias, ${trimmed}. ¿Cuál es tu número de celular?`);
      }

      if (session.pendingDataStep === 'PHONE') {
        const phone = trimmed.replace(/\D/g, '');
        if (phone.length < 9) return reply('Por favor ingresa un número de celular válido (9 dígitos).');
        session.customerPhone = phone;
        session.pendingDataStep = 'ADDRESS';
        return reply('¿Cuál es tu dirección de entrega? (Ej: Av. España 123, Urb. La Merced)');
      }

      if (session.pendingDataStep === 'ADDRESS') {
        if (trimmed.length < 5) return reply('Por favor ingresa una dirección más detallada.');
        session.deliveryAddress = trimmed;
        session.pendingDataStep = 'REFERENCE';
        return reply('¿Alguna referencia para llegar más fácil? (Ej: frente al parque, casa azul)');
      }

      if (session.pendingDataStep === 'REFERENCE') {
        session.deliveryReference = trimmed || 'Sin referencia';
        session.pendingDataStep = 'CONFIRMING';
        session.orderStatus = 'ESPERANDO_CONFIRMACION_PEDIDO';

        const subtotal = cartService.getSubtotal(sessionId);
        const total = subtotal + 5;
        const cartLines = cart.map(i => `  • ${i.quantity}x ${i.productName} — S/ ${(i.quantity * i.unitPrice).toFixed(2)}`).join('\n');
        const msg = [
          'Perfecto. Aquí está tu resumen:\n',
          '*Pedido:*',
          cartLines,
          '',
          `Subtotal: S/ ${subtotal.toFixed(2)}`,
          `Delivery: S/ 5.00`,
          `*Total: S/ ${total.toFixed(2)}*`,
          '',
          '*Datos de entrega:*',
          `👤 ${session.customerName}`,
          `📱 ${session.customerPhone}`,
          `📍 ${session.deliveryAddress}`,
          `🔖 ${session.deliveryReference}`,
          '',
          '¿Confirmas tu pedido? Responde *sí confirmo* o dime qué deseas cambiar.',
        ].join('\n');
        return reply(msg, { quickReplies: ['Sí, confirmo', 'Quiero cambiar algo'] });
      }

      if (session.pendingDataStep === 'CONFIRMING') {

        // 1. Detectar remoción de producto durante el resumen
        const productAction = parseProductAction(trimmed);
        if (productAction) {
          let actionResult: boolean | 'decreased' | 'removed' | 'not_found';
          if (productAction.quantity === 0) {
            actionResult = cartService.removeItem(sessionId, productAction.productName);
          } else {
            actionResult = cartService.decreaseItem(sessionId, productAction.productName, productAction.quantity);
          }

          if (actionResult === false || actionResult === 'not_found') {
            return reply(
              `${calm}Entiendo, pero no encontré *${productAction.productName}* en tu pedido. Estos son tus productos actuales:\n\n${cartService.getSummary(sessionId)}\n\n¿Qué deseas cambiar?`,
            );
          }

          const updatedCart = cartService.getCart(sessionId);
          const label = productAction.quantity > 0
            ? `${productAction.quantity}x ${productAction.productName}`
            : productAction.productName;

          if (updatedCart.length === 0) {
            session.pendingDataStep = undefined;
            session.orderStatus = 'INICIO';
            return reply(
              `${calm}Listo, retiré *${label}* 🙏 Tu carrito quedó vacío. ¿Deseas elegir otro producto de la carta?`,
              { quickReplies: ['Ver el menú'] },
            );
          }

          const sub = cartService.getSubtotal(sessionId);
          const tot = sub + 5;
          const lines = updatedCart.map(i => `  • ${i.quantity}x ${i.productName} — S/ ${(i.quantity * i.unitPrice).toFixed(2)}`).join('\n');
          const msg = [
            `${calm}Listo, retiré *${label}* ✅\n`,
            '*Tu pedido actualizado:*',
            lines,
            '',
            `Subtotal: S/ ${sub.toFixed(2)}`,
            `Delivery: S/ 5.00`,
            `*Total: S/ ${tot.toFixed(2)}*`,
            '',
            `👤 ${session.customerName} · 📱 ${session.customerPhone}`,
            `📍 ${session.deliveryAddress}`,
            '',
            '¿Confirmamos el pedido o deseas ajustar algo más?',
          ].join('\n');
          return reply(msg, { quickReplies: ['Sí, confirmo', 'Agregar más productos'] });
        }

        // 2. Detectar rechazo o corrección explícita
        if (isRejectionOrCorrection(trimmed)) {
          session.pendingDataStep = undefined;
          session.orderStatus = 'CARRITO_ACTIVO';
          return reply(
            `${calm}Entendido, no hay problema 😊 Tu carrito sigue activo. Dime qué deseas cambiar y lo arreglamos con gusto.`,
            { quickReplies: ['Ver mi carrito', 'Ver el menú'] },
          );
        }

        // 3. Solo confirmar con frases explícitas e inequívocas
        const normalized = trimmed.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const EXPLICIT_CONFIRM = /^(si(\s+(confirmo|lo\s*confirmo|quiero|acepto|procede))?|confirmo(\s+(mi\s*)?pedido)?|confirmar?\s*(mi\s*)?pedido|esta\s*bien|correcto|procede|quiero\s*pagar|eso\s*es\s*todo|solo\s*eso|dale|va)$/i;

        if (EXPLICIT_CONFIRM.test(normalized)) {
          const order = await orderService.createOrder({
            customerName: session.customerName!,
            customerPhone: session.customerPhone!,
            deliveryAddress: session.deliveryAddress!,
            deliveryReference: session.deliveryReference!,
            cart,
          });
          session.activeOrderId = order.id;
          session.orderStatus = 'PAGO_PENDIENTE';
          session.pendingDataStep = undefined;
          cartService.clearCart(sessionId);

          const total = Number(order.total);
          const msg = [
            '¡Pedido registrado! 🎉',
            '',
            'Puedes pagar por:',
            '• *Yape:* 938749977 (El Trujillano)',
            '• *Plin:* 938749977 (El Trujillano)',
            '',
            `Total a pagar: *S/ ${total.toFixed(2)}*`,
            '',
            'Envía el comprobante de pago por aquí usando el clip 📎 y te confirmaremos en breve.',
          ].join('\n');
          return reply(msg, { orderId: order.id });
        }

        // 4. Respuesta ambigua: pedir aclaración sin asumir nada
        return reply(
          `${calm}Para confirmar tu pedido responde *sí confirmo*, o dime qué deseas cambiar y lo corrijo de inmediato 😊`,
          { quickReplies: ['Sí, confirmo', 'Quiero cambiar algo'] },
        );
      }
    }

    // ── CLASIFICACIÓN DE INTENCIÓN CON CLAUDE ───────────────────────────────
    const result = await chatbotAgent.processMessage({
      sessionId,
      message,
      cart,
      orderStatus: session.orderStatus,
      products,
      history: session.history,
    });

    pushUser(message);
    let replyMessage = result.user_message;

    switch (result.intent) {

      case 'GREETING': {
        const calm = isAngryTone(message) ? 'Disculpa 🙏 ' : '';
        if (session.confirmedOrderId || session.activeOrderId) {
          if (session.orderStatus === 'PAGO_VALIDADO') {
            replyMessage = `${calm}¡Hola de nuevo! 👋 Tu pago fue validado y tu pedido está en cocina. ¿Deseas hacer otro pedido?`;
          } else if (session.activeOrderId && session.orderStatus === 'PAGO_PENDIENTE') {
            replyMessage = `${calm}¡Hola de nuevo! 👋 Tienes un pedido pendiente de pago. Envía tu comprobante usando el clip 📎 cuando estés listo.`;
          } else {
            replyMessage = `${calm}¡Hola de nuevo! 👋 ¿En qué puedo ayudarte?`;
          }
        } else {
          replyMessage = '¡Hola! Bienvenido a *El Trujillano* 🍽️ Somos un restaurante de comida peruana en Trujillo. ¿Deseas ver nuestro menú o tienes algo en mente?';
        }
        break;
      }

      case 'SHOW_MENU': {
        replyMessage = `Aquí está nuestro menú completo 🍽️\n\n${productService.formatMenu(products)}\n\n¿Qué deseas pedir?`;
        break;
      }

      case 'SHOW_CATEGORY': {
        const cat = result.category?.toLowerCase() || '';
        const filtered = products.filter(p => p.category.toLowerCase().includes(cat));
        if (filtered.length > 0) {
          const lines = filtered.map(p => `  • ${p.name} — S/ ${Number(p.price).toFixed(2)}`).join('\n');
          replyMessage = `*${result.category}:*\n${lines}\n\n¿Deseas agregar alguno?`;
        } else {
          replyMessage = `No encontré productos en esa categoría. ¿Te muestro el menú completo?`;
        }
        break;
      }

      case 'ADD_PRODUCT': {
        if (result.product_name) {
          const product = await productService.findByName(result.product_name);
          if (product) {
            const qty = result.quantity || 1;
            cartService.addItem(sessionId, {
              productId: product.id,
              productName: product.name,
              quantity: qty,
              unitPrice: Number(product.price),
            });
            session.orderStatus = 'CARRITO_ACTIVO';
            session.lastPrompt = 'ASK_ADD_OR_CONFIRM';
            replyMessage = `✅ Agregué ${qty}x *${product.name}* (S/ ${Number(product.price).toFixed(2)} c/u).\n\n${cartService.getSummary(sessionId)}\n\n¿Deseas agregar algo más o confirmamos tu pedido?`;
            return reply(replyMessage, { intent: result.intent, quickReplies: ['Agregar más productos', 'Confirmar pedido'] });
          } else {
            replyMessage = `No encontré "${result.product_name}" en el menú. ¿Puedes escribir el nombre exacto o te muestro la carta?`;
          }
        }
        break;
      }

      case 'REMOVE_PRODUCT': {
        const calm = isAngryTone(message) ? 'Disculpa 🙏 ' : '';
        if (result.product_name) {
          const removed = cartService.removeItem(sessionId, result.product_name);
          if (removed) {
            const updatedCart = cartService.getCart(sessionId);
            if (updatedCart.length === 0) {
              session.orderStatus = 'INICIO';
              replyMessage = `${calm}Listo 😊 Retiré *${result.product_name}* de tu pedido. Tu carrito quedó vacío. ¿Deseas elegir otro producto de la carta?`;
              return reply(replyMessage, { intent: result.intent, quickReplies: ['Ver el menú'] });
            }
            session.orderStatus = 'CARRITO_ACTIVO';
            session.lastPrompt = 'ASK_ADD_OR_CONFIRM';
            replyMessage = `${calm}Listo 😊 Retiré *${result.product_name}* de tu pedido.\n\n${cartService.getSummary(sessionId)}\n\n¿Deseas agregar algo más o confirmamos tu pedido?`;
            return reply(replyMessage, { intent: result.intent, quickReplies: ['Confirmar pedido', 'Agregar más productos'] });
          } else {
            replyMessage = `${calm}No encontré *${result.product_name}* en tu carrito. ¿Quieres ver tu carrito actual?`;
            return reply(replyMessage, { intent: result.intent, quickReplies: ['Ver mi carrito'] });
          }
        }
        break;
      }

      case 'VIEW_CART': {
        const summary = cartService.getSummary(sessionId);
        if (cart.length > 0) {
          session.lastPrompt = 'ASK_ADD_OR_CONFIRM';
          replyMessage = `${summary}\n\n¿Deseas agregar algo más o confirmamos tu pedido?`;
          return reply(replyMessage, { intent: result.intent, quickReplies: ['Confirmar pedido', 'Agregar más productos'] });
        }
        replyMessage = summary;
        break;
      }

      case 'CONFIRM_ORDER': {
        if (session.orderStatus === 'PAGO_PENDIENTE' && session.activeOrderId) {
          const orderData = await orderService.getStatus(session.activeOrderId);
          const total = Number((orderData as any)?.total || 0);
          replyMessage = `Tu pedido ya está registrado ✅\n\nPuedes pagar por:\n• *Yape:* 938749977 (El Trujillano)\n• *Plin:* 938749977 (El Trujillano)\n\nTotal: *S/ ${total.toFixed(2)}*\n\nEnvía el comprobante usando el clip 📎`;
          break;
        }
        if (cart.length === 0) {
          replyMessage = 'Tu carrito está vacío. Primero agrega productos. ¿Te muestro el menú?';
          break;
        }
        // "sí" solo es ambiguo cuando el carrito está activo: la pregunta anterior tenía dos opciones
        const EXPLICIT_CONFIRM = /confirmo|confirmar\s*(pedido)?|confirma|ya\s*est[áa]|solo\s*eso|eso\s*es\s*todo|eso\s*nada\s*m[áa]s|no\s*(deseo|quiero)\s*agregar|procede|quiero\s*pagar/i;
        const AMBIGUOUS_AFFIRMATIVE = /^(s[ií]|ok|dale|sip|aj[áa]|yes|va|bueno|bien)\.?$/i;
        if (
          session.orderStatus === 'CARRITO_ACTIVO' &&
          AMBIGUOUS_AFFIRMATIVE.test(message.trim()) &&
          !EXPLICIT_CONFIRM.test(message.trim())
        ) {
          return reply(
            'Perfecto 😊 ¿Qué deseas hacer?',
            { intent: result.intent, quickReplies: ['Agregar más productos', 'Confirmar pedido'] },
          );
        }
        const subC = cartService.getSubtotal(sessionId);
        const linesC = cart.map(i => `  • ${i.quantity}x ${i.productName} — S/ ${(i.quantity * i.unitPrice).toFixed(2)}`).join('\n');
        session.pendingDataStep = 'NAME';
        session.orderStatus = 'ESPERANDO_DATOS_CLIENTE';
        replyMessage = `📋 *Tu pedido:*\n${linesC}\n\nSubtotal: S/ ${subC.toFixed(2)} + S/ 5.00 delivery = *S/ ${(subC + 5).toFixed(2)}*\n\nPara completar tu pedido necesito tus datos. ¿Cuál es tu nombre completo?`;
        break;
      }

      case 'REJECT_ADDITION': {
        if (cart.length === 0) {
          replyMessage = '¿En qué más puedo ayudarte?';
          break;
        }
        const subR = cartService.getSubtotal(sessionId);
        const linesR = cart.map(i => `  • ${i.quantity}x ${i.productName} — S/ ${(i.quantity * i.unitPrice).toFixed(2)}`).join('\n');
        session.pendingDataStep = 'NAME';
        session.orderStatus = 'ESPERANDO_DATOS_CLIENTE';
        replyMessage = `📋 *Tu pedido:*\n${linesR}\n\nSubtotal: S/ ${subR.toFixed(2)} + S/ 5.00 delivery = *S/ ${(subR + 5).toFixed(2)}*\n\nPerfecto, procedemos con el pedido. ¿Cuál es tu nombre completo?`;
        break;
      }

      case 'REQUEST_PAYMENT': {
        // Si ya está confirmado, recordar los datos de pago
        if (session.orderStatus === 'PAGO_PENDIENTE' && session.activeOrderId) {
          const orderData = await orderService.getStatus(session.activeOrderId);
          const total = Number((orderData as any)?.total || 0);
          replyMessage = `Puedes pagar por:\n• *Yape:* 938749977 (El Trujillano)\n• *Plin:* 938749977 (El Trujillano)\n\nTotal: *S/ ${total.toFixed(2)}*\n\nEnvía el comprobante usando el clip 📎`;
          break;
        }
        if (session.orderStatus === 'PAGO_EN_VERIFICACION') {
          replyMessage = 'Tu comprobante ya fue recibido y está en verificación ✅ Te avisaremos cuando el pago sea validado.';
          break;
        }
        // Pedido no confirmado: guiar al flujo correcto
        if (cart.length === 0) {
          replyMessage = 'Aceptamos *Yape* y *Plin* al número 938749977. Primero agrega productos al carrito. ¿Te muestro el menú?';
          break;
        }
        const subtotal = cartService.getSubtotal(sessionId);
        const cartLines = cart.map(i => `  • ${i.quantity}x ${i.productName} — S/ ${(i.quantity * i.unitPrice).toFixed(2)}`).join('\n');
        session.pendingDataStep = 'NAME';
        session.orderStatus = 'ESPERANDO_DATOS_CLIENTE';
        replyMessage = `Aceptamos Yape y Plin al *938749977* (El Trujillano).\n\nAntes de darte el número, confirmemos tu pedido:\n\n${cartLines}\n\nSubtotal: S/ ${subtotal.toFixed(2)} + S/ 5.00 delivery = *S/ ${(subtotal + 5).toFixed(2)}*\n\nPara continuar, ¿cuál es tu nombre?`;
        break;
      }

      case 'SELECT_PAYMENT_YAPE': {
        if (session.orderStatus === 'PAGO_PENDIENTE' && session.activeOrderId) {
          const orderData = await orderService.getStatus(session.activeOrderId);
          const total = Number((orderData as any)?.total || 0);
          session.selectedPaymentMethod = 'YAPE';
          replyMessage = `Perfecto 👍 Paga por *Yape* al:\n\n📱 *938749977*\nNombre: *El Trujillano*\nTotal: *S/ ${total.toFixed(2)}*\n\nLuego envía tu comprobante por aquí usando el clip 📎`;
        } else if (cart.length > 0) {
          session.selectedPaymentMethod = 'YAPE';
          session.pendingDataStep = 'NAME';
          session.orderStatus = 'ESPERANDO_DATOS_CLIENTE';
          replyMessage = 'Perfecto, pagarás por Yape al 938749977 (El Trujillano). Primero confirmemos tu pedido. ¿Cuál es tu nombre?';
        } else {
          replyMessage = 'Aceptamos Yape al 938749977 (El Trujillano). Primero agrega productos. ¿Te muestro el menú?';
        }
        break;
      }

      case 'SELECT_PAYMENT_PLIN': {
        if (session.orderStatus === 'PAGO_PENDIENTE' && session.activeOrderId) {
          const orderData = await orderService.getStatus(session.activeOrderId);
          const total = Number((orderData as any)?.total || 0);
          session.selectedPaymentMethod = 'PLIN';
          replyMessage = `Perfecto 👍 Paga por *Plin* al:\n\n📱 *938749977*\nNombre: *El Trujillano*\nTotal: *S/ ${total.toFixed(2)}*\n\nLuego envía tu comprobante por aquí usando el clip 📎`;
        } else if (cart.length > 0) {
          session.selectedPaymentMethod = 'PLIN';
          session.pendingDataStep = 'NAME';
          session.orderStatus = 'ESPERANDO_DATOS_CLIENTE';
          replyMessage = 'Perfecto, pagarás por Plin al 938749977 (El Trujillano). Primero confirmemos tu pedido. ¿Cuál es tu nombre?';
        } else {
          replyMessage = 'Aceptamos Plin al 938749977 (El Trujillano). Primero agrega productos. ¿Te muestro el menú?';
        }
        break;
      }

      case 'CHECK_ORDER_STATUS': {
        // Pedido activo: esperando pago o en verificación
        if (session.orderStatus === 'PAGO_EN_VERIFICACION') {
          replyMessage = 'Tu comprobante está siendo validado automáticamente. Te avisaré en cuanto termine la revisión.';
          break;
        }
        if (session.activeOrderId && session.orderStatus === 'PAGO_PENDIENTE') {
          if (session.lastRejectionReason) {
            replyMessage = `El comprobante fue revisado, pero no fue aceptado ❌\n\nMotivo: ${session.lastRejectionReason}\n\nPor favor, envía un nuevo comprobante correcto usando el clip 📎`;
          } else {
            const orderData = await orderService.getStatus(session.activeOrderId);
            const total = Number((orderData as any)?.total || 0);
            replyMessage = `Tu pedido está registrado y esperando el pago.\n\nPuedes pagar por:\n• *Yape:* 938749977 (El Trujillano)\n• *Plin:* 938749977 (El Trujillano)\n\nTotal: *S/ ${total.toFixed(2)}*`;
          }
          break;
        }
        // Pedido confirmado: consultar estado real desde la BD
        if (session.confirmedOrderId) {
          const orderData = await orderService.getStatus(session.confirmedOrderId);
          const dbStatus = orderData?.status ?? '';
          const driver = (orderData as any)?.driver as { name: string; phone: string } | null;

          if (dbStatus === 'EN_REPARTO') {
            if (driver) {
              replyMessage = `Tu pedido está en camino 🛵\n\n*Repartidor:* ${driver.name}\n*Teléfono:* ${driver.phone}\n\nPuedes contactarlo directamente si necesitas dar indicaciones. ¡Ya casi llega!`;
            } else {
              replyMessage = 'Tu pedido está en camino con el repartidor 🛵 ¡Ya casi llega!';
            }
            break;
          }

          if (dbStatus === 'CERRADO' || dbStatus === 'ENTREGADO') {
            session.orderStatus = 'ENCUESTA';
            replyMessage = '¡Tu pedido fue entregado! Muchas gracias por preferir El Trujillano 🎉\n\n⭐ *¿Cómo calificarías tu experiencia?*\n\nEscribe un número del *1 al 5*:\n1 = Muy malo  •  5 = Excelente';
            break;
          }

          const isTimeQuestion = /tiempo|tard[aáe]|cuánto|cuando|demor[aáe]|minutos|rato|urgente/i.test(message);
          const statusResponses: Record<string, string> = {
            PAGO_VALIDADO: '✅ Tu pago fue confirmado. Tu pedido está siendo enviado a cocina.',
            EN_COCINA: isTimeQuestion
              ? '🍳 Tu pedido está siendo preparado en cocina. El tiempo estimado es de *15-25 minutos*. ¡Ya casi está listo!'
              : '🍳 Tu pedido está siendo preparado en cocina. Te avisaremos cuando esté listo para el reparto.',
            LISTO_PARA_REPARTO: '📦 ¡Tu pedido está listo! Estamos asignando el repartidor automáticamente.',
            EN_REPARTO: isTimeQuestion
              ? '🛵 Tu pedido está en camino. El tiempo estimado de llegada es de *10-20 minutos*.'
              : '🛵 Tu pedido está en camino con el repartidor. ¡Ya casi llega!',
            ENTREGADO: '✅ ¡Tu pedido fue entregado! Buen provecho 🍽️',
            CERRADO: '🌟 ¡Tu pedido fue entregado! Fue un placer atenderte.',
          };
          replyMessage = statusResponses[dbStatus] ?? `Estado de tu pedido: ${dbStatus}`;
          break;
        }
        replyMessage = 'Aún no tienes un pedido activo. ¿Deseas ver el menú para empezar?';
        break;
      }

      case 'REMOVE_PRODUCT_BY_NEGATION': {
        const calm = isAngryTone(message) ? 'Disculpa 🙏 ' : '';
        // Claude puede haber extraído el producto; como fallback usamos parseProductAction
        const pAction = parseProductAction(message);
        const productName = result.product_name ?? pAction?.productName;
        if (!productName) {
          replyMessage = `${calm}¿Qué producto deseas retirar? Dime el nombre y lo quito de inmediato.`;
          break;
        }
        const removed = cartService.removeItem(sessionId, productName);
        if (!removed) {
          replyMessage = `${calm}No encontré *${productName}* en tu carrito. Estos son tus productos:\n\n${cartService.getSummary(sessionId)}\n\n¿Qué deseas cambiar?`;
          break;
        }
        const updatedCart = cartService.getCart(sessionId);
        if (updatedCart.length === 0) {
          session.orderStatus = 'INICIO';
          replyMessage = `${calm}Listo 😊 Retiré *${productName}* de tu pedido. Tu carrito quedó vacío. ¿Deseas elegir otro producto de la carta?`;
          return reply(replyMessage, { intent: result.intent, quickReplies: ['Ver el menú'] });
        }
        session.orderStatus = 'CARRITO_ACTIVO';
        session.lastPrompt = 'ASK_ADD_OR_CONFIRM';
        replyMessage = `${calm}Listo 😊 Retiré *${productName}* de tu pedido.\n\n${cartService.getSummary(sessionId)}\n\n¿Deseas agregar algo más o confirmamos tu pedido?`;
        return reply(replyMessage, { intent: result.intent, quickReplies: ['Confirmar pedido', 'Agregar más productos'] });
      }

      case 'CANCEL_CONFIRMATION': {
        const calm = isAngryTone(message) ? 'Disculpa 🙏 ' : '';
        session.pendingDataStep = undefined;
        session.orderStatus = cart.length > 0 ? 'CARRITO_ACTIVO' : 'INICIO';
        replyMessage = `${calm}Entendido, no confirmaste el pedido 😊 Tu carrito sigue activo. Dime qué deseas cambiar.`;
        return reply(replyMessage, { intent: result.intent, quickReplies: ['Ver mi carrito', 'Ver el menú'] });
      }

      case 'CUSTOMER_CORRECTION': {
        const calm = isAngryTone(message) ? 'Disculpa 🙏 ' : '';
        session.pendingDataStep = undefined;
        session.orderStatus = cart.length > 0 ? 'CARRITO_ACTIVO' : 'INICIO';
        replyMessage = `${calm}Con gusto lo corregimos 😊 Dime qué deseas cambiar: puedo quitar o agregar productos.`;
        return reply(replyMessage, { intent: result.intent, quickReplies: ['Ver mi carrito', 'Ver el menú'] });
      }

      case 'CUSTOMER_REJECTION': {
        const calm = isAngryTone(message) ? 'Disculpa 🙏 ' : '';
        session.pendingDataStep = undefined;
        session.orderStatus = cart.length > 0 ? 'CARRITO_ACTIVO' : 'INICIO';
        replyMessage = `${calm}Entendido, no hay problema 🙏 No registré ningún pedido. ¿Qué deseas hacer?`;
        return reply(replyMessage, { intent: result.intent, quickReplies: ['Ver mi carrito', 'Ver el menú'] });
      }

      case 'CANCEL_ORDER': {
        if (session.activeOrderId && ['PAGO_PENDIENTE', 'PAGO_EN_VERIFICACION'].includes(session.orderStatus)) {
          replyMessage = 'Para cancelar un pedido ya registrado, por favor contáctanos directamente. Tu pedido está en proceso.';
        } else {
          cartService.clearCart(sessionId);
          session.activeOrderId = undefined;
          session.orderStatus = 'INICIO';
          session.pendingDataStep = undefined;
          session.lastRejectionReason = undefined;
          replyMessage = 'Entendido, limpié tu carrito. ¿En qué más puedo ayudarte?';
        }
        break;
      }

      case 'START_NEW_ORDER': {
        cartService.clearCart(sessionId);
        session.activeOrderId = undefined;
        session.orderStatus = 'INICIO';
        session.pendingDataStep = undefined;
        session.lastRejectionReason = undefined;
        session.selectedPaymentMethod = undefined;
        session.customerName = undefined;
        session.customerPhone = undefined;
        session.deliveryAddress = undefined;
        session.deliveryReference = undefined;
        if (session.confirmedOrderId) {
          replyMessage = '¡Perfecto! Iniciamos un nuevo pedido 🍽️ Tu pedido anterior sigue siendo procesado normalmente. ¿Qué deseas ordenar? ¿Te muestro el menú?';
        } else {
          replyMessage = '¡Perfecto! Empecemos de nuevo 🍽️ ¿Qué deseas ordenar? ¿Te muestro el menú?';
        }
        break;
      }

      case 'OUT_OF_SCOPE': {
        replyMessage = 'Solo puedo ayudarte con pedidos de El Trujillano 🍽️ ¿Te muestro el menú o te ayudo con tu pedido?';
        break;
      }

      default:
        break;
    }

    return reply(replyMessage, { intent: result.intent });

  } catch (err: any) {
    console.error('[SmartChatbot]', err);
    res.status(500).json({ message: 'Error procesando tu mensaje. Intenta de nuevo.', type: 'text' });
  }
});

// GET /api/chat/driver-check/:sessionId — Polling: detecta asignación de repartidor y notifica al cliente
router.get('/driver-check/:sessionId', async (req: Request, res: Response) => {
  try {
    const session = smartSessions.get(req.params.sessionId);
    if (!session?.confirmedOrderId || session.driverNotified) return res.json({ assigned: false });

    const order = await prisma.order.findUnique({
      where: { id: session.confirmedOrderId },
      include: { driver: true },
    });

    if (order?.status === 'EN_REPARTO' && order.driver) {
      session.driverNotified = true;
      return res.json({
        assigned: true,
        message: `Tu pedido está en camino 🛵\n\n*Repartidor:* ${order.driver.name}\n*Teléfono:* ${order.driver.phone}\n\nPuedes contactarlo directamente si necesitas dar indicaciones. ¡Ya casi llega!`,
      });
    }
    res.json({ assigned: false });
  } catch {
    res.json({ assigned: false });
  }
});

// GET /api/chat/survey-check/:sessionId — Polling: detecta si el pedido fue entregado y activa la encuesta
router.get('/survey-check/:sessionId', async (req: Request, res: Response) => {
  try {
    const session = smartSessions.get(req.params.sessionId);
    if (!session?.confirmedOrderId) return res.json({ survey: false });
    if (['ENCUESTA', 'ENCUESTA_COMENTARIO', 'INICIO'].includes(session.orderStatus)) {
      return res.json({ survey: false });
    }
    const order = await orderService.getStatus(session.confirmedOrderId);
    if (order?.status === 'CERRADO' || order?.status === 'ENTREGADO') {
      session.orderStatus = 'ENCUESTA';
      return res.json({
        survey: true,
        message: '🎉 ¡Tu pedido ha sido entregado! Muchas gracias por preferir *El Trujillano*.\n\n⭐ *¿Cómo calificarías tu experiencia?*\n\nEscribe un número del *1 al 5*:\n1 = Muy malo  •  5 = Excelente',
      });
    }
    res.json({ survey: false });
  } catch {
    res.json({ survey: false });
  }
});

// GET /api/chat/notifications/:orderId — Notificaciones del pedido
router.get('/notifications/:orderId', async (req: Request, res: Response) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { order_id: req.params.orderId, channel: 'chatbot' },
      orderBy: { sent_at: 'asc' },
    });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Error consultando notificaciones' });
  }
});

export default router;

