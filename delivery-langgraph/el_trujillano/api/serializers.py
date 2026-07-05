"""Serializadores: modelos SQLAlchemy -> JSON con la forma que espera el frontend.

El frontend (heredado del backend Node/Prisma) consume campos en inglés snake_case,
`id` como string e items/driver/payments anidados. Aquí se hace ese mapeo, sin tocar
el grafo ni los nombres internos en español.
"""
from __future__ import annotations

from ..db.models import Driver, Order, OrderItem, Product
from ..estados import PAGO_RECHAZADO, PAGO_VALIDADO

# Mapea el estado del pedido al estado de pago que muestra el panel.
_PAY_STATUS = {
    "PAGO_VALIDADO": "VALIDADO",
    "PAGO_RECHAZADO": "RECHAZADO",
    "PAGO_ENVIADO": "EN_VERIFICACION",
    "PAGO_PENDIENTE": "PENDIENTE",
}


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def item_to_dict(it: OrderItem) -> dict:
    return {
        "id": str(it.id),
        "quantity": it.cantidad,
        "unit_price": it.precio,
        "subtotal": round(it.precio * it.cantidad, 2),
        "product": {"name": it.nombre},
    }


def _payment_from_order(o: Order) -> list[dict]:
    """Sintetiza el arreglo `payments` a partir de los datos de pago del pedido."""
    if not o.payment_proof_url and o.monto_pagado is None:
        return []
    return [
        {
            "id": str(o.id),
            "status": _PAY_STATUS.get(o.estado, "PENDIENTE"),
            "proof_url": o.payment_proof_url,
            "validated_automatically": o.monto_pagado is not None,
            "validation_confidence": None,
            "detected_amount": o.monto_pagado,
            "detected_method": o.metodo_pago,
            "detected_receiver_number": o.numero_destino_pago,
            "rejection_reason": o.rejection_reason,
            "validated_at": _iso(o.updated_at) if o.estado in (PAGO_VALIDADO, PAGO_RECHAZADO) else None,
        }
    ]


def order_to_dict(o: Order, *, with_payments: bool = True) -> dict:
    return {
        "id": str(o.id),
        "customer_name": o.cliente_nombre,
        "customer_phone": o.cliente_telefono,
        "delivery_address": o.direccion,
        "delivery_reference": o.referencia,
        "total": o.total,
        "subtotal": o.total,
        "status": o.estado,
        "payment_proof_url": o.payment_proof_url,
        "created_at": _iso(o.created_at),
        "updated_at": _iso(o.updated_at),
        "items": [item_to_dict(i) for i in o.items],
        "driver": (
            {"id": str(o.driver.id), "name": o.driver.name, "phone": o.driver.phone}
            if o.driver
            else None
        ),
        "payments": _payment_from_order(o) if with_payments else [],
    }


def product_to_dict(p: Product) -> dict:
    return {
        "id": str(p.id),
        "name": p.name,
        "category": p.category,
        "description": p.description,
        "price": p.price,
        "is_available": p.is_available,
    }


def driver_to_dict(d: Driver) -> dict:
    return {
        "id": str(d.id),
        "name": d.name,
        "phone": d.phone,
        "is_available": d.disponible,
    }
