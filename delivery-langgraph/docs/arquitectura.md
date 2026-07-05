# Arquitectura del Sistema Multiagente — El Trujillano Delivery

## Diagrama de Arquitectura

```mermaid
graph TB
    subgraph CLIENT["🖥️ Clientes"]
        CB["Chatbot Web\n(Simula WhatsApp)"]
        AP["Panel Admin"]
        KV["Vista Cocina"]
        DV["Vista Repartidor"]
    end

    subgraph BACKEND["⚙️ Backend — Node.js + Express + TypeScript"]
        direction TB
        API["API REST\n/api/*"]

        subgraph ORCHESTRATOR["🧠 OrchestratorAgent"]
            SESSION["Gestión de Sesiones\n(State Machine)"]
        end

        subgraph AGENTS["🤖 Subagentes Especializados"]
            MA["MenuAgent\n📋 Menú y productos"]
            OA["OrderAgent\n🛒 Pedidos y carrito"]
            PA["PricingAgent\n💰 Cálculo de precios"]
            PYA["PaymentAgent\n💳 Pagos y comprobantes"]
            KA["KitchenAgent\n🍳 Gestión cocina"]
            DA["DeliveryAgent\n🛵 Asignación reparto"]
            NA["NotificationAgent\n🔔 Notificaciones"]
            AA["AdminAgent\n🔧 Administración"]
        end

        UPLOAD["Multer\n📸 Subida archivos"]
        AUTH["JWT Auth\n🔒 Middleware"]
    end

    subgraph DB["🗄️ Base de Datos — PostgreSQL"]
        PRISMA["Prisma ORM"]
        T1["users"]
        T2["products"]
        T3["orders"]
        T4["order_items"]
        T5["payments"]
        T6["drivers"]
        T7["notifications"]
        T8["surveys"]
    end

    CB -->|"POST /api/chat\nmultipart/form-data"| API
    AP -->|"GET/POST /api/admin/*\nBearer JWT"| API
    KV -->|"GET/POST /api/kitchen/*\nBearer JWT"| API
    DV -->|"GET/POST /api/driver/*\nBearer JWT"| API

    API --> AUTH
    API --> ORCHESTRATOR
    API --> AA

    SESSION --> MA
    SESSION --> OA
    SESSION --> PA
    SESSION --> PYA
    SESSION --> KA
    SESSION --> DA
    SESSION --> NA

    MA --> PRISMA
    OA --> PRISMA
    PYA --> PRISMA
    KA --> PRISMA
    DA --> PRISMA
    NA --> PRISMA
    AA --> PRISMA

    PRISMA --> T1
    PRISMA --> T2
    PRISMA --> T3
    PRISMA --> T4
    PRISMA --> T5
    PRISMA --> T6
    PRISMA --> T7
    PRISMA --> T8

    UPLOAD -->|"Guarda en /uploads"| PYA

    style ORCHESTRATOR fill:#1e3a5f,stroke:#4a90d9,color:#fff
    style AGENTS fill:#1a3a2a,stroke:#4caf50,color:#fff
    style DB fill:#2a1a3a,stroke:#9c27b0,color:#fff
    style CLIENT fill:#3a2a1a,stroke:#ff9800,color:#fff
    style BACKEND fill:#1a1a2e,stroke:#555,color:#fff
```

## Descripción de Componentes

### OrchestratorAgent (Cerebro del sistema)
- Mantiene el estado de cada conversación en memoria (Map por sessionId)
- Implementa una máquina de estados finita
- Delega cada acción al subagente correspondiente
- **No hace trabajo directo**: coordina y delega

### Estados de la máquina de estados del chat
| Estado | Descripción |
|--------|-------------|
| GREETING | Bienvenida, solicitud de nombre |
| COLLECTING_NAME | Captura del nombre del cliente |
| MENU | Muestra el menú interactivo |
| SELECTING | El cliente selecciona productos |
| COLLECTING_PHONE | Captura teléfono del cliente |
| COLLECTING_ADDRESS | Captura dirección de entrega |
| COLLECTING_REFERENCE | Captura referencia de entrega |
| CONFIRMING_ORDER | Confirmación del pedido |
| PAYMENT_INSTRUCTIONS | Instrucciones de pago Yape/Plin |
| WAITING_PROOF | Esperando comprobante de pago |
| AWAITING_VALIDATION | Pago enviado, esperando admin |
| ORDER_ACTIVE | Pedido en proceso |
| SURVEY | Encuesta de satisfacción |

### Subagentes y sus responsabilidades

| Agente | Responsabilidad principal | Método clave |
|--------|--------------------------|--------------|
| MenuAgent | Catálogo de productos | `getFormattedMenu()`, `findProductByNameOrNumber()` |
| OrderAgent | Carrito y pedidos | `parseAndAddToCart()`, `createOrder()` |
| PricingAgent | Cálculo de precios | `calculateSubtotal()`, `generateSummary()` |
| PaymentAgent | Gestión de pagos | `saveProof()`, `validatePayment()` |
| KitchenAgent | Control de cocina | `receiveOrder()`, `markOrderReady()` |
| DeliveryAgent | Asignación y entrega | `assignDriver()`, `confirmDelivery()` |
| NotificationAgent | Mensajería interna | `saveNotification()`, `notifyStatusChange()` |
| AdminAgent | Panel administrativo | `getMetrics()`, `validatePayment()` |

## Integración con Claude AI

El sistema usa la API de Anthropic en dos puntos del flujo:

### 1. Validación de comprobantes de pago (Claude Vision)
Cuando el cliente sube una imagen del comprobante (Yape / Plin), `PaymentAgent` invoca Claude con visión para extraer y verificar:
- Monto transferido
- Número de destino (938749977 — El Trujillano)
- Método de pago
- Nivel de confianza de la validación

Esto permite al admin aprobar o rechazar con datos pre-analizados, reduciendo el tiempo de validación a menos de 3 minutos.

### 2. Detección de intención en el chatbot
La ruta `/api/chat` puede invocar Claude para interpretar mensajes ambiguos del cliente (producto no reconocido, texto libre fuera de flujo), complementando la lógica de la máquina de estados del `OrchestratorAgent`.

---

## Stack Tecnológico

```
Backend:        Node.js 20 + TypeScript + Express
ORM:            Prisma 5
Base de datos:  PostgreSQL 15
IA:             Anthropic Claude SDK (@anthropic-ai/sdk 0.97)
Auth:           JWT + bcryptjs
Archivos:       Multer (local /uploads)
Frontend:       React 18 + Vite + TailwindCSS
Routing:        React Router DOM v6
HTTP Client:    Axios
```
