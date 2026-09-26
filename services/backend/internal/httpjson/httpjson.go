package httpjson

import (
	"encoding/json"
	"io"
	"net/http"
)

func Write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func Read(r *http.Request, value any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 2_000_000))
	decoder.DisallowUnknownFields()
	return decoder.Decode(value)
}
