package client

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Client is a lightweight HTTP client for the Resonate API.
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	Token      string
	Username   string
	Password   string
}

// SearchPromises queries GET /promises with the given parameters.
func (c *Client) SearchPromises(ctx context.Context, params SearchParams) (*SearchResult, error) {
	u, err := url.Parse(c.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid base URL: %w", err)
	}
	u.Path = "/promises"

	q := url.Values{}
	if params.ID != "" {
		q.Set("id", params.ID)
	}
	if params.State != "" {
		q.Set("state", params.State)
	}
	if params.Limit > 0 {
		q.Set("limit", strconv.Itoa(params.Limit))
	}
	if params.Cursor != "" {
		q.Set("cursor", params.Cursor)
	}
	for k, v := range params.Tags {
		q.Set(fmt.Sprintf("tags[%s]", k), v)
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	c.applyAuth(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var result SearchResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

// GetPromise fetches a single promise by ID via GET /promises/{id}.
func (c *Client) GetPromise(ctx context.Context, id string) (*Promise, error) {
	u, err := url.Parse(c.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid base URL: %w", err)
	}
	u.Path = "/promises/" + id

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	c.applyAuth(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var promise Promise
	if err := json.NewDecoder(resp.Body).Decode(&promise); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &promise, nil
}

func (c *Client) applyAuth(req *http.Request) {
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	} else if c.Username != "" {
		req.SetBasicAuth(c.Username, c.Password)
	}
}
