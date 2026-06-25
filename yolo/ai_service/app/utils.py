import base64
import re

_DATA_URI_PREFIX = re.compile(r"^data:image/[a-zA-Z0-9.+-]+;base64,")


def decode_base64_image(b64_str: str) -> bytes:
    """Decodifica una imagen base64 a bytes crudos.

    Acepta:
    - Base64 plano:  "iVBORw0KGgo..."
    - Data URI:      "data:image/jpeg;base64,iVBORw0KGgo..."
    """
    if not b64_str:
        raise ValueError("Empty image string")

    cleaned = _DATA_URI_PREFIX.sub("", b64_str).strip()

    try:
        return base64.b64decode(cleaned, validate=True)
    except Exception as e:
        raise ValueError(f"Invalid base64 image: {e}")
