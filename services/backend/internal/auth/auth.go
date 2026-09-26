package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/scrypt"
)

const (
	CookieName = "th_session"
	MaxAge     = 14 * 24 * 60 * 60
)

type User struct {
	ID                int     `json:"-"`
	Username          string  `json:"username"`
	Role              string  `json:"role"`
	PreferredLanguage *string `json:"preferredLanguage"`
}

func FromRequest(ctx context.Context, pool *pgxpool.Pool, r *http.Request) (*User, error) {
	cookie, err := r.Cookie(CookieName)
	if err != nil || cookie.Value == "" {
		return nil, nil
	}
	var user User
	err = pool.QueryRow(ctx, `SELECT u.id, u.username, u.role, u.preferred_language
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token = $1 AND s.expires_at > now()`, cookie.Value).
		Scan(&user.ID, &user.Username, &user.Role, &user.PreferredLanguage)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &user, err
}

func VerifyPassword(password, stored string) bool {
	parts := strings.Split(stored, ":")
	if len(parts) != 2 {
		return false
	}
	salt, err := hex.DecodeString(parts[0])
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	derived, err := scrypt.Key([]byte(password), salt, 16384, 8, 1, 64)
	return err == nil && len(derived) == len(expected) && subtle.ConstantTimeCompare(derived, expected) == 1
}

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	derived, err := scrypt.Key([]byte(password), salt, 16384, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(derived), nil
}

func CreateSession(ctx context.Context, pool *pgxpool.Pool, userID int) (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	token := hex.EncodeToString(bytes)
	_, err := pool.Exec(ctx, `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)`,
		token, userID, time.Now().Add(MaxAge*time.Second))
	return token, err
}

func SetCookie(w http.ResponseWriter, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}
