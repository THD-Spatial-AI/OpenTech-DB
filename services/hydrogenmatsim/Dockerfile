# Hydrogen Plant Simulation Bridge - Dockerfile (OpenModelica)
# Base: python:3.11-slim with OpenModelica installation
# Much simpler than MATLAB — no licensing, no authentication, open-source!

FROM python:3.11-slim

USER root

# ──────────────────────────────────────────────────────────────────────────────
# Install OpenModelica (Optional - for production simulation)
# Falls back to mock simulation if not available  
# ──────────────────────────────────────────────────────────────────────────────
RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update -qq \
    && apt-get install -y --no-install-recommends \
        curl \
        gnupg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install OpenModelica
RUN curl -fsSL https://build.openmodelica.org/apt/openmodelica.asc | gpg --dearmor -o /usr/share/keyrings/openmodelica-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/openmodelica-keyring.gpg] https://build.openmodelica.org/apt \
        $(grep VERSION_CODENAME /etc/os-release | cut -d= -f2) stable" \
        > /etc/apt/sources.list.d/openmodelica.list \
    && apt-get update -qq \
    && apt-get install -y --no-install-recommends omc \
    && rm -rf /var/lib/apt/lists/*

# ──────────────────────────────────────────────────────────────────────────────
# Install Python dependencies
# ──────────────────────────────────────────────────────────────────────────────
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# ──────────────────────────────────────────────────────────────────────────────
# Application setup
# ──────────────────────────────────────────────────────────────────────────────
WORKDIR /app

# Copy application code
COPY main.py ./
COPY modelica/ ./modelica/

# Create non-root user for security
RUN useradd -m -u 1000 simuser && chown -R simuser:simuser /app

# Create OpenModelica working directory with proper permissions
RUN mkdir -p /home/simuser/.openmodelica/libraries && \
    chown -R simuser:simuser /home/simuser/.openmodelica

USER simuser

# Expose FastAPI port
EXPOSE 8765

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8765/api/health || exit 1

# Start FastAPI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]
