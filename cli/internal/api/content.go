package api

import (
	"context"
	"fmt"
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
