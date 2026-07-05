"""Router de repartidor (roles ADMIN, REPARTIDOR). Determinista."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import joinedload, selectinload

from ... import order_flow
from ...db.database import get_session
from ...db.models import Driver, Order
from ...estados import CERRADO, EN_REPARTO, ENTREGADO, LISTO_PARA_REPARTO
from ..security import require_role
from ..serializers import driver_to_dict, order_to_dict

router = APIRouter(dependencies=[Depends(require_role("ADMIN", "REPARTIDOR"))])

_OPTS = (selectinload(Order.items), joinedload(Order.driver))


@router.get("/active")
def active_deliveries():
    with get_session() as session:
        orders = (
            session.query(Order).options(*_OPTS).filter(Order.estado == EN_REPARTO).all()
        )
        return [order_to_dict(o) for o in orders]


@router.get("/ready-orders")
def ready_orders():
    with get_session() as session:
        orders = (
            session.query(Order).options(*_OPTS).filter(Order.estado == LISTO_PARA_REPARTO).all()
        )
        return [order_to_dict(o) for o in orders]


@router.get("/completed")
def completed():
    with get_session() as session:
        orders = (
            session.query(Order)
            .options(*_OPTS)
            .filter(Order.estado.in_([ENTREGADO, CERRADO]))
            .order_by(Order.updated_at.desc())
            .limit(30)
            .all()
        )
        return [order_to_dict(o) for o in orders]


@router.post("/orders/{order_id}/confirm-delivery")
def confirm_delivery(order_id: int):
    """Repartidor confirma entrega: EN_REPARTO -> ENTREGADO -> CERRADO (crea encuesta)."""
    try:
        order_flow.marcar_entregado(order_id)
        return order_flow.cerrar(order_id)
    except Exception as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/available-drivers")
def available_drivers():
    with get_session() as session:
        drivers = session.query(Driver).filter(Driver.disponible.is_(True)).all()
        return [driver_to_dict(d) for d in drivers]
