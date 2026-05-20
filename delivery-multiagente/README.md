# El Trujillano Delivery — Sistema Multiagente

Sistema de delivery automatizado para restaurante, desarrollado como proyecto académico. Implementa una arquitectura multiagente con 9 agentes especializados que gestionan el ciclo completo de un pedido: desde el chatbot hasta la entrega y encuesta de satisfacción.

## Descripción general

El sistema reemplaza un proceso manual (AS-IS) con un flujo digital automatizado (TO-BE). Un cliente interactúa con un chatbot web que simula WhatsApp; detrás, el `OrchestratorAgent` coordina los demás agentes para gestionar el menú, carrito, pagos, cocina, reparto y notificaciones.

**Resultado:** validación de pagos de 10-20 min a menos de 3 min, cero errores de cálculo y trazabilidad completa del pedido.

---

## Arquitectura

```
Cliente (Chatbot Web / Panel Admin / Cocina / Repartidor)
        │
        ▼
   API REST (Express)
        │
        ▼
 OrchestratorAgent  ──► MenuAgent
  (Máquina de          ──► OrderAgent
   13 estados)         ──► PricingAgent
                       ──► PaymentAgent  ──► Claude Vision (validación)
                       ──► KitchenAgent
                       ──► DeliveryAgent
                       ──► NotificationAgent
                       ──► AdminAgent
                              │
                              ▼
                      PostgreSQL (Prisma ORM)
```

Ver diagrama completo en [`docs/arquitectura.md`](docs/arquitectura.md).

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 20 + TypeScript 5.3 |
| Framework | Express 4.18 |
| ORM | Prisma 5.7 |
| Base de datos | PostgreSQL 15 |
| IA | Anthropic Claude (SDK 0.97) |
| Auth | JWT + bcryptjs |
| Archivos | Multer (local `/uploads`) |
| Frontend | React 18 + Vite 5 + TailwindCSS 3 |
| Routing | React Router DOM 6 |
| HTTP Client | Axios 1.6 |

---

## Agentes implementados

| Agente | Responsabilidad | Métodos clave |
|--------|----------------|---------------|
| `OrchestratorAgent` | Coordina el flujo completo. Mantiene máquina de estados por sesión | `process()` |
| `MenuAgent` | Catálogo de productos desde BD | `getFormattedMenu()`, `findProductByNameOrNumber()` |
| `OrderAgent` | Carrito y creación de pedidos | `parseAndAddToCart()`, `createOrder()` |
| `PricingAgent` | Subtotal + delivery (S/ 5.00 fijo) + total | `calculateSubtotal()`, `generateSummary()` |
| `PaymentAgent` | Guarda comprobante y valida el pago | `saveProof()`, `validatePayment()` |
| `KitchenAgent` | Control de cocina **(solo acepta PAGO_VALIDADO)** | `receiveOrder()`, `markOrderReady()` |
| `DeliveryAgent` | Asigna repartidor y confirma entrega | `assignDriver()`, `confirmDelivery()` |
| `NotificationAgent` | Centraliza notificaciones internas | `saveNotification()`, `notifyStatusChange()` |
| `AdminAgent` | Panel de métricas y gestión manual | `getMetrics()`, `validatePayment()` |

---

## Estados del pedido

```
CONSULTA → SELECCION_PRODUCTOS → COTIZACION → PAGO_PENDIENTE
→ PAGO_ENVIADO → PAGO_VALIDADO → EN_COCINA → LISTO_PARA_REPARTO
→ EN_REPARTO → ENTREGADO → CERRADO
```

> **Regla crítica:** `KitchenAgent` bloquea cualquier pedido que no esté en `PAGO_VALIDADO`.

Ver flujo completo en [`docs/flujo-pedido.md`](docs/flujo-pedido.md).

---

## Requisitos previos

- Node.js 20+
- PostgreSQL 15 (corriendo en localhost:5432)
- npm 9+

---

## Instalación

### 1. Clonar y preparar variables de entorno

```bash
cd delivery-multiagente/backend
cp .env.example .env
```

Editar `.env`:

```env
DATABASE_URL="postgresql://postgres:TU_PASSWORD@localhost:5432/delivery_trujillano"
JWT_SECRET="cambia_esto_por_un_secreto_seguro"
PORT=3001
NODE_ENV=development
ANTHROPIC_API_KEY="sk-ant-..."
```

### 2. Instalar dependencias y configurar la base de datos

```bash
# Backend
cd delivery-multiagente/backend
npm install
npm run prisma:migrate
npm run prisma:seed

# Frontend
cd ../frontend
npm install
```

### 3. Ejecutar en desarrollo

Abrir dos terminales:

```bash
# Terminal 1 — Backend
cd delivery-multiagente/backend
npm run dev
# Corre en http://localhost:3001

# Terminal 2 — Frontend
cd delivery-multiagente/frontend
npm run dev
# Corre en http://localhost:5173
```

---

## Acceso al sistema

| Rol | URL | Email | Contraseña |
|-----|-----|-------|-----------|
| Cliente | http://localhost:5173 | — | — |
| Admin | http://localhost:5173/login | admin@eltrujillano.com | admin123 |
| Cocina | http://localhost:5173/login | cocina@eltrujillano.com | cocina123 |
| Repartidor | http://localhost:5173/login | repartidor@eltrujillano.com | repartidor123 |

---

## Prueba rápida del flujo completo

1. **Chatbot** → escribir cualquier mensaje → ingresar nombre → seleccionar del menú → confirmar → subir comprobante de pago
2. **Admin** (`/admin`) → tab Pagos → Aprobar comprobante
3. **Cocina** (`/kitchen`) → ver pedido → Marcar como Listo
4. **Admin** → tab Pedidos → Asignar Repartidor
5. **Repartidor** (`/driver`) → Confirmar Entrega
6. **Chatbot** → el sistema envía encuesta de satisfacción

Ver guía detallada en [`docs/evidencias.md`](docs/evidencias.md).

---

## Scripts disponibles

### Backend

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Servidor con hot-reload (ts-node-dev) |
| `npm run build` | Compilar TypeScript a `/dist` |
| `npm start` | Ejecutar build de producción |
| `npm run prisma:migrate` | Ejecutar migraciones |
| `npm run prisma:seed` | Poblar datos iniciales |
| `npm run setup` | migrate + seed en un paso |

### Frontend

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Servidor Vite con HMR |
| `npm run build` | Build de producción |
| `npm run preview` | Preview del build |

---

## API — Resumen de endpoints

Ver referencia completa en [`docs/api.md`](docs/api.md).

```
POST  /api/auth/login
POST  /api/chat                              (multipart/form-data)
GET   /api/chat/status/:sessionId

GET   /api/admin/orders?status=...           [ADMIN]
POST  /api/admin/orders/:id/validate-payment [ADMIN]
POST  /api/admin/orders/:id/assign-driver    [ADMIN]
GET   /api/admin/metrics                     [ADMIN]
GET/POST/PATCH /api/admin/products           [ADMIN]
GET/POST/PATCH /api/admin/drivers            [ADMIN]

GET   /api/kitchen/orders                    [COCINA]
POST  /api/kitchen/orders/:id/ready          [COCINA]

GET   /api/driver/active                     [REPARTIDOR]
POST  /api/driver/orders/:id/confirm-delivery[REPARTIDOR]
```

---

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [`docs/arquitectura.md`](docs/arquitectura.md) | Diagrama de arquitectura completo, descripción de componentes y stack |
| [`docs/flujo-pedido.md`](docs/flujo-pedido.md) | Diagrama de flujo TO-BE, diagrama de estados y tiempos estimados |
| [`docs/api.md`](docs/api.md) | Referencia completa de la API REST |
| [`docs/evidencias.md`](docs/evidencias.md) | Evidencia de implementación académica, reglas de negocio y criterios de éxito |

---

## Contexto académico

Proyecto desarrollado para evidenciar el diseño e implementación de una arquitectura multiagente aplicada a un caso real. El restaurante **El Trujillano**, ubicado en Trujillo, Perú, operaba con procesos manuales en WhatsApp. Este sistema automatiza el flujo completo con agentes especializados, manteniendo la separación de responsabilidades y una máquina de estados robusta.
