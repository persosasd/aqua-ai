# AI Models and Data Pipeline Dockerfile for Aqua-AI
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements files
COPY requirements.txt /app/
COPY data-pipeline/requirements.txt /app/data-pipeline/

# Install Python dependencies
RUN pip install --no-cache-dir -r /app/requirements.txt && \
    pip install --no-cache-dir -r /app/data-pipeline/requirements.txt

# Copy source code
COPY ai-models/ /app/ai-models/
COPY data-pipeline/ /app/data-pipeline/

# Create directories for models and data
RUN mkdir -p /app/models /app/data

# Create a non-root user and switch to it
RUN groupadd -r appgroup && useradd -r -g appgroup appuser && \
    chown -R appuser:appgroup /app
USER appuser

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Health check
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD python -c "import sys; sys.exit(0)"

# Default command (can be overridden in docker-compose)
CMD ["python", "/app/data-pipeline/fetch_data.py"]
