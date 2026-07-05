"""Router del panel admin (rol ADMIN). Replica el contrato del backend Node.

Endpoints: orders, metrics, validate-payment, assign-driver, products (CRUD),
drivers (CRUD), pending-payments. Toda la lógica es DETERMINISTA.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import joinedload, selectinload

from ... import order_flow
from ...db.database import get_session
from ...db.models import Driver, Order, Product
from ...estados import (
    ENTREGADO,
    CERRADO,
    PAGO_PENDIENTE,
    PAGO_RECHAZADO,
    PAGO_VALIDADO,
)
from ..security import require_role
from ..serializers import driver_to_dict, order_to_dict, product_to_dict

router = APIRouter(dependencies=[Depends(require_role("ADMIN"))])

_ORDER_OPTS = (selectinload(Order.items), joinedload(Order.driver))


@router.get("/orders")
def get_orders(status: str | None = None):
    with get_session() as session:
        q = session.query(Order).options(*_ORDER_OPTS)
        if status:
            q = q.filter(Order.estado == status)
        orders = q.order_by(Order.created_at.desc()).all()
        return [order_to_dict(o) for o in orders]


@router.get("/metrics")
def get_metrics():
    hoy = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    with get_session() as session:
        total = session.query(Order).count()
        pendientes = session.query(Order).filter(Order.estado.in_(["PAGO_ENVIADO", PAGO_PENDIENTE])).count()
        entregados = session.query(Order).filter(Order.estado.in_([ENTREGADO, CERRADO])).count()
        hoy_orders = session.query(Order).filter(Order.created_at >= hoy).all()
        ingresos = sum(
            o.total
            for o in hoy_orders
            if o.estado in (ENTREGADO, CERRADO, "EN_REPARTO", "EN_COCINA", "LISTO_PARA_REPARTO", PAGO_VALIDADO)
        )
        return {
            "totalOrders": total,
            "pendingOrders": pendientes,
            "deliveredOrders": entregados,
            "estimatedRevenue": round(ingresos, 2),
            "ordersToday": len(hoy_orders),
        }


class ValidatePaymentIn(BaseModel):
    approve: bool
    adminNotes: str | None = None


@router.post("/orders/{order_id}/validate-payment")
def validate_payment(order_id: int, payload: ValidatePaymentIn):
    """HITL: el admin aprueba/rechaza manualmente el pago."""
    with get_session() as session:
        order = session.get(Order, order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Pedido no encontrado")
        order.estado = PAGO_VALIDADO if payload.approve else PAGO_RECHAZADO
        if not payload.approve and payload.adminNotes:
            order.rejection_reason = payload.adminNotes
    # Si se aprueba, aplica la REGLA CRÍTICA y envía a cocina.
    if payload.approve:
        order_flow.enviar_a_cocina(order_id)
    return {"success": True, "approved": payload.approve}


@router.post("/orders/{order_id}/assign-driver")
def assign_driver(order_id: int):
    try:
        return order_flow.despachar(order_id)
    except Exception as e:
        raise HTTPException(status_code=409, detail=str(e))


# ------------------------------- Productos -------------------------------
@router.get("/products")
def get_products():
    with get_session() as session:
        productos = session.query(Product).order_by(Product.category, Product.name).all()
        return [product_to_dict(p) for p in productos]


class ProductIn(BaseModel):
    name: str
    category: str
    price: float
    description: str | None = ""


@router.post("/products", status_code=201)
def create_product(payload: ProductIn):
    with get_session() as session:
        p = Product(
            name=payload.name,
            category=payload.category,
            price=payload.price,
            description=payload.description or "",
        )
        session.add(p)
        session.flush()
        return product_to_dict(p)


class ProductUpdate(BaseModel):
    name: str | None = None
    price: float | None = None
    is_available: bool | None = None
    description: str | None = None


@router.patch("/products/{product_id}")
def update_product(product_id: int, payload: ProductUpdate):
    with get_session() as session:
        p = session.get(Product, product_id)
        if not p:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        if payload.name is not None:
            p.name = payload.name
        if payload.price is not None:
            p.price = payload.price
        if payload.is_available is not None:
            p.is_available = payload.is_available
        if payload.description is not None:
            p.description = payload.description
        return product_to_dict(p)


# ------------------------------- Repartidores -------------------------------
@router.get("/drivers")
def get_drivers():
    with get_session() as session:
        drivers = session.query(Driver).order_by(Driver.name).all()
        return [driver_to_dict(d) for d in drivers]


class DriverIn(BaseModel):
    name: str
    phone: str


@router.post("/drivers", status_code=201)
def create_driver(payload: DriverIn):
    with get_session() as session:
        d = Driver(name=payload.name, phone=payload.phone)
        session.add(d)
        session.flush()
        return driver_to_dict(d)


class DriverUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    is_available: bool | None = None


@router.patch("/drivers/{driver_id}")
def update_driver(driver_id: int, payload: DriverUpdate):
    with get_session() as session:
        d = session.get(Driver, driver_id)
        if not d:
            raise HTTPException(status_code=404, detail="Repartidor no encontrado")
        if payload.name is not None:
            d.name = payload.name
        if payload.phone is not None:
            d.phone = payload.phone
        if payload.is_available is not None:
            d.disponible = payload.is_available
        return driver_to_dict(d)


@router.get("/pending-payments")
def pending_payments():
    estados = ["PAGO_ENVIADO", PAGO_PENDIENTE, PAGO_VALIDADO, PAGO_RECHAZADO]
    with get_session() as session:
        orders = (
            session.query(Order)
            .options(*_ORDER_OPTS)
            .filter(Order.estado.in_(estados), Order.payment_proof_url.isnot(None))
            .order_by(Order.updated_at.desc())
            .all()
        )
        return [order_to_dict(o) for o in orders]
