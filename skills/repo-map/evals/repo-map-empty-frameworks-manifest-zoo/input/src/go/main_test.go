package main

import "testing"

func TestGreet(t *testing.T) {
	got := greet("Alice")
	want := "Hello from Go, Alice!"
	if got != want {
		t.Errorf("greet(Alice) = %q, want %q", got, want)
	}
}
