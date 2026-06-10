# El Trujillano Delivery — Sistema Multiagente

Sistema de delivery automatizado para restaurante, desarrollado como proyecto académico. Implementa una arquitectura multiagente con 10 agentes especializados que gestionan el ciclo completo de un pedido: desde el chatbot hasta la entrega y encuesta de satisfacción.

## Descripción general

El sistema reemplaza un proceso manual (AS-IS) con un flujo digital automatizado (TO-BE). Un cliente interactúa con un chatbot web que simula WhatsApp; detrás, el `OrchestratorAgent` coordina los demás agentes para gestionar el menú, carrito, pagos, cocina, reparto y notificaciones.

**Resultado:** validación de pagos de 10-20 min a menos de 3 min, cero errores de cálculo y trazabilidad completa del pedido.

---

## Arquitectura general

El sistema está construido sobre tres capas:

```
CLIENTE (Browser)
     │ HTTP REST
     ▼
BACKEND (Node.js + Express + TypeScript)
     │ Prisma ORM
     ▼
BASE DE DATOS (PostgreSQL)
```

```
Cliente (Chatbot Web / Panel Admin / Cocina / Repartidor)
        │
        ▼
   API REST (Express)
        │
        ▼
 OrchestratorAgent  ──► ChatbotAgent    (Claude AI — clasificación de intención)
  (Máquina de       ──► MenuAgent
   13 estados)      ──► OrderAgent
                    ──► PaymentAgent    ──► PaymentValidationAgent (Claude Vision)
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

## Los 10 Agentes y sus Roles

| Agente | Archivo | Responsabilidad |
|--------|---------|-----------------|
| `OrchestratorAgent` | `OrchestratorAgent.ts` | Director de orquesta. Mantiene el estado de cada sesión y delega a los demás. |
| `ChatbotAgent` | `ChatbotAgent.ts` | Clasificador de intenciones usando Claude AI. |
| `MenuAgent` | `MenuAgent.ts` | Consulta y formatea el menú desde la BD. |
| `OrderAgent` | `OrderAgent.ts` | Gestiona el carrito y crea pedidos en BD. |
| `PricingAgent` | _(dentro de OrderAgent)_ | Calcula subtotales, delivery (S/ 5.00 fijo) y totales. |
| `PaymentAgent` | `PaymentAgent.ts` | Instrucciones de pago y gestión de estados de comprobante. |
| `PaymentValidationAgent` | `PaymentValidationAgent.ts` | Valida comprobantes con Claude Vision (IA). |
| `KitchenAgent` | `KitchenAgent.ts` | Recibe pedidos validados y los pasa a cocina. |
| `DeliveryAgent` | `DeliveryAgent.ts` | Asigna repartidores y confirma entregas. |
| `NotificationAgent` | `NotificationAgent.ts` | Persiste notificaciones en BD para cada canal. |
| `AdminAgent` | `AdminAgent.ts` | Panel de control del administrador. |

---

## Cómo funciona el sistema — Flujo completo detallado

### FASE 1 — Conversación con el Cliente (Chatbot)

El cliente abre el frontend React y escribe. Cada mensaje llega a `POST /api/chat/message`.

El sistema utiliza **dos modos de chatbot en paralelo**:

**Modo A — `OrchestratorAgent` (máquina de estados pura):**
Funciona con `POST /api/chat`. Maneja estados fijos secuenciales:

```
GREETING → COLLECTING_NAME → MENU → SELECTING →
COLLECTING_PHONE → COLLECTING_ADDRESS → COLLECTING_REFERENCE →
CONFIRMING_ORDER → PAYMENT_INSTRUCTIONS → WAITING_PROOF →
AWAITING_VALIDATION → ORDER_ACTIVE → SURVEY
```

Cada mensaje del cliente avanza o mantiene el estado actual.

**Modo B — `ChatbotAgent` con Claude AI (clasificador inteligente):**
Funciona con `POST /api/chat/message`. Aquí ocurre lo siguiente:

1. Se envía a **Claude Haiku** el mensaje del cliente, el historial de conversación (últimos 6 turnos), el catálogo de productos y el estado actual del carrito.
2. Claude devuelve un JSON con la **intención clasificada** (ej: `ADD_PRODUCT`, `CONFIRM_ORDER`, `SELECT_PAYMENT_YAPE`, etc.) y un `user_message` sugerido.
3. El servidor en `chatbot.ts` lee esa intención y ejecuta la lógica correspondiente.

Esto permite lenguaje natural: el cliente puede decir *"ponme 2 lomos"*, *"ya no quiero el ceviche"* o *"quiero pagar con Yape"* y el sistema lo entiende correctamente.

Intenciones que reconoce Claude:

| Intent | Descripción |
|--------|-------------|
| `GREETING` | Saludo o inicio de conversación |
| `SHOW_MENU` | Pide ver el menú completo |
| `SHOW_CATEGORY` | Pide una categoría específica |
| `ADD_PRODUCT` | Quiere agregar un producto al carrito |
| `REMOVE_PRODUCT` | Quiere quitar todas las unidades de un producto |
| `REMOVE_PRODUCT_BY_NEGATION` | Rechaza un producto con negación |
| `VIEW_CART` | Quiere ver su carrito actual |
| `CONFIRM_ORDER` | Confirma el pedido explícitamente |
| `REJECT_ADDITION` | Dice "no" cuando se le pregunta si desea agregar algo más |
| `SELECT_PAYMENT_YAPE` | Elige pagar por Yape |
| `SELECT_PAYMENT_PLIN` | Elige pagar por Plin |
| `CHECK_ORDER_STATUS` | Pregunta por el estado de su pedido |
| `CANCEL_ORDER` | Quiere cancelar el pedido |
| `OUT_OF_SCOPE` | Pregunta no relacionada con el restaurante |

---

### FASE 2 — Armado del Carrito

Cuando Claude clasifica `ADD_PRODUCT`, el route handler:

1. Llama a `productService.findByName()` para encontrar el producto en BD.
2. Llama a `cartService.addItem()` que guarda el carrito **en memoria** (por sessionId).
3. Responde al cliente con el resumen actualizado del carrito.

El carrito vive en RAM, no en BD, hasta que el cliente confirma el pedido.

---

### FASE 3 — Recopilación de Datos del Cliente

Cuando el cliente confirma (`CONFIRM_ORDER`), el sistema entra en un flujo estructurado paso a paso vía `pendingDataStep`:

```
NAME → PHONE → ADDRESS → REFERENCE → CONFIRMING
```

Cada respuesta del cliente se valida (ej: teléfono debe tener 9 dígitos) y se almacena en la sesión. Al llegar a `CONFIRMING`, se muestra el resumen completo con el total (subtotal + S/ 5.00 de delivery).

---

### FASE 4 — Creación del Pedido en Base de Datos

Cuando el cliente confirma explícitamente (`"sí confirmo"`, `"confirmo"`, `"procede"`):

1. `orderService.createOrder()` persiste el pedido en PostgreSQL con estado `PAGO_PENDIENTE`.
2. Se limpia el carrito en memoria.
3. Se muestra al cliente los datos de pago: **Yape/Plin al 938749977**.

---

### FASE 5 — Validación del Comprobante con IA

El cliente adjunta una imagen (foto o captura de pantalla). El route handler la recibe vía `multer` y la guarda en `/uploads/`.

Luego llama a `paymentAgent.processProof()`, que invoca al `PaymentValidationAgent`:

```
1. Verificar duplicado
   ¿El mismo archivo ya fue validado en otro pedido?
   ↓
2. extractWithClaude() — Lee la imagen con Claude Haiku Vision:
   - Detecta monto pagado
   - Detecta método (Yape/Plin)
   - Detecta número de destinatario (aunque esté enmascarado como "*** *** 977")
   - Detecta nombre del destinatario
   ↓
3. compare() — Valida las 3 condiciones:
   a. Monto coincide con el total del pedido (tolerancia ±S/ 0.10)
   b. Número de destino corresponde al 938749977
   c. Nombre del destinatario es "El Trujillano" o "Diego Jar*"
   ↓
4. Si todo OK  → estado PAGO_VALIDADO (en transacción atómica en BD)
   Si falla    → estado PAGO_RECHAZADO + razón detallada al cliente
```

Si Claude Vision no está disponible (sin API key, imagen no accesible), hay un **fallback por nombre de archivo** para demos académicas: si el archivo se llama `monto_menor_xxx.jpg`, simula monto incorrecto; si no contiene palabras clave de rechazo, se aprueba automáticamente.

La validación también admite **revisión manual del administrador**, quien puede aprobar o rechazar cualquier comprobante desde el panel de administración, con notas opcionales.

---

### FASE 6 — Cocina (Regla Crítica de Negocio)

Cuando el pago es validado (automático o por admin), `kitchenAgent.receiveOrder()` es llamado:

```typescript
// REGLA CRÍTICA: Solo acepta pedidos con PAGO_VALIDADO
if (order.status !== 'PAGO_VALIDADO') {
  return { success: false, message: '...' };
}
```

Si la condición se cumple:

1. Estado del pedido → `EN_COCINA`
2. Se guarda una notificación para el chatbot (cliente): *"Tu pedido está siendo preparado"*
3. Se guarda una notificación para la pantalla de cocina con la lista completa de productos

El **frontend de cocina** (`KitchenPage.tsx`) muestra todos los pedidos en `EN_COCINA`. Cuando el cocinero hace clic en "Listo":

- `kitchenAgent.markOrderReady()` cambia estado a `LISTO_PARA_REPARTO`
- Inmediatamente llama a `deliveryAgent.assignDriver()` de forma automática

---

### FASE 7 — Reparto

`DeliveryAgent.assignDriver()` ejecuta los siguientes pasos:

1. Busca el primer repartidor con `is_available: true` en BD.
2. En una **transacción atómica**: asigna el repartidor al pedido + marca repartidor como no disponible.
3. Estado → `EN_REPARTO`
4. Envía un **mensaje WhatsApp** al repartidor con dirección, lista de productos y datos del cliente vía `whatsappService`.
5. El frontend hace polling a `GET /api/chat/driver-check/:sessionId` y cuando detecta la asignación, muestra al cliente el nombre y teléfono del repartidor.

---

### FASE 8 — Confirmación de Entrega y Encuesta

El repartidor confirma la entrega desde `POST /api/driver/orders/:id/confirm-delivery`:

1. `deliveryAgent.confirmDelivery()` cambia estado a `ENTREGADO`
2. Libera al repartidor (`is_available: true` de vuelta) en la misma transacción
3. Llama a `closeOrder()` internamente → estado `CERRADO` + crea registro de encuesta vacía en BD

El frontend hace polling a `GET /api/chat/survey-check/:sessionId`. Cuando detecta `CERRADO`, activa el flujo de encuesta donde el cliente califica del 1 al 5 y puede dejar un comentario, guardados en la tabla `Survey` de PostgreSQL.

---

## Panel de Administración

El `AdminAgent` requiere autenticación JWT con rol `ADMIN` (middleware aplicado a todas las rutas `/api/admin/*`). Permite:

- Ver todos los pedidos filtrados por estado
- Ver métricas del día (total pedidos, pendientes, ingresos estimados)
- **Validar comprobantes manualmente** (override a la validación automática): si aprueba, internamente llama a `kitchenAgent.receiveOrder()`
- Gestionar productos (crear, editar precio, activar/desactivar)
- Gestionar repartidores (crear, editar, cambiar disponibilidad)

---

## Estados del Pedido — Máquina de Estados

```
PAGO_PENDIENTE
    ├─→ PAGO_ENVIADO        (comprobante subido por el cliente)
    └─→ PAGO_VALIDADO       (validación automática o admin aprueba)
          ↑
PAGO_RECHAZADO              (validación automática o admin rechaza)
    └─→ PAGO_ENVIADO        (cliente reenvía nuevo comprobante)

PAGO_VALIDADO
    └─→ EN_COCINA           ← REGLA CRÍTICA: KitchenAgent bloquea todo lo demás

EN_COCINA
    └─→ LISTO_PARA_REPARTO  (cocina marca el pedido como listo)

LISTO_PARA_REPARTO
    └─→ EN_REPARTO          (DeliveryAgent asigna repartidor automáticamente)

EN_REPARTO
    └─→ ENTREGADO           (repartidor confirma la entrega)

ENTREGADO
    └─→ CERRADO             (cierre automático + encuesta de satisfacción)
```

> **Regla crítica de negocio:** `KitchenAgent` rechaza cualquier pedido que no esté en estado `PAGO_VALIDADO`. Ningún pedido puede pasar a cocina sin pago confirmado.

Ver flujo completo con diagramas Mermaid en [`docs/flujo-pedido.md`](docs/flujo-pedido.md).

---

## Integraciones con Claude AI

El sistema usa Claude en dos puntos específicos:

| Punto | Modelo | Para qué |
|-------|--------|----------|
| `ChatbotAgent` | `claude-haiku-4-5-20251001` | Clasifica la intención del mensaje del cliente en lenguaje natural y genera una respuesta sugerida |
| `PaymentValidationAgent` | `claude-haiku-4-5-20251001` | Analiza la imagen del comprobante con Claude Vision y extrae monto, método y número destinatario |

El modelo se configura en `.env` con la variable `CLAUDE_MODEL`. Si no se define, usa `claude-haiku-4-5-20251001` por defecto (más rápido y económico).

---

## Requisitos previos

- Node.js 20+
- PostgreSQL 15 (corriendo en localhost:5432)
- npm 9+
- Clave API de Anthropic (para Claude Vision y clasificación de intenciones)

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
CLAUDE_MODEL="claude-haiku-4-5-20251001"
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

1. **Chatbot** → escribir cualquier mensaje → ingresar nombre → seleccionar productos del menú → confirmar pedido → subir comprobante de pago
2. **Admin** (`/admin`) → pestaña Pagos → Aprobar comprobante (o el sistema lo valida automáticamente con Claude)
3. **Cocina** (`/kitchen`) → ver pedido en cola → Marcar como Listo
4. El sistema asigna repartidor automáticamente al marcar como listo
5. **Repartidor** (`/driver`) → ver pedido asignado → Confirmar Entrega
6. **Chatbot** → el sistema activa automáticamente la encuesta de satisfacción

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

POST  /api/chat                               (multipart/form-data — OrchestratorAgent)
GET   /api/chat/status/:sessionId
POST  /api/chat/message                       (multipart/form-data — ChatbotAgent con Claude)
GET   /api/chat/driver-check/:sessionId       (polling: detecta asignación de repartidor)
GET   /api/chat/survey-check/:sessionId       (polling: detecta pedido entregado → encuesta)
GET   /api/chat/notifications/:orderId

GET   /api/admin/orders?status=...            [ADMIN]
POST  /api/admin/orders/:id/validate-payment  [ADMIN]
POST  /api/admin/orders/:id/assign-driver     [ADMIN]
GET   /api/admin/metrics                      [ADMIN]
GET   /api/admin/pending-payments             [ADMIN]
GET/POST/PATCH /api/admin/products            [ADMIN]
GET/POST/PATCH /api/admin/drivers             [ADMIN]

GET   /api/kitchen/orders                     [COCINA]
POST  /api/kitchen/orders/:id/ready           [COCINA]

GET   /api/driver/active                      [REPARTIDOR]
POST  /api/driver/orders/:id/confirm-delivery [REPARTIDOR]

GET   /api/health
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

## Comparativa AS-IS vs TO-BE

| Métrica | AS-IS (manual) | TO-BE (automatizado) |
|---------|---------------|----------------------|
| Tiempo de validación de pago | 10-20 min | 1-3 min (-85%) |
| Errores de cálculo | Frecuentes (manual) | 0 (automatizado) |
| Pérdida de pedidos | Frecuente | 0 (registro automático) |
| Dependencia del encargado | Alta | Mínima |
| Tiempo total estimado | 60-90 min | 35-65 min |

---

## Contexto académico

Proyecto desarrollado para evidenciar el diseño e implementación de una arquitectura multiagente aplicada a un caso real. El restaurante **El Trujillano**, ubicado en Trujillo, Perú, operaba con procesos manuales en WhatsApp. Este sistema automatiza el flujo completo con agentes especializados, manteniendo la separación de responsabilidades y una máquina de estados robusta.
