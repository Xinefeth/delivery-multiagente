# Evidencias del Sistema — El Trujillano Delivery

## 1. Estructura de Agentes Implementados

```
backend/src/agents/
├── OrchestratorAgent.ts   → Orquestador principal (máquina de estados)
├── MenuAgent.ts           → Gestión del menú y productos
├── OrderAgent.ts          → Carrito y creación de pedidos
├── PricingAgent.ts        → Cálculo de precios y totales
├── PaymentAgent.ts        → Recepción y validación de pagos
├── KitchenAgent.ts        → Control de cocina (solo acepta PAGO_VALIDADO)
├── DeliveryAgent.ts       → Asignación de repartidores
├── NotificationAgent.ts   → Centraliza todas las notificaciones
└── AdminAgent.ts          → Panel administrativo
```

## 2. Reglas de Negocio Implementadas

### Regla crítica: Pago antes de cocina
```typescript
// KitchenAgent.ts — línea 27
if (order.status !== 'PAGO_VALIDADO') {
  return { 
    success: false, 
    message: `Solo se aceptan pedidos con PAGO_VALIDADO.` 
  };
}
```

### Máquina de estados del OrchestratorAgent
```typescript
// OrchestratorAgent.ts — process()
switch (session.chatState) {
  case 'GREETING':              return this.handleGreeting(session, msg);
  case 'SELECTING':             return this.handleSelecting(session, msg);
  case 'COLLECTING_PHONE':      return this.handleCollectingPhone(session, msg);
  case 'PAYMENT_INSTRUCTIONS':  return this.handlePaymentInstructions(...);
  case 'WAITING_PROOF':         return this.handleWaitingProof(...);
  // ...
}
```

## 3. Flujo de Prueba Manual

### Paso 1: Chatbot (http://localhost:5173)
1. El cliente escribe cualquier mensaje → recibe bienvenida
2. Escribe su nombre → recibe el menú
3. Escribe `2 lomo saltado` → producto agregado al carrito
4. Escribe `1 chicha morada` → producto agregado
5. Escribe `confirmar` → solicita teléfono
6. Ingresa `987654321` → solicita dirección
7. Ingresa `Av. España 1234` → solicita referencia
8. Ingresa `casa azul` → muestra resumen
9. Escribe `sí` → recibe instrucciones de pago (Yape/Plin)
10. Adjunta imagen del comprobante → estado cambia a PAGO_ENVIADO

### Paso 2: Panel Admin (http://localhost:5173/login → admin@eltrujillano.com / admin123)
1. Ver tab **Pagos** → aparece el comprobante del cliente
2. Click **Aprobar** → pedido pasa automáticamente a EN_COCINA
3. Ver tab **Pedidos** → filtrar por EN_COCINA

### Paso 3: Vista Cocina (cocina@eltrujillano.com / cocina123)
1. Ver pedido activo con detalle de productos
2. Click **Marcar como Listo** → estado cambia a LISTO_PARA_REPARTO

### Paso 4: Panel Admin — Asignar Repartidor
1. En tab **Pedidos** → filtrar LISTO_PARA_REPARTO
2. Click **Asignar Repartidor** → primer repartidor disponible asignado

### Paso 5: Vista Repartidor (repartidor@eltrujillano.com / repartidor123)
1. Ver pedido asignado con dirección
2. Click **Confirmar Entrega** → estado ENTREGADO → CERRADO

### Paso 6: Chatbot — Encuesta
1. El cliente recibe notificación de entrega
2. Sistema envía encuesta de satisfacción
3. Cliente escribe `5` → encuesta registrada

## 4. Endpoints de la API

```
POST   /api/auth/login                          → Autenticación JWT
POST   /api/chat                                → Mensaje al chatbot (multipart)
GET    /api/chat/status/:sessionId              → Estado del pedido actual
GET    /api/chat/notifications/:orderId         → Notificaciones

GET    /api/admin/orders?status=...             → Lista de pedidos [ADMIN]
GET    /api/admin/metrics                       → Métricas del día [ADMIN]
POST   /api/admin/orders/:id/validate-payment   → Validar comprobante [ADMIN]
POST   /api/admin/orders/:id/assign-driver      → Asignar repartidor [ADMIN]
GET    /api/admin/pending-payments              → Pagos pendientes [ADMIN]
GET    /api/admin/products                      → Lista de productos [ADMIN]
POST   /api/admin/products                      → Crear producto [ADMIN]
PATCH  /api/admin/products/:id                  → Actualizar producto [ADMIN]
GET    /api/admin/drivers                       → Lista de repartidores [ADMIN]
POST   /api/admin/drivers                       → Crear repartidor [ADMIN]
PATCH  /api/admin/drivers/:id                   → Actualizar repartidor [ADMIN]

GET    /api/kitchen/orders                      → Pedidos en cocina [COCINA]
POST   /api/kitchen/orders/:id/ready            → Marcar pedido listo [COCINA]

GET    /api/driver/active                       → Entregas activas [REPARTIDOR]
GET    /api/driver/ready-orders                 → Pedidos listos [REPARTIDOR]
POST   /api/driver/orders/:id/confirm-delivery  → Confirmar entrega [REPARTIDOR]
```

## 5. Modelo de Base de Datos

Las tablas implementadas y sus relaciones:
```
users ──────┐
            │ (user_id)
products ───┤          orders ──────── order_items
            │              │
drivers ────┘ (driver_id)  ├──── payments
                           ├──── notifications
                           └──── surveys
```

## 5b. Validación con Claude Vision

Al adjuntar el comprobante, el sistema invoca Claude con visión antes de notificar al admin:

```typescript
// routes/chatbot.ts — fragmento PaymentValidationAgent
const response = await anthropic.messages.create({
  model: 'claude-opus-4-5',
  max_tokens: 1024,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type, data: base64 } },
      { type: 'text', text: 'Analiza este comprobante de pago...' }
    ]
  }]
});
// Extrae: monto, método, destinatario, nivel de confianza
```

El admin recibe en el panel el resultado del análisis junto con la imagen, acelerando la validación manual.

---

## 6. Criterios de Éxito Verificados

| Criterio | Estado |
|----------|--------|
| ✅ Automatización del flujo TO-BE | Implementado |
| ✅ Pedido no avanza a cocina sin pago | Implementado (KitchenAgent) |
| ✅ Trazabilidad por estados | 12 estados implementados |
| ✅ Agentes con responsabilidades separadas | 9 agentes independientes |
| ✅ Base de datos | PostgreSQL + Prisma (8 tablas) |
| ✅ Interfaz web responsive | React + TailwindCSS |
| ✅ Diagrama de arquitectura | Mermaid en docs/arquitectura.md |
| ✅ Ejecutable localmente | Ver README.md |
