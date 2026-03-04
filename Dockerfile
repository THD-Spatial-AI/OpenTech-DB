# ─── Build stage ──────────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# Install dependencies into an isolated prefix so we can copy them cleanly
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM python:3.11-slim

# Non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY --chown=appuser:appgroup . .

USER appuser

# Expose the port uvicorn will bind to
EXPOSE 8000

# Start the API server
# Workers can be tuned via the WORKERS env variable (default: 2)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${WORKERS:-2}"]
