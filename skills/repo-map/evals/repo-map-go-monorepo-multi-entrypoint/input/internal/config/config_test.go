package config

import (
	"os"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	os.Clearenv()
	cfg := Load()
	if cfg.DatabaseURL != "postgres://localhost/platform_dev" {
		t.Errorf("expected default DatabaseURL, got %s", cfg.DatabaseURL)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("expected default LogLevel info, got %s", cfg.LogLevel)
	}
}

func TestLoadFromEnv(t *testing.T) {
	os.Setenv("DATABASE_URL", "postgres://testhost/testdb")
	os.Setenv("LOG_LEVEL", "debug")
	defer os.Clearenv()
	cfg := Load()
	if cfg.DatabaseURL != "postgres://testhost/testdb" {
		t.Errorf("expected env DatabaseURL, got %s", cfg.DatabaseURL)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("expected env LogLevel debug, got %s", cfg.LogLevel)
	}
}
