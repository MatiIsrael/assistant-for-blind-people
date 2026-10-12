import os
import sys
import shutil
import tempfile
from pathlib import Path

# Add project root directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'vision_nav.settings')

# Ensure SQLite database is seeded in writable temp dir on Vercel / serverless
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
        print(f"[Vercel DB Init] {e}")

from django.core.wsgi import get_wsgi_application

# Vercel entrypoint callable
app = get_wsgi_application()
