# Referencia de la API REST — El Trujillano Delivery

Base URL en desarrollo: `http://localhost:3001`

Los endpoints protegidos requieren el header:
```
Authorization: Bearer <jwt_token>
```

---

## Autenticación

### POST /api/auth/login

Obtiene un JWT para acceder a rutas protegidas.

**Body:**
```json
{
  "email": "admin@eltrujillano.com",
  "password": "admin123"
}
```

**Respuesta 200:**
```json
{
  "token": "eyJhbGci...",
  "user": {
    "id": 1,
    "name": "Admin",
    "email": "admin@eltrujillano.com",
    "role": "ADMIN"
  }
}
```

**Roles disponibles:** `CLIENTE`, `ADMIN`, `COCINA`, `REPARTIDOR`

---

## Chatbot

### POST /api/chat

Envía un mensaje al chatbot. Acepta `multipart/form-data` para adjuntar comprobante de pago.

**Body (form-data):**
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `message` | string | Mensaje del cliente |
| `sessionId` | string | ID único de sesión |
| `attachment` | file (opcional) | Imagen del comprobante de pago |

**Respuesta 200:**
```json
{
  "response": "¡Hola! Bienvenido a El Trujillano. ¿Cuál es tu nombre?",
  "sessionId": "abc123",
  "state": "COLLECTING_NAME"
}
```

**Estados del chatbot:**
`GREETING` → `COLLECTING_NAME` → `MENU` → `SELECTING` → `COLLECTING_PHONE` → `COLLECTING_ADDRESS` → `COLLECTING_REFERENCE` → `CONFIRMING_ORDER` → `PAYMENT_INSTRUCTIONS` → `WAITING_PROOF` → `AWAITING_VALIDATION` → `ORDER_ACTIVE` → `SURVEY`

---

### GET /api/chat/status/:sessionId

Devuelve el estado actual del pedido asociado a la sesión.

**Respuesta 200:**
```json
{
  "orderId": 42,
  "status": "EN_COCINA",
  "items": [
    { "product": "Lomo Saltado", "quantity": 2, "price": 28.00 }
  ],
  "total": 61.00
}
```

---

### GET /api/chat/notifications/:orderId

Lista las notificaciones internas asociadas a un pedido.

**Respuesta 200:**
```json
[
  {
    "id": 1,
    "message": "Pago validado. Pedido enviado a cocina.",
    "channel": "chatbot",
    "sent_at": "2025-01-15T14:32:00Z"
  }
]
```

---

## Admin `[rol: ADMIN]`

### GET /api/admin/orders

Lista pedidos, con filtro opcional por estado.

**Query params:**
- `status` (opcional): `PAGO_PENDIENTE`, `PAGO_ENVIADO`, `PAGO_VALIDADO`, `EN_COCINA`, `LISTO_PARA_REPARTO`, `EN_REPARTO`, `ENTREGADO`, `CERRADO`

**Respuesta 200:**
```json
[
  {
    "id": 42,
    "clientName": "Juan Pérez",
    "phone": "987654321",
    "address": "Av. España 1234",
    "reference": "Casa azul",
    "status": "EN_COCINA",
    "total": 61.00,
    "items": [...],
    "createdAt": "2025-01-15T14:00:00Z"
  }
]
```

---

### GET /api/admin/metrics

Métricas del día actual.

**Respuesta 200:**
```json
{
  "totalOrders": 15,
  "completedOrders": 10,
  "pendingPayments": 2,
  "totalRevenue": 915.00,
  "averageRating": 4.7
}
```

---

### GET /api/admin/pending-payments

Lista pedidos con pago enviado pero pendiente de validación.

---

### POST /api/admin/orders/:id/validate-payment

Aprueba o rechaza el comprobante de pago de un pedido.

**Body:**
```json
{
  "approved": true
}
```

**Efecto:** si `approved = true`, el pedido avanza automáticamente a `PAGO_VALIDADO` y `KitchenAgent` lo libera a `EN_COCINA`.

---

### POST /api/admin/orders/:id/assign-driver

Asigna el primer repartidor disponible al pedido.

**Respuesta 200:**
```json
{
  "driverName": "Carlos Ríos",
  "driverPhone": "955123456"
}
```

---

### GET /api/admin/products

Lista todos los productos del menú.

**Respuesta 200:**
```json
[
  {
    "id": 1,
    "name": "Lomo Saltado",
    "category": "Platos de fondo",
    "price": 28.00,
    "is_available": true,
    "image_url": "/uploads/lomo.jpg"
  }
]
```

---

### POST /api/admin/products

Crea un nuevo producto.

**Body (form-data):**
| Campo | Tipo | Requerido |
|-------|------|-----------|
| `name` | string | Sí |
| `category` | string | Sí |
| `price` | number | Sí |
| `is_available` | boolean | No (default: true) |
| `image` | file | No |

---

### PATCH /api/admin/products/:id

Actualiza un producto existente. Mismo body que POST (todos los campos opcionales).

---

### GET /api/admin/drivers

Lista todos los repartidores.

**Respuesta 200:**
```json
[
  {
    "id": 1,
    "name": "Carlos Ríos",
    "phone": "955123456",
    "is_available": true
  }
]
```

---

### POST /api/admin/drivers

Registra un nuevo repartidor.

**Body:**
```json
{
  "name": "Carlos Ríos",
  "phone": "955123456"
}
```

---

### PATCH /api/admin/drivers/:id

Actualiza datos o disponibilidad de un repartidor.

**Body:**
```json
{
  "is_available": false
}
```

---

## Cocina `[rol: ADMIN | COCINA]`

### GET /api/kitchen/orders

Lista pedidos en estado `EN_COCINA` con sus ítems.

**Respuesta 200:**
```json
[
  {
    "id": 42,
    "clientName": "Juan Pérez",
    "status": "EN_COCINA",
    "items": [
      { "product": "Lomo Saltado", "quantity": 2 },
      { "product": "Chicha Morada", "quantity": 1 }
    ],
    "createdAt": "2025-01-15T14:00:00Z"
  }
]
```

---

### POST /api/kitchen/orders/:id/ready

Marca un pedido como listo para reparto. `KitchenAgent` actualiza el estado a `LISTO_PARA_REPARTO` y notifica automáticamente.

**Respuesta 200:**
```json
{
  "success": true,
  "message": "Pedido marcado como listo para reparto."
}
```

---

## Repartidor `[rol: ADMIN | REPARTIDOR]`

### GET /api/driver/active

Devuelve las entregas activas asignadas al repartidor autenticado (estado `EN_REPARTO`).

**Respuesta 200:**
```json
[
  {
    "id": 42,
    "clientName": "Juan Pérez",
    "address": "Av. España 1234",
    "reference": "Casa azul",
    "phone": "987654321"
  }
]
```

---

### GET /api/driver/ready-orders

Lista pedidos en estado `LISTO_PARA_REPARTO` sin repartidor asignado.

---

### POST /api/driver/orders/:id/confirm-delivery

El repartidor confirma que entregó el pedido. `DeliveryAgent` actualiza a `ENTREGADO` → `CERRADO` y crea la encuesta.

**Respuesta 200:**
```json
{
  "success": true,
  "message": "Entrega confirmada. Pedido cerrado."
}
```

---

## Health check

### GET /api/health

```json
{ "status": "ok" }
```

---

## Códigos de error

| Código | Significado |
|--------|-------------|
| 400 | Datos inválidos o estado de pedido incorrecto |
| 401 | Token ausente o expirado |
| 403 | Rol sin permisos para esta acción |
| 404 | Recurso no encontrado |
| 500 | Error interno del servidor |
