# Image for sandboxed Python test runs (audit C3). It carries only the system libraries the browsers
# need. pytest, playwright and the browsers are installed per run, into the mounted work directory,
# so they always match the generated requirements.txt.
#   npm run sandbox:build
FROM python:3.12-slim-bookworm

# `playwright install-deps` needs the playwright package to know which packages to install, and the
# package's bundled Node driver needs libatomic1, which the slim base image does not have (without it
# the driver fails with "libatomic.so.1: cannot open shared object file", exit code 127). The package is
# removed afterwards so the run installs exactly what the generated project asks for.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libatomic1 \
    && pip install --no-cache-dir playwright \
    && playwright install-deps chromium firefox webkit \
    && pip uninstall -y playwright \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
