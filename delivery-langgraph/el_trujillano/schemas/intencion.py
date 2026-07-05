"""Salida estructurada del nodo-agente `clasificar_intencion`."""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class TipoIntencion(str, Enum):
    GREETING = "GREETING"
    SHOW_MENU = "SHOW_MENU"
    SHOW_CATEGORY = "SHOW_CATEGORY"
    ADD_PRODUCT = "ADD_PRODUCT"
    REMOVE_PRODUCT = "REMOVE_PRODUCT"
    REMOVE_PRODUCT_BY_NEGATION = "REMOVE_PRODUCT_BY_NEGATION"
    VIEW_CART = "VIEW_CART"
    CONFIRM_ORDER = "CONFIRM_ORDER"
    REJECT_ADDITION = "REJECT_ADDITION"
    SELECT_PAYMENT_YAPE = "SELECT_PAYMENT_YAPE"
    SELECT_PAYMENT_PLIN = "SELECT_PAYMENT_PLIN"
    CHECK_ORDER_STATUS = "CHECK_ORDER_STATUS"
    CANCEL_ORDER = "CANCEL_ORDER"
    OUT_OF_SCOPE = "OUT_OF_SCOPE"


class ProductoMencionado(BaseModel):
    """Producto que el cliente quiere agregar/quitar, según el clasificador."""

    nombre: str = Field(description="Nombre del producto tal como lo dijo el cliente")
    cantidad: int = Field(default=1, ge=1, description="Cantidad solicitada")


class IntencionClasificada(BaseModel):
    """Resultado estructurado de interpretar el mensaje del cliente."""

    intencion: TipoIntencion = Field(description="Intención principal detectada")
    categoria: str | None = Field(
        default=None,
        description="Categoría del menú si la intención es SHOW_CATEGORY (Entradas, Platos principales, Bebidas, Postres)",
    )
    productos: list[ProductoMencionado] = Field(
        default_factory=list,
        description="Productos mencionados para ADD_PRODUCT / REMOVE_PRODUCT",
    )
    mensaje_sugerido: str = Field(
        description="Respuesta natural y breve sugerida para el cliente, en español peruano amable"
    )
