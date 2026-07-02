# syntax=docker/dockerfile:1
FROM python

ARG UID=1000
ARG GID=1000

# BuildKit cache mounts keep the downloaded .deb files and apt index on the host
# across builds, so editing this package list re-installs from local cache instead
# of re-downloading. The mounts are build-time only (not baked into the image),
# so the image stays small without the usual rm of apt lists. Removing
# docker-clean stops the base image from discarding the cached .debs.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
    hdf5-tools

COPY requirements.txt .
RUN pip install -r requirements.txt

WORKDIR /src
