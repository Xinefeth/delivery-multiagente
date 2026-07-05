import React, { useState, useEffect } from 'react';
import { getKitchenOrders, markOrderReady } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function KitchenPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const fetchOrders = async () => {
    try { setOrders(await getKitchenOrders()); } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchOrders(); const t = setInterval(fetchOrders, 8000); return () => clearInterval(t); }, []);

  const handleReady = async (id: string) => {
    try { await markOrderReady(id); fetchOrders(); } catch {}
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 px-6 py-4 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🍳</span>
          <div>
            <h1 className="font-bold text-lg">Vista Cocina</h1>
            <p className="text-gray-400 text-xs">Restaurante El Trujillano</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">Hola, {user?.name}</span>
          <button onClick={() => { logout(); navigate('/login'); }} className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded transition">Salir</button>
        </div>
      </header>

      <main className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Pedidos en Cocina</h2>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <span className="text-xs text-gray-400">{orders.length} pedido(s) activo(s)</span>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">Cargando pedidos...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🍽️</div>
            <p className="text-gray-400 text-lg">No hay pedidos en cocina</p>
            <p className="text-gray-500 text-sm mt-1">Los nuevos pedidos aparecerán aquí automáticamente</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {orders.map(order => (
              <div key={order.id} className="bg-gray-800 rounded-xl p-5 border border-orange-500/30 hover:border-orange-500/60 transition">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold text-orange-400">#{order.id.slice(-6).toUpperCase()}</p>
                    <p className="text-sm text-gray-300">{order.customer_name}</p>
                    <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <span className="text-xs bg-orange-600 text-white px-2 py-1 rounded-full">EN COCINA</span>
                </div>

                <div className="border-t border-gray-700 pt-3 mb-4">
                  <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Productos:</p>
                  {order.items.map((item: any) => (
                    <div key={item.id} className="flex justify-between text-sm py-0.5">
                      <span className="text-white">{item.quantity}x {item.product.name}</span>
                      <span className="text-gray-400">S/ {item.subtotal.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <div className="text-xs text-gray-400 mb-4">
                  <p>📍 {order.delivery_address}</p>
                  {order.delivery_reference && <p>🏠 {order.delivery_reference}</p>}
                </div>

                <button onClick={() => handleReady(order.id)}
                  className="w-full bg-green-600 hover:bg-green-500 text-white font-medium py-2.5 rounded-lg transition text-sm">
                  ✅ Marcar como Listo
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
