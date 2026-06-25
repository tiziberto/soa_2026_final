from typing import List

import cv2
import face_recognition
import numpy as np

from app.config import FACE_DETECTION_MODEL


def _decode_image(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Could not decode image")
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def generate_embeddings(image_bytes: bytes) -> dict:
    rgb = _decode_image(image_bytes)
    locations = face_recognition.face_locations(rgb, model=FACE_DETECTION_MODEL)

    if not locations:
        return {
            "face_count": 0,
            "embeddings": [],
            "reason": "no_face_detected",
        }

    if len(locations) > 1:
        return {
            "face_count": len(locations),
            "embeddings": [],
            "reason": "Mas de 1 persona en la foto",
        }

    encodings = face_recognition.face_encodings(rgb, known_face_locations=locations)

    embeddings = []
    for loc, enc in zip(locations, encodings):
        top, right, bottom, left = loc
        embeddings.append({
            "bbox": {"top": top, "right": right, "bottom": bottom, "left": left},
            "vector": enc.tolist(),
        })

    return {
        "face_count": len(embeddings),
        "embeddings": embeddings,
    }


def recognize(image_bytes: bytes, known: List[dict], threshold: float) -> dict:
    """known = [{"personId": "...", "vector": [128 floats]}, ...]"""
    rgb = _decode_image(image_bytes)
    locations = face_recognition.face_locations(rgb, model=FACE_DETECTION_MODEL)

    if not locations:
        return {"personId": None, "confidence": 0.0, "reason": "no_face_detected"}

    if len(locations) > 1:
        return {
            "personId": None,
            "confidence": 0.0,
            "reason": "Mas de 1 persona en la foto",
            "face_count": len(locations),
        }

    encodings = face_recognition.face_encodings(rgb, known_face_locations=locations)

    if not known:
        return {"personId": None, "confidence": 0.0, "reason": "no_known_embeddings"}

    known_vecs = np.array([k["vector"] for k in known], dtype=np.float64)
    known_ids = [k["personId"] for k in known]

    query = encodings[0]
    distances = face_recognition.face_distance(known_vecs, query)
    best_idx = int(np.argmin(distances))
    best_distance = float(distances[best_idx])
    confidence = max(0.0, 1.0 - best_distance)

    if confidence >= threshold:
        return {
            "personId": known_ids[best_idx],
            "confidence": confidence,
            "distance": best_distance,
        }
    return {
        "personId": None,
        "confidence": confidence,
        "distance": best_distance,
    }
