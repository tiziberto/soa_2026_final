from fastapi import FastAPI

app = FastAPI(title="Worker de Inferencia SOA")

@app.get("/")
def health_check():
	return {"status": "Worker Python online y esperando imagenes"}

# Aca el Integrante 2 programara el POST para  YOLO
