FROM golang:1.24-alpine AS builder

WORKDIR /build
ENV GOTOOLCHAIN=auto

RUN apk add --no-cache build-base ca-certificates git

# The build context is the top-level keycloak/ directory.
COPY infrastructure/common /build/infrastructure/common
COPY infrastructure/platform /build/infrastructure/platform

# Copy the auth service originally sourced from Storcito-Wildfire.
COPY auth-service /build/auth-service

WORKDIR /build/auth-service

# Download dependencies and tidy
RUN go mod tidy && go mod download

# Build
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /build/bin/auth-service ./cmd/main.go

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata curl

WORKDIR /app

COPY --from=builder /build/bin/auth-service /app/auth-service

RUN addgroup -S auth && adduser -S -G auth auth && \
    mkdir -p /app/logs && chown -R auth:auth /app && chmod +x /app/auth-service

USER auth

EXPOSE 8001
ENV APP_HOST=0.0.0.0 APP_PORT=8001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8001/api/health || exit 1

ENTRYPOINT ["/app/auth-service"]
