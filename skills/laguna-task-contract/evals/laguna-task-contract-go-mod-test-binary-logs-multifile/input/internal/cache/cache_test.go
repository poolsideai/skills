package cache

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCacheBasic(t *testing.T) {
	c := NewCache(3)

	c.Set("a", 1)
	c.Set("b", 2)
	c.Set("c", 3)

	val, ok := c.Get("a")
	assert.True(t, ok)
	assert.Equal(t, 1, val)

	assert.Equal(t, 3, c.Size())
}

func TestCacheEviction(t *testing.T) {
	c := NewCache(2)

	c.Set("a", 1)
	c.Set("b", 2)

	// Access "a" to make it more recently used
	c.Get("a")

	// Add "c" - should evict "b" (least recently used)
	c.Set("c", 3)

	_, ok := c.Get("b")
	assert.False(t, ok, "b should have been evicted")

	_, ok = c.Get("a")
	assert.True(t, ok, "a should still exist")

	_, ok = c.Get("c")
	assert.True(t, ok, "c should exist")
}

func TestCacheUpdate(t *testing.T) {
	c := NewCache(2)

	c.Set("a", 1)
	c.Set("a", 2)

	val, ok := c.Get("a")
	assert.True(t, ok)
	assert.Equal(t, 2, val)

	assert.Equal(t, 1, c.Size())
}

func TestCacheDelete(t *testing.T) {
	c := NewCache(3)

	c.Set("a", 1)
	c.Set("b", 2)

	c.Delete("a")

	_, ok := c.Get("a")
	assert.False(t, ok)

	assert.Equal(t, 1, c.Size())
}

func TestCacheClear(t *testing.T) {
	c := NewCache(3)

	c.Set("a", 1)
	c.Set("b", 2)

	c.Clear()

	assert.Equal(t, 0, c.Size())
}

func TestConcurrentAccess(t *testing.T) {
	c := NewCache(10)
	var wg sync.WaitGroup

	// Start 10 concurrent workers
	t.Log("starting 10 concurrent workers")
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				key := fmt.Sprintf("key-%d", j)
				c.Set(key, id)
				c.Get(key)
			}
		}(i)
	}

	wg.Wait()
	t.Log("all workers finished")
}
