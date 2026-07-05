"""Modelos relacionales (ORM). Datos estructurados, nunca en la base vectorial."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..estados import PAGO_PENDIENTE
from .database import Base


class User(Base):
    """Usuarios del panel (admin / cocina / repartidor). Soporta login con roles."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="CLIENTE", nullable=False)  # ADMIN | COCINA | REPARTIDOR
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[float] = mapped_column(Float, nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Driver(Base):
    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    disponible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)

    cliente_nombre: Mapped[str | None] = mapped_column(String(120))
    cliente_telefono: Mapped[str | None] = mapped_column(String(20))
    direccion: Mapped[str | None] = mapped_column(Text)
    referencia: Mapped[str | None] = mapped_column(Text)

    total: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    estado: Mapped[str] = mapped_column(String(40), default=PAGO_PENDIENTE, nullable=False)

    # Datos del pago extraídos del comprobante
    monto_pagado: Mapped[float | None] = mapped_column(Float)
    metodo_pago: Mapped[str | None] = mapped_column(String(20))
    numero_destino_pago: Mapped[str | None] = mapped_column(String(40))
    nombre_destino_pago: Mapped[str | None] = mapped_column(String(120))
    payment_proof_url: Mapped[str | None] = mapped_column(String(255))  # ruta de la captura subida
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    driver_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id"))
    driver: Mapped[Driver | None] = relationship()

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
    nombre: Mapped[str] = mapped_column(String(120), nullable=False)
    precio: Mapped[float] = mapped_column(Float, nullable=False)
    cantidad: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"))
    canal: Mapped[str] = mapped_column(String(30), nullable=False)  # cliente | cocina | repartidor | admin
    mensaje: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Survey(Base):
    __tablename__ = "surveys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    calificacion: Mapped[int | None] = mapped_column(Integer)
    comentario: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Complaint(Base):
    __tablename__ = "complaints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"))
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    estado: Mapped[str] = mapped_column(String(30), default="ABIERTO", nullable=False)  # ABIERTO | RESUELTO | ESCALADO
    resolucion: Mapped[str | None] = mapped_column(Text)
    escalado: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    iteraciones: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
