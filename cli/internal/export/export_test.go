package export

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockFetcher implements ContentFetcher for tests.
type mockFetcher struct {
	pages      map[string][]api.ContentListResponse // keyed by content type
	items      map[string]map[string]any            // keyed by "type/id"
	getDelay   time.Duration                        // artificial delay per GetContent
	concurrent atomic.Int32                         // current in-flight GetContent calls
	maxSeen    atomic.Int32                         // peak concurrent GetContent calls
	getErr     error                                // if set, all GetContent calls return this
}

func newMockFetcher() *mockFetcher {
	return &mockFetcher{
		pages: make(map[string][]api.ContentListResponse),
		items: make(map[string]map[string]any),
	}
}

func (m *mockFetcher) addPage(contentType string, items []map[string]any, hasMore bool, total int) {
	m.pages[contentType] = append(m.pages[contentType], api.ContentListResponse{
		Items:   items,
		Total:   total,
		HasMore: hasMore,
	})
}

func (m *mockFetcher) addItem(contentType, id string, data map[string]any) {
	m.items[contentType+"/"+id] = data
}

func (m *mockFetcher) ListContent(_ context.Context, contentType string, offset, _ int, _ bool) (*api.ContentListResponse, error) {
	pages := m.pages[contentType]
	// Walk pages, accumulating item counts to find which page owns this offset.
	cumulative := 0
	for _, p := range pages {
		if offset == cumulative {
			return &p, nil
		}
		cumulative += len(p.Items)
	}
	return &api.ContentListResponse{}, nil
}

func (m *mockFetcher) GetContent(ctx context.Context, contentType, id string) (map[string]any, error) {
	cur := m.concurrent.Add(1)
	defer m.concurrent.Add(-1)

	// Track peak concurrency
	for {
		prev := m.maxSeen.Load()
		if cur <= prev || m.maxSeen.CompareAndSwap(prev, cur) {
			break
		}
	}

	if m.getDelay > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(m.getDelay):
		}
	}

	if m.getErr != nil {
		return nil, m.getErr
	}

	key := contentType + "/" + id
	data, ok := m.items[key]
	if !ok {
		return nil, fmt.Errorf("not found: %s", key)
	}
	return data, nil
}

func TestExportType__concurrent_fetches_preserve_order(t *testing.T) {
	f := newMockFetcher()
	// Add delay so items complete out of order
	f.getDelay = 10 * time.Millisecond

	ids := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
	items := make([]map[string]any, len(ids))
	for i, id := range ids {
		items[i] = map[string]any{"id": id}
		f.addItem("note", id, map[string]any{"id": id, "title": "Note " + id})
	}
	f.addPage("note", items, false, len(ids))

	opts := Options{Types: []string{"note"}}
	var buf bytes.Buffer
	result, err := runWithFetcher(context.Background(), f, opts, &buf)
	require.NoError(t, err)

	assert.Equal(t, len(ids), result.Counts["note"])

	var exported map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &exported))

	notes := exported["notes"].([]any)
	require.Len(t, notes, len(ids))

	// Verify order matches input
	for i, id := range ids {
		note := notes[i].(map[string]any)
		assert.Equal(t, id, note["id"], "item at index %d should be %s", i, id)
	}
}

func TestExportType__concurrency_bounded(t *testing.T) {
	f := newMockFetcher()
	f.getDelay = 20 * time.Millisecond

	// Create more items than maxConcurrentFetches
	count := maxConcurrentFetches * 3
	items := make([]map[string]any, count)
	for i := range count {
		id := fmt.Sprintf("item-%d", i)
		items[i] = map[string]any{"id": id}
		f.addItem("bookmark", id, map[string]any{"id": id})
	}
	f.addPage("bookmark", items, false, count)

	opts := Options{Types: []string{"bookmark"}}
	var buf bytes.Buffer
	_, err := runWithFetcher(context.Background(), f, opts, &buf)
	require.NoError(t, err)

	assert.LessOrEqual(t, int(f.maxSeen.Load()), maxConcurrentFetches,
		"concurrent fetches should not exceed %d, saw %d", maxConcurrentFetches, f.maxSeen.Load())
	assert.Greater(t, int(f.maxSeen.Load()), 1,
		"should have used concurrency (saw max %d)", f.maxSeen.Load())
}

func TestExportType__fetch_error_writes_nothing_from_page(t *testing.T) {
	f := newMockFetcher()

	// Page 1: succeeds
	f.addPage("note", []map[string]any{{"id": "n1"}}, true, 3)
	f.addItem("note", "n1", map[string]any{"id": "n1", "title": "Note 1"})

	// Page 2: one item will fail
	f.addPage("note", []map[string]any{{"id": "n2"}, {"id": "n3"}}, false, 3)
	f.addItem("note", "n2", map[string]any{"id": "n2", "title": "Note 2"})
	// n3 is intentionally missing — GetContent will return "not found"

	opts := Options{Types: []string{"note"}}
	var buf bytes.Buffer
	_, err := runWithFetcher(context.Background(), f, opts, &buf)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "n3")

	// The output should not contain n2 (partial page) since the whole page failed
	assert.NotContains(t, buf.String(), "n2")
}

func TestExportType__empty_page(t *testing.T) {
	f := newMockFetcher()
	f.addPage("bookmark", []map[string]any{}, false, 0)

	opts := Options{Types: []string{"bookmark"}}
	var buf bytes.Buffer
	result, err := runWithFetcher(context.Background(), f, opts, &buf)
	require.NoError(t, err)

	assert.Equal(t, 0, result.Counts["bookmark"])

	var exported map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &exported))
	bookmarks := exported["bookmarks"].([]any)
	assert.Empty(t, bookmarks)
}

func TestExportType__missing_id_field(t *testing.T) {
	f := newMockFetcher()
	f.addPage("note", []map[string]any{{"title": "no id"}}, false, 1)

	opts := Options{Types: []string{"note"}}
	var buf bytes.Buffer
	_, err := runWithFetcher(context.Background(), f, opts, &buf)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing id field")
}

func TestExportType__context_cancelled(t *testing.T) {
	f := newMockFetcher()
	f.getDelay = 100 * time.Millisecond

	items := make([]map[string]any, 10)
	for i := range 10 {
		id := fmt.Sprintf("item-%d", i)
		items[i] = map[string]any{"id": id}
		f.addItem("note", id, map[string]any{"id": id})
	}
	f.addPage("note", items, false, 10)

	ctx, cancel := context.WithCancel(context.Background())
	// Cancel after a short delay
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	opts := Options{Types: []string{"note"}}
	var buf bytes.Buffer
	_, err := runWithFetcher(ctx, f, opts, &buf)

	require.Error(t, err)
}

func TestExportType__pagination_with_concurrent_fetches(t *testing.T) {
	f := newMockFetcher()

	// Page 1
	page1Items := []map[string]any{{"id": "a"}, {"id": "b"}}
	f.addPage("note", page1Items, true, 4)
	f.addItem("note", "a", map[string]any{"id": "a", "order": 1})
	f.addItem("note", "b", map[string]any{"id": "b", "order": 2})

	// Page 2
	page2Items := []map[string]any{{"id": "c"}, {"id": "d"}}
	f.addPage("note", page2Items, false, 4)
	f.addItem("note", "c", map[string]any{"id": "c", "order": 3})
	f.addItem("note", "d", map[string]any{"id": "d", "order": 4})

	opts := Options{Types: []string{"note"}}
	var buf bytes.Buffer
	result, err := runWithFetcher(context.Background(), f, opts, &buf)
	require.NoError(t, err)
	assert.Equal(t, 4, result.Counts["note"])

	var exported map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &exported))

	notes := exported["notes"].([]any)
	require.Len(t, notes, 4)
	assert.Equal(t, "a", notes[0].(map[string]any)["id"])
	assert.Equal(t, "b", notes[1].(map[string]any)["id"])
	assert.Equal(t, "c", notes[2].(map[string]any)["id"])
	assert.Equal(t, "d", notes[3].(map[string]any)["id"])
}

func TestExportType__all_fetches_fail(t *testing.T) {
	f := newMockFetcher()
	f.getErr = fmt.Errorf("server unavailable")

	f.addPage("bookmark", []map[string]any{{"id": "x"}}, false, 1)

	opts := Options{Types: []string{"bookmark"}}
	var buf bytes.Buffer
	_, err := runWithFetcher(context.Background(), f, opts, &buf)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "server unavailable")
}
