import React, { useState, useEffect } from 'react';
import {
  getAdminOrders, getMetrics, validatePayment,
  getAdminProducts, updateProduct, createProduct,
  getAdminDrivers, createDriver, updateDriver,
  getPendingPayments,
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const STATUS_COLORS: Record<string, string> = {
  CONSULTA: 'bg-gray-600', COTIZACION: 'bg-gray-500',
  PAGO_PENDIENTE: 'bg-yellow-700', PAGO_ENVIADO: 'bg-yellow-500',
  PAGO_VALIDADO: 'bg-green-600', PAGO_RECHAZADO: 'bg-red-600',
  EN_COCINA: 'bg-orange-500', LISTO_PARA_REPARTO: 'bg-blue-500',
  EN_REPARTO: 'bg-purple-500', ENTREGADO: 'bg-green-500',
  CERRADO: 'bg-gray-400', CANCELADO: 'bg-red-800',
};

type Tab = 'dashboard' | 'orders' | 'payments' | 'products' | 'drivers';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [orders, setOrders] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [pendingPayments, setPendingPayments] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [o, m, pp, pr, dr] = await Promise.all([
        getAdminOrders(filterStatus || undefined),
        getMetrics(),
        getPendingPayments(),
        getAdminProducts(),
        getAdminDrivers(),
      ]);
      setOrders(o); setMetrics(m); setPendingPayments(pp);
      setProducts(pr); setDrivers(dr);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); const t = setInterval(fetchAll, 10000); return () => clearInterval(t); }, [filterStatus]);

  const handleValidate = async (orderId: string, approve: boolean) => {
    try {
      await validatePayment(orderId, approve, noteInputs[orderId]);
      fetchAll();
    } catch {}
  };

  const handleToggleProduct = async (p: any) => {
    try { await updateProduct(p.id, { is_available: !p.is_available }); fetchAll(); } catch {}
  };

  const handleToggleDriver = async (d: any) => {
    try { await updateDriver(d.id, { is_available: !d.is_available }); fetchAll(); } catch {}
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'orders', label: 'Pedidos', icon: '📋' },
    { id: 'payments', label: `Pagos (${pendingPayments.length})`, icon: '💳' },
    { id: 'products', label: 'Productos', icon: '🍽️' },
    { id: 'drivers', label: 'Repartidores', icon: '🛵' },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 px-6 py-4 flex items-center justify-between border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-sm font-bold">ET</div>
          <div>
            <h1 className="font-bold text-base">Panel Administrador</h1>
            <p className="text-gray-400 text-xs">El Trujillano Delivery</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{user?.name}</span>
          <a href="/" className="text-xs text-green-400 hover:underline">Chatbot</a>
          <button onClick={() => { logout(); navigate('/login'); }}
            className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded transition">Salir</button>
        </div>
      </header>

      {/* Nav tabs */}
      <nav className="bg-gray-800 border-b border-gray-700 px-4 flex gap-1 shrink-0 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 transition ${tab === t.id ? 'border-green-500 text-green-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-6 overflow-auto">
        {loading && tab !== 'dashboard' && <p className="text-gray-400 text-sm mb-3">Actualizando...</p>}

        {/* DASHBOARD */}
        {tab === 'dashboard' && metrics && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Resumen del día</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Pedidos hoy', value: metrics.ordersToday, color: 'border-blue-500', icon: '📦' },
                { label: 'Pendientes pago', value: metrics.pendingOrders, color: 'border-yellow-500', icon: '⏳' },
                { label: 'Entregados', value: metrics.deliveredOrders, color: 'border-green-500', icon: '✅' },
                { label: 'Ingresos estimados', value: `S/ ${metrics.estimatedRevenue?.toFixed(2) ?? '0.00'}`, color: 'border-purple-500', icon: '💰' },
              ].map(m => (
                <div key={m.label} className={`bg-gray-800 rounded-xl p-5 border-l-4 ${m.color}`}>
                  <p className="text-2xl mb-1">{m.icon}</p>
                  <p className="text-2xl font-bold text-white">{m.value}</p>
                  <p className="text-gray-400 text-sm">{m.label}</p>
                </div>
              ))}
            </div>
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <p className="text-sm text-gray-400 mb-2">Total de pedidos registrados: <span className="text-white font-bold">{metrics.totalOrders}</span></p>
              <p className="text-xs text-gray-500">Última actualización: {new Date().toLocaleTimeString('es-PE')}</p>
            </div>
          </div>
        )}

        {/* PEDIDOS */}
        {tab === 'orders' && (
          <div>
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <h2 className="text-xl font-semibold">Todos los Pedidos</h2>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="bg-gray-700 text-white text-sm rounded-lg px-3 py-1.5 border border-gray-600 outline-none">
                <option value="">Todos los estados</option>
                {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-3">
              {orders.map(order => (
                <div key={order.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">#{order.id.slice(-6).toUpperCase()} — {order.customer_name}</p>
                      <p className="text-xs text-gray-400">{order.customer_phone} | {order.delivery_address}</p>
                      <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleString('es-PE')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs text-white px-2 py-1 rounded-full ${STATUS_COLORS[order.status] ?? 'bg-gray-600'}`}>{order.status}</span>
                      <span className="text-green-400 font-semibold text-sm">S/ {order.total.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    {order.items.map((i: any) => `${i.quantity}x ${i.product.name}`).join(', ')}
                  </div>
                  {order.payment_proof_url && (
                    <a href={order.payment_proof_url} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-400 hover:underline mt-1 block">Ver comprobante</a>
                  )}
                  {order.driver && (
                    <p className="text-xs text-purple-400 mt-1">Repartidor: {order.driver.name}</p>
                  )}
                </div>
              ))}
              {orders.length === 0 && <p className="text-gray-400 text-center py-8">No hay pedidos</p>}
            </div>
          </div>
        )}

        {/* PAGOS */}
        {tab === 'payments' && (
          <div>
            <h2 className="text-xl font-semibold mb-1">Comprobantes de Pago</h2>
            <p className="text-xs text-gray-400 mb-4">El sistema valida automáticamente. El admin puede revisar o corregir.</p>
            {pendingPayments.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-5xl mb-3">✅</p>
                <p>No hay comprobantes registrados</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {pendingPayments.map((order: any) => {
                  const payment = order.payments?.[0];
                  const autoValidated = payment?.validated_automatically;
                  const payStatus = payment?.status;
                  const borderColor = payStatus === 'VALIDADO'
                    ? 'border-green-500/40'
                    : payStatus === 'RECHAZADO'
                    ? 'border-red-500/40'
                    : 'border-yellow-500/30';

                  return (
                    <div key={order.id} className={`bg-gray-800 rounded-xl p-5 border ${borderColor}`}>
                      {/* Header */}
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-bold text-yellow-400">#{order.id.slice(-6).toUpperCase()}</p>
                          <p className="text-sm">{order.customer_name} — {order.customer_phone}</p>
                          <p className="text-xs text-gray-400">{new Date(order.created_at).toLocaleString('es-PE')}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-green-400 font-bold">S/ {order.total.toFixed(2)}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[order.status] ?? 'bg-gray-600'} text-white`}>
                            {order.status}
                          </span>
                        </div>
                      </div>

                      {/* Items */}
                      <div className="text-xs text-gray-300 mb-3">
                        {order.items.map((i: any) => <div key={i.id}>{i.quantity}x {i.product.name}</div>)}
                      </div>

                      {/* Comprobante */}
                      {order.payment_proof_url && (
                        <div className="mb-3">
                          <a href={order.payment_proof_url} target="_blank" rel="noreferrer">
                            <img src={order.payment_proof_url} alt="Comprobante" className="rounded-lg max-h-40 object-contain border border-gray-600 w-full" />
                          </a>
                        </div>
                      )}

                      {/* Resultado de validación automática */}
                      {payment && (
                        <div className={`rounded-lg p-3 mb-3 text-xs ${
                          payStatus === 'VALIDADO' ? 'bg-green-900/40 border border-green-600/30' :
                          payStatus === 'RECHAZADO' ? 'bg-red-900/40 border border-red-600/30' :
                          'bg-gray-700/50 border border-gray-600/30'
                        }`}>
                          <p className="font-semibold mb-1 text-sm">
                            {autoValidated ? '🤖 Validación automática' : '👤 Validación manual'}
                            {' '}
                            {payStatus === 'VALIDADO' && <span className="text-green-400">— APROBADO ✅</span>}
                            {payStatus === 'RECHAZADO' && <span className="text-red-400">— RECHAZADO ❌</span>}
                            {payStatus === 'EN_VERIFICACION' && <span className="text-yellow-400">— EN PROCESO ⏳</span>}
                          </p>
                          {payment.validation_confidence != null && (
                            <p className="text-gray-300">Confianza: <span className="text-white font-medium">{Math.round(payment.validation_confidence * 100)}%</span></p>
                          )}
                          {payment.detected_amount != null && (
                            <p className="text-gray-300">Monto detectado: <span className="text-white">S/ {Number(payment.detected_amount).toFixed(2)}</span>
                              {' '}<span className="text-gray-400">(esperado: S/ {order.total.toFixed(2)})</span>
                            </p>
                          )}
                          {payment.detected_method && (
                            <p className="text-gray-300">Método detectado: <span className="text-white">{payment.detected_method}</span></p>
                          )}
                          {payment.detected_receiver_number && (
                            <p className="text-gray-300">Número destino: <span className="text-white">{payment.detected_receiver_number}</span></p>
                          )}
                          {payment.rejection_reason && (
                            <p className="text-red-300 mt-1">⚠️ {payment.rejection_reason}</p>
                          )}
                          {payment.validated_at && (
                            <p className="text-gray-500 mt-1">Validado: {new Date(payment.validated_at).toLocaleString('es-PE')}</p>
                          )}
                        </div>
                      )}

                      {/* Acción manual del admin */}
                      {['PAGO_ENVIADO', 'PAGO_PENDIENTE', 'PAGO_RECHAZADO'].includes(order.status) && (
                        <>
                          <textarea
                            placeholder="Notas del administrador (opcional)"
                            value={noteInputs[order.id] ?? ''}
                            onChange={e => setNoteInputs(prev => ({ ...prev, [order.id]: e.target.value }))}
                            className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2 resize-none mb-2 outline-none border border-gray-600"
                            rows={2}
                          />
                          <div className="flex gap-2">
                            <button onClick={() => handleValidate(order.id, true)}
                              className="flex-1 bg-green-700 hover:bg-green-600 text-white text-sm py-2 rounded-lg transition font-medium">
                              ✅ Aprobar manualmente
                            </button>
                            <button onClick={() => handleValidate(order.id, false)}
                              className="flex-1 bg-red-800 hover:bg-red-700 text-white text-sm py-2 rounded-lg transition font-medium">
                              ❌ Rechazar
                            </button>
                          </div>
                        </>
                      )}
                      {order.status === 'PAGO_VALIDADO' && (
                        <p className="text-center text-green-400 text-xs py-2">Pago validado — pedido en cocina</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* PRODUCTOS */}
        {tab === 'products' && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Gestión de Productos</h2>
            <div className="grid gap-2">
              {products.map(p => (
                <div key={p.id} className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between border border-gray-700">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.category} — S/ {p.price.toFixed(2)}</p>
                  </div>
                  <button onClick={() => handleToggleProduct(p)}
                    className={`text-xs px-3 py-1.5 rounded-full transition font-medium ${p.is_available ? 'bg-green-700 hover:bg-red-700 text-white' : 'bg-gray-700 hover:bg-green-700 text-gray-300'}`}>
                    {p.is_available ? 'Disponible' : 'No disponible'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* REPARTIDORES */}
        {tab === 'drivers' && (
          <div>
            <h2 className="text-xl font-semibold mb-4">Gestión de Repartidores</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {drivers.map(d => (
                <div key={d.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-sm text-gray-400">📱 {d.phone}</p>
                  </div>
                  <button onClick={() => handleToggleDriver(d)}
                    className={`text-xs px-3 py-1.5 rounded-full transition ${d.is_available ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-400'}`}>
                    {d.is_available ? '🟢 Disponible' : '🔴 Ocupado'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
