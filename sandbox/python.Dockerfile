# Image for sandboxed Python test runs (audit C3). It carries only the system libraries the browsers
# need. pytest, playwright and the browsers are installed per run, into the mounted work directory,
# so they always match the generated requirements.txt.
#   npm run sandbox:build
FROM python:3.12-slim-bookworm

# `playwright install-deps` needs the playwright package to know which packages to install; it is
# removed afterwards so the run installs exactly what the generated project asks for.
RUN pip install --no-cache-dir playwright \
    && playwright install-deps chromium firefox webkit \
    && pip uninstall -y playwright \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
