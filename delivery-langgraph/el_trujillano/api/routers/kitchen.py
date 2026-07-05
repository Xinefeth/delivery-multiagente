"""Router de cocina (roles ADMIN, COCINA). Determinista."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import joinedload, selectinload

from ... import order_flow
from ...db.database import get_session
from ...db.models import Order
from ...estados import EN_COCINA
from ..security import require_role
from ..serializers import order_to_dict

router = APIRouter(dependencies=[Depends(require_role("ADMIN", "COCINA"))])


@router.get("/orders")
def kitchen_orders():
    with get_session() as session:
        orders = (
            session.query(Order)
            .options(selectinload(Order.items), joinedload(Order.driver))
            .filter(Order.estado == EN_COCINA)
            .order_by(Order.created_at.asc())
            .all()
        )
        return [order_to_dict(o) for o in orders]


@router.post("/orders/{order_id}/ready")
def mark_ready(order_id: int):
    """Cocina marca listo. Intenta asignar repartidor automáticamente (EN_REPARTO)."""
    try:
        order_flow.marcar_listo(order_id)
    except Exception as e:
        raise HTTPException(status_code=409, detail=str(e))
    # Asignación automática si hay repartidor disponible (si no, queda LISTO_PARA_REPARTO).
    try:
        return order_flow.despachar(order_id)
    except Exception:
        return {"pedido_id": order_id, "estado": "LISTO_PARA_REPARTO"}
