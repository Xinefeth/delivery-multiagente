import React, { useState, useEffect } from 'react';
import { getActiveDeliveries, getReadyOrders, confirmDelivery, getCompletedDeliveries } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function DriverPage() {
  const [activeDeliveries, setActiveDeliveries] = useState<any[]>([]);
  const [readyOrders, setReadyOrders] = useState<any[]>([]);
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      const [active, ready, completed] = await Promise.all([
        getActiveDeliveries(),
        getReadyOrders(),
        getCompletedDeliveries(),
      ]);
      setActiveDeliveries(active);
      setReadyOrders(ready);
      setCompletedOrders(completed);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 8000); return () => clearInterval(t); }, []);

  const handleConfirm = async (id: string) => {
    try { await confirmDelivery(id); fetchData(); } catch {}
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 px-6 py-4 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛵</span>
          <div>
            <h1 className="font-bold text-lg">Vista Repartidor</h1>
            <p className="text-gray-400 text-xs">Restaurante El Trujillano</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">Hola, {user?.name}</span>
          <button onClick={() => { logout(); navigate('/login'); }} className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded transition">Salir</button>
        </div>
      </header>

      <main className="p-6">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : (
          <div className="space-y-8">
            {/* Pedidos en reparto */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse inline-block" />
                Mis Entregas Activas ({activeDeliveries.length})
              </h2>
              {activeDeliveries.length === 0 ? (
                <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-400 border border-gray-700">
                  <p className="text-4xl mb-2">🛵</p>
                  <p>Sin entregas activas</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {activeDeliveries.map(order => (
                    <div key={order.id} className="bg-gray-800 rounded-xl p-5 border border-purple-500/40">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-bold text-purple-400">#{order.id.slice(-6).toUpperCase()}</p>
                          <p className="text-sm font-medium">{order.customer_name}</p>
                          <p className="text-xs text-gray-400">{order.customer_phone}</p>
                        </div>
                        <span className="text-xs bg-purple-700 text-white px-2 py-1 rounded-full">EN REPARTO</span>
                      </div>
                      <div className="bg-gray-700/50 rounded-lg p-3 mb-4">
                        <p className="text-sm text-white">📍 {order.delivery_address}</p>
                        {order.delivery_reference && <p className="text-xs text-gray-400 mt-1">🏠 {order.delivery_reference}</p>}
                      </div>
                      <div className="text-sm text-gray-300 mb-4">
                        {order.items.map((i: any) => (
                          <div key={i.id}>{i.quantity}x {i.product.name}</div>
                        ))}
                      </div>
                      <p className="text-green-400 font-semibold text-sm mb-3">Total: S/ {order.total.toFixed(2)}</p>
                      <button onClick={() => handleConfirm(order.id)}
                        className="w-full bg-green-600 hover:bg-green-500 text-white font-medium py-2.5 rounded-lg transition text-sm">
                        ✅ Confirmar Entrega
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Pedidos listos para recoger */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                Pedidos Listos para Recoger ({readyOrders.length})
              </h2>
              {readyOrders.length === 0 ? (
                <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-400 border border-gray-700">
                  <p className="text-4xl mb-2">📦</p>
                  <p>No hay pedidos listos</p>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {readyOrders.map(order => (
                    <div key={order.id} className="bg-gray-800 rounded-xl p-5 border border-blue-500/40">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-bold text-blue-400">#{order.id.slice(-6).toUpperCase()}</p>
                          <p className="text-sm">{order.customer_name}</p>
                        </div>
                        <span className="text-xs bg-blue-700 text-white px-2 py-1 rounded-full">LISTO</span>
                      </div>
                      <p className="text-sm text-gray-300 mb-1">📍 {order.delivery_address}</p>
                      <p className="text-green-400 font-semibold text-sm">S/ {order.total.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Pedidos completados */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                Pedidos Completados ({completedOrders.length})
              </h2>
              {completedOrders.length === 0 ? (
                <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-400 border border-gray-700">
                  <p className="text-4xl mb-2">✅</p>
                  <p>Sin entregas completadas aún</p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {completedOrders.map(order => (
                    <div key={order.id} className="bg-gray-800 rounded-xl p-4 border border-green-500/20 opacity-80">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-bold text-green-400">#{order.id.slice(-6).toUpperCase()}</p>
                          <p className="text-sm text-gray-300">{order.customer_name}</p>
                          <p className="text-xs text-gray-500">{order.customer_phone}</p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${order.status === 'CERRADO' ? 'bg-gray-600 text-gray-300' : 'bg-green-800 text-green-200'}`}>
                          {order.status === 'CERRADO' ? 'CERRADO' : 'ENTREGADO'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mb-2">📍 {order.delivery_address}</p>
                      <div className="text-xs text-gray-500 mb-2">
                        {order.items.map((i: any) => (
                          <span key={i.id} className="mr-2">{i.quantity}x {i.product.name}</span>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-green-400 font-semibold text-sm">S/ {order.total.toFixed(2)}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(order.updated_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
