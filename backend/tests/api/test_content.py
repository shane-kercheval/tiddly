"""Tests for unified content API endpoints."""
from httpx import AsyncClient


async def test__list_all_content__returns_both_bookmarks_and_notes(
    client: AsyncClient,
) -> None:
    """Test that GET /content returns both bookmarks and notes."""
    # Create a bookmark
    await client.post(
        '/bookmarks/',
        json={'url': 'https://example.com', 'title': 'Example Bookmark'},
    )

    # Create a note
    await client.post(
        '/notes/',
        json={'title': 'Example Note'},
    )

    # List all content
    response = await client.get('/content/')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 2
    assert len(data['items']) == 2

    types = {item['type'] for item in data['items']}
    assert types == {'bookmark', 'note'}


async def test__list_all_content__returns_empty_for_new_user(
    client: AsyncClient,
) -> None:
    """Test that GET /content returns empty for user with no content."""
    response = await client.get('/content/')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 0
    assert data['items'] == []
    assert data['has_more'] is False


async def test__list_all_content__has_correct_type_fields(
    client: AsyncClient,
) -> None:
    """Test that items have correct type-specific fields."""
    # Create bookmark
    await client.post(
        '/bookmarks/',
        json={'url': 'https://test.com', 'title': 'Bookmark'},
    )

    # Create note
    await client.post(
        '/notes/',
        json={'title': 'Note'},
    )

    response = await client.get('/content/')
    data = response.json()

    bookmark_item = next(item for item in data['items'] if item['type'] == 'bookmark')
    note_item = next(item for item in data['items'] if item['type'] == 'note')

    # Bookmark has url, note does not
    assert bookmark_item['url'] == 'https://test.com/'
    assert note_item['url'] is None


async def test__list_all_content__view_active_excludes_deleted(
    client: AsyncClient,
) -> None:
    """Test that view=active excludes deleted content."""
    # Create content
    await client.post(
        '/bookmarks/',
        json={'url': 'https://active.com', 'title': 'Active Bookmark'},
    )
    note_response = await client.post(
        '/notes/',
        json={'title': 'Deleted Note'},
    )

    # Delete the note
    note_id = note_response.json()['id']
    await client.delete(f'/notes/{note_id}')

    # List active content
    response = await client.get('/content/?view=active')
    data = response.json()

    assert data['total'] == 1
    assert data['items'][0]['type'] == 'bookmark'


async def test__list_all_content__view_archived_returns_only_archived(
    client: AsyncClient,
) -> None:
    """Test that view=archived returns only archived content."""
    # Create content
    bookmark_response = await client.post(
        '/bookmarks/',
        json={'url': 'https://archived.com', 'title': 'Archived Bookmark'},
    )
    await client.post(
        '/notes/',
        json={'title': 'Active Note'},
    )

    # Archive the bookmark
    bookmark_id = bookmark_response.json()['id']
    await client.post(f'/bookmarks/{bookmark_id}/archive')

    # List archived content
    response = await client.get('/content/?view=archived')
    data = response.json()

    assert data['total'] == 1
    assert data['items'][0]['type'] == 'bookmark'
    assert data['items'][0]['title'] == 'Archived Bookmark'


async def test__list_all_content__view_deleted_returns_all_deleted(
    client: AsyncClient,
) -> None:
    """Test that view=deleted returns all deleted content."""
    # Create content
    bookmark_response = await client.post(
        '/bookmarks/',
        json={'url': 'https://deleted.com', 'title': 'Deleted Bookmark'},
    )
    note_response = await client.post(
        '/notes/',
        json={'title': 'Deleted Note'},
    )
    await client.post(
        '/notes/',
        json={'title': 'Active Note'},
    )

    # Delete bookmark and note
    bookmark_id = bookmark_response.json()['id']
    note_id = note_response.json()['id']
    await client.delete(f'/bookmarks/{bookmark_id}')
    await client.delete(f'/notes/{note_id}')

    # List deleted content
    response = await client.get('/content/?view=deleted')
    data = response.json()

    assert data['total'] == 2
    types = {item['type'] for item in data['items']}
    assert types == {'bookmark', 'note'}


async def test__list_all_content__multi_view_active_archived(
    client: AsyncClient,
) -> None:
    """Test multi-value view=active&view=archived returns both, excludes deleted."""
    await client.post('/bookmarks/', json={'url': 'https://a.com', 'title': 'Active BM'})
    note_resp = await client.post('/notes/', json={'title': 'Archived Note'})
    note_id = note_resp.json()['id']
    await client.post(f'/notes/{note_id}/archive')

    del_resp = await client.post('/notes/', json={'title': 'Deleted Note'})
    del_id = del_resp.json()['id']
    await client.delete(f'/notes/{del_id}')

    response = await client.get('/content/?view=active&view=archived')
    data = response.json()

    assert data['total'] == 2
    titles = {item['title'] for item in data['items']}
    assert titles == {'Active BM', 'Archived Note'}


async def test__list_all_content__multi_view_relevance_ranking(
    client: AsyncClient,
) -> None:
    """Active items rank above archived with same content when view=active&view=archived."""
    await client.post('/bookmarks/', json={'url': 'https://a.com', 'title': 'Ranking Test Query'})
    arch_resp = await client.post(
        '/bookmarks/', json={'url': 'https://b.com', 'title': 'Ranking Test Query'},
    )
    arch_id = arch_resp.json()['id']
    await client.post(f'/bookmarks/{arch_id}/archive')

    response = await client.get(
        '/content/?q=Ranking+Test+Query&view=active&view=archived&sort_by=relevance',
    )
    data = response.json()

    assert data['total'] == 2
    # Active should rank first
    assert data['items'][0]['archived_at'] is None
    assert data['items'][1]['archived_at'] is not None


async def test__list_all_content__single_view_still_works(
    client: AsyncClient,
) -> None:
    """Single view=active still works (backward compatible)."""
    await client.post('/bookmarks/', json={'url': 'https://a.com', 'title': 'Single View'})

    response = await client.get('/content/?view=active')
    data = response.json()

    assert data['total'] == 1
    assert data['items'][0]['title'] == 'Single View'


async def test__list_all_content__text_search_finds_across_types(
    client: AsyncClient,
) -> None:
    """Test that text search finds matches in both bookmarks and notes."""
    # Create content with different titles
    await client.post(
        '/bookmarks/',
        json={'url': 'https://python.com', 'title': 'Python Guide'},
    )
    await client.post(
        '/notes/',
        json={'title': 'Python Tutorial'},
    )
    await client.post(
        '/notes/',
        json={'title': 'JavaScript Guide'},
    )

    # Search for "python"
    response = await client.get('/content/?q=python')
    data = response.json()

    assert data['total'] == 2
    titles = {item['title'] for item in data['items']}
    assert titles == {'Python Guide', 'Python Tutorial'}


async def test__list_all_content__tag_filter_works(
    client: AsyncClient,
) -> None:
    """Test that tag filtering works across types."""
    # Create content with different tags
    await client.post(
        '/bookmarks/',
        json={'url': 'https://python.com', 'title': 'Python', 'tags': ['python']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Web', 'tags': ['web']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Java', 'tags': ['java']},
    )

    # Filter by python or web (ANY mode)
    response = await client.get('/content/?tags=python&tags=web&tag_match=any')
    data = response.json()

    assert data['total'] == 2
    titles = {item['title'] for item in data['items']}
    assert titles == {'Python', 'Web'}


async def test__list_all_content__includes_tags_in_response(
    client: AsyncClient,
) -> None:
    """Test that tags are included in the response items."""
    await client.post(
        '/bookmarks/',
        json={'url': 'https://test.com', 'title': 'Tagged Bookmark', 'tags': ['tag-a', 'tag-b']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Tagged Note', 'tags': ['tag-c']},
    )

    response = await client.get('/content/')
    data = response.json()

    bookmark_item = next(item for item in data['items'] if item['type'] == 'bookmark')
    note_item = next(item for item in data['items'] if item['type'] == 'note')

    assert set(bookmark_item['tags']) == {'tag-a', 'tag-b'}
    assert note_item['tags'] == ['tag-c']


async def test__list_all_content__sorting_works(
    client: AsyncClient,
) -> None:
    """Test that sorting works across types."""
    # Create content with different titles
    await client.post('/bookmarks/', json={'url': 'https://z.com', 'title': 'Zebra'})
    await client.post('/notes/', json={'title': 'Apple'})
    await client.post('/bookmarks/', json={'url': 'https://m.com', 'title': 'Mango'})

    # Sort by title ascending
    response = await client.get('/content/?sort_by=title&sort_order=asc')
    data = response.json()

    titles = [item['title'] for item in data['items']]
    assert titles == ['Apple', 'Mango', 'Zebra']


async def test__list_all_content__sort_by_title_case_insensitive(
    client: AsyncClient,
) -> None:
    """Test that title sorting is case-insensitive across all content types."""
    # Create mixed content types with varied casing
    await client.post('/notes/', json={'title': 'delta'})              # lowercase note
    await client.post('/bookmarks/', json={'url': 'https://a.com', 'title': 'Alpha'})  # capitalized bookmark
    await client.post('/prompts/', json={'name': 'gamma-prompt', 'content': 'test'})   # prompt with no title (uses name)
    await client.post('/notes/', json={'title': 'BETA'})               # uppercase note
    await client.post('/prompts/', json={'name': 'e-prompt', 'title': 'epsilon', 'content': 'test'})  # prompt with lowercase title

    response = await client.get('/content/?sort_by=title&sort_order=asc')
    data = response.json()

    # Verify case-insensitive order interleaves all content types correctly
    # Expected: Alpha < BETA < delta < epsilon < gamma-prompt
    items = data['items']
    assert len(items) == 5

    assert items[0]['title'] == 'Alpha'
    assert items[0]['type'] == 'bookmark'

    assert items[1]['title'] == 'BETA'
    assert items[1]['type'] == 'note'

    assert items[2]['title'] == 'delta'
    assert items[2]['type'] == 'note'

    assert items[3]['title'] == 'epsilon'
    assert items[3]['type'] == 'prompt'

    assert items[4]['name'] == 'gamma-prompt'  # Prompt without title, sorted by name
    assert items[4]['type'] == 'prompt'


async def test__list_all_content__pagination_works(
    client: AsyncClient,
) -> None:
    """Test that pagination works correctly."""
    # Create 5 items
    for i in range(3):
        await client.post('/bookmarks/', json={'url': f'https://test{i}.com', 'title': f'B{i}'})
    for i in range(2):
        await client.post('/notes/', json={'title': f'N{i}'})

    # Get first page
    response = await client.get('/content/?limit=2&offset=0')
    data = response.json()

    assert data['total'] == 5
    assert len(data['items']) == 2
    assert data['has_more'] is True

    # Get second page
    response = await client.get('/content/?limit=2&offset=2')
    data = response.json()

    assert data['total'] == 5
    assert len(data['items']) == 2
    assert data['has_more'] is True

    # Get last page
    response = await client.get('/content/?limit=2&offset=4')
    data = response.json()

    assert data['total'] == 5
    assert len(data['items']) == 1
    assert data['has_more'] is False


async def test__list_all_content__response_schema_is_correct(
    client: AsyncClient,
) -> None:
    """Test that response follows the expected schema."""
    await client.post('/bookmarks/', json={'url': 'https://test.com', 'title': 'Test'})

    response = await client.get('/content/')
    data = response.json()

    # Check top-level response fields
    assert 'items' in data
    assert 'total' in data
    assert 'offset' in data
    assert 'limit' in data
    assert 'has_more' in data

    # Check item fields
    item = data['items'][0]
    assert 'type' in item
    assert 'id' in item
    assert 'title' in item
    assert 'description' in item
    assert 'tags' in item
    assert 'created_at' in item
    assert 'updated_at' in item
    assert 'last_used_at' in item
    assert 'deleted_at' in item
    assert 'archived_at' in item
    assert 'url' in item


async def test__list_content__returns_length_and_preview(client: AsyncClient) -> None:
    """Test that unified content list returns content_length and content_preview."""
    bookmark_content = "H" * 1000
    note_content = "I" * 800

    await client.post(
        '/bookmarks/',
        json={'url': 'https://content-test.com', 'title': 'Bookmark', 'content': bookmark_content},
    )
    await client.post(
        '/notes/',
        json={'title': 'Note', 'content': note_content},
    )

    response = await client.get('/content/')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 2

    bookmark_item = next(item for item in data['items'] if item['type'] == 'bookmark')
    note_item = next(item for item in data['items'] if item['type'] == 'note')

    assert bookmark_item['content_length'] == 1000
    assert bookmark_item['content_preview'] == "H" * 500
    assert note_item['content_length'] == 800
    assert note_item['content_preview'] == "I" * 500


async def test__list_content__null_content__returns_null_metrics(
    client: AsyncClient,
) -> None:
    """Test that content list returns null metrics when content is null."""
    await client.post(
        '/bookmarks/',
        json={'url': 'https://no-content.com', 'title': 'No Content Bookmark'},
    )
    await client.post(
        '/notes/',
        json={'title': 'No Content Note'},
    )

    response = await client.get('/content/')
    assert response.status_code == 200

    for item in response.json()['items']:
        assert item['content_length'] is None
        assert item['content_preview'] is None


async def test__list_all_content__invalid_view_returns_422(
    client: AsyncClient,
) -> None:
    """Test that invalid view parameter returns 422."""
    response = await client.get('/content/?view=invalid')
    assert response.status_code == 422


async def test__list_all_content__invalid_sort_by_returns_422(
    client: AsyncClient,
) -> None:
    """Test that invalid sort_by parameter returns 422."""
    response = await client.get('/content/?sort_by=invalid')
    assert response.status_code == 422


async def test__list_all_content__limit_exceeds_max_is_capped(
    client: AsyncClient,
) -> None:
    """Test that limit parameter validation works."""
    # Limit > 100 should fail
    response = await client.get('/content/?limit=101')
    assert response.status_code == 422


async def test__list_all_content__negative_offset_returns_422(
    client: AsyncClient,
) -> None:
    """Test that negative offset parameter returns 422."""
    response = await client.get('/content/?offset=-1')
    assert response.status_code == 422


# =============================================================================
# List ID Filter Tests (ContentList integration)
# =============================================================================


async def test__list_content_with_filter_id__returns_matching_bookmarks_and_notes(
    client: AsyncClient,
) -> None:
    """Test filtering content by filter_id returns both types when list includes both."""
    # Create bookmark with 'work' tag
    await client.post(
        '/bookmarks/',
        json={'url': 'https://work.com', 'title': 'Work Bookmark', 'tags': ['work']},
    )
    # Create note with 'work' tag
    await client.post(
        '/notes/',
        json={'title': 'Work Note', 'tags': ['work']},
    )
    # Create bookmark without 'work' tag (should not match)
    await client.post(
        '/bookmarks/',
        json={'url': 'https://personal.com', 'title': 'Personal', 'tags': ['personal']},
    )

    # Create a list that includes both types with 'work' tag filter
    response = await client.post(
        '/filters/',
        json={
            'name': 'Work List',
            'content_types': ['bookmark', 'note'],
            'filter_expression': {'groups': [{'tags': ['work']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    # Filter content by filter_id
    response = await client.get(f'/content/?filter_id={filter_id}')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 2
    types = {item['type'] for item in data['items']}
    assert types == {'bookmark', 'note'}
    titles = {item['title'] for item in data['items']}
    assert titles == {'Work Bookmark', 'Work Note'}


async def test__list_content_with_filter_id__respects_content_types_bookmarks_only(
    client: AsyncClient,
) -> None:
    """Test that filter_id respects content_types and returns only bookmarks when specified."""
    # Create bookmark and note with same tag
    await client.post(
        '/bookmarks/',
        json={'url': 'https://work.com', 'title': 'Work Bookmark', 'tags': ['work']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Work Note', 'tags': ['work']},
    )

    # Create a list with only bookmark type
    response = await client.post(
        '/filters/',
        json={
            'name': 'Bookmarks Only',
            'content_types': ['bookmark'],
            'filter_expression': {'groups': [{'tags': ['work']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    # Filter content by filter_id
    response = await client.get(f'/content/?filter_id={filter_id}')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert data['items'][0]['type'] == 'bookmark'
    assert data['items'][0]['title'] == 'Work Bookmark'


async def test__list_content_with_filter_id__respects_content_types_notes_only(
    client: AsyncClient,
) -> None:
    """Test that filter_id respects content_types and returns only notes when specified."""
    # Create bookmark and note with same tag
    await client.post(
        '/bookmarks/',
        json={'url': 'https://work.com', 'title': 'Work Bookmark', 'tags': ['work']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Work Note', 'tags': ['work']},
    )

    # Create a list with only note type
    response = await client.post(
        '/filters/',
        json={
            'name': 'Notes Only',
            'content_types': ['note'],
            'filter_expression': {'groups': [{'tags': ['work']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    # Filter content by filter_id
    response = await client.get(f'/content/?filter_id={filter_id}')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert data['items'][0]['type'] == 'note'
    assert data['items'][0]['title'] == 'Work Note'


async def test__list_content_with_filter_id__filters_by_content_types_param(
    client: AsyncClient,
) -> None:
    """Test that filter_id respects the content_types query param within list types."""
    await client.post(
        '/bookmarks/',
        json={'url': 'https://work.com', 'title': 'Work Bookmark', 'tags': ['work']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Work Note', 'tags': ['work']},
    )

    response = await client.post(
        '/filters/',
        json={
            'name': 'Mixed Work',
            'content_types': ['bookmark', 'note'],
            'filter_expression': {'groups': [{'tags': ['work']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    response = await client.get(f'/content/?filter_id={filter_id}&content_types=note')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert data['items'][0]['type'] == 'note'
    assert data['items'][0]['title'] == 'Work Note'


async def test__list_content_with_filter_id__content_types_param_multiple(
    client: AsyncClient,
) -> None:
    """Test that multiple content_types params are honored within a mixed list."""
    await client.post(
        '/bookmarks/',
        json={'url': 'https://work.com', 'title': 'Work Bookmark', 'tags': ['work']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Work Note', 'tags': ['work']},
    )

    response = await client.post(
        '/filters/',
        json={
            'name': 'Mixed Work Multi',
            'content_types': ['bookmark', 'note'],
            'filter_expression': {'groups': [{'tags': ['work']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    response = await client.get(
        f'/content/?filter_id={filter_id}&content_types=bookmark&content_types=note',
    )
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 2
    types = {item['type'] for item in data['items']}
    assert types == {'bookmark', 'note'}


async def test__list_content_with_filter_id__content_types_param_matches_list(
    client: AsyncClient,
) -> None:
    """Test that matching content_types param still returns list content."""
    await client.post(
        '/bookmarks/',
        json={'url': 'https://work.com', 'title': 'Work Bookmark', 'tags': ['work']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Work Note', 'tags': ['work']},
    )

    response = await client.post(
        '/filters/',
        json={
            'name': 'Bookmarks Only Match',
            'content_types': ['bookmark'],
            'filter_expression': {'groups': [{'tags': ['work']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    response = await client.get(f'/content/?filter_id={filter_id}&content_types=bookmark')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert data['items'][0]['type'] == 'bookmark'
    assert data['items'][0]['title'] == 'Work Bookmark'


async def test__list_content_with_filter_id__not_found(
    client: AsyncClient,
) -> None:
    """Test that non-existent filter_id returns 404."""
    response = await client.get('/content/?filter_id=00000000-0000-0000-0000-000000000000')
    assert response.status_code == 404
    assert response.json()['detail'] == 'Filter not found'


async def test__list_content_with_filter_id__complex_filter_expression(
    client: AsyncClient,
) -> None:
    """Test complex filter: (work AND priority) OR (urgent)."""
    # Create content
    await client.post(
        '/bookmarks/',
        json={'url': 'https://wp.com', 'title': 'Work Priority', 'tags': ['work', 'priority']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Urgent Note', 'tags': ['urgent']},
    )
    await client.post(
        '/bookmarks/',
        json={'url': 'https://work.com', 'title': 'Just Work', 'tags': ['work']},
    )

    # Create list with complex filter
    response = await client.post(
        '/filters/',
        json={
            'name': 'Complex',
            'content_types': ['bookmark', 'note'],
            'filter_expression': {
                'groups': [
                    {'tags': ['work', 'priority']},
                    {'tags': ['urgent']},
                ],
                'group_operator': 'OR',
            },
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    response = await client.get(f'/content/?filter_id={filter_id}')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 2
    titles = {item['title'] for item in data['items']}
    assert titles == {'Work Priority', 'Urgent Note'}


async def test__list_content_with_filter_id__combines_with_text_search(
    client: AsyncClient,
) -> None:
    """Test combining filter_id filter with text search."""
    # Create content with 'work' tag
    await client.post(
        '/bookmarks/',
        json={'url': 'https://python.com', 'title': 'Python Work', 'tags': ['work']},
    )
    await client.post(
        '/notes/',
        json={'title': 'JavaScript Work', 'tags': ['work']},
    )

    # Create work list
    response = await client.post(
        '/filters/',
        json={
            'name': 'Work',
            'content_types': ['bookmark', 'note'],
            'filter_expression': {'groups': [{'tags': ['work']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    # Filter by list AND search for 'Python'
    response = await client.get(f'/content/?filter_id={filter_id}&q=python')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert data['items'][0]['title'] == 'Python Work'


async def test__list_content_with_filter_id__combines_with_tag_filter(
    client: AsyncClient,
) -> None:
    """Test that filter_id filter and tags parameter combine with AND logic."""
    # Create content
    await client.post(
        '/bookmarks/',
        json={'url': 'https://work.com', 'title': 'Work Only', 'tags': ['work']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Work Urgent', 'tags': ['work', 'urgent']},
    )

    # Create work list
    response = await client.post(
        '/filters/',
        json={
            'name': 'Work',
            'content_types': ['bookmark', 'note'],
            'filter_expression': {'groups': [{'tags': ['work']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    # Filter by list AND additional tag 'urgent'
    response = await client.get(f'/content/?filter_id={filter_id}&tags=urgent')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert data['items'][0]['title'] == 'Work Urgent'


async def test__list_content_with_filter_id__empty_results(
    client: AsyncClient,
) -> None:
    """Test filter_id filter with no matching content."""
    # Create content without 'work' tag
    await client.post(
        '/bookmarks/',
        json={'url': 'https://personal.com', 'title': 'Personal', 'tags': ['personal']},
    )

    # Create work list
    response = await client.post(
        '/filters/',
        json={
            'name': 'Work',
            'content_types': ['bookmark', 'note'],
            'filter_expression': {'groups': [{'tags': ['work']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    response = await client.get(f'/content/?filter_id={filter_id}')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 0
    assert data['items'] == []


async def test__list_all_content__content_types_param_filters_bookmarks_only(
    client: AsyncClient,
) -> None:
    """Test that content_types param filters to only bookmarks."""
    # Create a bookmark
    await client.post(
        '/bookmarks/',
        json={'url': 'https://example.com', 'title': 'Example Bookmark'},
    )
    # Create a note
    await client.post(
        '/notes/',
        json={'title': 'Example Note'},
    )

    # Filter by content_types=bookmark
    response = await client.get('/content/?content_types=bookmark')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert len(data['items']) == 1
    assert data['items'][0]['type'] == 'bookmark'
    assert data['items'][0]['title'] == 'Example Bookmark'


async def test__list_all_content__content_types_param_filters_notes_only(
    client: AsyncClient,
) -> None:
    """Test that content_types param filters to only notes."""
    # Create a bookmark
    await client.post(
        '/bookmarks/',
        json={'url': 'https://example.com', 'title': 'Example Bookmark'},
    )
    # Create a note
    await client.post(
        '/notes/',
        json={'title': 'Example Note'},
    )

    # Filter by content_types=note
    response = await client.get('/content/?content_types=note')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert len(data['items']) == 1
    assert data['items'][0]['type'] == 'note'
    assert data['items'][0]['title'] == 'Example Note'


async def test__list_all_content__content_types_param_accepts_multiple(
    client: AsyncClient,
) -> None:
    """Test that content_types param accepts both bookmark and note."""
    # Create a bookmark
    await client.post(
        '/bookmarks/',
        json={'url': 'https://example.com', 'title': 'Example Bookmark'},
    )
    # Create a note
    await client.post(
        '/notes/',
        json={'title': 'Example Note'},
    )

    # Filter by content_types=bookmark&content_types=note (both)
    response = await client.get('/content/?content_types=bookmark&content_types=note')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 2
    assert len(data['items']) == 2
    types = {item['type'] for item in data['items']}
    assert types == {'bookmark', 'note'}


async def test__list_all_content__content_types_param_with_search(
    client: AsyncClient,
) -> None:
    """Test that content_types param works with text search."""
    # Create content
    await client.post(
        '/bookmarks/',
        json={'url': 'https://python.org', 'title': 'Python Bookmark'},
    )
    await client.post(
        '/notes/',
        json={'title': 'Python Note'},
    )

    # Search for "Python" but only in bookmarks
    response = await client.get('/content/?q=python&content_types=bookmark')
    assert response.status_code == 200

    data = response.json()
    assert data['total'] == 1
    assert data['items'][0]['type'] == 'bookmark'
    assert data['items'][0]['title'] == 'Python Bookmark'


async def test__list_all_content__filter_id_content_types_intersects_query_param(
    client: AsyncClient,
) -> None:
    """
    Test that list's content_types intersects the content_types query param.

    When both filter_id and content_types query param are provided, the list's
    content_types act as the upper bound and the query param further filters.
    """
    # Create bookmark and note with same tag
    await client.post(
        '/bookmarks/',
        json={'url': 'https://example.com', 'title': 'Example Bookmark', 'tags': ['test']},
    )
    await client.post(
        '/notes/',
        json={'title': 'Example Note', 'tags': ['test']},
    )

    # Create a list that only includes bookmarks
    response = await client.post(
        '/filters/',
        json={
            'name': 'Bookmarks Only List',
            'content_types': ['bookmark'],
            'filter_expression': {'groups': [{'tags': ['test']}], 'group_operator': 'OR'},
        },
    )
    assert response.status_code == 201
    filter_id = response.json()['id']

    # Query with filter_id AND content_types=note
    # The list's content_types (bookmark) should intersect with query param (note)
    response = await client.get(f'/content/?filter_id={filter_id}&content_types=note')
    assert response.status_code == 200

    data = response.json()
    # Intersection is empty, so no items should be returned
    assert data['total'] == 0
    assert data['items'] == []


# =============================================================================
# Individual vs Unified Endpoint Equivalence
# =============================================================================


async def test__list_bookmarks__same_results_as_unified(
    client: AsyncClient,
) -> None:
    """GET /bookmarks/ returns the same items as GET /content/?content_types=bookmark."""
    await client.post('/bookmarks/', json={'url': 'https://test1.com', 'title': 'Test Bookmark 1'})
    await client.post('/bookmarks/', json={'url': 'https://test2.com', 'title': 'Test Bookmark 2'})
    await client.post('/notes/', json={'title': 'A Note'})

    bookmarks_resp = await client.get('/bookmarks/')
    content_resp = await client.get('/content/?content_types=bookmark')

    bookmark_ids = {item['id'] for item in bookmarks_resp.json()['items']}
    content_ids = {item['id'] for item in content_resp.json()['items']}

    assert bookmark_ids == content_ids
    assert bookmarks_resp.json()['total'] == content_resp.json()['total']


async def test__list_notes__same_results_as_unified(
    client: AsyncClient,
) -> None:
    """GET /notes/ returns the same items as GET /content/?content_types=note."""
    await client.post('/notes/', json={'title': 'Test Note 1'})
    await client.post('/notes/', json={'title': 'Test Note 2'})
    await client.post('/bookmarks/', json={'url': 'https://test.com'})

    notes_resp = await client.get('/notes/')
    content_resp = await client.get('/content/?content_types=note')

    note_ids = {item['id'] for item in notes_resp.json()['items']}
    content_ids = {item['id'] for item in content_resp.json()['items']}

    assert note_ids == content_ids
    assert notes_resp.json()['total'] == content_resp.json()['total']


async def test__list_prompts__same_results_as_unified(
    client: AsyncClient,
) -> None:
    """GET /prompts/ returns the same items as GET /content/?content_types=prompt."""
    await client.post('/prompts/', json={'name': 'test-prompt-1', 'content': 'Content 1'})
    await client.post('/prompts/', json={'name': 'test-prompt-2', 'content': 'Content 2'})
    await client.post('/notes/', json={'title': 'A Note'})

    prompts_resp = await client.get('/prompts/')
    content_resp = await client.get('/content/?content_types=prompt')

    prompt_ids = {item['id'] for item in prompts_resp.json()['items']}
    content_ids = {item['id'] for item in content_resp.json()['items']}

    assert prompt_ids == content_ids
    assert prompts_resp.json()['total'] == content_resp.json()['total']


async def test__list_bookmarks__search_same_results_as_unified(
    client: AsyncClient,
) -> None:
    """Text search through individual endpoint matches unified endpoint."""
    await client.post('/bookmarks/', json={'url': 'https://test.com', 'title': 'Searchable Test'})
    await client.post('/bookmarks/', json={'url': 'https://other.com', 'title': 'Other Bookmark'})
    await client.post('/notes/', json={'title': 'Searchable Test Note'})

    bookmarks_resp = await client.get('/bookmarks/?q=searchable')
    content_resp = await client.get('/content/?q=searchable&content_types=bookmark')

    bookmark_ids = {item['id'] for item in bookmarks_resp.json()['items']}
    content_ids = {item['id'] for item in content_resp.json()['items']}

    assert bookmark_ids == content_ids
