-- 1. Extensión vectorial
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Tabla frames (fotogramas procesados)
CREATE TABLE frames (
    frame_id VARCHAR(255) PRIMARY KEY, -- Corregido: VARCHAR para soportar el FID de SeaweedFS
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Tabla detections (resultados de YOLO)
CREATE TABLE detections (
    detection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frame_id VARCHAR(255) NOT NULL REFERENCES frames(frame_id) ON DELETE CASCADE, -- Corregido: VARCHAR
    class_name VARCHAR(50) NOT NULL,
    confidence NUMERIC(5,4) NOT NULL,
    bbox JSONB NOT NULL,
    model_id VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Tabla persons (reconocimiento facial)
CREATE TABLE persons (
    person_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    extra JSONB,
    keycloak_user_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Tabla embeddings (vectores faciales)
CREATE TABLE embeddings (
    embedding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
    vector VECTOR(128) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 6. Índices para performance
CREATE INDEX idx_frames_coords ON frames (latitude, longitude);
CREATE INDEX idx_frames_metadata ON frames USING GIN (metadata);
CREATE INDEX idx_detections_class ON detections (class_name);
CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_persons_kc_id ON persons (keycloak_user_id);

-- 7. Función para reconocimiento facial (S5.3)
CREATE OR REPLACE FUNCTION match_face(query_vector VECTOR(128), threshold FLOAT)
RETURNS TABLE(person_id UUID, first_name VARCHAR, last_name VARCHAR, confidence FLOAT) AS $$
    SELECT
        p.person_id,
        p.first_name,
        p.last_name,
        1 - (e.vector <=> query_vector) AS confidence
    FROM embeddings e
    JOIN persons p ON e.person_id = p.person_id
    WHERE 1 - (e.vector <=> query_vector) > threshold
    ORDER BY e.vector <=> query_vector
    LIMIT 1;
$$ LANGUAGE sql STABLE;
