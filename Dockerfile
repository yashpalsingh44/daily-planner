# Stage 1: Build binary using Golang 1.22 Alpine
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy module files
COPY go.mod ./
RUN go mod download

# Copy source files
COPY . .

# Build application CGO-free
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o aetherplan main.go

# Stage 2: Production Runtime Container
FROM alpine:latest

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/aetherplan /app/aetherplan

# Copy public static frontend directory
COPY --from=builder /app/public /app/public

# Create data directory for SQLite persistence volume
RUN mkdir -p /app/data

EXPOSE 8080

# Run server
CMD ["/app/aetherplan"]
