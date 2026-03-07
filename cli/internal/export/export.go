package export

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
)

// maxConcurrentFetches is the maximum number of concurrent GetContent requests per page.
const maxConcurrentFetches = 5

// ValidTypes is the list of valid content types for export.
var ValidTypes = []string{"bookmark", "note", "prompt"}

// ContentFetcher abstracts the API calls needed for export, enabling testing.
type ContentFetcher interface {
	ListContent(ctx context.Context, contentType string, offset, limit int, includeArchived bool) (*api.ContentListResponse, error)
	GetContent(ctx context.Context, contentType, id string) (map[string]any, error)
}

// Options configures an export operation.
type Options struct {
	Types           []string // content types to export (bookmark, note, prompt)
	IncludeArchived bool
	// Progress receives status messages during export.
	// Set to nil to suppress progress output.
	Progress io.Writer
}

// Result holds the outcome of an export operation.
type Result struct {
	Counts map[string]int // items exported per type
}

// Run streams a JSON export to w, fetching full content for each item.
func Run(ctx context.Context, client *api.Client, opts Options, w io.Writer) (*Result, error) {
	return runWithFetcher(ctx, client, opts, w)
}

func runWithFetcher(ctx context.Context, fetcher ContentFetcher, opts Options, w io.Writer) (*Result, error) {
	bw := bufio.NewWriter(w)
	result := &Result{Counts: make(map[string]int)}

	// Start JSON object
	if _, err := fmt.Fprintf(bw, "{\"exported_at\":%s", jsonString(time.Now().UTC().Format(time.RFC3339))); err != nil {
		return nil, fmt.Errorf("writing export header: %w", err)
	}

	for _, contentType := range opts.Types {
		count, err := exportType(ctx, fetcher, opts, bw, contentType)
		if err != nil {
			return nil, fmt.Errorf("exporting %ss: %w", contentType, err)
		}
		result.Counts[contentType] = count
	}

	// Close JSON object
	if _, err := io.WriteString(bw, "}\n"); err != nil {
		return nil, fmt.Errorf("writing export footer: %w", err)
	}

	if err := bw.Flush(); err != nil {
		return nil, fmt.Errorf("flushing export output: %w", err)
	}

	return result, nil
}

// exportType writes all items of a given type as a JSON array.
// Items within each page are fetched concurrently (bounded by maxConcurrentFetches)
// and written in order.
func exportType(ctx context.Context, fetcher ContentFetcher, opts Options, w io.Writer, contentType string) (int, error) {
	// Write array key
	if _, err := fmt.Fprintf(w, ",%s:[", jsonString(contentType+"s")); err != nil {
		return 0, err
	}

	offset := 0
	const pageSize = 100
	total := 0
	first := true

	for {
		if err := ctx.Err(); err != nil {
			return 0, err
		}

		page, err := fetcher.ListContent(ctx, contentType, offset, pageSize, opts.IncludeArchived)
		if err != nil {
			return 0, err
		}

		if opts.Progress != nil && page.Total > 0 {
			fetched := offset + len(page.Items)
			if fetched > page.Total {
				fetched = page.Total
			}
			fmt.Fprintf(opts.Progress, "Exporting %ss... %d/%d\n", contentType, fetched, page.Total)
		}

		// Fetch all items in this page concurrently
		pageResults, err := fetchPage(ctx, fetcher, contentType, page.Items)
		if err != nil {
			return 0, err
		}

		// Write results in order
		for _, data := range pageResults {
			if !first {
				if _, err := io.WriteString(w, ","); err != nil {
					return 0, err
				}
			}
			first = false

			encoded, err := json.Marshal(data)
			if err != nil {
				return 0, fmt.Errorf("encoding %s: %w", contentType, err)
			}
			if _, err := w.Write(encoded); err != nil {
				return 0, err
			}
			total++
		}

		if !page.HasMore {
			break
		}
		offset += len(page.Items)
	}

	// Close array
	if _, err := io.WriteString(w, "]"); err != nil {
		return 0, err
	}

	return total, nil
}

// fetchPage fetches full content for all items in a page concurrently.
// Returns results in the same order as the input items.
// If any fetch fails, returns the first error encountered.
func fetchPage(ctx context.Context, fetcher ContentFetcher, contentType string, items []map[string]any) ([]map[string]any, error) {
	if len(items) == 0 {
		return nil, nil
	}

	// Pre-validate all IDs before launching goroutines to avoid leaking workers.
	ids := make([]string, len(items))
	for i, item := range items {
		id, ok := item["id"].(string)
		if !ok {
			return nil, fmt.Errorf("item in %s list response missing id field", contentType)
		}
		ids[i] = id
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make([]map[string]any, len(items))
	errs := make([]error, len(items))

	sem := make(chan struct{}, maxConcurrentFetches)
	var wg sync.WaitGroup

	for i, id := range ids {
		wg.Add(1)
		go func(idx int, itemID string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			full, err := fetcher.GetContent(ctx, contentType, itemID)
			if err != nil {
				errs[idx] = fmt.Errorf("fetching %s %s: %w", contentType, itemID, err)
				cancel()
				return
			}
			results[idx] = full
		}(i, id)
	}

	wg.Wait()

	// Return first error in index order
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}

	return results, nil
}

// jsonString returns a JSON-encoded string literal.
func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
