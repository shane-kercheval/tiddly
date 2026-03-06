package api

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// ContentListResponse is the paginated response from list endpoints.
type ContentListResponse struct {
	Items   []map[string]any `json:"items"`
	Total   int              `json:"total"`
	Offset  int              `json:"offset"`
	Limit   int              `json:"limit"`
	HasMore bool             `json:"has_more"`
}

// GetContentCount returns the total count for a content type (bookmark, note, prompt).
// Uses limit=1 to minimize data transfer — we only need the total field.
func (c *Client) GetContentCount(ctx context.Context, contentType string) (int, error) {
	var resp ContentListResponse
	path := fmt.Sprintf("/%ss/?limit=1", contentType)
	if err := c.Do(ctx, "GET", path, nil, &resp); err != nil {
		return 0, err
	}
	return resp.Total, nil
}

// ListContent returns a paginated list of items for a content type.
// contentType is "bookmark", "note", or "prompt".
// Items contain metadata only (no full content).
func (c *Client) ListContent(ctx context.Context, contentType string, offset, limit int, includeArchived bool) (*ContentListResponse, error) {
	params := url.Values{}
	params.Set("offset", strconv.Itoa(offset))
	params.Set("limit", strconv.Itoa(limit))
	if includeArchived {
		params.Add("view", "active")
		params.Add("view", "archived")
	}
	path := fmt.Sprintf("/%ss/?%s", contentType, params.Encode())

	var resp ContentListResponse
	if err := c.Do(ctx, "GET", path, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetContent returns a single item with full content.
// contentType is "bookmark", "note", or "prompt".
func (c *Client) GetContent(ctx context.Context, contentType, id string) (map[string]any, error) {
	path := fmt.Sprintf("/%ss/%s", url.PathEscape(contentType), url.PathEscape(id))
	var item map[string]any
	if err := c.Do(ctx, "GET", path, nil, &item); err != nil {
		return nil, err
	}
	return item, nil
}
