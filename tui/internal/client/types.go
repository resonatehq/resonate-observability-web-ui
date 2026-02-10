package client

// Promise represents a Resonate promise from the API.
type Promise struct {
	ID          string            `json:"id"`
	State       string            `json:"state"`
	Timeout     int64             `json:"timeout"`
	Param       Value             `json:"param"`
	Value       Value             `json:"value"`
	Tags        map[string]string `json:"tags"`
	CreatedOn   *int64            `json:"createdOn,omitempty"`
	CompletedOn *int64            `json:"completedOn,omitempty"`
}

// Value represents input/output data on a promise.
type Value struct {
	Headers map[string]string `json:"headers,omitempty"`
	Data    *string           `json:"data,omitempty"` // base64 encoded
}

// SearchResult is the response from GET /promises.
type SearchResult struct {
	Promises []Promise `json:"promises"`
	Cursor   *string   `json:"cursor,omitempty"`
}

// SearchParams controls the promise search query.
type SearchParams struct {
	ID     string
	State  string
	Tags   map[string]string
	Limit  int
	Cursor string
	SortID *int // -1 for descending (newest first), 1 for ascending (oldest first)
}

// IntPtr returns a pointer to an int.
func IntPtr(i int) *int {
	return &i
}
