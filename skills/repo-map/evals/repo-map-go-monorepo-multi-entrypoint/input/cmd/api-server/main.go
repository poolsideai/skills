package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/acmecorp/platform-services/internal/config"
	"github.com/acmecorp/platform-services/internal/db"
)

func main() {
	cfg := config.Load()
	db, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer db.Close()

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "ok")
	})

	addr := fmt.Sprintf(":%s", os.Getenv("PORT"))
	if addr == ":" {
		addr = ":8080"
	}
	log.Printf("api-server listening on %s", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
