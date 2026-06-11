package queue

import "database/sql"

type Task struct {
	ID      string
	Payload string
}

func (t *Task) Execute() error {
	// stub: actual work happens here
	return nil
}

type Queue struct {
	db *sql.DB
}

func New(db *sql.DB) *Queue {
	return &Queue{db: db}
}

func (q *Queue) Poll() (*Task, error) {
	// stub: poll tasks table
	return nil, nil
}
