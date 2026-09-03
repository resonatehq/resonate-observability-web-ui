# The console is static files, so the runtime image is a web server and nothing
# else — no Node in the final image, nothing to patch but nginx.
#
# `--platform=$BUILDPLATFORM` pins the build stage to the machine doing the
# building rather than the target architecture. The output of `vite build` is
# architecture-independent, so an arm64 image does not need an emulated arm64
# Node to produce it; without this, a multi-arch build runs the whole toolchain
# under QEMU once per platform for byte-identical results.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

# Copy the manifests alone first so `npm ci` is cached against dependency
# changes rather than against every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY svelte.config.js vite.config.ts tsconfig.json ./
COPY src ./src
COPY static ./static

RUN npm run build


FROM nginx:alpine

# SPA routing, cache headers, and a 404 (not a fallback) for missing hashed
# assets. See the file for why each rule is there.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

# Deliberately a request for the app itself, not a bare `/healthz` that only
# proves nginx is listening: this way an image whose html directory failed to
# populate is unhealthy instead of serving 404s while reporting fine.
#
# 127.0.0.1, not `localhost`. The base image's /etc/hosts maps `localhost` to
# both 127.0.0.1 and ::1, wget tries the IPv6 address first, and this config
# listens on IPv4 only — so the `localhost` spelling is refused on every
# interval and the container reports unhealthy while serving every request fine.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
	CMD wget -q --spider http://127.0.0.1/ || exit 1
