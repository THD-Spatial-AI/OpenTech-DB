package utils

import (
	"regexp"
	"strings"
)

type PasswordValidationError struct {
	Field   string
	Message string
}

func ValidatePassword(password string) []PasswordValidationError {
	var errors []PasswordValidationError

	if password == "" {
		errors = append(errors, PasswordValidationError{
			Field:   "password",
			Message: "password is required",
		})
		return errors
	}

	if len(password) < 8 {
		errors = append(errors, PasswordValidationError{
			Field:   "password",
			Message: "password must be at least 8 characters long",
		})
	}

	hasUpper := regexp.MustCompile(`[A-Z]`).MatchString(password)
	if !hasUpper {
		errors = append(errors, PasswordValidationError{
			Field:   "password",
			Message: "password must contain at least one uppercase letter",
		})
	}

	hasLower := regexp.MustCompile(`[a-z]`).MatchString(password)
	if !hasLower {
		errors = append(errors, PasswordValidationError{
			Field:   "password",
			Message: "password must contain at least one lowercase letter",
		})
	}

	hasNumber := regexp.MustCompile(`[0-9]`).MatchString(password)
	if !hasNumber {
		errors = append(errors, PasswordValidationError{
			Field:   "password",
			Message: "password must contain at least one number",
		})
	}

	hasSpecial := regexp.MustCompile(`[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]`).MatchString(password)
	if !hasSpecial {
		errors = append(errors, PasswordValidationError{
			Field:   "password",
			Message: "password must contain at least one special character (!@#$%^&*()_+-=[]{}';:\"|,.<>/?)",
		})
	}

	return errors
}

func ValidatePasswordMatch(password, confirmation string) *PasswordValidationError {
	if password != confirmation {
		return &PasswordValidationError{
			Field:   "password_confirmation",
			Message: "passwords do not match",
		}
	}
	return nil
}

func IsPasswordWeak(password string) (bool, string) {
	password = strings.ToLower(password)

	weakPasswords := []string{
		"password", "12345678", "qwerty", "abc123", "letmein",
		"welcome", "monkey", "123456789", "password123", "admin",
	}

	for _, weak := range weakPasswords {
		if strings.Contains(password, weak) {
			return true, "password contains a common weak pattern"
		}
	}

	for i := 0; i < len(password)-2; i++ {
		if password[i] == password[i+1] && password[i+1] == password[i+2] {
			return true, "password contains too many repeated characters"
		}
	}

	sequential := []string{"abc", "bcd", "cde", "def", "efg", "fgh", "ghi", "hij", "ijk", "jkl", "klm", "lmn", "mno", "nop", "opq", "pqr", "qrs", "rst", "stu", "tuv", "uvw", "vwx", "wxy", "xyz", "123", "234", "345", "456", "567", "678", "789"}
	for _, seq := range sequential {
		if strings.Contains(password, seq) {
			return true, "password contains sequential characters"
		}
	}

	return false, ""
}
