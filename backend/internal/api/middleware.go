package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

type ctxKey string

const (
	ctxUserKey ctxKey = "user"
)

// userFrom возвращает аутентифицированного пользователя из контекста.
func userFrom(ctx context.Context) (*domain.User, bool) {
	u, ok := ctx.Value(ctxUserKey).(*domain.User)
	return u, ok
}

// authMiddleware проверяет Bearer-токен и подгружает пользователя.
func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			writeError(w, domain.ErrUnauthorized)
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		claims, err := s.tokens.Parse(token)
		if err != nil {
			writeError(w, domain.ErrUnauthorized)
			return
		}
		user, err := s.auth.Profile(r.Context(), claims.UserID)
		if err != nil {
			writeError(w, domain.ErrUnauthorized)
			return
		}
		if !user.IsActive {
			writeError(w, domain.ErrForbidden)
			return
		}
		ctx := context.WithValue(r.Context(), ctxUserKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// requireRole ограничивает доступ к обработчику набором ролей.
func requireRole(roles ...domain.Role) func(http.Handler) http.Handler {
	allowed := map[domain.Role]bool{}
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := userFrom(r.Context())
			if !ok {
				writeError(w, domain.ErrUnauthorized)
				return
			}
			if !allowed[u.Role] {
				writeError(w, domain.ErrForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
