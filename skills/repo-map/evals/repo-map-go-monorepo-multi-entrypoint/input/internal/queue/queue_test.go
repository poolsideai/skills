package queue

import (
	"testing"
)

func TestTaskExecute(t *testing.T) {
	task := &Task{ID: "test-1", Payload: "{}"}
	if err := task.Execute(); err != nil {
		t.Errorf("Execute() error = %v", err)
	}
}
