// Datos de demostración. Se usan como respaldo cuando el backend (Node-RED)
// todavía no responde, para que la consola se vea viva durante el desarrollo.
// Cuando /api/* esté operativo, estos valores quedan ignorados automáticamente.

const ago = (min) => new Date(Date.now() - min * 60000).toISOString()

export const mockModels = [
  { id: 'yolov8n',  name: 'YOLOv8 Nano',   task: 'Detección de objetos', classes: 80, status: 'activo',   loaded: true,  device: 'GPU' },
  { id: 'yolov8s',  name: 'YOLOv8 Small',  task: 'Detección de objetos', classes: 80, status: 'activo',   loaded: true,  device: 'GPU' },
  { id: 'facenet',  name: 'FaceNet',       task: 'Reconocimiento facial', classes: '—', status: 'activo',  loaded: true,  device: 'GPU' },
  { id: 'yolov8m',  name: 'YOLOv8 Medium', task: 'Detección de objetos', classes: 80, status: 'en reposo', loaded: false, device: 'GPU' },
]

export const mockDetections = [
  { id: 'det_8f21', frameId: null, label: 'persona',    confidence: 0.94, model: 'yolov8s', ts: ago(2) },
  { id: 'det_8f1d', frameId: null, label: 'persona',    confidence: 0.88, model: 'yolov8s', ts: ago(7) },
  { id: 'det_8f0a', frameId: null, label: 'mochila',    confidence: 0.76, model: 'yolov8n', ts: ago(13) },
  { id: 'det_8ef2', frameId: null, label: 'persona',    confidence: 0.91, model: 'yolov8s', ts: ago(21) },
  { id: 'det_8ee9', frameId: null, label: 'automóvil',  confidence: 0.83, model: 'yolov8n', ts: ago(34) },
  { id: 'det_8ed4', frameId: null, label: 'persona',    confidence: 0.79, model: 'yolov8n', ts: ago(48) },
  { id: 'det_8ec0', frameId: null, label: 'bicicleta',  confidence: 0.71, model: 'yolov8n', ts: ago(61) },
]

export const mockPersons = [
  { id: 'p_001', name: 'Ana Belén Ruiz',     embeddings: 5, createdAt: ago(60 * 24 * 9),  lastSeen: ago(2) },
  { id: 'p_002', name: 'Carlos Méndez',      embeddings: 3, createdAt: ago(60 * 24 * 6),  lastSeen: ago(120) },
  { id: 'p_003', name: 'Lucía Fernández',    embeddings: 4, createdAt: ago(60 * 24 * 4),  lastSeen: ago(15) },
  { id: 'p_004', name: 'Martín Sosa',        embeddings: 2, createdAt: ago(60 * 24 * 2),  lastSeen: null },
]

export const mockRecognition = [
  { id: 'rec_31', personId: 'p_001', name: 'Ana Belén Ruiz', confidence: 0.96, ts: ago(2) },
  { id: 'rec_30', personId: 'p_003', name: 'Lucía Fernández', confidence: 0.90, ts: ago(15) },
  { id: 'rec_29', personId: null,    name: 'Sin coincidencia', confidence: 0.41, ts: ago(40) },
  { id: 'rec_28', personId: 'p_002', name: 'Carlos Méndez',   confidence: 0.87, ts: ago(120) },
]
