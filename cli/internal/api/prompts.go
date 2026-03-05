package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

// PromptInfo is the metadata for a prompt in list responses.
type PromptInfo struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
}

// PromptListResponse is the paginated response from GET /prompts/.
type PromptListResponse struct {
	Items   []PromptInfo `json:"items"`
	Total   int          `json:"total"`
	Offset  int          `json:"offset"`
	Limit   int          `json:"limit"`
	HasMore bool         `json:"has_more"`
}

// ListPrompts returns prompts with optional tag filtering.
func (c *Client) ListPrompts(ctx context.Context, tags []string, tagMatch string, offset, limit int) (*PromptListResponse, error) {
	params := url.Values{}
	params.Set("offset", strconv.Itoa(offset))
	params.Set("limit", strconv.Itoa(limit))
	for _, tag := range tags {
		params.Add("tags", tag)
	}
	if tagMatch != "" {
		params.Set("tag_match", tagMatch)
	}
	path := "/prompts/?" + params.Encode()

	var resp PromptListResponse
	if err := c.Do(ctx, "GET", path, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ExportSkillsResponse holds the binary archive and its content type.
type ExportSkillsResponse struct {
	Body        io.ReadCloser
	ContentType string
}

// ExportSkills downloads skills as a tar.gz or zip archive.
// Caller must close Body when done.
func (c *Client) ExportSkills(ctx context.Context, client string, tags []string, tagMatch string) (*ExportSkillsResponse, error) {
	params := url.Values{}
	params.Set("client", client)
	for _, tag := range tags {
		params.Add("tags", tag)
	}
	if tagMatch != "" {
		params.Set("tag_match", tagMatch)
	}
	path := "/prompts/export/skills?" + params.Encode()

	req, err := http.NewRequestWithContext(ctx, "GET", c.BaseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("X-Request-Source", "cli")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close() //nolint:errcheck
		return nil, c.handleErrorFromBytes(resp, body)
	}

	return &ExportSkillsResponse{
		Body:        resp.Body,
		ContentType: resp.Header.Get("Content-Type"),
	}, nil
}

// handleErrorFromBytes creates an appropriate APIError from a non-2xx response.
// Passes maxRetries as attempt to ensure no retry is attempted — the response body
// is already consumed so the request cannot be replayed.
func (c *Client) handleErrorFromBytes(resp *http.Response, body []byte) error {
	return c.handleError(context.Background(), resp, body, "GET", "", nil, nil, maxRetries)
}
