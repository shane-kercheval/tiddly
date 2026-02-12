"""Tests for relationship API endpoints."""
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

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
