"""
Gunicorn configuration for FundTraceAI ML Service.
Configures multi-worker scaling with per-worker model & SHAP explainer isolation.
"""
import multiprocessing
import os

bind = os.getenv("GUNICORN_BIND", "0.0.0.0:5000")
workers = int(os.getenv("GUNICORN_WORKERS", str(min(4, max(2, multiprocessing.cpu_count())))))
worker_class = "sync"
worker_connections = 1000
timeout = 120
keepalive = 5

# Preload app: False ensures each worker cleanly initializes its own isolated ML model and SHAP background samples
preload_app = False

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"

def post_fork(server, worker):
    server.log.info(f"[Gunicorn Worker {worker.pid}]: Spawned and initializing ML Champion model and SHAP explainer.")
