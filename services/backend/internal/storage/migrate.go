package storage

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"transport-history/backend/internal/auth"
)

func MigrateAndSeed(ctx context.Context, pool *pgxpool.Pool, schemaPath string) error {
	schema, err := os.ReadFile(schemaPath)
	if err != nil {
		return fmt.Errorf("read schema: %w", err)
	}
	if _, err = pool.Exec(ctx, string(schema)); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	for code, mode := range map[string]string{"ЖД": "railway", "ТМ": "tram", "МТ": "metro", "ТБ": "trolleybus", "АВ": "bus"} {
		if _, err = pool.Exec(ctx, `INSERT INTO mode_codes(code,mode) VALUES($1,$2) ON CONFLICT(code) DO UPDATE SET mode=EXCLUDED.mode`, code, mode); err != nil {
			return err
		}
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*)::int FROM users`).Scan(&count); err != nil {
		return err
	}
	editor := env("EDITOR_USERNAME", "editor")
	if count == 0 {
		hash, hashErr := auth.HashPassword(env("EDITOR_PASSWORD", "editor"))
		if hashErr != nil {
			return hashErr
		}
		if _, err = pool.Exec(ctx, `INSERT INTO users(username,password_hash) VALUES($1,$2)`, editor, hash); err != nil {
			return err
		}
	}
	superuser := os.Getenv("SUPERUSER_USERNAME")
	if superuser == "" {
		superuser = editor
	}
	var superuserExists bool
	if err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE username=$1)`, superuser).Scan(&superuserExists); err != nil {
		return err
	}
	if !superuserExists {
		password := env("SUPERUSER_PASSWORD", env("EDITOR_PASSWORD", "editor"))
		hash, hashErr := auth.HashPassword(password)
		if hashErr != nil {
			return hashErr
		}
		if _, err = pool.Exec(ctx, `INSERT INTO users(username,password_hash,role) VALUES($1,$2,'superuser')`, superuser, hash); err != nil {
			return err
		}
	}
	if _, err = pool.Exec(ctx, `UPDATE users SET role='moderator' WHERE role IN ('admin','superuser') AND username<>$1`, superuser); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `UPDATE users SET role='superuser' WHERE username=$1`, superuser)
	return err
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
