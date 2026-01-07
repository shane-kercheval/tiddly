"""Tests for UUIDv7Mixin."""
import time
from uuid import UUID

from uuid6 import uuid7

from models.base import UUIDv7Mixin


class TestUUIDv7Mixin:
    """Tests for the UUIDv7Mixin class."""

    def test__uuid7__generates_valid_uuid(self) -> None:
        """Test that uuid7() generates a valid UUID."""
        generated = uuid7()
        assert isinstance(generated, UUID)
        # UUID string format: 8-4-4-4-12 characters
        uuid_str = str(generated)
        assert len(uuid_str) == 36
        parts = uuid_str.split("-")
        assert len(parts) == 5
        assert len(parts[0]) == 8
        assert len(parts[1]) == 4
        assert len(parts[2]) == 4
        assert len(parts[3]) == 4
        assert len(parts[4]) == 12

    def test__uuid7__is_version_7(self) -> None:
        """Test that uuid7() generates version 7 UUIDs."""
        generated = uuid7()
        # Version is encoded in the 13th character (7 for UUIDv7)
        uuid_str = str(generated)
        # The 13th character (index 14 accounting for hyphens) should be '7'
        # Format: xxxxxxxx-xxxx-Mxxx-xxxx-xxxxxxxxxxxx where M is version
        assert uuid_str[14] == "7"

    def test__uuid7__is_time_ordered(self) -> None:
        """Test that sequential UUIDs are time-ordered."""
        uuid1 = uuid7()
        # Small delay to ensure different timestamps
        time.sleep(0.002)  # 2ms
        uuid2 = uuid7()

        # UUIDv7 is lexicographically sortable by time
        # When compared as strings, later UUIDs should sort after earlier ones
        assert str(uuid2) > str(uuid1)

    def test__uuid7__generates_unique_ids(self) -> None:
        """Test that uuid7() generates unique IDs."""
        uuids = [uuid7() for _ in range(1000)]
        # All UUIDs should be unique
        assert len(set(uuids)) == 1000

    def test__uuid7_mixin__has_id_attribute(self) -> None:
        """Test that UUIDv7Mixin defines an id attribute."""
        assert hasattr(UUIDv7Mixin, "id")

    def test__uuid7__can_be_provided_explicitly(self) -> None:
        """Test that a custom UUID can be provided (for testing/seeding)."""
        custom_uuid = uuid7()
        # Verify it can be converted to/from string
        uuid_str = str(custom_uuid)
        parsed = UUID(uuid_str)
        assert parsed == custom_uuid

    def test__uuid7__is_compatible_with_postgres_uuid_type(self) -> None:
        """Test that uuid7 is compatible with standard UUID operations."""
        generated = uuid7()

        # Test hex representation (used by Postgres internally)
        hex_str = generated.hex
        assert len(hex_str) == 32

        # Test bytes representation
        uuid_bytes = generated.bytes
        assert len(uuid_bytes) == 16

        # Test round-trip through bytes
        reconstructed = UUID(bytes=uuid_bytes)
        assert reconstructed == generated

    def test__uuid7__uses_rfc9562_millisecond_precision(self) -> None:
        """
        Test that uuid7 uses RFC 9562 millisecond precision (not nanosecond).

        RFC 9562 UUIDs encode Unix milliseconds in the first 48 bits.
        The hex prefix should match the current time in milliseconds.
        Old implementations using nanoseconds would have a different prefix.
        """
        # Get current time in milliseconds
        current_ms = int(time.time() * 1000)

        # Generate UUID
        generated = uuid7()
        uuid_hex = generated.hex

        # Extract first 12 hex chars (48 bits = timestamp)
        uuid_timestamp_hex = uuid_hex[:12]
        uuid_timestamp_ms = int(uuid_timestamp_hex, 16)

        # The UUID timestamp should be very close to current time (within 2 seconds)
        # This verifies we're using millisecond precision per RFC 9562
        # Using 2 second tolerance to account for test execution time
        assert abs(uuid_timestamp_ms - current_ms) < 2000, (
            f"UUID timestamp {uuid_timestamp_ms} differs from current time {current_ms} by more than 2 seconds. "
            "This suggests the library is not using RFC 9562 millisecond precision."
        )
