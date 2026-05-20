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
- REMOVE_PRODUCT: quiere quitar TODAS las unidades de un producto ("quita el agua", "elimina la sopa", "no quiero la chicha")
- REMOVE_PRODUCT_BY_NEGATION: rechaza un producto con negación usando artículo definido ("no quiero el agua", "ya no quiero eso", "te dije que no quiero el agua")
- REMOVE_PRODUCT_QUANTITY: quiere reducir solo UNA PARTE de la cantidad de un producto usando artículo indefinido o número ("deseo eliminar un agua", "quita una sopa", "saca dos aguas", "no quiero un agua")
- VIEW_CART: quiere ver su carrito actual
- CONFIRM_ORDER: confirma el pedido de forma explícita e inequívoca
- REJECT_ADDITION: responde "no" o "ya no" cuando el bot preguntó si desea agregar algo más. Significa "no quiero agregar más, pregúntame si confirmo"
- CANCEL_CONFIRMATION: cancela o rechaza la confirmación ("no confirmo", "no ese pedido")
- CUSTOMER_CORRECTION: corrige algo del pedido ("me equivoqué", "cambia el pedido", "quiero cambiar algo", "eso está mal")
- CUSTOMER_REJECTION: rechaza el resumen o el registro ("no quiero ese pedido", "eso no lo pedí", "está incorrecto")
- MODIFY_ORDER: quiere modificar el pedido en general sin especificar qué ("modifica mi pedido", "quiero hacer un cambio")
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
1. ARTÍCULO INDEFINIDO = cantidad parcial: "un agua", "una sopa" → REMOVE_PRODUCT_QUANTITY, quantity=1. Nunca uses REMOVE_PRODUCT en este caso.
2. ARTÍCULO DEFINIDO = eliminar todo: "el agua", "la sopa", "el agua mineral" → REMOVE_PRODUCT o REMOVE_PRODUCT_BY_NEGATION.
3. CONFIRM_ORDER SOLO con frases completamente inequívocas: "confirmo", "sí confirmo", "confirmar pedido", "está correcto", "procede", "quiero pagar", "registra el pedido". NUNCA con "sí", "ok", "dale", "bueno" solos.
4. Si el último mensaje del asistente preguntó "¿Deseas agregar algo más?" y el cliente dice "no", "ya no", "no más" → REJECT_ADDITION, no CUSTOMER_REJECTION ni CANCEL_ORDER.
5. Si el cliente dice "quiero cambiar algo", "modifica", "cambiar" sin especificar producto → MODIFY_ORDER.
6. Si el cliente dice "quiero cambiar el agua", "cambia el agua por..." → CUSTOMER_CORRECTION con el producto en product_name.
7. NUNCA uses CONFIRM_ORDER si el cliente está eliminando, cambiando o rechazando productos.
8. Si el cliente escribe en MAYÚSCULAS o con enojo, user_message debe ser calmado y empático.
- Si el cliente dice "yape", usa SELECT_PAYMENT_YAPE. Si dice "plin", usa SELECT_PAYMENT_PLIN.
- Si el cliente dice "quiero otro pedido", "nuevo pedido", usa START_NEW_ORDER.
- El campo user_message es solo un borrador; el servidor puede ignorarlo según el estado.

FORMATO (JSON estricto):
{
  "intent": "INTENT_TYPE",
  "confidence": 0.95,
  "product_name": "nombre del producto (solo para ADD_PRODUCT o REMOVE_PRODUCT)",
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
