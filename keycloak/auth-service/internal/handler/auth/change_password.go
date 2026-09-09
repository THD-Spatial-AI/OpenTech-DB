package authhandler

import (
	"net/http"

	"platform.local/common/pkg/httputil"
	utils "platform.local/common/pkg/utils"
	platformlogger "platform.local/platform/logger"

	"github.com/gin-gonic/gin"
)

// ChangePasswordRequest is the payload for an authenticated password change.
type ChangePasswordRequest struct {
	NewPassword             string `json:"new_password"`
	NewPasswordConfirmation string `json:"new_password_confirmation"`
}

// ChangePassword
func (a *AuthHandler) ChangePassword(c *gin.Context) {
	sessionData, ok := httputil.GetSessionOrAbort(c, a.sessionStore)
	if !ok {
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequestWithDetails(c, "invalid request body", err.Error())
		return
	}

	if sessionData.UserID == "" {
		httputil.Unauthorized(c, "session is missing user identity")
		return
	}

	// Validate the new password against the shared policy (length + complexity).
	if pwErrors := utils.ValidatePassword(req.NewPassword); len(pwErrors) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"errors": map[string]string{"new_password": pwErrors[0].Message}})
		return
	}
	if isWeak, reason := utils.IsPasswordWeak(req.NewPassword); isWeak {
		c.JSON(http.StatusBadRequest, gin.H{"errors": map[string]string{"new_password": reason}})
		return
	}
	if req.NewPassword != req.NewPasswordConfirmation {
		c.JSON(http.StatusBadRequest, gin.H{"errors": map[string]string{"new_password_confirmation": "passwords do not match"}})
		return
	}

	// Update the password via the Keycloak admin API.
	adminToken, err := a.adminTokenProvider.GetToken()
	if err != nil {
		httputil.InternalError(c, "failed to obtain admin token")
		return
	}
	if err := a.setUserPassword(
		c.Request.Context(),
		sessionData.UserID,
		req.NewPassword,
		adminToken,
	); err != nil {
		platformlogger.WithFields(map[string]any{
			"component": "change_password",
			"user_id":   sessionData.UserID,
			"error":     err,
		}).Error("failed to set new password")
		httputil.InternalError(c, "failed to update password")
		return
	}

	platformlogger.WithFields(map[string]any{
		"component": "change_password",
		"user_id":   sessionData.UserID,
	}).Info("password changed successfully")

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Password changed successfully"})
}
