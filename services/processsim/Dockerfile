# Process Simulation Service — steady-state + OpenModelica (ADR-0004/0005).
# OpenModelica is installed so PROCESS_ENGINE=openmodelica works; the default
# engine is steady_state (pure Python), which needs none of it.
FROM python:3.11-slim

USER root

RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update -qq \
    && apt-get install -y --no-install-recommends curl gnupg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# OpenModelica (omc) + a working C toolchain for the dynamic engine.
RUN curl -fsSL https://build.openmodelica.org/apt/openmodelica.asc | gpg --dearmor -o /usr/share/keyrings/openmodelica-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/openmodelica-keyring.gpg] https://build.openmodelica.org/apt \
        $(grep VERSION_CODENAME /etc/os-release | cut -d= -f2) stable" \
        > /etc/apt/sources.list.d/openmodelica.list \
    && apt-get update -qq \
    && apt-get install -y --no-install-recommends omc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app
COPY *.py ./
COPY modelica/ ./modelica/

RUN useradd -m -u 1000 simuser && chown -R simuser:simuser /app \
    && mkdir -p /home/simuser/.openmodelica && chown -R simuser:simuser /home/simuser/.openmodelica
USER simuser

EXPOSE 8770
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -sf http://localhost:8770/api/health || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8770"]
