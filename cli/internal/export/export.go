package export

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/shane-kercheval/tiddly/cli/internal/api"
)

// ValidTypes is the list of valid content types for export.
var ValidTypes = []string{"bookmark", "note", "prompt"}

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
	bw := bufio.NewWriter(w)
	result := &Result{Counts: make(map[string]int)}

	// Start JSON object
	if _, err := fmt.Fprintf(bw, "{\"exported_at\":%s", jsonString(time.Now().UTC().Format(time.RFC3339))); err != nil {
		return nil, fmt.Errorf("writing export header: %w", err)
	}

	for _, contentType := range opts.Types {
		count, err := exportType(ctx, client, opts, bw, contentType)
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
func exportType(ctx context.Context, client *api.Client, opts Options, w io.Writer, contentType string) (int, error) {
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

		page, err := client.ListContent(ctx, contentType, offset, pageSize, opts.IncludeArchived)
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

		for _, item := range page.Items {
			id, ok := item["id"].(string)
			if !ok {
				return 0, fmt.Errorf("item in %s list response missing id field", contentType)
			}

			full, err := client.GetContent(ctx, contentType, id)
			if err != nil {
				return 0, fmt.Errorf("fetching %s %s: %w", contentType, id, err)
			}

			if !first {
				if _, err := io.WriteString(w, ","); err != nil {
					return 0, err
				}
			}
			first = false

			data, err := json.Marshal(full)
			if err != nil {
				return 0, fmt.Errorf("encoding %s %s: %w", contentType, id, err)
			}
			if _, err := w.Write(data); err != nil {
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

// jsonString returns a JSON-encoded string literal.
func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
