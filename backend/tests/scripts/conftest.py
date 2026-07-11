"""Puts backend/scripts on sys.path — one-off scripts live outside PYTHONPATH by design."""
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parents[2] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
