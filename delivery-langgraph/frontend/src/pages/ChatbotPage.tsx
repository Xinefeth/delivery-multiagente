import React, { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import ChatbotWidget from '../components/ChatbotWidget';
import OrderTracker, { DriverInfo } from '../components/OrderTracker';
import { getChatStatus } from '../services/api';

export default function ChatbotPage() {
  const [sessionId] = useState(() => `smart-${uuidv4()}`);
  const [hasOrder, setHasOrder] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);

  const onOrderConfirmed = useCallback((id: string) => {
    setHasOrder(true);
    setOrderId(id);
  }, []);

  // Sondeo del estado del pedido (fuera del widget): alimenta el tracker gráfico
  // y la tarjeta del repartidor. Una sola llamada trae estado + repartidor.
  useEffect(() => {
    if (!hasOrder) return;
    let stop = false;
    const poll = async () => {
      try {
        const data = await getChatStatus(sessionId);
        const order = data?.order;
        if (!order) return;
        if (order.id) setOrderId(order.id);
        if (order.status) setOrderStatus(order.status);
        if (order.driver) setDriver(order.driver);
        if (order.status === 'ENTREGADO' || order.status === 'CERRADO') {
          stop = true;
          clearInterval(interval);
        }
      } catch {
        // silencioso
      }
    };
    poll();
    const interval = setInterval(() => {
      if (!stop) poll();
    }, 6000);
    return () => clearInterval(interval);
  }, [hasOrder, sessionId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0b3d38] via-gray-900 to-black flex flex-col items-center py-8 px-4">
      {/* Encabezado de marca */}
      <header className="mb-8">
        <div className="inline-flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[#25D366] flex items-center justify-center text-2xl font-bold text-white shadow-lg">
            T
          </div>
          <div className="text-left">
            <h1 className="text-2xl font-bold text-white leading-tight">El Trujillano</h1>
            <p className="text-sm text-green-200/80">Delivery de comida peruana · Trujillo</p>
          </div>
        </div>
      </header>

      {/* Móvil + seguimiento, centrados y alineados arriba */}
      <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-8 w-full max-w-4xl">
        {/* Marco del móvil con el chatbot */}
        <div className="w-full max-w-sm h-[640px] rounded-[2rem] shadow-2xl overflow-hidden border-[6px] border-gray-800 bg-black flex-shrink-0">
          <ChatbotWidget sessionId={sessionId} onOrderConfirmed={onOrderConfirmed} />
        </div>

        {/* Indicador gráfico del estado — SIEMPRE visible, FUERA del móvil, a la derecha */}
        <div className="w-full max-w-sm lg:w-80">
          <OrderTracker status={orderStatus} driver={driver} orderId={orderId} />
        </div>
      </div>
    </div>
  );
}
