package api

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"transport-history/backend/internal/auth"
	"transport-history/backend/internal/httpjson"
)

var (
	usernamePattern      = regexp.MustCompile(`^[\p{L}\p{N}_.-]{3,32}$`)
	userRolePath         = regexp.MustCompile(`^/api/users/(\d+)/role$`)
	snapshotNetworkPath  = regexp.MustCompile(`^/api/snapshots/([^/]+)/network$`)
	snapshotPath         = regexp.MustCompile(`^/api/snapshots/([^/]+)$`)
	changesetSubmitPath  = regexp.MustCompile(`^/api/changesets/([^/]+)/submit$`)
	changesetPublishPath = regexp.MustCompile(`^/api/changesets/([^/]+)/publish$`)
	changesetReviewPath  = regexp.MustCompile(`^/api/changesets/([^/]+)/review$`)
)

type Server struct {
	pool          *pgxpool.Pool
	locationCache map[string]any
	httpClient    *http.Client
}

func New(pool *pgxpool.Pool) *Server {
	return &Server{pool: pool, locationCache: map[string]any{}, httpClient: &http.Client{Timeout: 12 * time.Second}}
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(s.serveHTTP)
}

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case r.Method == http.MethodGet && path == "/api/health":
		s.health(w, r)
	case r.Method == http.MethodGet && path == "/api/me":
		s.me(w, r)
	case r.Method == http.MethodPatch && path == "/api/me":
		s.updateMe(w, r)
	case r.Method == http.MethodPost && path == "/api/login":
		s.login(w, r)
	case r.Method == http.MethodPost && path == "/api/register":
		s.register(w, r)
	case r.Method == http.MethodPost && path == "/api/logout":
		s.logout(w, r)
	case r.Method == http.MethodGet && path == "/api/users":
		s.users(w, r)
	case r.Method == http.MethodPatch && userRolePath.MatchString(path):
		s.updateRole(w, r)
	case r.Method == http.MethodGet && path == "/api/location-context":
		s.locationContext(w, r)
	case r.Method == http.MethodGet && path == "/api/catalog":
		s.catalog(w, r)
	case r.Method == http.MethodGet && path == "/api/state":
		s.state(w, r)
	case r.Method == http.MethodGet && path == "/api/map":
		s.mapView(w, r)
	case r.Method == http.MethodGet && path == "/api/export.svg":
		s.exportSVG(w, r)
	case r.Method == http.MethodGet && snapshotNetworkPath.MatchString(path):
		s.snapshotNetwork(w, r)
	case r.Method == http.MethodGet && path == "/api/workspaces":
		s.workspaces(w, r)
	case r.Method == http.MethodPost && path == "/api/workspaces":
		s.createWorkspace(w, r)
	case r.Method == http.MethodGet && path == "/api/moderation-areas":
		s.moderationAreas(w, r)
	case r.Method == http.MethodPost && path == "/api/moderation-areas":
		s.createModerationArea(w, r)
	case r.Method == http.MethodGet && path == "/api/changesets":
		s.changesets(w, r)
	case r.Method == http.MethodPost && changesetSubmitPath.MatchString(path):
		s.submitChangeset(w, r)
	case r.Method == http.MethodPost && changesetPublishPath.MatchString(path):
		s.publishChangeset(w, r)
	case r.Method == http.MethodPost && changesetReviewPath.MatchString(path):
		s.reviewChangeset(w, r)
	case r.Method == http.MethodPost && path == "/api/objects/commit":
		s.objectCommit(w, r)
	case r.Method == http.MethodPost && path == "/api/commit":
		s.legacyCommit(w, r)
	case r.Method == http.MethodPost && path == "/api/snapshots":
		s.createSnapshot(w, r)
	case snapshotPath.MatchString(path) && (r.Method == http.MethodPut || r.Method == http.MethodDelete):
		s.mutateSnapshot(w, r)
	default:
		httpjson.Write(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.pool.Ping(r.Context()); err != nil {
		httpjson.Write(w, http.StatusServiceUnavailable, map[string]string{"error": "database"})
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) *auth.User {
	user, err := auth.FromRequest(r.Context(), s.pool, r)
	if err != nil {
		httpjson.Write(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return nil
	}
	if user == nil {
		httpjson.Write(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
	}
	return user
}

func publicUser(user *auth.User) map[string]any {
	return map[string]any{"username": user.Username, "role": user.Role, "preferredLanguage": user.PreferredLanguage}
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	if user := s.requireUser(w, r); user != nil {
		httpjson.Write(w, http.StatusOK, map[string]any{"user": publicUser(user)})
	}
}

func (s *Server) updateMe(w http.ResponseWriter, r *http.Request) {
	user := s.requireUser(w, r)
	if user == nil {
		return
	}
	var body struct {
		Language *string `json:"language"`
	}
	if err := httpjson.Read(r, &body); err != nil {
		httpjson.Write(w, http.StatusBadRequest, map[string]string{"error": "language"})
		return
	}
	if body.Language != nil && *body.Language != "en" && *body.Language != "sr" && *body.Language != "ru" {
		httpjson.Write(w, http.StatusBadRequest, map[string]string{"error": "language"})
		return
	}
	_, err := s.pool.Exec(r.Context(), `UPDATE users SET preferred_language=$1 WHERE id=$2`, body.Language, user.ID)
	if err != nil {
		httpjson.Write(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	user.PreferredLanguage = body.Language
	httpjson.Write(w, http.StatusOK, map[string]any{"user": publicUser(user)})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct{ Username, Password string }
	if err := httpjson.Read(r, &body); err != nil {
		httpjson.Write(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	var user auth.User
	var passwordHash string
	err := s.pool.QueryRow(r.Context(), `SELECT id,username,password_hash,role,preferred_language FROM users WHERE username=$1`, body.Username).
		Scan(&user.ID, &user.Username, &passwordHash, &user.Role, &user.PreferredLanguage)
	if err != nil || !auth.VerifyPassword(body.Password, passwordHash) {
		httpjson.Write(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}
	token, err := auth.CreateSession(r.Context(), s.pool, user.ID)
	if err != nil {
		httpjson.Write(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	auth.SetCookie(w, token, auth.MaxAge)
	httpjson.Write(w, http.StatusOK, map[string]any{"user": publicUser(&user)})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var body struct{ Username, Password string }
	if err := httpjson.Read(r, &body); err != nil {
		httpjson.Write(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if !usernamePattern.MatchString(body.Username) || len(body.Password) < 8 {
		httpjson.Write(w, http.StatusBadRequest, map[string]string{"error": "username must be 3–32 characters and password at least 8 characters"})
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		httpjson.Write(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	var id int
	err = s.pool.QueryRow(r.Context(), `INSERT INTO users (username,password_hash,role) VALUES ($1,$2,'user') RETURNING id`, body.Username, hash).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpjson.Write(w, http.StatusConflict, map[string]string{"error": "username is already taken"})
			return
		}
		httpjson.Write(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	token, err := auth.CreateSession(r.Context(), s.pool, id)
	if err != nil {
		httpjson.Write(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	auth.SetCookie(w, token, auth.MaxAge)
	httpjson.Write(w, http.StatusCreated, map[string]any{"user": map[string]any{"username": body.Username, "role": "user", "preferredLanguage": nil}})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(auth.CookieName); err == nil && cookie.Value != "" {
		_, _ = s.pool.Exec(r.Context(), `DELETE FROM sessions WHERE token=$1`, cookie.Value)
	}
	auth.SetCookie(w, "", -1)
	httpjson.Write(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) requireSuperuser(w http.ResponseWriter, r *http.Request) *auth.User {
	user, err := auth.FromRequest(r.Context(), s.pool, r)
	if err != nil {
		httpjson.Write(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return nil
	}
	if user == nil || user.Role != "superuser" {
		httpjson.Write(w, http.StatusForbidden, map[string]string{"error": "superuser required"})
		return nil
	}
	return user
}

func (s *Server) users(w http.ResponseWriter, r *http.Request) {
	if s.requireSuperuser(w, r) == nil {
		return
	}
	rows, err := s.pool.Query(r.Context(), `SELECT id,username,role,preferred_language,created_at FROM users ORDER BY username`)
	if err != nil {
		httpjson.Write(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	defer rows.Close()
	users := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var username, role string
		var language *string
		var createdAt time.Time
		if err := rows.Scan(&id, &username, &role, &language, &createdAt); err != nil {
			continue
		}
		users = append(users, map[string]any{"id": id, "username": username, "role": role, "preferredLanguage": language, "createdAt": createdAt})
	}
	httpjson.Write(w, http.StatusOK, map[string]any{"users": users})
}

func (s *Server) updateRole(w http.ResponseWriter, r *http.Request) {
	if s.requireSuperuser(w, r) == nil {
		return
	}
	matches := userRolePath.FindStringSubmatch(r.URL.Path)
	id, _ := strconv.Atoi(matches[1])
	var body struct {
		Role string `json:"role"`
	}
	if err := httpjson.Read(r, &body); err != nil || (body.Role != "user" && body.Role != "moderator") {
		httpjson.Write(w, http.StatusBadRequest, map[string]string{"error": "role"})
		return
	}
	var username, role string
	err := s.pool.QueryRow(r.Context(), `UPDATE users SET role=$1 WHERE id=$2 AND role<>'superuser' RETURNING username,role`, body.Role, id).Scan(&username, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		httpjson.Write(w, http.StatusNotFound, map[string]string{"error": "user"})
		return
	}
	if err != nil {
		httpjson.Write(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{"id": id, "username": username, "role": role})
}

func WaitForDatabase(ctx context.Context, pool *pgxpool.Pool) error {
	for {
		if err := pool.Ping(ctx); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}
