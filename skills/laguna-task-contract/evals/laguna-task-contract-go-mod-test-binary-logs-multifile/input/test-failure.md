# Test Failure Report: Race Condition in Cache Package

**Date**: 2024-02-10 09:47 UTC
**Environment**: CI pipeline (linux/amd64, go1.21.5)
**Command**: `go test -v -race ./internal/cache`

## Summary

The cache package tests are failing with a race detector warning followed by a panic. The race occurs between concurrent access to the cache map in the Set method. The panic happens when attempting to evict an entry that was already removed by another goroutine.

## Test Output

```
=== RUN   TestConcurrentAccess
    cache_test.go:89: starting 10 concurrent workers
==================
WARNING: DATA RACE
Write at 0x00c00012e0a0 by goroutine 23:
  runtime.mapassign_faststr()
      /usr/local/go/src/runtime/map_faststr.go:203 +0x0
  main.(*Cache).Set()
      /workspace/internal/cache/cache.go:45 +0x1c4
  main.TestConcurrentAccess.func1()
      /workspace/internal/cache/cache_test.go:94 +0x8c

Previous read at 0x00c00012e0a0 by goroutine 21:
  runtime.mapaccess1_faststr()
      /usr/local/go/src/runtime/map_faststr.go:13 +0x0
  main.(*Cache).Set()
      /workspace/internal/cache/cache.go:37 +0x94
  main.TestConcurrentAccess.func1()
      /workspace/internal/cache/cache_test.go:94 +0x8c

Goroutine 23 (running) created at:
  main.TestConcurrentAccess()
      /workspace/internal/cache/cache_test.go:92 +0x134

Goroutine 21 (running) created at:
  main.TestConcurrentAccess()
      /workspace/internal/cache/cache_test.go:92 +0x134
==================
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x5a4e67]

goroutine 21 [running]:
main.(*Cache).evictOldest(0xc0001200f0)
        /workspace/internal/cache/cache.go:67 +0x98
main.(*Cache).Set(0xc0001200f0, {0xc00010c3c0, 0x7}, {0x0, 0x0})
        /workspace/internal/cache/cache.go:48 +0x254
main.TestConcurrentAccess.func1(0x21, 0xc000120000)
        /workspace/internal/cache/cache_test.go:94 +0x8c
created by main.TestConcurrentAccess in goroutine 1
        /workspace/internal/cache/cache_test.go:92 +0x134
--- FAIL: TestConcurrentAccess (0.02s)
FAIL
FAIL    internal/cache  0.047s
```

## Analysis

**Root cause**: The cache implementation is missing synchronization for the cache map operations. When multiple goroutines call `Set()` concurrently:

1. Goroutine A checks if a key exists (line 37), finds it doesn't
2. Goroutine B also checks the same key (line 37), also finds it doesn't exist
3. Both proceed to check capacity and potentially evict (line 44-48)
4. Both attempt to insert the key (line 50), causing a data race on the map
5. The panic at line 67 occurs when eviction logic encounters inconsistent state

**Files involved**:
- `internal/cache/cache.go`: Cache type and Set method (lines 34-51), evictOldest method (lines 64-70)

**Binary race log**: Full race detector output with memory addresses and goroutine stacks is available at `race.log.txt`.

## Required Fix

Add a mutex field to the Cache struct and use it to synchronize all map access in the Set, Get, Delete, and evictOldest methods. The critical section spans the entire Set method from the existence check through insertion.

## Impact

Critical: the cache is used in production request handlers. This race causes intermittent crashes under load (observed 3 times in the last 24 hours).
