"""Capa REST (FastAPI): único backend del sistema.

Sirve al frontend React (panel admin/cocina/repartidor + chatbot) y expone el Deep
Agent de reclamos. Toda ruta del frontend vive bajo /api (el frontend usa baseURL /api).
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import config
from ..graphs.reclamos_graph import grafo_reclamos
from .routers import admin, auth, chat, driver, kitchen

app = FastAPI(title="El Trujillano Delivery", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Servir las capturas de comprobantes subidas (el frontend las muestra en el panel de pagos).
os.makedirs(config.UPLOADS_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=config.UPLOADS_DIR), name="uploads")

# Routers que consume el frontend (todos bajo /api).
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(kitchen.router, prefix="/api/kitchen", tags=["kitchen"])
app.include_router(driver.router, prefix="/api/driver", tags=["driver"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])


# ------------------------------- Deep Agent de reclamos -------------------------------
class ReclamoIn(BaseModel):
    session_id: str
    reclamo: str
    order_id: Optional[int] = None


class ReclamoOut(BaseModel):
    resolucion: str
    escalado: bool
    iteraciones: int


@app.post("/api/reclamos", response_model=ReclamoOut)
def reclamos(payload: ReclamoIn):
    cfg = {"configurable": {"thread_id": f"reclamo-{payload.session_id}"}}
    estado = grafo_reclamos.invoke(
        {"session_id": payload.session_id, "reclamo": payload.reclamo, "order_id": payload.order_id},
        config=cfg,
    )
    return ReclamoOut(
        resolucion=estado.get("resolucion", ""),
        escalado=estado.get("escalado", False),
        iteraciones=estado.get("iteraciones", 0),
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "modelo": config.CLAUDE_MODEL, "embeddings": config.EMBEDDINGS_PROVIDER}
