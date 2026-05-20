import fs from 'fs';
import path from 'path';
import claudeClient from '../clients/claudeClient';
import { prisma } from '../lib/prisma';
import { ValidationResult, ValidateParams } from '../types';

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

// ── Funciones puras de validación ──────────────────────────────────────────

/** Elimina todo lo que no sea dígito */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

/** Últimos N dígitos de un string */
function getLastDigits(value: string, length = 3): string {
  const digits = normalizePhone(value);
  return digits.slice(-length);
}

/**
 * Valida número receptor contra el número oficial.
 * Acepta número completo, número enmascarado (*** *** 977) o solo los últimos 3 dígitos.
 */
function validateReceiverNumber(detected: string | null, official: string): boolean {
  if (!detected) return true; // sin número visible → no podemos rechazar

  const detectedDigits = normalizePhone(detected);
  const officialDigits = normalizePhone(official);

  if (!detectedDigits) return true; // solo asteriscos/espacios → invisible, aceptar

  // Coincidencia exacta (número completo visible)
  if (detectedDigits === officialDigits) return true;

  // Número parcial / enmascarado: acepta si official termina con los dígitos detectados
  // Solo aplica si lo detectado es más corto que el oficial (ej: "977" < "938749977")
  if (detectedDigits.length < officialDigits.length && officialDigits.endsWith(detectedDigits)) {
    return true;
  }

  // Número completo diferente → rechazo
  return false;
}

// ── Agente ─────────────────────────────────────────────────────────────────

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

  // ── Extracción con Claude Vision ──────────────────────────────────────────

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
        receiver_number: rawReceiver, // guardamos raw; la normalización ocurre en compare()
        receiver_name: data.receiver_name ? String(data.receiver_name).toLowerCase() : null,
      };
    } catch (e) {
      console.error('[PaymentValidationAgent] Claude Vision error:', (e as Error).message);
      return null;
    }
  }

  // ── Fallback por nombre de archivo (demo académico) ───────────────────────

  private simulateFromFilename(proofUrl: string, expectedAmount: number) {
    const name = proofUrl.toLowerCase();
    let amount: number | null = expectedAmount;
    let method: 'YAPE' | 'PLIN' | 'UNKNOWN' = 'YAPE';
    let receiver_number: string | null = '*** *** 977'; // simula el formato enmascarado de Yape
    let receiver_name: string | null = 'diego jar*';

    if (name.includes('monto_menor') || name.includes('monto-menor')) amount = expectedAmount - 2;
    if (name.includes('numero_incorrecto') || name.includes('numero-incorrecto')) receiver_number = '*** *** 123';
    if (name.includes('plin')) method = 'PLIN';
    if (name.includes('invalido') || name.includes('invalid') || name.includes('rechazado')) amount = null;

    return { amount, method, receiver_number, receiver_name };
  }

  // ── Comparación principal ─────────────────────────────────────────────────

  private compare(
    extracted: {
      amount: number | null;
      method: 'YAPE' | 'PLIN' | 'UNKNOWN';
      receiver_number: string | null;
      receiver_name: string | null;
    },
    params: ValidateParams,
  ): ValidationResult {
    // Sin monto → rechazo por imagen ilegible
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

    // Validación del nombre (opcional — solo penaliza si es visible y claramente incorrecto)
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
      const detectedDisplay = extracted.receiver_number ?? 'desconocido';
      const lastDigits = getLastDigits(params.expectedReceiverNumber);
      return this.reject(
        `El número de destino detectado no corresponde al número de El Trujillano. Se esperaba un número que termine en ${lastDigits}.`,
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
