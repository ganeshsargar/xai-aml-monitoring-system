#!/usr/bin/env bash
# Startup script for FundTraceAI ML Service with Gunicorn
cd "$(dirname "$0")"
source ../.venv/bin/activate 2>/dev/null || true
echo "=========================================================="
echo " Starting FundTraceAI ML Service with Gunicorn (Multi-Worker)"
echo "=========================================================="
exec gunicorn --config gunicorn_config.py wsgi:app
