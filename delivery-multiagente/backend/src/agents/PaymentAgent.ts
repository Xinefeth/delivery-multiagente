import { prisma } from '../lib/prisma';
import { ValidationResult, ProofProcessResult } from '../types';
import { PaymentValidationAgent } from './PaymentValidationAgent';

/**
 * PaymentAgent
 * Responsabilidad: Instrucciones de pago, persistencia de comprobantes, actualización de estados.
 */
export class PaymentAgent {
  readonly YAPE_NUMBER = '938749977';
  readonly PLIN_NUMBER = '938749977';
  readonly ACCOUNT_NAME = 'El Trujillano';
  private validationAgent = new PaymentValidationAgent();

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

  async processProof(orderId: string, proofUrl: string, method: string): Promise<ProofProcessResult> {
    const expectedAmount = await this.getOrderTotal(orderId);
    const payment = await this.createPendingPayment(orderId, proofUrl, method);

    const result = await this.validationAgent.validatePaymentProof({
      orderId,
      paymentId: payment.id,
      proofUrl,
      expectedAmount,
      expectedMethod: method,
      expectedReceiverNumber: this.YAPE_NUMBER,
    });

    if (result.isValid) {
      await this.markAsValidated(payment.id, orderId, result);
    } else {
      await this.markAsRejected(payment.id, orderId, result);
    }

    return { approved: result.isValid, rejectionReason: result.rejectionReason };
  }
}
