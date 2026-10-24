# Stage 1: export a YOLO nano model to ONNX (needs torch; not shipped in the runtime image)
FROM python:3.12-slim AS export
ARG MODEL=yolo11n
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir ultralytics onnx onnxslim onnxruntime
WORKDIR /export
RUN python -c "from ultralytics import YOLO; YOLO('${MODEL}.pt').export(format='onnx', imgsz=(384, 640), opset=12, simplify=True)" \
 && mv ${MODEL}.onnx /model.onnx

# Stage 2: runtime — ffmpeg + onnxruntime + headless OpenCV
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir numpy opencv-python-headless onnxruntime websockets
WORKDIR /app
COPY --from=export /model.onnx /app/model.onnx
COPY tracker.py /app/tracker.py
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "tracker.py"]
