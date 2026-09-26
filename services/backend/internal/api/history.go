package api

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"transport-history/backend/internal/auth"
	"transport-history/backend/internal/domain"
	"transport-history/backend/internal/httpjson"
)

type bounds struct {
	West  float64 `json:"west"`
	South float64 `json:"south"`
	East  float64 `json:"east"`
	North float64 `json:"north"`
}

func parseBounds(raw string) (bounds, bool) {
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return bounds{}, false
	}
	v := make([]float64, 4)
	for i, s := range parts {
		n, e := strconv.ParseFloat(s, 64)
		if e != nil || math.IsNaN(n) || math.IsInf(n, 0) {
			return bounds{}, false
		}
		v[i] = n
	}
	b := bounds{math.Max(-180, v[0]), math.Max(-90, v[1]), math.Min(180, v[2]), math.Min(90, v[3])}
	return b, b.West < b.East && b.South < b.North
}

func (s *Server) loadEvents(ctx context.Context, scope string) ([]domain.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,type,occurred_on::text,COALESCE(city_id,''),actor,payload FROM events WHERE scope_id=$1 ORDER BY occurred_on,id`, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Event{}
	for rows.Next() {
		var e domain.Event
		if err := rows.Scan(&e.ID, &e.Type, &e.OccurredOn, &e.CityID, &e.Actor, &e.Payload); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Server) syncProjection(ctx context.Context, scope string) error {
	events, err := s.loadEvents(ctx, scope)
	if err != nil {
		return err
	}
	state := domain.Project(events, "")
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM network_routes WHERE source_scope=$1`, scope); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM network_infra WHERE source_scope=$1`, scope); err != nil {
		return err
	}
	for _, v := range state.Infra {
		raw, _ := json.Marshal(v)
		geom, _ := json.Marshal(v.Geometry)
		var since, until any
		if v.Since != "" {
			since = v.Since
		}
		if v.Until != "" {
			until = v.Until
		}
		if _, err = tx.Exec(ctx, `INSERT INTO network_infra(id,source_scope,kind,way,valid_from,valid_to,payload,geom) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,ST_SetSRID(ST_GeomFromGeoJSON($8),4326))`, v.ID, scope, v.Kind, v.Way, since, until, raw, geom); err != nil {
			return err
		}
	}
	for _, v := range state.Routes {
		raw, _ := json.Marshal(v)
		ids := append([]string{}, v.SegmentIDs...)
		var geom any
		for _, leg := range v.Legs {
			if leg.Type == "wire" {
				ids = append(ids, leg.SegmentIDs...)
			} else if leg.Type == "autonomous" && leg.Geometry != nil && geom == nil {
				q, _ := json.Marshal(leg.Geometry)
				geom = q
			}
		}
		if geom == nil && v.Geometry != nil {
			q, _ := json.Marshal(v.Geometry)
			geom = q
		}
		ids = uniqueStrings(ids)
		var since, until any
		if v.Since != "" {
			since = v.Since
		}
		if v.Until != "" {
			until = v.Until
		}
		if _, err = tx.Exec(ctx, `INSERT INTO network_routes(id,source_scope,mode,valid_from,valid_to,segment_ids,geom,payload) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7::jsonb IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($7),4326) END,$8::jsonb)`, v.ID, scope, v.Mode, since, until, ids, geom, raw); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO projection_checkpoints(scope_id,last_event_id,projected_at)
		SELECT $1,COALESCE(max(id),0),now() FROM events WHERE scope_id=$1
		ON CONFLICT(scope_id) DO UPDATE SET last_event_id=EXCLUDED.last_event_id,projected_at=EXCLUDED.projected_at`, scope); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Server) SyncAllProjections(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT event_scope.scope_id
		FROM (SELECT scope_id,max(id) AS last_event_id FROM events GROUP BY scope_id) event_scope
		LEFT JOIN projection_checkpoints checkpoint ON checkpoint.scope_id=event_scope.scope_id
		WHERE checkpoint.last_event_id IS DISTINCT FROM event_scope.last_event_id
		ORDER BY event_scope.scope_id`)
	if err != nil {
		return err
	}
	scopes := []string{}
	for rows.Next() {
		var q string
		if rows.Scan(&q) == nil {
			scopes = append(scopes, q)
		}
	}
	rows.Close()
	for _, q := range scopes {
		if err = s.syncProjection(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range in {
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func (s *Server) locationContext(w http.ResponseWriter, r *http.Request) {
	lat, e1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, e2 := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if e1 != nil || e2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		httpjson.Write(w, 400, map[string]string{"error": "lat, lng"})
		return
	}
	key := fmt.Sprintf("%.2f,%.2f", lat, lng)
	if v, ok := s.locationCache[key]; ok {
		httpjson.Write(w, 200, v)
		return
	}
	u, _ := url.Parse("https://nominatim.openstreetmap.org/reverse")
	q := u.Query()
	q.Set("format", "jsonv2")
	q.Set("lat", strconv.FormatFloat(lat, 'f', -1, 64))
	q.Set("lon", strconv.FormatFloat(lng, 'f', -1, 64))
	q.Set("zoom", "3")
	u.RawQuery = q.Encode()
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, u.String(), nil)
	req.Header.Set("user-agent", "transport-history/1.0 (transporthistory.net)")
	resp, err := s.httpClient.Do(req)
	if err != nil || resp.StatusCode/100 != 2 {
		v := map[string]any{}
		s.locationCache[key] = v
		httpjson.Write(w, 200, v)
		return
	}
	defer resp.Body.Close()
	var data struct {
		BoundingBox []string `json:"boundingbox"`
	}
	if json.NewDecoder(resp.Body).Decode(&data) != nil || len(data.BoundingBox) != 4 {
		httpjson.Write(w, 200, map[string]any{})
		return
	}
	vals := make([]float64, 4)
	for i, v := range data.BoundingBox {
		vals[i], err = strconv.ParseFloat(v, 64)
		if err != nil {
			httpjson.Write(w, 200, map[string]any{})
			return
		}
	}
	v := map[string]any{"bounds": [][]float64{{vals[0], vals[2]}, {vals[1], vals[3]}}}
	s.locationCache[key] = v
	httpjson.Write(w, 200, v)
}

func (s *Server) catalog(w http.ResponseWriter, r *http.Request) {
	type city struct {
		ID, Name               string
		Aliases                []string
		Lat, Lng               float64
		Zoom, MinZoom, MaxZoom int
	}
	rows, err := s.pool.Query(r.Context(), `SELECT id,name,aliases,lat,lng,zoom,min_zoom,max_zoom FROM cities ORDER BY id`)
	if err != nil {
		s.fail(w, err)
		return
	}
	cities := []city{}
	for rows.Next() {
		var v city
		if rows.Scan(&v.ID, &v.Name, &v.Aliases, &v.Lat, &v.Lng, &v.Zoom, &v.MinZoom, &v.MaxZoom) == nil {
			cities = append(cities, v)
		}
	}
	rows.Close()
	cityOut := []map[string]any{}
	lines := []map[string]any{}
	snapshots := []domain.Chronicle{}
	dateSet := map[string]bool{}
	for _, c := range cities {
		cityOut = append(cityOut, map[string]any{"id": c.ID, "name": c.Name, "aliases": c.Aliases, "zoom": c.Zoom, "minZoom": c.MinZoom, "maxZoom": c.MaxZoom, "center": []float64{c.Lat, c.Lng}})
		events, e := s.loadEvents(r.Context(), c.ID)
		if e != nil {
			s.fail(w, e)
			return
		}
		state := domain.Project(events, "")
		for _, e := range events {
			dateSet[e.OccurredOn] = true
		}
		for _, v := range state.Infra {
			if v.Since != "" {
				dateSet[v.Since] = true
			}
			if v.Until != "" {
				dateSet[v.Until] = true
			}
		}
		for _, v := range state.Routes {
			if v.Since != "" {
				dateSet[v.Since] = true
			}
			if v.Until != "" {
				dateSet[v.Until] = true
			}
			lines = append(lines, map[string]any{"id": v.ID, "city": c.ID, "mode": v.Mode, "number": v.Number, "name": v.Name, "color": v.Color})
		}
		for _, v := range state.Chronicles {
			dateSet[v.Date] = true
			snapshots = append(snapshots, v)
		}
	}
	sort.Slice(lines, func(i, j int) bool {
		a, b := lines[i], lines[j]
		if a["mode"].(string) != b["mode"].(string) {
			return a["mode"].(string) < b["mode"].(string)
		}
		return a["number"].(string) < b["number"].(string)
	})
	sort.Slice(snapshots, func(i, j int) bool {
		if snapshots[i].Date != snapshots[j].Date {
			return snapshots[i].Date < snapshots[j].Date
		}
		return snapshots[i].Mode < snapshots[j].Mode
	})
	modeCodes := map[string]string{}
	rows, _ = s.pool.Query(r.Context(), `SELECT code,mode FROM mode_codes`)
	for rows.Next() {
		var a, b string
		if rows.Scan(&a, &b) == nil {
			modeCodes[a] = b
		}
	}
	rows.Close()
	type system struct {
		ID, Name   string
		Aliases    []string
		Lat, Lng   float64
		Zoom       int
		Localities []string
	}
	systems := []map[string]any{}
	rows, err = s.pool.Query(r.Context(), `SELECT system.id,COALESCE(effective_name.name,system.name),system.aliases,system.lat,system.lng,system.zoom,
		COALESCE(array_agg(locality.name ORDER BY locality.name) FILTER(WHERE locality.name IS NOT NULL),'{}')
		FROM transport_systems system
		LEFT JOIN LATERAL(
			SELECT history.name FROM transport_system_names history
			WHERE history.system_id=system.id AND history.valid_from<=CURRENT_DATE
				AND(history.valid_to IS NULL OR history.valid_to>=CURRENT_DATE)
			ORDER BY history.valid_from DESC LIMIT 1
		)effective_name ON true
		LEFT JOIN transport_system_localities locality ON locality.system_id=system.id
			AND(locality.valid_from IS NULL OR locality.valid_from<=CURRENT_DATE)
			AND(locality.valid_to IS NULL OR locality.valid_to>=CURRENT_DATE)
		GROUP BY system.id,effective_name.name ORDER BY system.id`)
	if err != nil {
		s.fail(w, err)
		return
	}
	for rows.Next() {
		var v system
		if rows.Scan(&v.ID, &v.Name, &v.Aliases, &v.Lat, &v.Lng, &v.Zoom, &v.Localities) == nil {
			systems = append(systems, map[string]any{"id": v.ID, "name": v.Name, "aliases": v.Aliases, "center": []float64{v.Lat, v.Lng}, "zoom": v.Zoom, "minZoom": 2, "maxZoom": 22, "localities": v.Localities})
		}
	}
	rows.Close()
	dates := keys(dateSet)
	httpjson.Write(w, 200, map[string]any{"cities": cityOut, "systems": systems, "lines": lines, "modeCodes": modeCodes, "dates": dates, "snapshots": snapshots})
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
func (s *Server) fail(w http.ResponseWriter, err error) {
	httpjson.Write(w, 500, map[string]string{"error": err.Error()})
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	city := strings.TrimSpace(r.URL.Query().Get("city"))
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	var exists bool
	if s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM cities WHERE id=$1)`, city).Scan(&exists) != nil || !exists {
		httpjson.Write(w, 400, map[string]string{"error": "city"})
		return
	}
	if !domain.ValidDate(date) {
		httpjson.Write(w, 400, map[string]string{"error": "date"})
		return
	}
	events, err := s.loadEvents(r.Context(), city)
	if err != nil {
		s.fail(w, err)
		return
	}
	p := domain.Project(events, date)
	infra := make([]domain.Infra, 0, len(p.Infra))
	routes := make([]domain.Route, 0, len(p.Routes))
	chron := make([]domain.Chronicle, 0, len(p.Chronicles))
	for _, v := range p.Infra {
		infra = append(infra, v)
	}
	for _, v := range p.Routes {
		routes = append(routes, v)
	}
	for _, v := range p.Chronicles {
		chron = append(chron, v)
	}
	sort.Slice(chron, func(i, j int) bool { return chron[i].Date < chron[j].Date })
	httpjson.Write(w, 200, map[string]any{"city": city, "date": date, "infra": infra, "routes": routes, "chronicles": chron, "features": domain.Features(p, date)})
}

type mapState struct {
	Scope      string             `json:"scope"`
	Bounds     bounds             `json:"bounds"`
	Zoom       float64            `json:"zoom"`
	Date       string             `json:"date"`
	Dates      []string           `json:"dates"`
	Events     []domain.Chronicle `json:"events"`
	Infra      []domain.Infra     `json:"infra"`
	Routes     []domain.Route     `json:"routes"`
	Chronicles []domain.Chronicle `json:"chronicles"`
	Features   []domain.Feature   `json:"features"`
	Places     []map[string]any   `json:"places"`
}

func (s *Server) mapView(w http.ResponseWriter, r *http.Request) {
	b, ok := parseBounds(r.URL.Query().Get("bbox"))
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	zoom, ze := strconv.ParseFloat(r.URL.Query().Get("zoom"), 64)
	if !ok || !domain.ValidDate(date) || ze != nil || zoom < 0 || zoom > 22 {
		httpjson.Write(w, 400, map[string]string{"error": "bbox, date, zoom"})
		return
	}
	workspace := strings.TrimSpace(r.URL.Query().Get("workspace"))
	if workspace == "" {
		workspace = "main"
	}
	if !s.canViewWorkspace(r, workspace) {
		httpjson.Write(w, 404, map[string]string{"error": "workspace"})
		return
	}
	state, err := s.buildMap(r.Context(), b, date, zoom, r.URL.Query().Get("detail") == "editor", workspace)
	if err != nil {
		s.fail(w, err)
		return
	}
	httpjson.Write(w, 200, state)
}

func (s *Server) canViewWorkspace(r *http.Request, id string) bool {
	if id == "main" {
		return true
	}
	user, _ := auth.FromRequest(r.Context(), s.pool, r)
	var ok bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=$1 AND kind='scenario' AND (visibility IN('public','link') OR owner_id=$2))`, id, userID(user)).Scan(&ok)
	return ok
}
func userID(u *auth.User) any {
	if u == nil {
		return nil
	}
	return u.ID
}

func (s *Server) buildMap(ctx context.Context, b bounds, date string, zoom float64, detail bool, workspace string) (mapState, error) {
	out := mapState{Scope: "viewport", Bounds: b, Zoom: zoom, Date: date, Dates: []string{}, Events: []domain.Chronicle{}, Infra: []domain.Infra{}, Routes: []domain.Route{}, Chronicles: []domain.Chronicle{}, Features: []domain.Feature{}, Places: []map[string]any{}}
	if zoom < 11 && !detail {
		rows, err := s.pool.Query(ctx, `WITH active_modes AS(
			SELECT source_scope,array_agg(DISTINCT mode) modes FROM(
				SELECT source_scope,mode FROM network_routes WHERE(valid_from IS NULL OR valid_from<=$1)AND(valid_to IS NULL OR valid_to>=$1)
				UNION SELECT source_scope,payload->>'mode' mode FROM network_infra WHERE payload->>'mode' IN('metro','tram','trolleybus','bus')AND(valid_from IS NULL OR valid_from<=$1)AND(valid_to IS NULL OR valid_to>=$1)
			)q WHERE mode IN('metro','tram','trolleybus','bus') GROUP BY source_scope
		) SELECT system.id,COALESCE(effective_name.name,system.name),system.lat,system.lng,active_modes.modes,
			COALESCE((SELECT array_agg(locality.name ORDER BY locality.name) FROM transport_system_localities locality
				WHERE locality.system_id=system.id AND(locality.valid_from IS NULL OR locality.valid_from<=$1)
					AND(locality.valid_to IS NULL OR locality.valid_to>=$1)),'{}')
		FROM transport_systems system
		JOIN active_modes ON active_modes.source_scope=system.id
		LEFT JOIN LATERAL(
			SELECT history.name FROM transport_system_names history
			WHERE history.system_id=system.id AND history.valid_from<=$1
				AND(history.valid_to IS NULL OR history.valid_to>=$1)
			ORDER BY history.valid_from DESC LIMIT 1
		)effective_name ON true
		WHERE system.lng BETWEEN $2 AND $4 AND system.lat BETWEEN $3 AND $5
			AND(system.valid_from IS NULL OR system.valid_from<=$1)AND(system.valid_to IS NULL OR system.valid_to>=$1)
		UNION ALL SELECT city.id,city.name,city.lat,city.lng,active_modes.modes,ARRAY[city.name]
		FROM cities city JOIN active_modes ON active_modes.source_scope=city.id
		WHERE city.lng BETWEEN $2 AND $4 AND city.lat BETWEEN $3 AND $5
			AND NOT EXISTS(SELECT 1 FROM transport_system_localities locality WHERE locality.locality_id=city.id)`, date, b.West, b.South, b.East, b.North)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var id, name string
			var lat, lng float64
			var modes, localities []string
			if rows.Scan(&id, &name, &lat, &lng, &modes, &localities) == nil {
				out.Places = append(out.Places, map[string]any{"id": id, "name": name, "center": []float64{lat, lng}, "modes": modes, "localities": localities})
			}
		}
		rows.Close()
		rows, err = s.pool.Query(ctx, `SELECT DISTINCT date::text FROM(
			SELECT valid_from date FROM transport_systems WHERE lng BETWEEN $1 AND $3 AND lat BETWEEN $2 AND $4
			UNION ALL SELECT valid_to date FROM transport_systems WHERE lng BETWEEN $1 AND $3 AND lat BETWEEN $2 AND $4
			UNION ALL SELECT history.valid_from date FROM transport_system_names history JOIN transport_systems system ON system.id=history.system_id WHERE system.lng BETWEEN $1 AND $3 AND system.lat BETWEEN $2 AND $4
			UNION ALL SELECT history.valid_to date FROM transport_system_names history JOIN transport_systems system ON system.id=history.system_id WHERE system.lng BETWEEN $1 AND $3 AND system.lat BETWEEN $2 AND $4
			UNION ALL SELECT locality.valid_from date FROM transport_system_localities locality JOIN transport_systems system ON system.id=locality.system_id WHERE system.lng BETWEEN $1 AND $3 AND system.lat BETWEEN $2 AND $4
			UNION ALL SELECT locality.valid_to date FROM transport_system_localities locality JOIN transport_systems system ON system.id=locality.system_id WHERE system.lng BETWEEN $1 AND $3 AND system.lat BETWEEN $2 AND $4
			UNION ALL SELECT lineage.effective_on date FROM transport_system_lineage lineage JOIN transport_systems system ON system.id IN(lineage.predecessor_id,lineage.successor_id) WHERE system.lng BETWEEN $1 AND $3 AND system.lat BETWEEN $2 AND $4
			UNION ALL SELECT min(event.occurred_on) date FROM cities city JOIN events event ON event.city_id=city.id WHERE city.lng BETWEEN $1 AND $3 AND city.lat BETWEEN $2 AND $4 AND NOT EXISTS(SELECT 1 FROM transport_system_localities locality WHERE locality.locality_id=city.id)GROUP BY city.id
		)q WHERE date IS NOT NULL ORDER BY date`, b.West, b.South, b.East, b.North)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var d string
			if rows.Scan(&d) == nil {
				out.Dates = append(out.Dates, d)
			}
		}
		rows.Close()
		return out, nil
	}
	kindClause := ""
	if !detail && zoom < 14 {
		kindClause = " AND kind='track'"
	} else if !detail && zoom < 15 {
		kindClause = " AND kind<>'node'"
	}
	rows, err := s.pool.Query(ctx, `SELECT payload,source_scope FROM network_infra WHERE(valid_from IS NULL OR valid_from<=$1)AND(valid_to IS NULL OR valid_to>=$1)AND ST_Intersects(geom,ST_MakeEnvelope($2,$3,$4,$5,4326))`+kindClause, date, b.West, b.South, b.East, b.North)
	if err != nil {
		return out, err
	}
	infra := map[string]domain.Infra{}
	for rows.Next() {
		var v domain.Infra
		var scope string
		if rows.Scan(&v, &scope) == nil {
			infra[v.ID] = v
		}
	}
	rows.Close()
	ids := make([]string, 0, len(infra))
	for id := range infra {
		ids = append(ids, id)
	}
	rows, err = s.pool.Query(ctx, `SELECT payload FROM network_routes WHERE(segment_ids&&$1::text[] OR ST_Intersects(geom,ST_MakeEnvelope($3,$4,$5,$6,4326)))AND(valid_from IS NULL OR valid_from<=$2)AND(valid_to IS NULL OR valid_to>=$2)`, ids, date, b.West, b.South, b.East, b.North)
	if err != nil {
		return out, err
	}
	routes := map[string]domain.Route{}
	for rows.Next() {
		var v domain.Route
		if rows.Scan(&v) == nil {
			routes[v.ID] = v
		}
	}
	rows.Close()
	if workspace != "main" {
		rows, err = s.pool.Query(ctx, `SELECT operations FROM changesets WHERE workspace_id=$1 AND status='published' AND effective_on<=$2 ORDER BY effective_on,created_at`, workspace, date)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var op domain.Operations
			if rows.Scan(&op) != nil {
				continue
			}
			for _, id := range op.RemoveInfra {
				delete(infra, id)
			}
			for _, v := range op.UpsertInfra {
				if domain.Alive(v.Since, v.Until, date) && domain.GeometryInBounds(v.Geometry, b.West, b.South, b.East, b.North) {
					infra[v.ID] = v
				} else {
					delete(infra, v.ID)
				}
			}
			for _, id := range op.RemoveRoutes {
				delete(routes, id)
			}
			for _, v := range op.UpsertRoutes {
				visible := v.Geometry != nil && domain.GeometryInBounds(*v.Geometry, b.West, b.South, b.East, b.North)
				for _, id := range v.SegmentIDs {
					if _, ok := infra[id]; ok {
						visible = true
					}
				}
				if domain.Alive(v.Since, v.Until, date) && visible {
					routes[v.ID] = v
				} else {
					delete(routes, v.ID)
				}
			}
		}
		rows.Close()
	}
	rows, err = s.pool.Query(ctx, `SELECT DISTINCT source_scope FROM network_infra WHERE ST_Intersects(geom,ST_MakeEnvelope($1,$2,$3,$4,4326))`, b.West, b.South, b.East, b.North)
	if err != nil {
		return out, err
	}
	scopes := []string{"world"}
	for rows.Next() {
		var q string
		if rows.Scan(&q) == nil && q != "world" {
			scopes = append(scopes, q)
		}
	}
	rows.Close()
	dates := map[string]bool{}
	timeline := map[string]domain.Chronicle{}
	chronicles := []domain.Chronicle{}
	for _, scope := range scopes {
		events, e := s.loadEvents(ctx, scope)
		if e != nil {
			return out, e
		}
		view := domain.Project(events, date)
		for _, v := range view.Chronicles {
			chronicles = append(chronicles, v)
		}
		if scope == "world" {
			continue
		}
		all := domain.Project(events, "")
		for _, v := range all.Chronicles {
			dates[v.Date] = true
			timeline[v.ID] = v
		}
		for _, v := range all.Infra {
			if v.Since != "" {
				dates[v.Since] = true
			}
			if v.Until != "" {
				dates[v.Until] = true
			}
		}
		for _, v := range all.Routes {
			if v.Since != "" {
				dates[v.Since] = true
			}
			if v.Until != "" {
				dates[v.Until] = true
			}
		}
	}
	state := domain.Projection{Infra: infra, Routes: routes, Chronicles: map[string]domain.Chronicle{}}
	for _, v := range chronicles {
		state.Chronicles[v.ID] = v
	}
	for _, v := range infra {
		out.Infra = append(out.Infra, v)
	}
	for _, v := range routes {
		out.Routes = append(out.Routes, v)
	}
	out.Chronicles = chronicles
	out.Features = domain.Features(state, date)
	out.Dates = keys(dates)
	for _, v := range timeline {
		out.Events = append(out.Events, v)
	}
	sort.Slice(out.Events, func(i, j int) bool { return out.Events[i].Date < out.Events[j].Date })
	sort.Slice(out.Chronicles, func(i, j int) bool { return out.Chronicles[i].Date < out.Chronicles[j].Date })
	return out, nil
}
