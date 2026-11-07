// Package auth реализует хеширование паролей, выпуск и проверку JWT.
package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/zigih-1212/mindia-kz-demo-work/backend/internal/domain"
)

// ErrInvalidToken возвращается при невалидном или просроченном токене.
var ErrInvalidToken = errors.New("invalid token")

// Claims — полезная нагрузка JWT.
type Claims struct {
	UserID   string      `json:"uid"`
	Email    string      `json:"email"`
	Role     domain.Role `json:"role"`
	jwt.RegisteredClaims
}

// Manager выпускает и проверяет токены, а также хеширует пароли.
type Manager struct {
	secret []byte
	ttl    time.Duration
	issuer string
}

// NewManager создаёт менеджер аутентификации.
func NewManager(secret string, ttl time.Duration) *Manager {
	return &Manager{secret: []byte(secret), ttl: ttl, issuer: "mindia-kz-demo"}
}

// HashPassword возвращает bcrypt-хеш пароля.
func (m *Manager) HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(h), nil
}

// CheckPassword сравнивает пароль с хешем.
func (m *Manager) CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// Issue выпускает подписанный JWT для пользователя.
func (m *Manager) Issue(u *domain.User) (string, time.Time, error) {
	now := time.Now()
	exp := now.Add(m.ttl)
	claims := Claims{
		UserID: u.ID,
		Email:  u.Email,
		Role:   u.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    m.issuer,
			Subject:   u.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(m.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign token: %w", err)
	}
	return signed, exp, nil
}

// Parse проверяет подпись и срок действия токена и возвращает claims.
func (m *Manager) Parse(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	}, jwt.WithIssuer(m.issuer), jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
