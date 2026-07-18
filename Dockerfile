# HadeelOS — single-process deployment image.
#
# Builds the frontend (React/Vite) into static assets, then runs the
# decision-engine backend as the container's one process, serving both
# the API (/api/*) and the built frontend from the same Node process
# (see decision-engine/src/staticFiles.ts). This is a deployment
# RECIPE, prepared per MVP Hardening item #11 — building this image
# does not deploy it anywhere, and no credentials were requested to
# produce it.
#
# Build:  docker build -t hadeelos .
# Run:    docker run -p 3000:3000 \
#           -e DATABASE_URL=postgres://... \
#           -e TOKEN_ENCRYPTION_KEY=... \
#           hadeelos
# (See README "Environment Variables" for the full list, and
# docs/DEPLOYMENT.md for the complete recipe including how to generate
# TOKEN_ENCRYPTION_KEY and run migrations.)

FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-slim AS backend
WORKDIR /app/decision-engine
COPY decision-engine/package.json decision-engine/package-lock.json ./
RUN npm ci --omit=dev
COPY decision-engine/ ./
COPY --from=frontend-build /app/frontend/dist ./static

ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/decision-engine/static

EXPOSE 3000

CMD ["npx", "tsx", "src/main.ts"]
