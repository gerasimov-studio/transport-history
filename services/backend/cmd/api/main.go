package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	backend "transport-history/backend/internal/api"
	"transport-history/backend/internal/storage"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	databaseURL := env("DATABASE_URL", "postgres://th:th@db:5432/th")
	port := env("PORT", "3001")
	schemaPath := env("SCHEMA_PATH", "/migrations/init.sql")

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	if err := backend.WaitForDatabase(ctx, pool); err != nil {
		log.Fatal(err)
	}

	if err := storage.MigrateAndSeed(ctx, pool, schemaPath); err != nil {
		log.Fatal(err)
	}
	api := backend.New(pool)
	if err := api.SyncAllProjections(ctx); err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: ":" + port, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Printf("go api listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
