package logger

import (
	"fmt"
	"io"
	"os"
	"time"

	rotatelogs "github.com/lestrrat-go/file-rotatelogs"
	"github.com/sirupsen/logrus"
)

var Logger = logrus.New()

// Init sets up logrus with daily rotation, keeping 7 days of logs
func Init(logDir, baseName string) error {
	if logDir == "" {
		logDir = "logs"
	}
	if baseName == "" {
		baseName = "app"
	}
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return fmt.Errorf("create log dir: %w", err)
	}

	pattern := logDir + "/" + baseName + "-%Y-%m-%d.log"

	rl, err := rotatelogs.New(
		pattern,
		rotatelogs.WithRotationTime(24*time.Hour),
		rotatelogs.WithMaxAge(7*24*time.Hour),
	)
	if err != nil {
		return fmt.Errorf("create rotatelogs: %w", err)
	}

	level, err := logrus.ParseLevel(os.Getenv("LOG_LEVEL"))
	if err != nil {
		level = logrus.InfoLevel
	}

	switch os.Getenv("LOG_FORMAT") {
	case "json":
		Logger.SetFormatter(&logrus.JSONFormatter{TimestampFormat: time.RFC3339})
	default:
		Logger.SetFormatter(&logrus.TextFormatter{
			FullTimestamp:   false,
			DisableQuote:    true,
			DisableColors:   true,
			TimestampFormat: time.RFC3339,
		})
	}

	Logger.SetLevel(level)

	mw := io.MultiWriter(os.Stdout, rl)
	Logger.SetOutput(mw)

	_ = os.Remove(logDir + "/" + baseName + ".log")

	return nil
}

func WithFields(fields logrus.Fields) *logrus.Entry {
	return Logger.WithFields(fields)
}

// This is a convenience function to standardize component logging across the codebase
func ForComponent(component string) *logrus.Entry {
	return Logger.WithField("component", component)
}
