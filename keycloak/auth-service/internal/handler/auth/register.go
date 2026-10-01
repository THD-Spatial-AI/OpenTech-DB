package authhandler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"regexp"
	"strings"

	"platform.local/common/pkg/httputil"
	utils "platform.local/common/pkg/utils"
	platformlogger "platform.local/platform/logger"

	"github.com/gin-gonic/gin"
)

var validUsername = regexp.MustCompile(`^[A-Za-z0-9._-]{3,64}$`)

type UserRegistration struct {
	Username             string `json:"username"`
	Email                string `json:"email"`
	Password             string `json:"password"`
	PasswordConfirmation string `json:"password_confirmation"`
}

func (u *UserRegistration) Validate() map[string]string {
	errors := make(map[string]string)
	u.Username = strings.TrimSpace(u.Username)
	u.Email = strings.TrimSpace(strings.ToLower(u.Email))
	if !validUsername.MatchString(u.Username) {
		errors["username"] = "username must be 3-64 letters, numbers, dots, underscores, or hyphens"
	}
	if u.Password == "" {
		errors["password"] = "password is required"
	}
	if parsed, err := mail.ParseAddress(u.Email); err != nil || parsed.Address != u.Email {
		errors["email"] = "enter a valid email address"
	}
	return errors
}

func (u *UserRegistration) ToKeycloakPayload() map[string]any {
	return map[string]any{
		"username": u.Username,
		"email":    u.Email,
		"enabled":  true,
	}
}

func (a *AuthHandler) Register(c *gin.Context) {
	var user UserRegistration
	if err := c.ShouldBindJSON(&user); err != nil {
		httputil.BadRequest(c, "username, email, and password are required")
		return
	}
	if !a.validateRegistrationInput(c, &user) {
		return
	}

	adminToken, err := a.adminTokenProvider.GetToken()
	if err != nil {
		httputil.BadGateway(c, "failed to authenticate registration service")
		return
	}
	if a.userExists(c, user.Username, user.Email, adminToken) {
		return
	}

	userID, ok := a.createKeycloakUser(c, &user, adminToken)
	if !ok {
		return
	}
	if err := a.setUserPassword(c.Request.Context(), userID, user.Password, adminToken); err != nil {
		a.deleteKeycloakUser(c.Request.Context(), userID, adminToken)
		platformlogger.WithFields(map[string]any{
			"component": "auth",
			"user_id":   userID,
			"error":     err,
		}).Error("failed to set Keycloak password")
		httputil.InternalError(c, "failed to set account password")
		return
	}
	if err := a.assignRealmRole(
		c.Request.Context(),
		userID,
		"contributor",
		adminToken,
	); err != nil {
		a.deleteKeycloakUser(c.Request.Context(), userID, adminToken)
		platformlogger.WithFields(map[string]any{
			"component": "registration",
			"user_id":   userID,
			"error":     err,
		}).Error("failed to assign OpenTech realm role")
		httputil.InternalError(c, "failed to assign account permissions")
		return
	}

	httputil.Created(c, gin.H{
		"message": "User registered successfully. You can now sign in.",
		"user":    gin.H{"username": user.Username, "email": user.Email},
	})
}

func (a *AuthHandler) validateRegistrationInput(c *gin.Context, user *UserRegistration) bool {
	if errors := user.Validate(); len(errors) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"errors": errors})
		return false
	}
	if passwordErrors := utils.ValidatePassword(user.Password); len(passwordErrors) > 0 {
		errors := make(map[string]string)
		for _, validationError := range passwordErrors {
			errors[validationError.Field] = validationError.Message
		}
		c.JSON(http.StatusBadRequest, gin.H{"errors": errors})
		return false
	}
	if isWeak, reason := utils.IsPasswordWeak(user.Password); isWeak {
		c.JSON(http.StatusBadRequest, gin.H{
			"errors": map[string]string{"password": reason},
		})
		return false
	}
	if matchErr := utils.ValidatePasswordMatch(
		user.Password,
		user.PasswordConfirmation,
	); matchErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"errors": map[string]string{matchErr.Field: matchErr.Message},
		})
		return false
	}
	return true
}

func (a *AuthHandler) userExists(c *gin.Context, username, email, adminToken string) bool {
	checks := []struct {
		field string
		value string
	}{
		{field: "username", value: username},
		{field: "email", value: email},
	}
	for _, check := range checks {
		if a.identityValueExists(c, check.field, check.value, adminToken) {
			return true
		}
	}
	return false
}

func (a *AuthHandler) identityValueExists(
	c *gin.Context,
	field, value, adminToken string,
) bool {
	checkURL := fmt.Sprintf(
		"%s/admin/realms/%s/users?%s=%s&exact=true",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		a.cfg.Auth.Realm,
		field,
		url.QueryEscape(value),
	)
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, checkURL, nil)
	if err != nil {
		httputil.InternalError(c, "failed to create account lookup")
		return true
	}
	req.Header.Set("Authorization", authorizationPrefix+adminToken)

	response, err := a.httpClient.Do(req)
	if err != nil {
		httputil.BadGateway(c, "failed to check existing account")
		return true
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		httputil.BadGateway(c, "account service returned an unexpected response")
		return true
	}

	var users []map[string]any
	if err := json.NewDecoder(response.Body).Decode(&users); err != nil {
		httputil.BadGateway(c, "failed to parse account lookup")
		return true
	}
	if len(users) > 0 {
		httputil.ConflictWithData(c, gin.H{
			"errors": map[string]string{field: fmt.Sprintf("This %s is already registered", field)},
		})
		return true
	}
	return false
}

func (a *AuthHandler) createKeycloakUser(
	c *gin.Context,
	user *UserRegistration,
	adminToken string,
) (string, bool) {
	createURL := fmt.Sprintf(
		"%s/admin/realms/%s/users",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		a.cfg.Auth.Realm,
	)
	payload, err := json.Marshal(user.ToKeycloakPayload())
	if err != nil {
		httputil.InternalError(c, "failed to create registration payload")
		return "", false
	}
	req, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		createURL,
		bytes.NewReader(payload),
	)
	if err != nil {
		httputil.InternalError(c, "failed to create registration request")
		return "", false
	}
	req.Header.Set("Authorization", authorizationPrefix+adminToken)
	req.Header.Set("Content-Type", "application/json")

	response, err := a.httpClient.Do(req)
	if err != nil {
		httputil.BadGateway(c, "failed to create Keycloak user")
		return "", false
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode == http.StatusConflict {
		httputil.ConflictWithData(c, gin.H{
			"errors": map[string]string{"username": "This username or email is already registered"},
		})
		return "", false
	}
	if response.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 8*1024))
		platformlogger.WithFields(map[string]any{
			"component": "registration",
			"status":    response.StatusCode,
			"response":  string(body),
		}).Error("Keycloak user creation failed")
		httputil.BadGateway(c, "account service rejected the registration")
		return "", false
	}

	location := response.Header.Get("Location")
	parts := strings.Split(strings.TrimRight(location, "/"), "/")
	if location == "" || len(parts) == 0 || parts[len(parts)-1] == "" {
		httputil.InternalError(c, "account service did not return a user identifier")
		return "", false
	}
	return parts[len(parts)-1], true
}

func (a *AuthHandler) setUserPassword(
	ctx context.Context,
	userID, password, adminToken string,
) error {
	passwordURL := fmt.Sprintf(
		"%s/admin/realms/%s/users/%s/reset-password",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		a.cfg.Auth.Realm,
		url.PathEscape(userID),
	)
	payload, err := json.Marshal(map[string]any{
		"type":      "password",
		"value":     password,
		"temporary": false,
	})
	if err != nil {
		return fmt.Errorf("marshal password payload: %w", err)
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPut,
		passwordURL,
		bytes.NewReader(payload),
	)
	if err != nil {
		return fmt.Errorf("create password request: %w", err)
	}
	req.Header.Set("Authorization", authorizationPrefix+adminToken)
	req.Header.Set("Content-Type", "application/json")

	response, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusNoContent &&
		response.StatusCode != http.StatusOK {
		return fmt.Errorf("Keycloak returned status %d", response.StatusCode)
	}
	return nil
}

func (a *AuthHandler) assignRealmRole(
	ctx context.Context,
	userID, roleName, adminToken string,
) error {
	roleURL := fmt.Sprintf(
		"%s/admin/realms/%s/roles/%s",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		a.cfg.Auth.Realm,
		url.PathEscape(roleName),
	)
	roleRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, roleURL, nil)
	if err != nil {
		return fmt.Errorf("create realm-role request: %w", err)
	}
	roleRequest.Header.Set("Authorization", authorizationPrefix+adminToken)
	roleResponse, err := a.httpClient.Do(roleRequest)
	if err != nil {
		return fmt.Errorf("get realm role: %w", err)
	}
	defer func() { _ = roleResponse.Body.Close() }()
	if roleResponse.StatusCode != http.StatusOK {
		return fmt.Errorf("get realm role: status %d", roleResponse.StatusCode)
	}

	var role map[string]any
	if err := json.NewDecoder(roleResponse.Body).Decode(&role); err != nil {
		return fmt.Errorf("decode realm role: %w", err)
	}
	rolePayload, err := json.Marshal([]map[string]any{role})
	if err != nil {
		return fmt.Errorf("marshal realm-role assignment: %w", err)
	}
	assignmentURL := fmt.Sprintf(
		"%s/admin/realms/%s/users/%s/role-mappings/realm",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		a.cfg.Auth.Realm,
		url.PathEscape(userID),
	)
	assignmentRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		assignmentURL,
		bytes.NewReader(rolePayload),
	)
	if err != nil {
		return fmt.Errorf("create realm-role assignment: %w", err)
	}
	assignmentRequest.Header.Set("Authorization", authorizationPrefix+adminToken)
	assignmentRequest.Header.Set("Content-Type", "application/json")
	assignmentResponse, err := a.httpClient.Do(assignmentRequest)
	if err != nil {
		return fmt.Errorf("assign realm role: %w", err)
	}
	defer func() { _ = assignmentResponse.Body.Close() }()
	if assignmentResponse.StatusCode != http.StatusNoContent {
		return fmt.Errorf("assign realm role: status %d", assignmentResponse.StatusCode)
	}
	return nil
}

func (a *AuthHandler) deleteKeycloakUser(
	ctx context.Context,
	userID, adminToken string,
) {
	deleteURL := fmt.Sprintf(
		"%s/admin/realms/%s/users/%s",
		strings.TrimRight(a.cfg.Auth.BaseURL, "/"),
		a.cfg.Auth.Realm,
		url.PathEscape(userID),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, deleteURL, nil)
	if err != nil {
		return
	}
	request.Header.Set("Authorization", authorizationPrefix+adminToken)
	response, err := a.httpClient.Do(request)
	if err == nil {
		_ = response.Body.Close()
	}
}
