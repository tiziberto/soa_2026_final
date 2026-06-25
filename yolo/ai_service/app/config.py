import os
from pathlib import Path

MODELS_DIR = Path(os.getenv("MODELS_DIR", "/app/models"))
DEFAULT_CONFIDENCE = float(os.getenv("DEFAULT_CONFIDENCE", "0.25"))
DEFAULT_FACE_THRESHOLD = float(os.getenv("DEFAULT_FACE_THRESHOLD", "0.9"))
FACE_DETECTION_MODEL = os.getenv("FACE_DETECTION_MODEL", "hog")  # hog (rapido) o cnn (preciso)
