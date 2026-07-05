"""Salida estructurada del nodo-agente con visión `validar_comprobante`."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ComprobanteExtraido(BaseModel):
    """Datos leídos de la captura del comprobante Yape/Plin por el modelo de visión."""

    monto: float | None = Field(
        default=None, description="Monto pagado en soles (ej. 55.00)"
    )
    metodo: str | None = Field(
        default=None, description="Método de pago detectado: 'Yape' o 'Plin'"
    )
    numero_destinatario: str | None = Field(
        default=None,
        description=(
            "Número del destinatario del pago. Conserva el formato visible aunque esté "
            "enmascarado, por ejemplo '*** *** 977'."
        ),
    )
    nombre_destinatario: str | None = Field(
        default=None, description="Nombre del destinatario del pago tal como aparece"
    )
    es_comprobante_valido: bool = Field(
        default=False,
        description="True si la imagen realmente parece un comprobante de Yape/Plin",
    )
