import axios from 'axios';

// En producción (Render) se define VITE_API_URL con la URL absoluta del backend,
// p.ej. https://el-trujillano-api.onrender.com/api. En desarrollo cae a '/api',
// que el proxy de Vite (vite.config.ts) redirige a http://localhost:8000.
const BASE = import.meta.env.VITE_API_URL || '/api';

// Origen del backend (sin el sufijo /api), para construir URLs de archivos
// servidos por el backend como /uploads/... (comprobantes de pago).
export const API_ORIGIN = BASE.replace(/\/api\/?$/, '');

/** Convierte una ruta relativa del backend (p.ej. /uploads/x.jpg) en absoluta. */
export const assetUrl = (path?: string | null): string | undefined => {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
};

export const api = axios.create({ baseURL: BASE });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Chatbot (legacy - OrchestratorAgent)
export const sendChatMessage = async (sessionId: string, message: string, attachment?: File) => {
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('message', message);
  if (attachment) form.append('attachment', attachment);
  const { data } = await api.post('/chat', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  return data;
};

// Chatbot inteligente con Claude
export const sendSmartMessage = async (sessionId: string, message: string, attachment?: File) => {
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('message', message);
  if (attachment) form.append('attachment', attachment);
  const { data } = await api.post('/chat/message', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  return data;
};

export const getChatStatus = async (sessionId: string) => {
  const { data } = await api.get(`/chat/status/${sessionId}`);
  return data;
};

export const getChatNotifications = async (orderId: string) => {
  const { data } = await api.get(`/chat/notifications/${orderId}`);
  return data;
};

// Auth
export const login = async (email: string, password: string) => {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
};

// Admin
export const getAdminOrders = async (status?: string) => {
  const { data } = await api.get('/admin/orders', { params: status ? { status } : {} });
  return data;
};

export const getMetrics = async () => {
  const { data } = await api.get('/admin/metrics');
  return data;
};

export const validatePayment = async (orderId: string, approve: boolean, adminNotes?: string) => {
  const { data } = await api.post(`/admin/orders/${orderId}/validate-payment`, { approve, adminNotes });
  return data;
};

export const assignDriver = async (orderId: string) => {
  const { data } = await api.post(`/admin/orders/${orderId}/assign-driver`);
  return data;
};

export const getPendingPayments = async () => {
  const { data } = await api.get('/admin/pending-payments');
  return data;
};

export const getAdminProducts = async () => {
  const { data } = await api.get('/admin/products');
  return data;
};

export const updateProduct = async (id: string, updates: any) => {
  const { data } = await api.patch(`/admin/products/${id}`, updates);
  return data;
};

export const createProduct = async (product: any) => {
  const { data } = await api.post('/admin/products', product);
  return data;
};

export const getAdminDrivers = async () => {
  const { data } = await api.get('/admin/drivers');
  return data;
};

export const createDriver = async (driver: any) => {
  const { data } = await api.post('/admin/drivers', driver);
  return data;
};

export const updateDriver = async (id: string, updates: any) => {
  const { data } = await api.patch(`/admin/drivers/${id}`, updates);
  return data;
};

// Kitchen
export const getKitchenOrders = async () => {
  const { data } = await api.get('/kitchen/orders');
  return data;
};

export const markOrderReady = async (orderId: string) => {
  const { data } = await api.post(`/kitchen/orders/${orderId}/ready`);
  return data;
};

// Driver
export const getActiveDeliveries = async () => {
  const { data } = await api.get('/driver/active');
  return data;
};

export const getReadyOrders = async () => {
  const { data } = await api.get('/driver/ready-orders');
  return data;
};

export const confirmDelivery = async (orderId: string) => {
  const { data } = await api.post(`/driver/orders/${orderId}/confirm-delivery`);
  return data;
};

export const getCompletedDeliveries = async () => {
  const { data } = await api.get('/driver/completed');
  return data;
};
