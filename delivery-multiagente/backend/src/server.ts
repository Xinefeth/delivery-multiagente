import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { errorHandler, notFound } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import chatbotRoutes from './routes/chatbot';
import adminRoutes from './routes/admin';
import kitchenRoutes from './routes/kitchen';
import driverRoutes from './routes/driver';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir comprobantes de pago subidos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatbotRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/kitchen', kitchenRoutes);
app.use('/api/driver', driverRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'Delivery El Trujillano API' });
});

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📋 API Endpoints:`);
  console.log(`   POST /api/auth/login`);
  console.log(`   POST /api/chat`);
  console.log(`   GET  /api/chat/status/:sessionId`);
  console.log(`   GET  /api/admin/orders`);
  console.log(`   GET  /api/admin/metrics`);
  console.log(`   POST /api/admin/orders/:id/validate-payment`);
  console.log(`   GET  /api/kitchen/orders`);
  console.log(`   POST /api/kitchen/orders/:id/ready`);
  console.log(`   GET  /api/driver/active`);
  console.log(`   POST /api/driver/orders/:id/confirm-delivery\n`);
});

export default app;
