"""
WSGI Entry Point for Production Flask ML Service.
Compatible with Gunicorn, Waitress, and uWSGI.
"""
import os
import sys

# Add ml-service root to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, load_resources

# Ensure models, calibration curves, and SHAP explainers are loaded once per worker process
load_resources()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
