.DEFAULT_GOAL := help

.PHONY: help deps install pull up down dev build run stop clean logs

help:
	@echo "Auth Service - Available Commands"
	@echo "=================================="
	@echo ""
	@echo "Infrastructure:"
	@echo "  make pull       Pull required containers (postgres, redis, keycloak)"
	@echo "  make up         Start infrastructure services"
	@echo "  make down       Stop infrastructure services"
	@echo "  make logs       View container logs"
	@echo ""
	@echo "Development:"
	@echo "  make deps       Download Go module dependencies"
	@echo "  make install    Alias for deps"
	@echo "  make dev        Run auth-service locally (go run)"
	@echo "  make build      Build auth-service binary"
	@echo "  make run        Run built binary"
	@echo ""
	@echo "Container:"
	@echo "  make build-image     Build Docker image"
	@echo "  make run-container   Run auth-service in container"
	@echo "  make stop-container  Stop auth-service container"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean      Remove containers, volumes and build artifacts"
	@echo ""
	@echo "Ports:"
	@echo "  PostgreSQL: localhost:5433"
	@echo "  Redis:      localhost:6379"
	@echo "  Keycloak:   localhost:8080"
	@echo "  Auth-Service: localhost:8081"

deps:
	@echo "Downloading Go dependencies..."
	go mod tidy
	go mod download
	@echo "✓ Dependencies ready"

install: deps

pull:
	@echo "Pulling required containers..."
	docker pull postgis/postgis:17-3.5
	docker pull redis:7-alpine
	docker pull quay.io/keycloak/keycloak:26.0.6
	@echo "✓ Containers pulled"

up:
	@echo "Starting infrastructure..."
	docker compose up -d postgres redis keycloak
	@echo ""
	@echo "✓ Services started:"
	@echo "  PostgreSQL: localhost:5433"
	@echo "  Redis:      localhost:6379"
	@echo "  Keycloak:   http://localhost:8180"

down:
	docker compose down

logs:
	docker compose logs -f

dev:
	@echo "Starting auth-service..."
	go run ./cmd/main.go

build:
	@echo "Building auth-service..."
	go build -o main ./cmd/
	@echo "✓ Built: ./main"

run: build
	./main

build-image:
	@echo "Building Docker image..."
	docker build -t auth-service:local .
	@echo "✓ Image built: auth-service:local"

run-container:
	@echo "Running auth-service container..."
	docker run -d --name auth-service \
		--network host \
		-p 8081:8081 \
		--env-file .env \
		auth-service:local
	@echo "✓ Auth-service running on localhost:8081"

stop-container:
	docker stop auth-service || true
	docker rm auth-service || true

clean:
	docker compose down -v
	rm -f main
	@echo "✓ Cleaned"
