#!/bin/bash
echo "Installing requirements..."
pip install -r requirements.txt
echo "Collecting static files..."
python manage.py collectstatic --noinput --clear
echo "Build complete."
