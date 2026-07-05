"""Router de autenticación. POST /api/auth/login -> {token, user}."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...db.database import get_session
from ...db.models import User
from ..security import crear_token, verify_password

router = APIRouter()


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(payload: LoginIn):
    if not payload.email or not payload.password:
        raise HTTPException(status_code=400, detail="Email y contraseña requeridos")
    with get_session() as session:
        user = session.query(User).filter(User.email == payload.email).first()
        if not user or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Credenciales inválidas")
        token = crear_token(user.id, user.email, user.role)
        return {
            "token": token,
            "user": {"id": str(user.id), "name": user.name, "email": user.email, "role": user.role},
        }
