import React from 'react';

export interface DriverInfo {
  name: string;
  phone: string;
}

// Etapas visibles del seguimiento (mapeadas desde los estados internos del pedido).
const STAGES = [
  { key: 'pago', label: 'Pago', icon: '💳' },
  { key: 'cocina', label: 'En cocina', icon: '🍳' },
  { key: 'listo', label: 'Listo', icon: '📦' },
  { key: 'camino', label: 'En camino', icon: '🛵' },
  { key: 'entregado', label: 'Entregado', icon: '✅' },
];

const STATUS_LABEL: Record<string, string> = {
  PAGO_PENDIENTE: 'Esperando tu comprobante de pago',
  PAGO_ENVIADO: 'Verificando tu pago…',
  PAGO_RECHAZADO: 'Pago rechazado — reenvía el comprobante',
  PAGO_VALIDADO: '¡Pago confirmado! ✅',
  EN_COCINA: 'Preparando tu pedido 🍳',
  LISTO_PARA_REPARTO: 'Listo para salir 📦',
  EN_REPARTO: 'En camino a tu dirección 🛵',
  ENTREGADO: '¡Entregado! Buen provecho 😋',
  CERRADO: 'Pedido cerrado',
};

function stepIndex(status: string): number {
  switch (status) {
    case 'PAGO_PENDIENTE':
    case 'PAGO_ENVIADO':
    case 'PAGO_RECHAZADO':
      return 0;
    case 'PAGO_VALIDADO':
    case 'EN_COCINA':
      return 1;
    case 'LISTO_PARA_REPARTO':
      return 2;
    case 'EN_REPARTO':
      return 3;
    case 'ENTREGADO':
    case 'CERRADO':
      return 4;
    default:
      return 0;
  }
}

interface Props {
  status: string | null;
  driver: DriverInfo | null;
  orderId?: string | null;
}

export default function OrderTracker({ status, driver, orderId }: Props) {
  // Sin pedido aún: mostramos el tracker "apagado" con un mensaje guía.
  const activo = !!status;
  const current = activo ? stepIndex(status as string) : -1;
  const rejected = status === 'PAGO_RECHAZADO';
  return (
    <div className="bg-white rounded-2xl shadow-xl px-4 py-4 w-full">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-[#075E54]">Seguimiento de tu pedido</p>
        {orderId && <span className="text-[11px] text-gray-400">#{orderId}</span>}
      </div>

      <p className="text-xs font-semibold text-gray-600 mb-3 text-center">
        {activo
          ? STATUS_LABEL[status as string] ?? 'Estado de tu pedido'
          : 'Aún no tienes un pedido activo. Haz tu pedido en el chat y verás aquí su avance 👉'}
      </p>

      <div className="flex items-start">
        {STAGES.map((s, i) => {
          const done = i <= current;
          const isCurrent = i === current;
          return (
            <React.Fragment key={s.key}>
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 52 }}>
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-base transition-all ${
                    done ? (rejected && i === 0 ? 'bg-red-500' : 'bg-[#25D366]') : 'bg-gray-200'
                  } ${isCurrent && !rejected ? 'ring-2 ring-offset-2 ring-[#075E54] animate-pulse' : ''}`}
                >
                  <span className={done ? '' : 'opacity-40 grayscale'}>{s.icon}</span>
                </div>
                <span
                  className={`text-[10px] mt-1 text-center leading-tight ${
                    done ? 'text-[#075E54] font-medium' : 'text-gray-400'
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div className={`flex-1 h-1 mt-4 rounded ${i < current ? 'bg-[#25D366]' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Repartidor: visible mientras haya un pedido. Muestra placeholder hasta
          que se asigne (cuando el pedido sale a reparto). */}
      {activo && (
        <div className="mt-4 flex items-center gap-3 bg-[#ECE5DD] rounded-xl px-3 py-3">
          <div className="w-11 h-11 rounded-full bg-[#075E54] text-white flex items-center justify-center text-xl flex-shrink-0">
            🛵
          </div>
          {driver ? (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gray-500 leading-tight">Tu repartidor</p>
                <p className="text-base font-semibold text-gray-800 truncate">{driver.name}</p>
                <p className="text-[11px] text-gray-500 truncate">📞 {driver.phone}</p>
              </div>
              <a
                href={`tel:${driver.phone}`}
                className="bg-[#25D366] text-white text-sm rounded-full px-4 py-2 font-medium flex items-center gap-1 flex-shrink-0"
              >
                Llamar
              </a>
            </>
          ) : (
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-gray-500 leading-tight">Tu repartidor</p>
              <p className="text-sm text-gray-500 italic">Se asignará cuando tu pedido salga a reparto 🛵</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
