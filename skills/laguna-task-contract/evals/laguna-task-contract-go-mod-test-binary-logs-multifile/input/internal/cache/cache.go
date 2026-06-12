package cache

import (
	"fmt"
)

// Cache is a simple in-memory cache with LRU eviction.
type Cache struct {
	items    map[string]interface{}
	maxSize  int
	lru      *LRU
}

// NewCache creates a new cache with the specified maximum size.
func NewCache(maxSize int) *Cache {
	return &Cache{
		items:   make(map[string]interface{}),
		maxSize: maxSize,
		lru:     NewLRU(),
	}
}

// Get retrieves a value from the cache.
func (c *Cache) Get(key string) (interface{}, bool) {
	val, ok := c.items[key]
	if ok {
		c.lru.Access(key)
	}
	return val, ok
}

// Set adds or updates a value in the cache.
// If the cache is full, the least recently used item is evicted.
func (c *Cache) Set(key string, value interface{}) {
	// Check if key already exists
	if _, exists := c.items[key]; exists {
		c.items[key] = value
		c.lru.Access(key)
		return
	}

	// Check if we need to evict
	if len(c.items) >= c.maxSize {
		// BUG: No synchronization here - multiple goroutines can enter this block
		// and race on both the eviction and the subsequent insertion
		c.evictOldest()
	}

	c.items[key] = value
	c.lru.Add(key)
}

// Delete removes a key from the cache.
func (c *Cache) Delete(key string) {
	delete(c.items, key)
	c.lru.Remove(key)
}

// Size returns the current number of items in the cache.
func (c *Cache) Size() int {
	return len(c.items)
}

// evictOldest removes the least recently used item from the cache.
func (c *Cache) evictOldest() {
	key := c.lru.Evict()
	// BUG: Line 67 - if multiple goroutines call evictOldest concurrently,
	// they may get the same key from lru.Evict(), and both will attempt to
	// delete it. The second delete will operate on a nil entry, causing a panic
	// when the LRU list tries to access the node.
	delete(c.items, key)
}

// Clear removes all items from the cache.
func (c *Cache) Clear() {
	c.items = make(map[string]interface{})
	c.lru = NewLRU()
}

// Stats returns cache statistics.
func (c *Cache) Stats() string {
	return fmt.Sprintf("size: %d/%d", len(c.items), c.maxSize)
}
