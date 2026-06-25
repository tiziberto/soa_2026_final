import asyncio
import json
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.config import DEFAULT_FACE_THRESHOLD
from app.services import face_service
from app.utils import decode_base64_image

router = APIRouter(tags=["face"])


class EmbeddingsBase64Request(BaseModel):
    image: str = Field(..., description="Imagen en base64 (con o sin prefijo data:image/...;base64,)")


class KnownEmbedding(BaseModel):
    personId: str
    vector: List[float]


class RecognizeBase64Request(BaseModel):
    image: str = Field(..., description="Imagen en base64")
    known: List[KnownEmbedding] = Field(..., description="Embeddings ya registrados")
    threshold: float = Field(default=DEFAULT_FACE_THRESHOLD, ge=0.0, le=1.0)


@router.post("/embeddings")
async def embeddings(image: UploadFile = File(...)):
    """Genera embedding(s) facial(es) recibiendo la imagen como archivo multipart."""
    content = await image.read()
    try:
        return await asyncio.to_thread(face_service.generate_embeddings, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/embeddings/base64")
async def embeddings_base64(payload: EmbeddingsBase64Request):
    """Genera embedding(s) facial(es) recibiendo la imagen como string base64 dentro de un JSON."""
    try:
        image_bytes = decode_base64_image(payload.image)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        return await asyncio.to_thread(face_service.generate_embeddings, image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/recognize")
async def recognize(
    image: UploadFile = File(...),
    known: str = Form(..., description="JSON array: [{personId, vector:[...]}, ...]"),
    threshold: float = Form(DEFAULT_FACE_THRESHOLD),
):
    """Reconocimiento facial recibiendo la imagen como archivo multipart."""
    try:
        known_list = json.loads(known)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in 'known' field")

    if not isinstance(known_list, list):
        raise HTTPException(status_code=400, detail="'known' must be a JSON array")

    content = await image.read()
    try:
        return await asyncio.to_thread(face_service.recognize, content, known_list, threshold)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/recognize/base64")
async def recognize_base64(payload: RecognizeBase64Request):
    """Reconocimiento facial recibiendo todo en JSON (imagen base64 + known + threshold)."""
    try:
        image_bytes = decode_base64_image(payload.image)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    known_list = [k.model_dump() for k in payload.known]

    try:
        return await asyncio.to_thread(
            face_service.recognize, image_bytes, known_list, payload.threshold
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
