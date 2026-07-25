# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /out/service ./cmd/service

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Europe/Rome
COPY --from=build /out/service /usr/local/bin/service
EXPOSE 8080
USER nobody
CMD ["service"]
