# syntax=docker/dockerfile:1

# Stage 1: Build the React frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Rust backend using xx for cross-compilation
FROM --platform=$BUILDPLATFORM tonistiigi/xx:master AS xx

FROM --platform=$BUILDPLATFORM rust:1.80-alpine AS backend-builder
RUN apk add --no-cache clang lld musl-dev gcc git file
COPY --from=xx / /

ARG TARGETPLATFORM
WORKDIR /app

# Copy cargo files and source code
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src

# Create the output directory
RUN mkdir -p /out

# Build backend using xx-cargo for the target platform
RUN xx-cargo build --release --target-dir /target && \
    cp /target/$(xx-cargo --print-target)/release/backend /out/helen-collector && \
    xx-verify /out/helen-collector

# Stage 3: Final lightweight image
FROM alpine:latest
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend-builder /out/helen-collector .
# Copy static frontend assets to the final container so Axum can serve them
COPY --from=frontend-builder /app/frontend/dist ./dist

EXPOSE 3000
CMD ["./helen-collector"]
