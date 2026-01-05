"""
Pytest configuration for schema tests.

Schema tests don't need a real database connection, but the Settings class
requires DATABASE_URL to be set. This conftest sets up minimal environment
for schema validation tests.
"""
import os

# Set minimal required environment variables before any imports
# that might trigger Settings validation
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
