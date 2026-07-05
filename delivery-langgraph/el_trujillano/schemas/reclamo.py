"""Salidas estructuradas del Deep Agent de reclamos (planificar y evaluar)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class PlanReclamo(BaseModel):
    """Descomposición del reclamo hecha por el nodo `planificar`."""

    que_paso: str = Field(description="Resumen objetivo de lo que reporta el cliente")
    que_pide: str = Field(description="Qué solución/compensación solicita el cliente")
    politica_candidata: str = Field(
        description="Qué política del restaurante podría aplicar (demoras, devoluciones, pedido errado, reembolso)"
    )
    consulta_inicial: str = Field(
        description="Consulta de búsqueda semántica para recuperar la política aplicable del PDF"
    )


class VeredictoReclamo(BaseModel):
    """Juicio del sub-agente crítico (fase evaluar) sobre la propuesta generada."""

    suficiente: bool = Field(
        description="True si la propuesta se apoya en una política real y resuelve el reclamo"
    )
    razon: str = Field(description="Justificación del veredicto")
    nueva_consulta: str = Field(
        default="",
        description="Si no es suficiente, consulta reformulada para volver a recuperar (si no, cadena vacía)",
    )
