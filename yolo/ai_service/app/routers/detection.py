import asyncio

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from app.config import DEFAULT_CONFIDENCE
from app.services.yolo_service import YoloService
from app.utils import decode_base64_image

router = APIRouter(tags=["detection"])


def get_yolo(request: Request) -> YoloService:
    return request.app.state.yolo


class DetectBase64Request(BaseModel):
    image: str = Field(..., description="Imagen en base64 (con o sin prefijo data:image/...;base64,)")
    model_id: str = Field(..., description="Nombre del modelo (ver GET /models)")
    min_confidence: float = Field(default=DEFAULT_CONFIDENCE, ge=0.0, le=1.0)


@router.get("/models")
def list_models(yolo: YoloService = Depends(get_yolo)):
    return yolo.list_models()


@router.get("/models/{model_name}/classes")
def model_classes(model_name: str, yolo: YoloService = Depends(get_yolo)):
    """Devuelve el catalogo de clases que el modelo puede detectar.

    Las clases salen directamente de model.names del modelo Ultralytics,
    no de listas hardcodeadas. Asi cualquier .pt nuevo funciona sin tocar codigo.
    """
    try:
        classes = yolo.get_classes(model_name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Model not found: {model_name}")
    return {
        "model": model_name,
        "count": len(classes),
        "classes": classes,
    }


@router.post("/detect")
async def detect(
    image: UploadFile = File(...),
    model_id: str = Form(...),
    min_confidence: float = Form(DEFAULT_CONFIDENCE),
    yolo: YoloService = Depends(get_yolo),
):
    """Detección YOLO recibiendo la imagen como archivo multipart."""
    content = await image.read()
    try:
        return await asyncio.to_thread(yolo.detect, content, model_id, min_confidence)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/detect/base64")
async def detect_base64(
    payload: DetectBase64Request,
    yolo: YoloService = Depends(get_yolo),
):
    """Detección YOLO recibiendo la imagen como string base64 dentro de un JSON."""
    try:
        image_bytes = decode_base64_image(payload.image)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        return await asyncio.to_thread(
            yolo.detect, image_bytes, payload.model_id, payload.min_confidence
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
