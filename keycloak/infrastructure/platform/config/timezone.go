package config

import (
	"time"

	"github.com/sirupsen/logrus"
)

// SetupTimezone configures time.Local based on provided timezone, falling back to UTC on error.
func SetupTimezone(timezone string, log logrus.FieldLogger) {
	if timezone == "" {
		timezone = "UTC"
	}

	loc, err := time.LoadLocation(timezone)
	if err != nil {
		if log != nil {
			log.Warnf("Failed to load timezone '%s', falling back to UTC: %v", timezone, err)
		}
		time.Local = time.UTC
		return
	}

	time.Local = loc
}
