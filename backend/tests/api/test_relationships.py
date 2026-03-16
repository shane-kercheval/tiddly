"""Tests for relationship API endpoints."""
import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.tier_limits import TIER_LIMITS, Tier
from models.note import Note
from tests.api.conftest import FAKE_UUID


# =============================================================================
# Helpers
# =============================================================================


async def _create_bookmark(client: AsyncClient, title: str = 'Test Bookmark', url: str | None = None) -> dict:
    """Create a bookmark via API and return response data."""
    response = await client.post('/bookmarks/', json={
        'url': url or f'https://example.com/{uuid4().hex[:8]}',
        'title': title,
    })
    assert response.status_code == 201
    return response.json()


async def _create_note(client: AsyncClient, title: str = 'Test Note') -> dict:
    """Create a note via API and return response data."""
    response = await client.post('/notes/', json={'title': title})
    assert response.status_code == 201
    return response.json()


async def _create_prompt(client: AsyncClient, name: str | None = None, title: str = 'Test Prompt') -> dict:
    """Create a prompt via API and return response data."""
    response = await client.post('/prompts/', json={
        'name': name or f'test-prompt-{uuid4().hex[:8]}',
        'title': title,
        'content': 'Test content',
    })
    assert response.status_code == 201
    return response.json()


async def _create_relationship(
    client: AsyncClient,
    source_type: str,
    source_id: str,
    target_type: str,
    target_id: str,
    description: str | None = None,
) -> dict:
    """Create a relationship via API and return response data."""
    payload: dict = {
        'source_type': source_type,
        'source_id': source_id,
        'target_type': target_type,
        'target_id': target_id,
        'relationship_type': 'related',
    }
    if description is not None:
        payload['description'] = description
    response = await client.post('/relationships/', json=payload)
    assert response.status_code == 201
    return response.json()


# =============================================================================
# POST /relationships/ - Create
# =============================================================================


@pytest.mark.asyncio
async def test__api_create__success(client: AsyncClient) -> None:
    """Create a relationship between bookmark and note."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': bm['id'],
        'target_type': 'note',
        'target_id': note['id'],
        'relationship_type': 'related',
    })
    assert response.status_code == 201

    data = response.json()
    assert data['relationship_type'] == 'related'
    assert data['description'] is None
    assert 'id' in data
    assert 'created_at' in data
    assert 'updated_at' in data


@pytest.mark.asyncio
async def test__api_create__with_description(client: AsyncClient) -> None:
    """Create a relationship with a description."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    data = await _create_relationship(
        client, 'bookmark', bm['id'], 'note', note['id'],
        description='Related context',
    )
    assert data['description'] == 'Related context'


@pytest.mark.asyncio
async def test__api_create__duplicate(client: AsyncClient) -> None:
    """Duplicate relationship returns 409."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': bm['id'],
        'target_type': 'note',
        'target_id': note['id'],
        'relationship_type': 'related',
    })
    assert response.status_code == 409
    assert response.json()['detail']['error_code'] == 'DUPLICATE_RELATIONSHIP'


@pytest.mark.asyncio
async def test__api_create__reverse_duplicate(client: AsyncClient) -> None:
    """Creating B->A when A->B exists returns 409 (canonical ordering)."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Reverse direction should also be a duplicate
    response = await client.post('/relationships/', json={
        'source_type': 'note',
        'source_id': note['id'],
        'target_type': 'bookmark',
        'target_id': bm['id'],
        'relationship_type': 'related',
    })
    assert response.status_code == 409


@pytest.mark.asyncio
async def test__api_create__self_reference_rejected(client: AsyncClient) -> None:
    """Self-reference returns 400."""
    bm = await _create_bookmark(client)

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': bm['id'],
        'target_type': 'bookmark',
        'target_id': bm['id'],
        'relationship_type': 'related',
    })
    assert response.status_code == 400


@pytest.mark.asyncio
async def test__api_create__source_not_found(client: AsyncClient) -> None:
    """Non-existent source content returns 404."""
    note = await _create_note(client)

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': FAKE_UUID,
        'target_type': 'note',
        'target_id': note['id'],
        'relationship_type': 'related',
    })
    assert response.status_code == 404


@pytest.mark.asyncio
async def test__api_create__target_not_found(client: AsyncClient) -> None:
    """Non-existent target content returns 404."""
    bm = await _create_bookmark(client)

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': bm['id'],
        'target_type': 'note',
        'target_id': FAKE_UUID,
        'relationship_type': 'related',
    })
    assert response.status_code == 404


@pytest.mark.asyncio
async def test__api_create__invalid_relationship_type(client: AsyncClient) -> None:
    """Invalid relationship_type returns 422."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': bm['id'],
        'target_type': 'note',
        'target_id': note['id'],
        'relationship_type': 'references',
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test__api_create__description_max_length(client: AsyncClient) -> None:
    """Description over 500 chars returns 422."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': bm['id'],
        'target_type': 'note',
        'target_id': note['id'],
        'relationship_type': 'related',
        'description': 'x' * 501,
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test__api_create__empty_description_normalized_to_null(client: AsyncClient) -> None:
    """Empty string description is normalized to null."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': bm['id'],
        'target_type': 'note',
        'target_id': note['id'],
        'relationship_type': 'related',
        'description': '',
    })
    assert response.status_code == 201
    assert response.json()['description'] is None


@pytest.mark.asyncio
async def test__api_create__whitespace_description_normalized_to_null(client: AsyncClient) -> None:
    """Whitespace-only description is normalized to null."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': bm['id'],
        'target_type': 'note',
        'target_id': note['id'],
        'relationship_type': 'related',
        'description': '   \t\n  ',
    })
    assert response.status_code == 201
    assert response.json()['description'] is None


@pytest.mark.asyncio
async def test__api_create__soft_deleted_source_rejected(client: AsyncClient) -> None:
    """Cannot create relationship to soft-deleted content."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    # Soft delete the bookmark
    response = await client.delete(f'/bookmarks/{bm["id"]}')
    assert response.status_code == 204

    response = await client.post('/relationships/', json={
        'source_type': 'bookmark',
        'source_id': bm['id'],
        'target_type': 'note',
        'target_id': note['id'],
        'relationship_type': 'related',
    })
    assert response.status_code == 404


@pytest.mark.asyncio
async def test__api_create__archived_source_allowed(client: AsyncClient) -> None:
    """Can create relationship to archived content."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    # Archive the bookmark
    response = await client.post(f'/bookmarks/{bm["id"]}/archive')
    assert response.status_code == 200

    data = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])
    assert data['id'] is not None


@pytest.mark.asyncio
async def test__api_create__all_content_type_combinations(client: AsyncClient) -> None:
    """All 6 cross-type combinations work (3 same-type + 3 cross-type)."""
    bm1 = await _create_bookmark(client, title='BM1')
    bm2 = await _create_bookmark(client, title='BM2')
    note1 = await _create_note(client, title='Note1')
    note2 = await _create_note(client, title='Note2')
    prompt1 = await _create_prompt(client, title='Prompt1')
    prompt2 = await _create_prompt(client, title='Prompt2')

    combos = [
        ('bookmark', bm1['id'], 'bookmark', bm2['id']),
        ('bookmark', bm1['id'], 'note', note1['id']),
        ('bookmark', bm1['id'], 'prompt', prompt1['id']),
        ('note', note1['id'], 'note', note2['id']),
        ('note', note1['id'], 'prompt', prompt1['id']),
        ('prompt', prompt1['id'], 'prompt', prompt2['id']),
    ]

    for src_type, src_id, tgt_type, tgt_id in combos:
        response = await client.post('/relationships/', json={
            'source_type': src_type,
            'source_id': src_id,
            'target_type': tgt_type,
            'target_id': tgt_id,
            'relationship_type': 'related',
        })
        assert response.status_code == 201, (
            f"Failed for {src_type}->{tgt_type}: {response.json()}"
        )


# =============================================================================
# GET /relationships/{id} - Get single
# =============================================================================


@pytest.mark.asyncio
async def test__api_get__success(client: AsyncClient) -> None:
    """Get a relationship by ID."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    response = await client.get(f'/relationships/{rel["id"]}')
    assert response.status_code == 200
    data = response.json()
    assert data['id'] == rel['id']
    assert data['relationship_type'] == 'related'


@pytest.mark.asyncio
async def test__api_get__not_found(client: AsyncClient) -> None:
    """Non-existent relationship returns 404."""
    response = await client.get(f'/relationships/{FAKE_UUID}')
    assert response.status_code == 404


# =============================================================================
# PATCH /relationships/{id} - Update
# =============================================================================


@pytest.mark.asyncio
async def test__api_update__description(client: AsyncClient) -> None:
    """Update relationship description."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    response = await client.patch(
        f'/relationships/{rel["id"]}',
        json={'description': 'Updated description'},
    )
    assert response.status_code == 200
    assert response.json()['description'] == 'Updated description'


@pytest.mark.asyncio
async def test__api_update__clear_description(client: AsyncClient) -> None:
    """Set description to null."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    rel = await _create_relationship(
        client, 'bookmark', bm['id'], 'note', note['id'],
        description='Initial',
    )

    response = await client.patch(
        f'/relationships/{rel["id"]}',
        json={'description': None},
    )
    assert response.status_code == 200
    assert response.json()['description'] is None


@pytest.mark.asyncio
async def test__api_update__empty_body_no_change(client: AsyncClient) -> None:
    """PATCH with empty body leaves description unchanged."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    rel = await _create_relationship(
        client, 'bookmark', bm['id'], 'note', note['id'],
        description='Keep this',
    )

    response = await client.patch(f'/relationships/{rel["id"]}', json={})
    assert response.status_code == 200
    assert response.json()['description'] == 'Keep this'


@pytest.mark.asyncio
async def test__api_update__whitespace_description_normalized_to_null(client: AsyncClient) -> None:
    """Whitespace-only description in update is normalized to null."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    rel = await _create_relationship(
        client, 'bookmark', bm['id'], 'note', note['id'],
        description='Initial',
    )

    response = await client.patch(
        f'/relationships/{rel["id"]}',
        json={'description': '   '},
    )
    assert response.status_code == 200
    assert response.json()['description'] is None


@pytest.mark.asyncio
async def test__api_update__description_max_length(client: AsyncClient) -> None:
    """Description over 500 chars returns 422."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    response = await client.patch(
        f'/relationships/{rel["id"]}',
        json={'description': 'x' * 501},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test__api_update__not_found(client: AsyncClient) -> None:
    """Update non-existent relationship returns 404."""
    response = await client.patch(
        f'/relationships/{FAKE_UUID}',
        json={'description': 'test'},
    )
    assert response.status_code == 404


# =============================================================================
# DELETE /relationships/{id}
# =============================================================================


@pytest.mark.asyncio
async def test__api_delete__success(client: AsyncClient) -> None:
    """Delete a relationship."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    response = await client.delete(f'/relationships/{rel["id"]}')
    assert response.status_code == 204

    # Verify it's gone
    response = await client.get(f'/relationships/{rel["id"]}')
    assert response.status_code == 404


@pytest.mark.asyncio
async def test__api_delete__not_found(client: AsyncClient) -> None:
    """Delete non-existent relationship returns 404."""
    response = await client.delete(f'/relationships/{FAKE_UUID}')
    assert response.status_code == 404


# =============================================================================
# GET /relationships/content/{type}/{id} - Query
# =============================================================================


@pytest.mark.asyncio
async def test__api_query__success(client: AsyncClient) -> None:
    """Query relationships for a content item returns enriched data."""
    bm = await _create_bookmark(client, title='My Bookmark')
    note = await _create_note(client, title='My Note')
    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    response = await client.get(f'/relationships/content/bookmark/{bm["id"]}')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert data['offset'] == 0
    assert data['limit'] == 50
    assert data['has_more'] is False
    assert len(data['items']) == 1

    item = data['items'][0]
    # Verify content info is included
    assert item['source_title'] is not None or item['target_title'] is not None
    assert item['source_deleted'] is False
    assert item['target_deleted'] is False


@pytest.mark.asyncio
async def test__api_query__from_either_side(client: AsyncClient) -> None:
    """Same relationship returned when querying from either side."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    resp_bm = await client.get(f'/relationships/content/bookmark/{bm["id"]}')
    resp_note = await client.get(f'/relationships/content/note/{note["id"]}')

    assert resp_bm.json()['total'] == 1
    assert resp_note.json()['total'] == 1
    assert resp_bm.json()['items'][0]['id'] == resp_note.json()['items'][0]['id']


@pytest.mark.asyncio
async def test__api_query__without_content_info(client: AsyncClient) -> None:
    """Query with include_content_info=false returns slim response."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    response = await client.get(
        f'/relationships/content/bookmark/{bm["id"]}',
        params={'include_content_info': 'false'},
    )
    assert response.status_code == 200
    data = response.json()
    assert data['total'] == 1

    item = data['items'][0]
    # Without content info, titles should be null and deleted/archived default to false
    assert item['source_title'] is None
    assert item['target_title'] is None


@pytest.mark.asyncio
async def test__api_query__empty_result(client: AsyncClient) -> None:
    """Query for content with no relationships returns empty list."""
    bm = await _create_bookmark(client)

    response = await client.get(f'/relationships/content/bookmark/{bm["id"]}')
    assert response.status_code == 200
    data = response.json()
    assert data['total'] == 0
    assert data['items'] == []
    assert data['has_more'] is False


@pytest.mark.asyncio
async def test__api_query__nonexistent_content_returns_empty(client: AsyncClient) -> None:
    """Query for non-existent content ID returns empty list (not 404)."""
    response = await client.get(f'/relationships/content/bookmark/{FAKE_UUID}')
    assert response.status_code == 200
    assert response.json()['total'] == 0


@pytest.mark.asyncio
async def test__api_query__pagination(client: AsyncClient) -> None:
    """Pagination works with offset and limit."""
    bm = await _create_bookmark(client)
    notes = []
    for i in range(5):
        notes.append(await _create_note(client, title=f'Note {i}'))
    for note in notes:
        await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # First page
    resp1 = await client.get(
        f'/relationships/content/bookmark/{bm["id"]}',
        params={'offset': 0, 'limit': 2},
    )
    data1 = resp1.json()
    assert len(data1['items']) == 2
    assert data1['total'] == 5
    assert data1['has_more'] is True

    # Second page
    resp2 = await client.get(
        f'/relationships/content/bookmark/{bm["id"]}',
        params={'offset': 2, 'limit': 2},
    )
    data2 = resp2.json()
    assert len(data2['items']) == 2
    assert data2['has_more'] is True

    # Last page
    resp3 = await client.get(
        f'/relationships/content/bookmark/{bm["id"]}',
        params={'offset': 4, 'limit': 2},
    )
    data3 = resp3.json()
    assert len(data3['items']) == 1
    assert data3['has_more'] is False


@pytest.mark.asyncio
async def test__api_query__ordering(client: AsyncClient) -> None:
    """Results ordered by created_at DESC (newest first)."""
    bm = await _create_bookmark(client)
    note1 = await _create_note(client, title='First')
    note2 = await _create_note(client, title='Second')

    rel1 = await _create_relationship(client, 'bookmark', bm['id'], 'note', note1['id'])
    rel2 = await _create_relationship(client, 'bookmark', bm['id'], 'note', note2['id'])

    response = await client.get(f'/relationships/content/bookmark/{bm["id"]}')
    items = response.json()['items']

    # Most recently created first
    assert items[0]['id'] == rel2['id']
    assert items[1]['id'] == rel1['id']


@pytest.mark.asyncio
async def test__api_query__content_info_deleted_target(client: AsyncClient) -> None:
    """Soft-deleted target shows deleted flag in content info."""
    bm = await _create_bookmark(client)
    note = await _create_note(client, title='Will Delete')
    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Soft delete the note
    await client.delete(f'/notes/{note["id"]}')

    response = await client.get(f'/relationships/content/bookmark/{bm["id"]}')
    items = response.json()['items']
    assert len(items) == 1

    item = items[0]
    # The note could be source or target depending on canonical ordering
    # Find which side has the note
    if item['source_type'] == 'note':
        assert item['source_deleted'] is True
    else:
        assert item['target_deleted'] is True


@pytest.mark.asyncio
async def test__api_query__content_info_archived_target(client: AsyncClient) -> None:
    """Archived target shows archived flag in content info."""
    bm = await _create_bookmark(client)
    note = await _create_note(client, title='Will Archive')
    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Archive the note
    await client.post(f'/notes/{note["id"]}/archive')

    response = await client.get(f'/relationships/content/bookmark/{bm["id"]}')
    items = response.json()['items']
    assert len(items) == 1

    item = items[0]
    if item['source_type'] == 'note':
        assert item['source_archived'] is True
    else:
        assert item['target_archived'] is True


@pytest.mark.asyncio
async def test__api_query__future_archived_at_not_considered_archived(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """
    A note with archived_at in the future should not be flagged as archived.

    Future archived_at means "scheduled to archive" — not yet actually archived.
    """
    bm = await _create_bookmark(client)
    note = await _create_note(client, title='Future Scheduled')
    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Set archived_at to a future date directly in the DB
    future_time = datetime.now(UTC) + timedelta(days=7)
    note_id = UUID(note['id'])
    await db_session.execute(
        Note.__table__.update()
        .where(Note.id == note_id)
        .values(archived_at=future_time),
    )
    await db_session.flush()

    response = await client.get(f'/relationships/content/bookmark/{bm["id"]}')
    items = response.json()['items']
    assert len(items) == 1

    item = items[0]
    # Future archived_at should NOT be flagged as archived
    if item['source_type'] == 'note':
        assert item['source_archived'] is False
    else:
        assert item['target_archived'] is False


@pytest.mark.asyncio
async def test__api_query__content_info_with_bookmark_url(client: AsyncClient) -> None:
    """Bookmark content info includes URL."""
    bm = await _create_bookmark(client, title='Has URL', url='https://example.com/test-url')
    note = await _create_note(client)
    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    response = await client.get(f'/relationships/content/note/{note["id"]}')
    item = response.json()['items'][0]

    # Find the bookmark side
    if item['source_type'] == 'bookmark':
        assert 'example.com/test-url' in item['source_url']
    else:
        assert 'example.com/test-url' in item['target_url']


@pytest.mark.asyncio
async def test__api_query__content_info_missing_entity(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """
    If an entity row is missing (e.g. race condition between relationship query
    and permanent delete), the enrichment fallback sets title=null, deleted=true.

    We bypass BaseEntityService.delete() (which cascades relationship cleanup)
    by deleting the note row directly via SQL, leaving the relationship orphaned.
    """
    bm = await _create_bookmark(client)
    note = await _create_note(client)
    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Delete the note row directly, bypassing cascade cleanup
    note_id = UUID(note['id'])
    await db_session.execute(sql_delete(Note).where(Note.id == note_id))
    await db_session.flush()

    # Relationship still exists but note is gone — fallback should kick in
    response = await client.get(f'/relationships/content/bookmark/{bm["id"]}')
    data = response.json()
    assert data['total'] == 1

    item = data['items'][0]
    # The note side should show the missing-entity fallback: title=null, deleted=true
    if item['source_type'] == 'note':
        assert item['source_title'] is None
        assert item['source_deleted'] is True
    else:
        assert item['target_title'] is None
        assert item['target_deleted'] is True


# =============================================================================
# Standalone endpoint history recording
# =============================================================================


@pytest.mark.asyncio
async def test__api_create_relationship__records_history_on_source(
    client: AsyncClient,
) -> None:
    """POST /relationships/ records a history entry on the source entity."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Check history on the source entity (bookmark)
    response = await client.get(f'/history/bookmark/{bm["id"]}')
    assert response.status_code == 200
    data = response.json()

    # Should have CREATE (from bookmark creation) + UPDATE (from relationship creation)
    assert data['total'] >= 2
    actions = [item['action'] for item in data['items']]
    assert 'update' in actions

    # The relationship history entry should have changed_fields = ["relationships"]
    update_entry = next(item for item in data['items'] if item['action'] == 'update')
    assert update_entry['changed_fields'] == ['relationships']


@pytest.mark.asyncio
async def test__api_delete_relationship__records_history_on_source(
    client: AsyncClient,
) -> None:
    """DELETE /relationships/{id} records a history entry on the canonical source entity."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Delete the relationship
    response = await client.delete(f'/relationships/{rel["id"]}')
    assert response.status_code == 204

    # Check history on the source entity (bookmark, which is the canonical source)
    response = await client.get(f'/history/bookmark/{bm["id"]}')
    assert response.status_code == 200
    data = response.json()

    # Should have CREATE + UPDATE (add rel) + UPDATE (remove rel)
    assert data['total'] >= 3


@pytest.mark.asyncio
async def test__api_update_relationship__records_history_on_source(
    client: AsyncClient,
) -> None:
    """PATCH /relationships/{id} records a history entry on the source entity."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Get history count before update
    response = await client.get(f'/history/bookmark/{bm["id"]}')
    count_before = response.json()['total']

    # Update description
    response = await client.patch(
        f'/relationships/{rel["id"]}',
        json={'description': 'New description'},
    )
    assert response.status_code == 200

    # Check history — should have one more entry
    response = await client.get(f'/history/bookmark/{bm["id"]}')
    data = response.json()
    assert data['total'] == count_before + 1

    # The newest entry should have changed_fields = ["relationships"]
    newest = data['items'][0]
    assert newest['changed_fields'] == ['relationships']


# =============================================================================
# Entity create/update with relationships via API
# =============================================================================


@pytest.mark.asyncio
async def test__api_create_bookmark_with_relationships(client: AsyncClient) -> None:
    """POST /bookmarks/ with relationships creates them and includes in response."""
    note = await _create_note(client)

    response = await client.post('/bookmarks/', json={
        'url': f'https://example.com/{uuid4().hex[:8]}',
        'title': 'BM with Links',
        'relationships': [
            {'target_type': 'note', 'target_id': note['id']},
        ],
    })
    assert response.status_code == 201
    data = response.json()
    assert len(data['relationships']) == 1


@pytest.mark.asyncio
async def test__api_update_bookmark_with_relationships(client: AsyncClient) -> None:
    """PUT /bookmarks/{id} with relationships syncs them."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    response = await client.patch(f'/bookmarks/{bm["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note['id']},
        ],
    })
    assert response.status_code == 200
    data = response.json()
    assert len(data['relationships']) == 1

    # Remove all
    response = await client.patch(f'/bookmarks/{bm["id"]}', json={
        'relationships': [],
    })
    assert response.status_code == 200
    data = response.json()
    assert len(data['relationships']) == 0


@pytest.mark.asyncio
async def test__api_update_bookmark_relationships_none__no_change(client: AsyncClient) -> None:
    """PUT /bookmarks/{id} with relationships omitted (None) leaves them unchanged."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    # Add a relationship
    await client.patch(f'/bookmarks/{bm["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note['id']},
        ],
    })

    # Update title only (relationships not in payload = None)
    response = await client.patch(f'/bookmarks/{bm["id"]}', json={
        'title': 'New Title',
    })
    assert response.status_code == 200
    data = response.json()
    assert len(data['relationships']) == 1  # Still there


@pytest.mark.asyncio
async def test__api_create_note_with_relationships(client: AsyncClient) -> None:
    """POST /notes/ with relationships creates them."""
    bm = await _create_bookmark(client)

    response = await client.post('/notes/', json={
        'title': 'Note with Link',
        'relationships': [
            {'target_type': 'bookmark', 'target_id': bm['id']},
        ],
    })
    assert response.status_code == 201
    data = response.json()
    assert len(data['relationships']) == 1


@pytest.mark.asyncio
async def test__api_create_prompt_with_relationships(client: AsyncClient) -> None:
    """POST /prompts/ with relationships creates them."""
    note = await _create_note(client)

    response = await client.post('/prompts/', json={
        'name': f'test-rel-{uuid4().hex[:8]}',
        'title': 'Prompt with Link',
        'content': 'Test content',
        'relationships': [
            {'target_type': 'note', 'target_id': note['id']},
        ],
    })
    assert response.status_code == 201
    data = response.json()
    assert len(data['relationships']) == 1


# =============================================================================
# History restore with relationships
# =============================================================================


@pytest.mark.asyncio
async def test__api_restore_version__restores_relationships(client: AsyncClient) -> None:
    """Restoring to a version restores the relationship set from that point."""
    note = await _create_note(client)
    prompt = await _create_prompt(client)

    # Create bookmark with note link
    bm_resp = await client.post('/bookmarks/', json={
        'url': f'https://example.com/{uuid4().hex[:8]}',
        'title': 'BM',
        'content': 'v1 content',
        'relationships': [
            {'target_type': 'note', 'target_id': note['id']},
        ],
    })
    assert bm_resp.status_code == 201
    bm = bm_resp.json()

    # Update: change to prompt link
    update_resp = await client.patch(f'/bookmarks/{bm["id"]}', json={
        'content': 'v2 content',
        'relationships': [
            {'target_type': 'prompt', 'target_id': prompt['id']},
        ],
    })
    assert update_resp.status_code == 200
    assert len(update_resp.json()['relationships']) == 1

    # Restore to version 1 (should restore note link)
    restore_resp = await client.post(f'/history/bookmark/{bm["id"]}/restore/1')
    assert restore_resp.status_code == 200

    # Fetch bookmark and verify relationships restored
    get_resp = await client.get(f'/bookmarks/{bm["id"]}')
    data = get_resp.json()

    # Should have the note relationship back (from v1)
    rel_types = set()
    for rel in data['relationships']:
        if rel['source_type'] == 'note' or rel['target_type'] == 'note':
            rel_types.add('note')
        if rel['source_type'] == 'prompt' or rel['target_type'] == 'prompt':
            rel_types.add('prompt')
    assert 'note' in rel_types
    # prompt link should be gone (wasn't in v1)


@pytest.mark.asyncio
async def test__api_restore_version__handles_deleted_targets(client: AsyncClient) -> None:
    """Restoring relationships when a target has been permanently deleted succeeds, skipping missing targets."""
    note1 = await _create_note(client, title="Keep Note")
    note2 = await _create_note(client, title="Will Delete")

    # Create bookmark with both notes linked
    bm_resp = await client.post('/bookmarks/', json={
        'url': f'https://example.com/{uuid4().hex[:8]}',
        'title': 'BM',
        'content': 'v1',
        'relationships': [
            {'target_type': 'note', 'target_id': note1['id']},
            {'target_type': 'note', 'target_id': note2['id']},
        ],
    })
    bm = bm_resp.json()

    # Update bookmark (new version)
    await client.patch(f'/bookmarks/{bm["id"]}', json={
        'content': 'v2',
        'relationships': [],
    })

    # Permanently delete note2
    await client.delete(f'/notes/{note2["id"]}')
    await client.delete(f'/notes/{note2["id"]}', params={'permanent': 'true'})

    # Restore to version 1 — note2 is gone, should succeed with note1 only
    restore_resp = await client.post(f'/history/bookmark/{bm["id"]}/restore/1')
    assert restore_resp.status_code == 200

    # Verify note1 link is restored, note2 is skipped
    get_resp = await client.get(f'/bookmarks/{bm["id"]}')
    data = get_resp.json()
    assert len(data['relationships']) >= 1
    # note1 should be in relationships
    rel_target_ids = set()
    for rel in data['relationships']:
        if rel['source_type'] == 'note':
            rel_target_ids.add(rel['source_id'])
        elif rel['target_type'] == 'note':
            rel_target_ids.add(rel['target_id'])
    assert note1['id'] in rel_target_ids



# =============================================================================
# Relationship limit enforcement
# =============================================================================


@pytest.mark.asyncio
async def test__api_create_relationship__enforces_limit(
    client: AsyncClient,
) -> None:
    """Creating relationships beyond the per-entity limit returns 402."""
    bm = await _create_bookmark(client)
    notes = [await _create_note(client, title=f'Note {i}') for i in range(4)]

    # Patch only the relationship limit (keep all other limits at production values)
    patched_limits = TIER_LIMITS[Tier.FREE].__class__(
        **{**vars(TIER_LIMITS[Tier.FREE]), 'max_relationships_per_entity': 3},
    )
    with patch.dict("core.tier_limits.TIER_LIMITS", {Tier.FREE: patched_limits, Tier.STANDARD: patched_limits, Tier.PRO: patched_limits, Tier.DEV: patched_limits}):
        # Create relationships up to the limit of 3
        for i in range(3):
            resp = await client.post('/relationships/', json={
                'source_type': 'bookmark',
                'source_id': bm['id'],
                'target_type': 'note',
                'target_id': notes[i]['id'],
                'relationship_type': 'related',
            })
            assert resp.status_code == 201

        # 4th should fail
        resp = await client.post('/relationships/', json={
            'source_type': 'bookmark',
            'source_id': bm['id'],
            'target_type': 'note',
            'target_id': notes[3]['id'],
            'relationship_type': 'related',
        })
        assert resp.status_code == 402
        assert resp.json()['error_code'] == 'QUOTA_EXCEEDED'


# =============================================================================
# Milestone 1: Target entity history recording
# =============================================================================


@pytest.mark.asyncio
async def test__api_create_relationship__records_history_on_target(
    client: AsyncClient,
) -> None:
    """POST /relationships/ records a history entry on the target entity."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Check history on the target entity (note)
    response = await client.get(f'/history/note/{note["id"]}')
    assert response.status_code == 200
    data = response.json()

    # Should have CREATE (from note creation) + UPDATE (from relationship creation)
    assert data['total'] >= 2
    actions = [item['action'] for item in data['items']]
    assert 'update' in actions

    update_entry = next(item for item in data['items'] if item['action'] == 'update')
    assert update_entry['changed_fields'] == ['relationships']


@pytest.mark.asyncio
async def test__api_delete_relationship__records_history_on_target(
    client: AsyncClient,
) -> None:
    """DELETE /relationships/{id} records a history entry on the target entity."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    response = await client.delete(f'/relationships/{rel["id"]}')
    assert response.status_code == 204

    # Check history on the target entity (note)
    response = await client.get(f'/history/note/{note["id"]}')
    assert response.status_code == 200
    data = response.json()

    # Should have CREATE + UPDATE (add rel) + UPDATE (remove rel)
    update_entries = [item for item in data['items'] if item['action'] == 'update']
    assert len(update_entries) >= 2


@pytest.mark.asyncio
async def test__api_update_relationship__records_history_on_target(
    client: AsyncClient,
) -> None:
    """PATCH /relationships/{id} records a history entry on the target entity."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Get history count on target before update
    response = await client.get(f'/history/note/{note["id"]}')
    count_before = response.json()['total']

    # Update description
    response = await client.patch(
        f'/relationships/{rel["id"]}',
        json={'description': 'New description'},
    )
    assert response.status_code == 200

    # Check history on target — should have one more entry
    response = await client.get(f'/history/note/{note["id"]}')
    data = response.json()
    assert data['total'] == count_before + 1

    newest = data['items'][0]
    assert newest['changed_fields'] == ['relationships']


# =============================================================================
# Milestone 1: updated_at bumps on both entities
# =============================================================================


@pytest.mark.asyncio
async def test__api_create_relationship__bumps_updated_at_on_both(
    client: AsyncClient,
) -> None:
    """POST /relationships/ bumps updated_at on both source and target entities."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    bm_before = bm['updated_at']
    note_before = note['updated_at']

    await asyncio.sleep(0.01)

    await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Fetch both entities and check updated_at
    bm_resp = await client.get(f'/bookmarks/{bm["id"]}')
    note_resp = await client.get(f'/notes/{note["id"]}')

    assert bm_resp.json()['updated_at'] > bm_before
    assert note_resp.json()['updated_at'] > note_before


@pytest.mark.asyncio
async def test__api_delete_relationship__bumps_updated_at_on_both(
    client: AsyncClient,
) -> None:
    """DELETE /relationships/{id} bumps updated_at on both entities."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    # Re-fetch to get updated_at after relationship creation
    bm_after_create = (await client.get(f'/bookmarks/{bm["id"]}')).json()['updated_at']
    note_after_create = (await client.get(f'/notes/{note["id"]}')).json()['updated_at']

    await asyncio.sleep(0.01)

    response = await client.delete(f'/relationships/{rel["id"]}')
    assert response.status_code == 204

    bm_resp = await client.get(f'/bookmarks/{bm["id"]}')
    note_resp = await client.get(f'/notes/{note["id"]}')

    assert bm_resp.json()['updated_at'] > bm_after_create
    assert note_resp.json()['updated_at'] > note_after_create


@pytest.mark.asyncio
async def test__api_update_relationship__bumps_updated_at_on_both(
    client: AsyncClient,
) -> None:
    """PATCH /relationships/{id} bumps updated_at on both entities when description changes."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    bm_after_create = (await client.get(f'/bookmarks/{bm["id"]}')).json()['updated_at']
    note_after_create = (await client.get(f'/notes/{note["id"]}')).json()['updated_at']

    await asyncio.sleep(0.01)

    response = await client.patch(
        f'/relationships/{rel["id"]}',
        json={'description': 'Changed'},
    )
    assert response.status_code == 200

    bm_resp = await client.get(f'/bookmarks/{bm["id"]}')
    note_resp = await client.get(f'/notes/{note["id"]}')

    assert bm_resp.json()['updated_at'] > bm_after_create
    assert note_resp.json()['updated_at'] > note_after_create


# =============================================================================
# Milestone 1: Prompt entity coverage
# =============================================================================


@pytest.mark.asyncio
async def test__api_create_relationship__bumps_updated_at_on_prompt(
    client: AsyncClient,
) -> None:
    """POST /relationships/ bumps updated_at on a prompt entity."""
    note = await _create_note(client)
    prompt = await _create_prompt(client)

    prompt_before = prompt['updated_at']

    await asyncio.sleep(0.01)

    await _create_relationship(client, 'note', note['id'], 'prompt', prompt['id'])

    prompt_resp = await client.get(f'/prompts/{prompt["id"]}')
    assert prompt_resp.json()['updated_at'] > prompt_before


# =============================================================================
# Milestone 1: No-op gating
# =============================================================================


@pytest.mark.asyncio
async def test__api_update_relationship__empty_body_does_not_bump_updated_at(
    client: AsyncClient,
) -> None:
    """Empty PATCH body doesn't create history or bump updated_at."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    rel = await _create_relationship(client, 'bookmark', bm['id'], 'note', note['id'])

    bm_after = (await client.get(f'/bookmarks/{bm["id"]}')).json()['updated_at']
    note_after = (await client.get(f'/notes/{note["id"]}')).json()['updated_at']

    # Get history counts
    bm_history = (await client.get(f'/history/bookmark/{bm["id"]}')).json()['total']
    note_history = (await client.get(f'/history/note/{note["id"]}')).json()['total']

    # Send empty PATCH body
    response = await client.patch(f'/relationships/{rel["id"]}', json={})
    assert response.status_code == 200

    # updated_at should not change
    assert (await client.get(f'/bookmarks/{bm["id"]}')).json()['updated_at'] == bm_after
    assert (await client.get(f'/notes/{note["id"]}')).json()['updated_at'] == note_after

    # History counts should not change
    assert (await client.get(f'/history/bookmark/{bm["id"]}')).json()['total'] == bm_history
    assert (await client.get(f'/history/note/{note["id"]}')).json()['total'] == note_history


@pytest.mark.asyncio
async def test__api_update_relationship__same_description_does_not_bump_updated_at(
    client: AsyncClient,
) -> None:
    """PATCH with same description value produces no history entry and no updated_at bump."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    rel = await _create_relationship(
        client, 'bookmark', bm['id'], 'note', note['id'], description='Same',
    )

    bm_after = (await client.get(f'/bookmarks/{bm["id"]}')).json()['updated_at']
    note_after = (await client.get(f'/notes/{note["id"]}')).json()['updated_at']

    bm_history = (await client.get(f'/history/bookmark/{bm["id"]}')).json()['total']
    note_history = (await client.get(f'/history/note/{note["id"]}')).json()['total']

    # Send PATCH with same description
    response = await client.patch(
        f'/relationships/{rel["id"]}',
        json={'description': 'Same'},
    )
    assert response.status_code == 200

    # updated_at should not change
    assert (await client.get(f'/bookmarks/{bm["id"]}')).json()['updated_at'] == bm_after
    assert (await client.get(f'/notes/{note["id"]}')).json()['updated_at'] == note_after

    # History counts should not change
    assert (await client.get(f'/history/bookmark/{bm["id"]}')).json()['total'] == bm_history
    assert (await client.get(f'/history/note/{note["id"]}')).json()['total'] == note_history


# =============================================================================
# Milestone 1: HTTP cache regression
# =============================================================================


@pytest.mark.asyncio
async def test__api_create_relationship__invalidates_http_cache(
    client: AsyncClient,
) -> None:
    """GET /notes/{id}/metadata returns 200 (not 304) after a relationship is created."""
    note = await _create_note(client)

    # Get Last-Modified from the metadata endpoint (consistent with test_http_cache.py)
    response = await client.get(f'/notes/{note["id"]}/metadata')
    assert response.status_code == 200
    last_modified = response.headers['last-modified']

    # Verify we get 304 (note hasn't changed)
    response = await client.get(
        f'/notes/{note["id"]}/metadata',
        headers={'If-Modified-Since': last_modified},
    )
    assert response.status_code == 304

    # Wait >1s to ensure the relationship creation bumps updated_at past the
    # second boundary (check_not_modified compares at second precision)
    await asyncio.sleep(1.1)

    # Create a relationship — this bumps note's updated_at to now
    bm = await _create_bookmark(client)
    await _create_relationship(client, 'note', note['id'], 'bookmark', bm['id'])

    # Now should get 200 because updated_at was bumped past our If-Modified-Since
    response = await client.get(
        f'/notes/{note["id"]}/metadata',
        headers={'If-Modified-Since': last_modified},
    )
    assert response.status_code == 200


# =============================================================================
# Milestone 2: Target updated_at bump via inline sync
# =============================================================================


@pytest.mark.asyncio
async def test__api_update_note_with_relationships__bumps_target_updated_at(
    client: AsyncClient,
) -> None:
    """PATCH /notes/{id} with a new relationship bumps the target entity's updated_at."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    note_b_before = note_b['updated_at']

    await asyncio.sleep(0.01)

    # Update Note A to add a relationship to Note B
    response = await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note_b['id'], 'relationship_type': 'related'},
        ],
    })
    assert response.status_code == 200

    note_b_after = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']
    assert note_b_after > note_b_before


@pytest.mark.asyncio
async def test__api_update_note_remove_relationship__bumps_target_updated_at(
    client: AsyncClient,
) -> None:
    """Removing a relationship via inline sync bumps the target's updated_at."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    # Add relationship via inline sync
    await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note_b['id'], 'relationship_type': 'related'},
        ],
    })

    note_b_after_add = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']

    await asyncio.sleep(0.01)

    # Remove relationship by setting to empty list
    response = await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [],
    })
    assert response.status_code == 200

    note_b_after_remove = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']
    assert note_b_after_remove > note_b_after_add


@pytest.mark.asyncio
async def test__api_update_bookmark_with_relationships__bumps_target_updated_at(
    client: AsyncClient,
) -> None:
    """PATCH /bookmarks/{id} with a new relationship bumps the target's updated_at."""
    bm = await _create_bookmark(client)
    note = await _create_note(client)

    note_before = note['updated_at']

    await asyncio.sleep(0.01)

    response = await client.patch(f'/bookmarks/{bm["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note['id'], 'relationship_type': 'related'},
        ],
    })
    assert response.status_code == 200

    note_after = (await client.get(f'/notes/{note["id"]}')).json()['updated_at']
    assert note_after > note_before


# =============================================================================
# Milestone 2: Target history via inline sync
# =============================================================================


@pytest.mark.asyncio
async def test__api_update_note_with_relationships__records_history_on_target(
    client: AsyncClient,
) -> None:
    """PATCH /notes/{id} with a new relationship records history on the target."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    history_before = (await client.get(f'/history/note/{note_b["id"]}')).json()['total']

    await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note_b['id'], 'relationship_type': 'related'},
        ],
    })

    history_resp = await client.get(f'/history/note/{note_b["id"]}')
    history_after = history_resp.json()['total']
    assert history_after == history_before + 1

    # Verify the history entry has changed_fields=["relationships"]
    latest = history_resp.json()['items'][0]
    assert latest['changed_fields'] == ['relationships']


@pytest.mark.asyncio
async def test__api_update_note_remove_relationship__records_history_on_target(
    client: AsyncClient,
) -> None:
    """Removing a relationship via inline sync records history on the target."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    # Add relationship
    await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note_b['id'], 'relationship_type': 'related'},
        ],
    })

    history_before = (await client.get(f'/history/note/{note_b["id"]}')).json()['total']

    # Remove relationship
    await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [],
    })

    history_after = (await client.get(f'/history/note/{note_b["id"]}')).json()['total']
    assert history_after == history_before + 1


# =============================================================================
# Milestone 2: No-op sync doesn't bump
# =============================================================================


@pytest.mark.asyncio
async def test__api_update_note_with_same_relationships__does_not_bump_target(
    client: AsyncClient,
) -> None:
    """Re-sending the same relationship set doesn't bump target updated_at or record history."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    # Add relationship
    await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note_b['id'], 'relationship_type': 'related'},
        ],
    })

    note_b_after_add = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']
    history_after_add = (await client.get(f'/history/note/{note_b["id"]}')).json()['total']

    # Re-send the same relationships
    await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note_b['id'], 'relationship_type': 'related'},
        ],
    })

    note_b_after_resend = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']
    history_after_resend = (await client.get(f'/history/note/{note_b["id"]}')).json()['total']

    assert note_b_after_resend == note_b_after_add
    assert history_after_resend == history_after_add


# =============================================================================
# Milestone 2: Restore bumps target
# =============================================================================


@pytest.mark.asyncio
async def test__api_restore_version__bumps_target_updated_at_on_relationship_change(
    client: AsyncClient,
) -> None:
    """Restoring to a version that changes relationships bumps target updated_at."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    # Version 1: Note A created (no relationships)
    # Update Note A to add relationship to Note B (creates version 2)
    await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note_b['id'], 'relationship_type': 'related'},
        ],
    })

    note_b_after_add = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']

    await asyncio.sleep(0.01)

    # Restore to version 1 (no relationships) — should remove the relationship
    restore_resp = await client.post(f'/history/note/{note_a["id"]}/restore/1')
    assert restore_resp.status_code == 200

    note_b_after_restore = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']
    assert note_b_after_restore > note_b_after_add


@pytest.mark.asyncio
async def test__api_restore_version__records_history_on_target_for_relationship_change(
    client: AsyncClient,
) -> None:
    """Restoring to a version that removes a relationship records history on the target."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    # Add relationship via update
    await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note_b['id'], 'relationship_type': 'related'},
        ],
    })

    history_before = (await client.get(f'/history/note/{note_b["id"]}')).json()['total']

    # Restore to version 1 (no relationships)
    restore_resp = await client.post(f'/history/note/{note_a["id"]}/restore/1')
    assert restore_resp.status_code == 200

    history_after = (await client.get(f'/history/note/{note_b["id"]}')).json()['total']
    assert history_after == history_before + 1


# =============================================================================
# Milestone 2: HTTP cache regression for inline path
# =============================================================================


@pytest.mark.asyncio
async def test__api_update_note_with_relationships__invalidates_target_http_cache(
    client: AsyncClient,
) -> None:
    """GET /notes/{target_id}/metadata returns 200 (not 304) after inline relationship add."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    # Get Last-Modified for Note B
    response = await client.get(f'/notes/{note_b["id"]}/metadata')
    assert response.status_code == 200
    last_modified = response.headers['last-modified']

    # Verify 304
    response = await client.get(
        f'/notes/{note_b["id"]}/metadata',
        headers={'If-Modified-Since': last_modified},
    )
    assert response.status_code == 304

    # Wait >1s for second-precision boundary
    await asyncio.sleep(1.1)

    # Add relationship to Note B via updating Note A
    await client.patch(f'/notes/{note_a["id"]}', json={
        'relationships': [
            {'target_type': 'note', 'target_id': note_b['id'], 'relationship_type': 'related'},
        ],
    })

    # Should get 200 now
    response = await client.get(
        f'/notes/{note_b["id"]}/metadata',
        headers={'If-Modified-Since': last_modified},
    )
    assert response.status_code == 200


# =============================================================================
# Milestone 3: Permanent delete cascade
# =============================================================================


@pytest.mark.asyncio
async def test__api_permanent_delete__bumps_related_entity_updated_at(
    client: AsyncClient,
) -> None:
    """Permanently deleting an entity bumps updated_at on surviving related entities."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    # Create relationship
    await _create_relationship(client, 'note', note_a['id'], 'note', note_b['id'])

    # Record Note B's updated_at
    note_b_before = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']

    await asyncio.sleep(0.01)

    # Soft-delete then permanent-delete Note A
    resp = await client.delete(f'/notes/{note_a["id"]}')
    assert resp.status_code == 204
    resp = await client.delete(f'/notes/{note_a["id"]}', params={'permanent': 'true'})
    assert resp.status_code == 204

    # Note B's updated_at should have increased
    note_b_after = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']
    assert note_b_after > note_b_before


@pytest.mark.asyncio
async def test__api_permanent_delete__does_not_record_history_on_related_entity(
    client: AsyncClient,
) -> None:
    """Permanently deleting an entity does NOT create history on surviving related entities."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    # Create relationship
    await _create_relationship(client, 'note', note_a['id'], 'note', note_b['id'])

    history_before = (await client.get(f'/history/note/{note_b["id"]}')).json()['total']

    # Soft-delete then permanent-delete Note A
    resp = await client.delete(f'/notes/{note_a["id"]}')
    assert resp.status_code == 204
    resp = await client.delete(f'/notes/{note_a["id"]}', params={'permanent': 'true'})
    assert resp.status_code == 204

    history_after = (await client.get(f'/history/note/{note_b["id"]}')).json()['total']
    assert history_after == history_before


@pytest.mark.asyncio
async def test__api_permanent_delete__invalidates_related_entity_http_cache(
    client: AsyncClient,
) -> None:
    """GET /notes/{id}/metadata returns 200 (not 304) after related entity is permanently deleted."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')

    # Create relationship
    await _create_relationship(client, 'note', note_a['id'], 'note', note_b['id'])

    # Get Last-Modified for Note B
    response = await client.get(f'/notes/{note_b["id"]}/metadata')
    assert response.status_code == 200
    last_modified = response.headers['last-modified']

    # Verify 304
    response = await client.get(
        f'/notes/{note_b["id"]}/metadata',
        headers={'If-Modified-Since': last_modified},
    )
    assert response.status_code == 304

    # Wait >1s for second-precision boundary
    await asyncio.sleep(1.1)

    # Soft-delete then permanent-delete Note A
    resp = await client.delete(f'/notes/{note_a["id"]}')
    assert resp.status_code == 204
    resp = await client.delete(f'/notes/{note_a["id"]}', params={'permanent': 'true'})
    assert resp.status_code == 204

    # Should get 200 now
    response = await client.get(
        f'/notes/{note_b["id"]}/metadata',
        headers={'If-Modified-Since': last_modified},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test__api_permanent_delete__bumps_all_related_entities(
    client: AsyncClient,
) -> None:
    """Permanently deleting an entity bumps updated_at on ALL surviving related entities."""
    note_a = await _create_note(client, title='Note A')
    note_b = await _create_note(client, title='Note B')
    bookmark_c = await _create_bookmark(client, title='Bookmark C')

    # Create relationships: A -> B and A -> C
    await _create_relationship(client, 'note', note_a['id'], 'note', note_b['id'])
    await _create_relationship(client, 'note', note_a['id'], 'bookmark', bookmark_c['id'])

    # Record timestamps
    note_b_before = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']
    bookmark_c_before = (await client.get(f'/bookmarks/{bookmark_c["id"]}')).json()['updated_at']

    await asyncio.sleep(0.01)

    # Soft-delete then permanent-delete Note A
    resp = await client.delete(f'/notes/{note_a["id"]}')
    assert resp.status_code == 204
    resp = await client.delete(f'/notes/{note_a["id"]}', params={'permanent': 'true'})
    assert resp.status_code == 204

    # Both should have bumped
    note_b_after = (await client.get(f'/notes/{note_b["id"]}')).json()['updated_at']
    bookmark_c_after = (await client.get(f'/bookmarks/{bookmark_c["id"]}')).json()['updated_at']
    assert note_b_after > note_b_before
    assert bookmark_c_after > bookmark_c_before
