import os
import sys
import shutil
import tempfile
import traceback
from pathlib import Path

# Add project root directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'vision_nav.settings')

# 1. Initialize Django apps registry first (prevents AppRegistryNotReady error)
import django
try:
    django.setup()
except Exception as e:
    print(f"[Django Setup Error]:\n{traceback.format_exc()}", flush=True)

# 2. Ensure SQLite database is seeded in /tmp on Vercel serverless cold start
if os.environ.get('VERCEL') or os.environ.get('AWS_LAMBDA_FUNCTION_NAME'):
    try:
        tmp_dir = Path(tempfile.gettempdir())
        tmp_db = tmp_dir / 'db.sqlite3'
        if not tmp_db.exists():
            seed_db = BASE_DIR / 'seed_db.sqlite3'
            if seed_db.exists():
                shutil.copy2(seed_db, tmp_db)
            else:
                from django.core.management import call_command
                call_command('migrate', interactive=False)
    except Exception as e:
        print(f"[Vercel DB Init Notice]: {e}", flush=True)

from django.core.wsgi import get_wsgi_application
_django_app = get_wsgi_application()

# 3. Robust WSGI application entrypoint for Vercel
def app(environ, start_response):
    try:
        return _django_app(environ, start_response)
    except Exception as e:
        err = traceback.format_exc()
        print(f"[WSGI Invocation Error]:\n{err}", flush=True)
        start_response('500 Internal Server Error', [('Content-Type', 'text/html; charset=utf-8')])
        html = f"""<!DOCTYPE html>
<html>
<head><title>VisionNav Server Error</title></head>
<body style="font-family:sans-serif; background:#0a0c10; color:#fff; padding:2rem;">
  <h2 style="color:#ff0055;">VisionNav Application Error</h2>
  <p>A serverless function error occurred:</p>
  <pre style="background:#161b22; padding:1rem; border-radius:8px; color:#ffe600; overflow:auto;">{err}</pre>
</body>
</html>"""
        return [html.encode('utf-8')]
