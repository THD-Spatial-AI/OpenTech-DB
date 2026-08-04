package httputil

// Standard error messages for consistent API responses
const (
	// User-related errors
	ErrFetchUsers      = "Failed to fetch users"
	ErrCreateUser      = "Failed to create user"
	ErrUpdateUser      = "Failed to update user"
	ErrDeleteUser      = "Failed to delete user"
	ErrDisableUser     = "Failed to disable user"
	ErrEnableUser      = "Failed to enable user"
	ErrUserNotFound    = "User not found"
	ErrInvalidUserData = "Invalid user data"

	// Group-related errors
	ErrFetchGroups       = "Failed to fetch groups"
	ErrFetchGroup        = "Failed to fetch group details"
	ErrCreateGroup       = "Failed to create group"
	ErrUpdateGroup       = "Failed to update group"
	ErrDeleteGroup       = "Failed to delete group"
	ErrDisableGroup      = "Failed to disable group"
	ErrEnableGroup       = "Failed to enable group"
	ErrGroupNotFound     = "Group not found"
	ErrInvalidGroupData  = "Invalid group data"
	ErrFetchGroupMembers = "Failed to fetch group members"
	ErrAddMember         = "Failed to add member to group"
	ErrRemoveMember      = "Failed to remove member from group"

	// Authentication/Authorization errors
	ErrUnauthorized   = "Unauthorized access"
	ErrForbidden      = "Access forbidden"
	ErrInvalidToken   = "Invalid authentication token"
	ErrSessionExpired = "Session has expired"
	ErrAuthFailed     = "Invalid credentials"

	// General errors
	ErrInternalServer = "Internal server error"
	ErrBadRequest     = "Bad request"
	ErrNotFound       = "Resource not found"
	ErrConflict       = "Resource already exists"
	ErrValidation     = "Validation error"

	// Keycloak-specific errors
	ErrKeycloakConnection = "Failed to connect to authentication service"
	ErrKeycloakOperation  = "Authentication service operation failed"
)

// Success messages for consistent API responses
const (
	MsgUserCreated  = "User created successfully"
	MsgUserUpdated  = "User updated successfully"
	MsgUserDeleted  = "User deleted successfully"
	MsgUserDisabled = "User disabled successfully"
	MsgUserEnabled  = "User enabled successfully"

	MsgGroupCreated  = "Group created successfully"
	MsgGroupUpdated  = "Group updated successfully"
	MsgGroupDeleted  = "Group deleted successfully"
	MsgGroupDisabled = "Group disabled successfully"
	MsgGroupEnabled  = "Group enabled successfully"

	MsgMemberAdded   = "Member added successfully"
	MsgMemberRemoved = "Member removed successfully"

	MsgLoginSuccessful  = "Login successful"
	MsgLogoutSuccessful = "Logout successful"
)
