"""Tests for content_chunks and content_embedding_state schema (M1)."""
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from core.tier_limits import Tier
from models.content_chunk import ContentChunk
from models.content_embedding_state import ContentEmbeddingState
from models.user import User


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(auth0_id="test-chunks-user", email="chunks@example.com", tier=Tier.PRO.value)
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)
    return user


def _make_embedding(dim: int = 1536) -> list[float]:
    """Create a deterministic embedding vector."""
    return [0.01 * (i % 100) for i in range(dim)]


# =============================================================================
# pgvector Extension
# =============================================================================


async def test__pgvector_extension__is_enabled(db_session: AsyncSession) -> None:
    """Pgvector extension should be available in the test database."""
    result = await db_session.execute(text(
        "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    ))
    assert result.scalar() == "vector"


# =============================================================================
# ContentChunk: Basic CRUD
# =============================================================================


async def test__content_chunk__insert_and_retrieve(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Chunk insertion and retrieval round-trips correctly including embedding."""
    entity_id = uuid7()
    embedding = _make_embedding()
    chunk = ContentChunk(
        user_id=test_user.id,
        entity_type="note",
        entity_id=entity_id,
        chunk_type="content",
        chunk_index=0,
        chunk_text="This is a test paragraph.",
        token_count=6,
        chunk_hash="abc123",
        model="text-embedding-3-small",
        embedding=embedding,
    )
    db_session.add(chunk)
    await db_session.flush()
    await db_session.refresh(chunk)

    assert chunk.id is not None
    assert chunk.entity_type == "note"
    assert chunk.chunk_type == "content"
    assert chunk.chunk_index == 0
    assert chunk.token_count == 6
    assert chunk.model == "text-embedding-3-small"

    # Verify embedding round-trip via ORM (to ensure Vector type works)
    result = await db_session.execute(
        select(ContentChunk.embedding).where(ContentChunk.id == chunk.id),
    )
    retrieved = result.scalar_one()
    assert len(retrieved) == 1536
    assert abs(retrieved[0] - 0.0) < 1e-6
    assert abs(retrieved[1] - 0.01) < 1e-6


async def test__content_chunk__multiple_chunks_per_entity(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Multiple chunks (metadata + content) for one entity."""
    entity_id = uuid7()
    embedding = _make_embedding()

    metadata_chunk = ContentChunk(
        user_id=test_user.id,
        entity_type="bookmark",
        entity_id=entity_id,
        chunk_type="metadata",
        chunk_index=0,
        chunk_text="Title: Test Bookmark",
        token_count=4,
        chunk_hash="meta_hash",
        model="text-embedding-3-small",
        embedding=embedding,
    )
    content_chunk_0 = ContentChunk(
        user_id=test_user.id,
        entity_type="bookmark",
        entity_id=entity_id,
        chunk_type="content",
        chunk_index=0,
        chunk_text="First paragraph of content.",
        token_count=5,
        chunk_hash="content_hash_0",
        model="text-embedding-3-small",
        embedding=embedding,
    )
    content_chunk_1 = ContentChunk(
        user_id=test_user.id,
        entity_type="bookmark",
        entity_id=entity_id,
        chunk_type="content",
        chunk_index=1,
        chunk_text="Second paragraph of content.",
        token_count=5,
        chunk_hash="content_hash_1",
        model="text-embedding-3-small",
        embedding=embedding,
    )
    db_session.add_all([metadata_chunk, content_chunk_0, content_chunk_1])
    await db_session.flush()

    result = await db_session.execute(text(
        "SELECT count(*) FROM content_chunks WHERE entity_id = :eid",
    ), {"eid": str(entity_id)})
    assert result.scalar() == 3


# =============================================================================
# ContentChunk: Constraints
# =============================================================================


async def test__content_chunk__unique_constraint_prevents_duplicate(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Duplicate (entity_type, entity_id, chunk_type, chunk_index) is rejected."""
    entity_id = uuid7()
    embedding = _make_embedding()
    kwargs = {
        "user_id": test_user.id,
        "entity_type": "note",
        "entity_id": entity_id,
        "chunk_type": "content",
        "chunk_index": 0,
        "chunk_text": "text",
        "token_count": 1,
        "chunk_hash": "h1",
        "model": "text-embedding-3-small",
        "embedding": embedding,
    }
    db_session.add(ContentChunk(**kwargs))
    await db_session.flush()

    db_session.add(ContentChunk(**{**kwargs, "chunk_hash": "h2"}))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test__content_chunk__embedding_not_null_enforced(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Inserting a chunk without an embedding is rejected."""
    chunk = ContentChunk(
        user_id=test_user.id,
        entity_type="note",
        entity_id=uuid7(),
        chunk_type="content",
        chunk_index=0,
        chunk_text="text",
        token_count=1,
        chunk_hash="h1",
        model="text-embedding-3-small",
        embedding=None,
    )
    db_session.add(chunk)
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test__content_chunk__wrong_dimension_rejected(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Inserting an embedding with wrong dimensions is rejected."""
    chunk = ContentChunk(
        user_id=test_user.id,
        entity_type="note",
        entity_id=uuid7(),
        chunk_type="content",
        chunk_index=0,
        chunk_text="text",
        token_count=1,
        chunk_hash="h1",
        model="text-embedding-3-small",
        embedding=[0.1] * 768,  # wrong dimension — should be 1536
    )
    db_session.add(chunk)
    with pytest.raises(StatementError, match="expected 1536 dimensions"):
        await db_session.flush()


async def test__content_chunk__user_fk_cascade_delete(
    db_session: AsyncSession,
) -> None:
    """Deleting a user cascades to their content chunks."""
    user = User(auth0_id="test-cascade-chunk-user", email="cascade@example.com", tier=Tier.PRO.value)
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)

    chunk = ContentChunk(
        user_id=user.id,
        entity_type="note",
        entity_id=uuid7(),
        chunk_type="content",
        chunk_index=0,
        chunk_text="text",
        token_count=1,
        chunk_hash="h1",
        model="text-embedding-3-small",
        embedding=_make_embedding(),
    )
    db_session.add(chunk)
    await db_session.flush()
    chunk_id = chunk.id

    await db_session.delete(user)
    await db_session.flush()

    result = await db_session.execute(text(
        "SELECT count(*) FROM content_chunks WHERE id = :id",
    ), {"id": str(chunk_id)})
    assert result.scalar() == 0


# =============================================================================
# ContentChunk: HNSW Index
# =============================================================================


async def test__content_chunk__hnsw_index_exists(db_session: AsyncSession) -> None:
    """HNSW index on embedding column should exist."""
    result = await db_session.execute(text("""
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'content_chunks' AND indexname = 'ix_content_chunks_embedding'
    """))
    row = result.first()
    assert row is not None
    assert "hnsw" in row.indexdef.lower()
    assert "vector_cosine_ops" in row.indexdef.lower()


# =============================================================================
# ContentChunk: Vector Similarity Query
# =============================================================================


async def test__content_chunk__cosine_similarity_query(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Vector similarity search returns results ordered by distance."""
    entity_id = uuid7()

    # Insert two chunks with different embeddings
    emb_a = [1.0] + [0.0] * 1535  # points along dim 0
    emb_b = [0.0, 1.0] + [0.0] * 1534  # points along dim 1

    for i, emb in enumerate([emb_a, emb_b]):
        db_session.add(ContentChunk(
            user_id=test_user.id,
            entity_type="note",
            entity_id=entity_id,
            chunk_type="content",
            chunk_index=i,
            chunk_text=f"chunk {i}",
            token_count=2,
            chunk_hash=f"hash_{i}",
            model="text-embedding-3-small",
            embedding=emb,
        ))
    await db_session.flush()

    # Query with a vector close to emb_a
    query_emb = str([1.0] + [0.0] * 1535)
    result = await db_session.execute(text("""
        SELECT chunk_index, embedding <=> :query_emb AS distance
        FROM content_chunks
        WHERE entity_id = :eid
        ORDER BY embedding <=> :query_emb
    """), {"query_emb": query_emb, "eid": str(entity_id)})
    rows = result.fetchall()
    assert len(rows) == 2
    # First result should be chunk 0 (identical vector, distance ≈ 0)
    assert rows[0].chunk_index == 0
    assert rows[0].distance < 0.01
    # Second result should be chunk 1 (orthogonal, distance ≈ 1)
    assert rows[1].chunk_index == 1
    assert rows[1].distance > 0.9


# =============================================================================
# ContentEmbeddingState: Basic CRUD
# =============================================================================


async def test__embedding_state__insert_and_retrieve(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """State row insertion and retrieval round-trips correctly."""
    entity_id = uuid7()
    state = ContentEmbeddingState(
        user_id=test_user.id,
        entity_type="note",
        entity_id=entity_id,
        metadata_hash="meta_sha256",
        content_hash="content_sha256",
        model="text-embedding-3-small",
        status="embedded",
    )
    db_session.add(state)
    await db_session.flush()
    await db_session.refresh(state)

    assert state.id is not None
    assert state.status == "embedded"
    assert state.last_error is None


async def test__embedding_state__update_status_and_error(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """State row can be updated with error information."""
    state = ContentEmbeddingState(
        user_id=test_user.id,
        entity_type="bookmark",
        entity_id=uuid7(),
        metadata_hash="h1",
        content_hash="h2",
        model="text-embedding-3-small",
        status="embedded",
    )
    db_session.add(state)
    await db_session.flush()

    state.status = "failed"
    state.last_error = "OpenAI API rate limit exceeded"
    await db_session.flush()
    await db_session.refresh(state)

    assert state.status == "failed"
    assert state.last_error == "OpenAI API rate limit exceeded"


async def test__embedding_state__invalid_status_rejected(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """CHECK constraint rejects invalid status values."""
    state = ContentEmbeddingState(
        user_id=test_user.id,
        entity_type="note",
        entity_id=uuid7(),
        metadata_hash="h1",
        content_hash="h2",
        model="text-embedding-3-small",
        status="pending",  # invalid — only 'embedded' or 'failed' allowed
    )
    db_session.add(state)
    with pytest.raises(IntegrityError):
        await db_session.flush()


# =============================================================================
# ContentEmbeddingState: Constraints
# =============================================================================


async def test__embedding_state__unique_constraint_prevents_duplicate(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Duplicate (entity_type, entity_id) is rejected."""
    entity_id = uuid7()
    kwargs = {
        "user_id": test_user.id,
        "entity_type": "note",
        "entity_id": entity_id,
        "metadata_hash": "h1",
        "content_hash": "h2",
        "model": "text-embedding-3-small",
        "status": "embedded",
    }
    db_session.add(ContentEmbeddingState(**kwargs))
    await db_session.flush()

    db_session.add(ContentEmbeddingState(**{**kwargs, "metadata_hash": "h3"}))
    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test__embedding_state__user_fk_cascade_delete(
    db_session: AsyncSession,
) -> None:
    """Deleting a user cascades to their embedding state rows."""
    user = User(auth0_id="test-cascade-state-user", email="cascade-state@example.com", tier=Tier.PRO.value)
    db_session.add(user)
    await db_session.flush()
    await db_session.refresh(user)

    state = ContentEmbeddingState(
        user_id=user.id,
        entity_type="note",
        entity_id=uuid7(),
        metadata_hash="h1",
        content_hash="h2",
        model="text-embedding-3-small",
        status="embedded",
    )
    db_session.add(state)
    await db_session.flush()
    state_id = state.id

    await db_session.delete(user)
    await db_session.flush()

    result = await db_session.execute(text(
        "SELECT count(*) FROM content_embedding_state WHERE id = :id",
    ), {"id": str(state_id)})
    assert result.scalar() == 0


# =============================================================================
# ContentEmbeddingState: Same entity, different types allowed
# =============================================================================


async def test__embedding_state__different_entity_types_same_id(
    db_session: AsyncSession,
    test_user: User,
) -> None:
    """Same entity_id with different entity_types should be allowed."""
    entity_id = uuid7()
    for entity_type in ["note", "bookmark"]:
        db_session.add(ContentEmbeddingState(
            user_id=test_user.id,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata_hash="h1",
            content_hash="h2",
            model="text-embedding-3-small",
            status="embedded",
        ))
    await db_session.flush()

    result = await db_session.execute(text(
        "SELECT count(*) FROM content_embedding_state WHERE entity_id = :eid",
    ), {"eid": str(entity_id)})
    assert result.scalar() == 2


# =============================================================================
# Indexes Exist
# =============================================================================


async def test__indexes__all_expected_indexes_exist(db_session: AsyncSession) -> None:
    """All planned indexes should exist on both tables."""
    result = await db_session.execute(text("""
        SELECT indexname FROM pg_indexes
        WHERE tablename IN ('content_chunks', 'content_embedding_state')
        ORDER BY indexname
    """))
    index_names = {row.indexname for row in result.fetchall()}

    expected = {
        "ix_content_chunks_embedding",
        "ix_content_chunks_entity",
        "ix_content_chunks_user_id",
        "ix_content_embedding_state_user_id",
        "ix_content_embedding_state_status",
    }
    assert expected.issubset(index_names), f"Missing indexes: {expected - index_names}"
