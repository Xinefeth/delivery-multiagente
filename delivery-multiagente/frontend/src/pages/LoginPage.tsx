import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { token, user } = await login(email, password);
      setAuth(token, user);
      const routes: Record<string, string> = { ADMIN: '/admin', COCINA: '/kitchen', REPARTIDOR: '/driver' };
      navigate(routes[user.role] ?? '/');
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Error al iniciar sesión');
    } finally { setLoading(false); }
  };

  const quickLogin = async (e: string, p: string) => {
    setEmail(e); setPassword(p);
    setError(''); setLoading(true);
    try {
      const { token, user } = await login(e, p);
      setAuth(token, user);
      const routes: Record<string, string> = { ADMIN: '/admin', COCINA: '/kitchen', REPARTIDOR: '/driver' };
      navigate(routes[user.role] ?? '/');
    } catch { setError('Error al iniciar sesión'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-gray-800 rounded-2xl p-8 shadow-xl border border-gray-700">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3">ET</div>
            <h1 className="text-white text-2xl font-bold">El Trujillano</h1>
            <p className="text-gray-400 text-sm mt-1">Panel de administración</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-gray-300 text-sm mb-1 block">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none border border-gray-600 focus:border-green-500 transition text-sm" />
            </div>
            <div>
              <label className="text-gray-300 text-sm mb-1 block">Contraseña</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none border border-gray-600 focus:border-green-500 transition text-sm" />
            </div>
            {error && <p className="text-red-400 text-sm bg-red-900/20 p-2 rounded">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition">
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>

          <div className="mt-6">
            <p className="text-gray-500 text-xs text-center mb-3">Acceso rápido (demo):</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '🔧 Admin', e: 'admin@eltrujillano.com', p: 'admin123' },
                { label: '🍳 Cocina', e: 'cocina@eltrujillano.com', p: 'cocina123' },
                { label: '🛵 Reparto', e: 'repartidor@eltrujillano.com', p: 'repartidor123' },
              ].map(({ label, e, p }) => (
                <button key={e} onClick={() => quickLogin(e, p)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 py-1.5 rounded-lg transition">
                  {label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-center mt-6">
            <a href="/" className="text-green-400 text-sm hover:underline">← Ir al chatbot</a>
          </p>
        </div>
      </div>
    </div>
  );
}
