# El Trujillano Delivery — Sistema Multiagente

Sistema de delivery automatizado para el restaurante **El Trujillano** (Trujillo, Perú), desarrollado como proyecto académico. Implementa una arquitectura multiagente con **LangGraph + API de Claude** que gestiona el ciclo completo de un pedido: desde el chatbot hasta la entrega, más un **agente de reclamos basado en el patrón Deep Agent**.

## Descripción general

El sistema reemplaza un proceso manual (AS-IS) con un flujo digital automatizado (TO-BE). Un cliente interactúa con un chatbot web que simula WhatsApp; detrás, un **grafo de estados de LangGraph** coordina los nodos para gestionar el menú, carrito, pagos, cocina, reparto y notificaciones.

**Resultado:** validación de pagos de 10-20 min a menos de 3 min, cero errores de cálculo y trazabilidad completa del pedido.

> **Principio de diseño innegociable:** un componente solo es "agente" (usa chat model) si el LLM debe **razonar, clasificar o interpretar lenguaje/imágenes**. SQL, sumas, validaciones con `if` y CRUD son **nodos deterministas o tools**, NO agentes.

---

## Arquitectura general

El sistema es un **monolito modular** desplegado como tres servicios en Render:

```
CLIENTE (Browser)
     │ HTTPS
     ▼
FRONTEND (React + Vite + Tailwind — Static Site)   ── proxy /api ─┐
                                                                   ▼
                                          BACKEND (FastAPI + LangGraph, Python)
                                                                   │ SQLAlchemy + pgvector
                                                                   ▼
                                          BASE DE DATOS (PostgreSQL 16 + pgvector)
```

El orquestador **es el grafo**: no existe ninguna clase `OrchestratorAgent`. La máquina de estados del pedido es un `StateGraph` (`el_trujillano/graphs/ventas_graph.py`) que mantiene el estado, decide transiciones con aristas condicionales y delega en los nodos.

Ver diagrama completo en [`docs/arquitectura.md`](delivery-langgraph/docs/arquitectura.md).

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Lenguaje | Python 3.11 |
| Orquestación | LangGraph (`StateGraph`) |
| Tools / RAG / salida estructurada | LangChain |
| IA | API de Claude (Anthropic) vía `langchain-anthropic` — `claude-haiku-4-5-20251001` con visión nativa |
| Embeddings | Voyage AI (`langchain-voyageai`) o HuggingFace |
| API REST | FastAPI + auth JWT con roles |
| ORM / relacional | SQLAlchemy |
| Vector store | PostgreSQL 16 + pgvector |
| Observabilidad | LangSmith |
| Frontend | React 18 + Vite 5 + TailwindCSS 3 |

> **Un solo backend.** El frontend React consume EXCLUSIVAMENTE la API FastAPI bajo `/api`. La capa `el_trujillano/api/serializers.py` adapta los modelos internos (en español) a la forma que el frontend espera (campos en inglés, `id` como string).

---

## Componentes: qué es agente y qué es determinista (y POR QUÉ)

### Nodos CON chat model (agentes reales)

| Componente | ¿Por qué ES agente? |
|---|---|
| `clasificar_intencion` | El LLM **interpreta lenguaje natural ambiguo** del cliente y lo mapea a una intención. Salida estructurada (`IntencionClasificada`). |
| `validar_comprobante` | Modelo con **visión**: lee la imagen del comprobante Yape/Plin y **extrae** monto, método, número (aunque esté enmascarado `*** *** 977`) y nombre. Salida estructurada (`ComprobanteExtraido`). |
| Deep Agent: `planificar` | **Razona** para descomponer el reclamo (qué pasó / qué pide / qué política aplica). |
| Deep Agent: `generar` | **Redacta** la propuesta de solución apoyada solo en la política recuperada. |
| Deep Agent: `evaluar` | Sub-agente **crítico**: juzga si la propuesta tiene respaldo real. |

### Nodos DETERMINISTAS / tools (sin LLM)

| Componente | ¿Por qué NO es agente? |
|---|---|
| `consultar_menu` | RAG semántico + **SQL** sobre el catálogo. |
| `gestionar_carrito` | Agrega/quita ítems: matching + **aritmética**. |
| `recopilar_datos_cliente` | Máquina de pasos `NAME→PHONE→ADDRESS→REFERENCE→CONFIRMING` con validaciones (`if`, teléfono = 9 dígitos). |
| `crear_pedido` | **CRUD**: persiste el pedido en `PAGO_PENDIENTE`. |
| `comparar_pago` | Compara extraído vs pedido: monto (±S/0.10), número, nombre. **Comparaciones**, no razonamiento. |
| `validar_estado_cocina` | **REGLA CRÍTICA**: un `if` que rechaza todo pedido que no esté en `PAGO_VALIDADO`. |
| `asignar_repartidor` | Primer repartidor disponible en **transacción atómica** (`SELECT ... FOR UPDATE SKIP LOCKED`). |
| `guardar_notificacion` | **CRUD** de notificaciones por canal. |
| `cerrar_pedido` | Cierra el pedido + crea encuesta vacía + libera repartidor. |
| `recuperar` (Deep Agent) | **RAG** sobre el PDF de políticas (pgvector). |

---

## Cómo funciona el sistema — Flujo completo

### FASE 1 — Conversación con el cliente (Chatbot)

Cada mensaje del cliente llega a `POST /api/chat/message`. El nodo `clasificar_intencion` envía a **Claude** el mensaje, el historial (últimos turnos), el catálogo y el estado del carrito, y devuelve la **intención clasificada** (`ADD_PRODUCT`, `CONFIRM_ORDER`, `SELECT_PAYMENT_YAPE`, etc.). El grafo ejecuta la lógica correspondiente.

Esto permite lenguaje natural: el cliente puede decir *"ponme 2 lomos"*, *"ya no quiero el ceviche"* o *"quiero pagar con Yape"* y el sistema lo entiende.

Intenciones reconocidas: `GREETING`, `SHOW_MENU`, `SHOW_CATEGORY`, `ADD_PRODUCT`, `REMOVE_PRODUCT`, `REMOVE_PRODUCT_BY_NEGATION`, `VIEW_CART`, `CONFIRM_ORDER`, `REJECT_ADDITION`, `SELECT_PAYMENT_YAPE`, `SELECT_PAYMENT_PLIN`, `CHECK_ORDER_STATUS`, `CANCEL_ORDER`, `OUT_OF_SCOPE`.

### FASE 2 — Armado del carrito

`gestionar_carrito` encuentra el producto en la BD, actualiza el carrito (persistido en el estado del grafo por `session_id`) y responde con el resumen actualizado.

### FASE 3 — Recopilación de datos del cliente

Al confirmar (`CONFIRM_ORDER`), `recopilar_datos_cliente` entra en un flujo paso a paso:

```
NAME → PHONE → ADDRESS → REFERENCE → CONFIRMING
```

Cada respuesta se valida (ej: teléfono = 9 dígitos). En `CONFIRMING` se muestra el resumen con el total (subtotal + S/ 5.00 de delivery).

### FASE 4 — Creación del pedido en base de datos

Al confirmar explícitamente, `crear_pedido` persiste el pedido en PostgreSQL con estado `PAGO_PENDIENTE` y muestra los datos de pago: **Yape/Plin al 938749977**.

### FASE 5 — Validación del comprobante con IA

El cliente adjunta una imagen. `validar_comprobante` (Claude Vision) la lee:

```
1. Verificar duplicado (¿el mismo archivo ya fue validado?)
2. Extraer con Claude Vision: monto, método (Yape/Plin), número destinatario, nombre
3. comparar_pago valida 3 condiciones:
   a. Monto coincide con el total (tolerancia ±S/ 0.10)
   b. Número de destino corresponde al 938749977
   c. Nombre del destinatario es el titular esperado
4. OK  → PAGO_VALIDADO (transacción atómica)
   Falla → PAGO_RECHAZADO + razón detallada al cliente
```

También admite **revisión manual del administrador (HITL)**, que puede aprobar o rechazar cualquier comprobante desde el panel.

### FASE 6 — Cocina (regla crítica de negocio)

`validar_estado_cocina` **rechaza cualquier pedido que no esté en `PAGO_VALIDADO`**. Si el pago está validado: estado → `EN_COCINA` y se notifica al cliente y a la pantalla de cocina. Cuando el cocinero marca "Listo" → `LISTO_PARA_REPARTO` y se intenta asignar repartidor automáticamente.

### FASE 7 — Reparto

`asignar_repartidor` toma el primer repartidor disponible en una **transacción atómica** (`SELECT ... FOR UPDATE SKIP LOCKED`), lo asigna y marca como no disponible. Estado → `EN_REPARTO`. El frontend hace polling y muestra al cliente el repartidor asignado.

### FASE 8 — Confirmación de entrega y encuesta

El repartidor confirma la entrega → `ENTREGADO`; `cerrar_pedido` libera al repartidor, pasa a `CERRADO` y crea el registro de encuesta. El frontend detecta el cierre y activa la encuesta (1 a 5 + comentario).

---

## Agente de reclamos (Deep Agent)

Un segundo grafo atiende reclamos con el patrón Deep Agent (planificar → recuperar → generar → evaluar):

```
planificar 🤖 → recuperar (RAG pgvector) → generar 🤖 → evaluar 🤖 (crítico)
   ├─ suficiente → responder
   ├─ insuficiente y quedan reintentos → recuperar (itera)
   └─ MAX_ITERACIONES → escalar (HITL, deriva a humano)
```

- **Memoria en el estado:** `historial` (consultas intentadas) e `iteraciones`.
- **Límite operativo:** `MAX_ITERACIONES_RECLAMO = 3`.

---

## Estados del pedido — Máquina de estados

```
PAGO_PENDIENTE
    ├─→ PAGO_ENVIADO        (comprobante subido por el cliente)
    └─→ PAGO_VALIDADO       (validación automática o admin aprueba)
          ↑
PAGO_RECHAZADO              (validación automática o admin rechaza)
    └─→ PAGO_ENVIADO        (cliente reenvía nuevo comprobante)

PAGO_VALIDADO
    └─→ EN_COCINA           ← REGLA CRÍTICA: validar_estado_cocina bloquea todo lo demás

EN_COCINA → LISTO_PARA_REPARTO → EN_REPARTO → ENTREGADO → CERRADO
```

> **Regla crítica de negocio:** ningún pedido puede pasar a cocina sin pago confirmado (`PAGO_VALIDADO`).

Ver flujo completo con diagramas Mermaid en [`docs/flujo-pedido.md`](delivery-langgraph/docs/flujo-pedido.md).

---

## Integraciones con Claude AI

| Punto | Modelo | Para qué |
|-------|--------|----------|
| `clasificar_intencion` | `claude-haiku-4-5-20251001` | Clasifica la intención del mensaje del cliente en lenguaje natural |
| `validar_comprobante` | `claude-haiku-4-5-20251001` | Analiza la imagen del comprobante con Claude Vision y extrae monto, método y número |
| Deep Agent (`planificar`/`generar`/`evaluar`) | `claude-haiku-4-5-20251001` | Razona, redacta y evalúa la resolución de reclamos |

El modelo se configura con la variable `CLAUDE_MODEL`.

---

## Despliegue en Render

El sistema está desplegado en **Render** mediante el blueprint [`render.yaml`](render.yaml), que levanta **tres servicios**:

| # | Servicio | Tipo | Descripción |
|---|----------|------|-------------|
| 1 | `el-trujillano-db` | PostgreSQL 16 gestionada | Base de datos relacional + `pgvector` para el RAG. `DATABASE_URL` se inyecta automáticamente al backend. |
| 2 | `el-trujillano-api` | Web Service Python (FastAPI + uvicorn) | Backend: grafos LangGraph, API REST bajo `/api`, auth JWT. `rootDir: delivery-langgraph`. Health check en `/api/health`. |
| 3 | `el-trujillano-frontend` | Static Site (React + Vite) | Frontend compilado (`npm run build` → `./dist`). Hace *rewrite* de `/api/*` y `/uploads/*` hacia el backend, con fallback SPA a `index.html`. |

**Cómo se despliega (Blueprint):**

1. En Render: **New → Blueprint**, apuntando a este repositorio (usa `render.yaml`).
2. Render crea la base de datos y los dos web services automáticamente.
3. Se completan en el dashboard las variables marcadas `sync: false`: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` y (opcional) `LANGSMITH_API_KEY`. `DATABASE_URL` y `JWT_SECRET` se inyectan/generan solos.
4. El backend arranca con `scripts/start_render.sh`: instala dependencias, habilita `pgvector`, crea tablas, siembra catálogo/usuarios y levanta uvicorn.
5. Se verifica en `GET /api/health`.

> **Notas del plan free (512 Mi):** la ingesta RAG no cabe junto a uvicorn (OOM), por eso `RUN_INGEST_ON_START=false` y la ingesta se corre aparte. `MALLOC_ARENA_MAX=2` reduce el RSS residente. Render entrega `DATABASE_URL` como `postgresql://…` y `config.py` la reescribe a `postgresql+psycopg://…` (psycopg3).

### Acceso al sistema

| Rol | Ruta | Email | Contraseña |
|-----|------|-------|-----------|
| Cliente | `/` | — | — |
| Admin | `/login` | admin@eltrujillano.com | admin123 |
| Cocina | `/login` | cocina@eltrujillano.com | cocina123 |
| Repartidor | `/login` | repartidor@eltrujillano.com | repartidor123 |

---

## API — Resumen de endpoints

Todos bajo `/api`. Ver referencia completa en [`docs/api.md`](delivery-langgraph/docs/api.md).

```
POST  /api/auth/login                          (login JWT → {token, user})

POST  /api/chat/message                        (multipart — turno del chatbot, acepta attachment)
GET   /api/chat/driver-check/{sid}             (polling: detecta asignación de repartidor)
GET   /api/chat/survey-check/{sid}             (polling: detecta pedido entregado → encuesta)

GET/POST/PATCH /api/admin/*                    [ADMIN] pedidos, métricas, pagos, productos, repartidores
POST  /api/admin/orders/{id}/validate-payment  [ADMIN] HITL: aprobar/rechazar pago manualmente

GET/POST  /api/kitchen/*                        [ADMIN/COCINA] pedidos en cocina y marcar listo
GET/POST  /api/driver/*                         [ADMIN/REPARTIDOR] entregas activas/listas/completadas

POST  /api/reclamos                            (Deep Agent de reclamos)
GET   /api/health
```

---

## Persistencia, HITL y observabilidad

- **Checkpointing de LangGraph:** los grafos compilan con el checkpointer que decide `LANGGRAPH_CHECKPOINTER` (`memory` → `MemorySaver`; `postgres` → `PostgresSaver` sobre la misma PostgreSQL en producción). El `thread_id` es el `session_id`, así el carrito y los datos del cliente persisten entre turnos.
- **Human-in-the-loop:** (a) aprobación/rechazo manual del pago desde el panel admin; (b) el Deep Agent escala a humano al superar `MAX_ITERACIONES`.
- **LangSmith:** con `LANGSMITH_TRACING=true` y `LANGSMITH_API_KEY` se traza cada ejecución del grafo y llamada al LLM.
- **Blindaje anti prompt-injection:** lo crítico ya es determinista (precios desde la BD, validación de pago y regla de cocina no confían en el LLM). Además `el_trujillano/prompt_guard.py` delimita el texto del cliente como CONTENIDO NO CONFIABLE. El dinero real siempre pasa por HITL.

---

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [`docs/arquitectura.md`](delivery-langgraph/docs/arquitectura.md) | Diagrama de arquitectura, componentes y stack |
| [`docs/flujo-pedido.md`](delivery-langgraph/docs/flujo-pedido.md) | Diagrama de flujo TO-BE, estados y tiempos |
| [`docs/api.md`](delivery-langgraph/docs/api.md) | Referencia completa de la API REST |
| [`docs/agentes.md`](delivery-langgraph/docs/agentes.md) | Descripción de agentes y nodos |
| [`docs/evidencias.md`](delivery-langgraph/docs/evidencias.md) | Evidencia académica, reglas de negocio y criterios de éxito |

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

Proyecto desarrollado para evidenciar el diseño e implementación de una arquitectura multiagente aplicada a un caso real. El restaurante **El Trujillano**, ubicado en Trujillo, Perú, operaba con procesos manuales en WhatsApp. Este sistema automatiza el flujo completo con LangGraph y la API de Claude, distinguiendo con rigor los componentes que razonan con un LLM de los nodos deterministas, y manteniendo una máquina de estados robusta.
