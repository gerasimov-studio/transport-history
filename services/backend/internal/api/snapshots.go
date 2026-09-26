package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"transport-history/backend/internal/domain"
	"transport-history/backend/internal/httpjson"
)

type snapshotInput struct {
	City, Mode, Date, Title, Summary string
	Features                         []json.RawMessage `json:"features"`
}
type validatedSnapshotFeature struct {
	Kind, LineID, Number, Name, Color, TrackForm, FacilityKind string
	NodeKind                                                   *string
	Geometry                                                   domain.Geometry
}

func snapshotKey(city, mode, date string) string { return city + "-" + mode + "-" + date }
func numberFromLineID(id, city, mode string) string {
	prefix := city + "-" + mode + "-"
	if strings.HasPrefix(id, prefix) {
		return strings.TrimPrefix(id, prefix)
	}
	id = strings.TrimPrefix(strings.TrimPrefix(id, "tm-"), "line-")
	if id == "" {
		return "1"
	}
	return id
}

func validateSnapshotFeatures(input snapshotInput) ([]validatedSnapshotFeature, error) {
	out := []validatedSnapshotFeature{}
	for i, raw := range input.Features {
		var v struct {
			Properties struct {
				Kind         string `json:"kind"`
				LineID       string `json:"lineId"`
				Number       string `json:"number"`
				Name         string `json:"name"`
				Color        string `json:"color"`
				TrackForm    string `json:"trackForm"`
				NodeKind     string `json:"nodeKind"`
				FacilityKind string `json:"facilityKind"`
			} `json:"properties"`
			Geometry domain.Geometry `json:"geometry"`
		}
		if json.Unmarshal(raw, &v) != nil {
			return nil, fmt.Errorf("feature %d: geometry", i)
		}
		p := v.Properties
		if p.Kind != "track" && p.Kind != "stop" && p.Kind != "node" && p.Kind != "area" {
			return nil, fmt.Errorf("feature %d: kind", i)
		}
		if v.Geometry.Type == "" {
			return nil, fmt.Errorf("feature %d: geometry", i)
		}
		number := strings.TrimSpace(p.Number)
		if number == "" {
			number = numberFromLineID(p.LineID, input.City, input.Mode)
		}
		lineID := input.City + "-" + input.Mode + "-" + number
		form := p.TrackForm
		if !domain.TrackForms[form] {
			if input.Mode == "metro" {
				form = "double"
			} else {
				form = "single_both"
			}
		}
		if p.Kind == "track" && v.Geometry.Type != "LineString" && v.Geometry.Type != "MultiLineString" {
			return nil, fmt.Errorf("feature %d: track geometry", i)
		}
		if p.Kind == "stop" && v.Geometry.Type != "Point" {
			return nil, fmt.Errorf("feature %d: stop geometry", i)
		}
		if p.Kind == "area" && (p.FacilityKind != "depot" || v.Geometry.Type != "Polygon" || domain.CoordinateCount(v.Geometry) < 4) {
			return nil, fmt.Errorf("feature %d: depot area", i)
		}
		var nk *string
		if p.Kind == "node" {
			if !domain.NodeKinds[p.NodeKind] {
				return nil, fmt.Errorf("feature %d: nodeKind", i)
			}
			line := p.NodeKind == "loop" || p.NodeKind == "wye" || p.NodeKind == "crossover"
			if (line && (v.Geometry.Type != "LineString" && v.Geometry.Type != "MultiLineString")) || (!line && v.Geometry.Type != "Point") {
				return nil, fmt.Errorf("feature %d: node geometry", i)
			}
			q := p.NodeKind
			nk = &q
		}
		name := strings.TrimSpace(p.Name)
		if name == "" {
			if p.Kind == "track" {
				name = "Маршрут №" + number
			} else if p.Kind == "stop" {
				name = "Остановка"
			} else {
				name = "Узел"
			}
		}
		color := strings.TrimSpace(p.Color)
		if color == "" {
			color = "#c45c26"
		}
		out = append(out, validatedSnapshotFeature{p.Kind, lineID, number, name, color, form, p.FacilityKind, nk, v.Geometry})
	}
	return out, nil
}

func (s *Server) snapshotNetwork(w http.ResponseWriter, r *http.Request) {
	id := pathID(snapshotNetworkPath, r.URL.Path)
	var city, mode string
	_ = s.pool.QueryRow(r.Context(), `SELECT city_id,mode FROM snapshots WHERE id=$1`, id).Scan(&city, &mode)
	rows, err := s.pool.Query(r.Context(), `SELECT kind,line_id,name,color,track_form,node_kind,facility_kind,ST_AsGeoJSON(geom)::json FROM features WHERE snapshot_id=$1 ORDER BY id`, id)
	if err != nil {
		s.fail(w, err)
		return
	}
	defer rows.Close()
	features := []map[string]any{}
	for rows.Next() {
		var kind, line, name, color, form string
		var node, facility *string
		var geom json.RawMessage
		if rows.Scan(&kind, &line, &name, &color, &form, &node, &facility, &geom) == nil {
			var geometry any
			_ = json.Unmarshal(geom, &geometry)
			features = append(features, map[string]any{"type": "Feature", "properties": map[string]any{"kind": kind, "mode": fallback(mode, "tram"), "lineId": line, "number": numberFromLineID(line, city, mode), "name": name, "color": color, "trackForm": fallback(form, "double"), "nodeKind": node, "facilityKind": facility}, "geometry": geometry})
		}
	}
	httpjson.Write(w, 200, map[string]any{"type": "FeatureCollection", "features": features})
}
func fallback(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

func (s *Server) createSnapshot(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	var body snapshotInput
	if httpjson.Read(r, &body) != nil {
		httpjson.Write(w, 400, map[string]string{"error": "bad request"})
		return
	}
	id := snapshotKey(body.City, body.Mode, body.Date)
	if err := s.writeSnapshot(r, id, body, ""); err != nil {
		if uniqueViolation(err) {
			httpjson.Write(w, 409, map[string]string{"error": "snapshot exists"})
		} else {
			httpjson.Write(w, 400, map[string]string{"error": err.Error()})
		}
		return
	}
	httpjson.Write(w, 201, map[string]string{"id": id, "network": "/api/snapshots/" + id + "/network"})
}
func (s *Server) mutateSnapshot(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	old := pathID(snapshotPath, r.URL.Path)
	if r.Method == http.MethodDelete {
		tag, err := s.pool.Exec(r.Context(), `DELETE FROM snapshots WHERE id=$1`, old)
		if err != nil {
			s.fail(w, err)
			return
		}
		if tag.RowsAffected() == 0 {
			httpjson.Write(w, 404, map[string]string{"error": "not found"})
		} else {
			httpjson.Write(w, 200, map[string]bool{"ok": true})
		}
		return
	}
	var body snapshotInput
	if httpjson.Read(r, &body) != nil {
		httpjson.Write(w, 400, map[string]string{"error": "bad request"})
		return
	}
	id := snapshotKey(body.City, body.Mode, body.Date)
	if err := s.writeSnapshot(r, id, body, old); err != nil {
		if uniqueViolation(err) {
			httpjson.Write(w, 409, map[string]string{"error": "snapshot exists"})
		} else {
			httpjson.Write(w, 400, map[string]string{"error": err.Error()})
		}
		return
	}
	httpjson.Write(w, 200, map[string]string{"id": id, "network": "/api/snapshots/" + id + "/network"})
}

func (s *Server) writeSnapshot(r *http.Request, id string, input snapshotInput, old string) error {
	input.City = strings.TrimSpace(input.City)
	input.Mode = strings.TrimSpace(input.Mode)
	input.Date = strings.TrimSpace(input.Date)
	input.Title = strings.TrimSpace(input.Title)
	if input.City == "" || input.Mode == "" || input.Date == "" || input.Title == "" {
		return fmt.Errorf("city, mode, date, title")
	}
	if !domain.Modes[input.Mode] {
		return fmt.Errorf("mode")
	}
	if !domain.ValidDate(input.Date) {
		return fmt.Errorf("date")
	}
	var exists bool
	if err := s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM cities WHERE id=$1)`, input.City).Scan(&exists); err != nil || !exists {
		return fmt.Errorf("city")
	}
	features, err := validateSnapshotFeatures(input)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())
	if old != "" && old != id {
		if _, err = tx.Exec(r.Context(), `DELETE FROM snapshots WHERE id=$1`, old); err != nil {
			return err
		}
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO snapshots(id,city_id,mode,on_date,title,summary)VALUES($1,$2,$3,$4,$5,$6)ON CONFLICT(id)DO UPDATE SET city_id=EXCLUDED.city_id,mode=EXCLUDED.mode,on_date=EXCLUDED.on_date,title=EXCLUDED.title,summary=EXCLUDED.summary`, id, input.City, input.Mode, input.Date, input.Title, input.Summary)
	if err != nil {
		return err
	}
	lines := map[string]validatedSnapshotFeature{}
	for _, v := range features {
		cur, ok := lines[v.LineID]
		if !ok || v.Kind == "track" {
			if ok && v.Kind != "track" {
				v.Name = cur.Name
			}
			lines[v.LineID] = v
		}
	}
	for lineID, v := range lines {
		_, err = tx.Exec(r.Context(), `INSERT INTO lines(id,city_id,mode,number,name,color)VALUES($1,$2,$3,$4,$5,$6)ON CONFLICT(id)DO UPDATE SET name=EXCLUDED.name,color=EXCLUDED.color,number=EXCLUDED.number`, lineID, input.City, input.Mode, v.Number, v.Name, v.Color)
		if err != nil {
			return err
		}
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM features WHERE snapshot_id=$1`, id); err != nil {
		return err
	}
	for _, v := range features {
		geom, _ := json.Marshal(v.Geometry)
		_, err = tx.Exec(r.Context(), `INSERT INTO features(snapshot_id,kind,line_id,name,color,track_form,node_kind,facility_kind,geom)VALUES($1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_GeomFromGeoJSON($9),4326))`, id, v.Kind, v.LineID, v.Name, v.Color, v.TrackForm, v.NodeKind, v.FacilityKind, geom)
		if err != nil {
			return err
		}
	}
	return tx.Commit(r.Context())
}
func uniqueViolation(err error) bool {
	var e *pgconn.PgError
	return errors.As(err, &e) && e.Code == "23505"
}
