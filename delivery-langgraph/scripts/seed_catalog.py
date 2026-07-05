"""Carga el catálogo de productos y los repartidores en PostgreSQL. Determinista.

Uso:  python -m scripts.seed_catalog
"""
from __future__ import annotations

import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from el_trujillano.api.security import hash_password
from el_trujillano.db.database import get_session
from el_trujillano.db.init_db import init_db
from el_trujillano.db.models import Driver, Product, User

# Usuarios del panel (mismas credenciales demo que el frontend muestra).
USUARIOS = [
    ("Administrador", "admin@eltrujillano.com", "admin123", "ADMIN"),
    ("Cocina Principal", "cocina@eltrujillano.com", "cocina123", "COCINA"),
    ("Repartidor App", "repartidor@eltrujillano.com", "repartidor123", "REPARTIDOR"),
]

PRODUCTOS = [
    # Entradas
    ("Ceviche de pescado", "Entradas", "Ceviche fresco con leche de tigre, ají limo y cancha serrana", 25.00),
    ("Causa limeña", "Entradas", "Causa rellena de atún o pollo con mayo y palta", 15.00),
    ("Tequeños de queso", "Entradas", "6 unidades de tequeños crocantes rellenos de queso", 12.00),
    ("Anticuchos de corazón", "Entradas", "3 palitos de anticuchos con papa y choclo", 18.00),
    # Platos principales
    ("Lomo saltado", "Platos principales", "Tiras de lomo con papas fritas, tomate y cebolla en salsa de soya", 30.00),
    ("Arroz con leche de tigre", "Platos principales", "Arroz con mariscos bañado en leche de tigre", 28.00),
    ("Pollo a la brasa 1/4", "Platos principales", "1/4 de pollo a la brasa con papas fritas y ensalada", 22.00),
    ("Pollo a la brasa 1/2", "Platos principales", "1/2 pollo a la brasa con papas fritas y ensalada", 38.00),
    ("Trucha frita", "Platos principales", "Trucha frita entera con arroz, papas y ensalada", 32.00),
    ("Ají de gallina", "Platos principales", "Ají de gallina clásico con arroz, papa y huevo", 22.00),
    # Bebidas
    ("Chicha morada", "Bebidas", "Vaso de chicha morada artesanal", 5.00),
    ("Inca Kola", "Bebidas", "Botella 500ml", 5.00),
    ("Agua mineral", "Bebidas", "Botella 625ml", 3.00),
    ("Maracuyá fresco", "Bebidas", "Vaso de jugo de maracuyá natural", 6.00),
    ("Cerveza Pilsen", "Bebidas", "Lata 355ml", 7.00),
    # Postres
    ("Arroz con leche", "Postres", "Porción de arroz con leche con canela", 8.00),
    ("Tres leches", "Postres", "Porción de torta tres leches", 10.00),
    ("Mazamorra morada", "Postres", "Porción de mazamorra morada con arroz con leche", 9.00),
]

REPARTIDORES = [
    ("Carlos Moya", "987001001"),
    ("Ana Torres", "987001002"),
    ("Juan Ríos", "987001003"),
    ("Repartidor 4", "938749977"),
]


def seed() -> None:
    init_db()
    with get_session() as session:
        for nombre, email, password, role in USUARIOS:
            if not session.query(User).filter(User.email == email).first():
                session.add(User(name=nombre, email=email, password_hash=hash_password(password), role=role))
        for nombre, telefono in REPARTIDORES:
            if not session.query(Driver).filter(Driver.phone == telefono).first():
                session.add(Driver(name=nombre, phone=telefono))
        for name, category, description, price in PRODUCTOS:
            if not session.query(Product).filter(Product.name == name).first():
                session.add(Product(name=name, category=category, description=description, price=price))
    print(f"✅ Seed completado: {len(USUARIOS)} usuarios, {len(PRODUCTOS)} productos y {len(REPARTIDORES)} repartidores.")
    print("   Credenciales: admin@eltrujillano.com/admin123 · cocina@.../cocina123 · repartidor@.../repartidor123")


if __name__ == "__main__":
    seed()
