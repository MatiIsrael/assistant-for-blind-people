import os
import sys
from pathlib import Path

# Add parent project directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'vision_nav.settings')

from django.core.wsgi import get_wsgi_application

# Auto-migrate for Vercel /tmp database on cold start
if os.environ.get('VERCEL'):
    try:
        from django.core.management import call_command
        call_command('migrate', interactive=False)
    except Exception as e:
        print(f"[Vercel Migration] {e}")

app = get_wsgi_application()
