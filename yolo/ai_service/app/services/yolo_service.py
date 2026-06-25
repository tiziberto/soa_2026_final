import threading
from pathlib import Path
from typing import Dict, List

import cv2
import numpy as np
from ultralytics import YOLO


class YoloService:
    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self._cache: Dict[str, YOLO] = {}
        self._classes_cache: Dict[str, List[str]] = {}
        self._lock = threading.Lock()

    def list_models(self) -> List[str]:
        if not self.models_dir.exists():
            return []
        return sorted(p.name for p in self.models_dir.glob("*.pt"))

    def _load(self, model_id: str) -> YOLO:
        with self._lock:
            if model_id not in self._cache:
                path = self.models_dir / model_id
                if not path.exists():
                    raise FileNotFoundError(f"Model not found: {model_id}")
                self._cache[model_id] = YOLO(str(path))
            return self._cache[model_id]

    def warm_up(self) -> None:
        models = self.list_models()
        if models:
            self._load(models[0])

    def get_classes(self, model_id: str) -> List[str]:
        """Devuelve las clases del modelo ordenadas por indice.

        Cachea el resultado para no recorrer model.names en cada request.
        Lanza FileNotFoundError si el modelo no existe.
        """
        if model_id not in self._classes_cache:
            model = self._load(model_id)  # FileNotFoundError si no existe
            names = model.names  # dict {idx: nombre}
            self._classes_cache[model_id] = [names[i] for i in sorted(names)]
        return self._classes_cache[model_id]

    def detect(self, image_bytes: bytes, model_id: str, min_confidence: float) -> dict:
        model = self._load(model_id)
        arr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Could not decode image")

        results = model(frame, verbose=False)
        detections = []
        for r in results:
            for box in r.boxes:
                conf = float(box.conf[0])
                if conf < min_confidence:
                    continue
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
                cls = int(box.cls[0])
                detections.append({
                    "class_id": cls,
                    "class_name": model.names.get(cls, str(cls)),
                    "confidence": conf,
                    "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                })

        h, w = frame.shape[:2]
        return {
            "model": model_id,
            "image_size": {"width": w, "height": h},
            "detections": detections,
        }
