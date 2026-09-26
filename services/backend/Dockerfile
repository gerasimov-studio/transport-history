FROM golang:1.26-alpine AS build

WORKDIR /src
COPY services/backend/go.mod services/backend/go.sum ./
RUN go mod download
COPY services/backend ./
ARG COMMAND=api
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/service ./cmd/${COMMAND}

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/service /service
COPY db/init.sql /migrations/init.sql
EXPOSE 3001
ENTRYPOINT ["/service"]
