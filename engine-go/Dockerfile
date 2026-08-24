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
# Identità di build reale (tag git o dev-<sha>, decisa da release.yml) --
# in un file, non un ENV, così un "environment:" in compose non può sovrascriverla
# per sbaglio. Usata come Sentry release al posto del canale IMAGE_TAG a runtime
# (mobile su dev/latest, quindi identico per build diverse -- inutile per distinguerle).
ARG BUILD_VERSION=sconosciuta
RUN echo "$BUILD_VERSION" > /etc/polaris-build-version
COPY --from=build /out/service /usr/local/bin/service
EXPOSE 8080
USER nobody
CMD ["service"]
