package main

import (
	"fmt"
	"log"
	"os"

	"github.com/acmecorp/platform-services/internal/config"
	"github.com/acmecorp/platform-services/internal/db"
	"github.com/acmecorp/platform-services/internal/migrations"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: migrate <up|down|status>")
		os.Exit(2)
	}

	cfg := config.Load()
	conn, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer conn.Close()

	migrator := migrations.New(conn)
	switch os.Args[1] {
	case "up":
		if err := migrator.Up(); err != nil {
			log.Fatalf("migrate up: %v", err)
		}
		log.Println("migrations applied")
	case "down":
		if err := migrator.Down(); err != nil {
			log.Fatalf("migrate down: %v", err)
		}
		log.Println("migrations rolled back")
	case "status":
		status, err := migrator.Status()
		if err != nil {
			log.Fatalf("migrate status: %v", err)
		}
		fmt.Println(status)
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		os.Exit(2)
	}
}
