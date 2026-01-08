# Use Node as base, we'll add Python on top
FROM node:20-bookworm-slim

# Install Python and base dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    # GUI dependencies for headed mode
    xvfb \
    libgtk-3-0 \
    libnotify-dev \
    libgconf-2-4 \
    libnss3 \
    libxss1 \
    libasound2 \
    libxtst6 \
    libatspi2.0-0 \
    libdrm2 \
    libgbm1 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

# Create a virtual environment to avoid pip conflicts
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python testing dependencies globally in the venv
RUN pip install --no-cache-dir \
    pytest \
    playwright \
    pytest-playwright \
    pytest-json-report \
    pytest-html \
    pytest-xdist

# Install all Playwright browsers and their system dependencies
RUN playwright install chromium firefox webkit \
    && playwright install-deps chromium firefox webkit

# Set working directory
WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install Node dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Build the frontend
RUN npm run build

# Expose the port
EXPOSE 3001

# Environment for headed mode (uses Xvfb virtual display)
ENV DISPLAY=:99

# Start Xvfb and the server
CMD Xvfb :99 -screen 0 1920x1080x24 & node server.js
