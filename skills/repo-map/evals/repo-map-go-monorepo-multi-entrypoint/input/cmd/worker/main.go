package main

import (
	"log"
	"time"

	"github.com/acmecorp/platform-services/internal/config"
	"github.com/acmecorp/platform-services/internal/db"
	"github.com/acmecorp/platform-services/internal/queue"
)

func main() {
	cfg := config.Load()
	db, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer db.Close()

	q := queue.New(db)
	log.Println("worker started, polling for tasks")
	for {
		task, err := q.Poll()
		if err != nil {
			log.Printf("poll error: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}
		if task == nil {
			time.Sleep(1 * time.Second)
			continue
		}
		log.Printf("processing task %s", task.ID)
		if err := task.Execute(); err != nil {
			log.Printf("task %s failed: %v", task.ID, err)
		}
	}
}
