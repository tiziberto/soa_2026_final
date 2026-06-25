from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import MODELS_DIR
from app.routers import detection, face
from app.services.yolo_service import YoloService


@asynccontextmanager
async def lifespan(app: FastAPI):
    yolo = YoloService(MODELS_DIR)
    yolo.warm_up()
    app.state.yolo = yolo
    yield


app = FastAPI(
    title="SOA 2026 - AI Service",
    description="Servicio interno de inferencia YOLO y reconocimiento facial",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(detection.router)
app.include_router(face.router)


@app.get("/health")
def health():
    return {"status": "ok"}
