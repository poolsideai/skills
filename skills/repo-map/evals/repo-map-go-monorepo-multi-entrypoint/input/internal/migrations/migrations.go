package migrations

import "database/sql"

type Migrator struct {
	db *sql.DB
}

func New(db *sql.DB) *Migrator {
	return &Migrator{db: db}
}

func (m *Migrator) Up() error {
	// stub: apply pending migrations
	return nil
}

func (m *Migrator) Down() error {
	// stub: rollback last migration
	return nil
}

func (m *Migrator) Status() (string, error) {
	// stub: report current schema version
	return "v1.0.0", nil
}
