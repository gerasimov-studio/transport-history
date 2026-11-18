package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"transport-history/backend/internal/domain"
	"transport-history/backend/internal/httpjson"
)

type objectCommitBody struct {
	WorkspaceID  string            `json:"workspaceId"`
	ChangeSetID  string            `json:"changeSetId"`
	Date         string            `json:"date"`
	Mode         string            `json:"mode"`
	Title        string            `json:"title"`
	Summary      string            `json:"summary"`
	UpsertInfra  []json.RawMessage `json:"upsertInfra"`
	RemoveInfra  []string          `json:"removeInfra"`
	UpsertRoutes []json.RawMessage `json:"upsertRoutes"`
	RemoveRoutes []string          `json:"removeRoutes"`
}

func (s *Server) objectCommit(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var body objectCommitBody
	if httpjson.Read(r, &body) != nil {
		httpjson.Write(w, 400, map[string]string{"error": "bad request"})
		return
	}
	workspace := strings.TrimSpace(body.WorkspaceID)
	if workspace == "" {
		workspace = "main"
	}
	var allowed bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=$1 AND(id='main' OR owner_id=$2))`, workspace, u.ID).Scan(&allowed)
	if !allowed {
		httpjson.Write(w, 403, map[string]string{"error": "workspace"})
		return
	}
	date := body.Date
	mode := body.Mode
	if !domain.ValidDate(date) || !domain.Modes[mode] {
		httpjson.Write(w, 400, map[string]string{"error": "date, mode"})
		return
	}
	infra := []domain.Infra{}
	for _, raw := range body.UpsertInfra {
		var probe struct {
			Way string `json:"way"`
		}
		_ = json.Unmarshal(raw, &probe)
		if !domain.Ways[probe.Way] {
			httpjson.Write(w, 400, map[string]string{"error": "infra way"})
			return
		}
		v, err := domain.ValidateInfra([]json.RawMessage{raw}, probe.Way, date)
		if err != nil {
			httpjson.Write(w, 400, map[string]string{"error": err.Error()})
			return
		}
		infra = append(infra, v...)
	}
	routes := []domain.Route{}
	for _, raw := range body.UpsertRoutes {
		var probe struct {
			Mode string `json:"mode"`
		}
		_ = json.Unmarshal(raw, &probe)
		if !domain.Modes[probe.Mode] {
			httpjson.Write(w, 400, map[string]string{"error": "route mode"})
			return
		}
		v, err := domain.ValidateRoutes([]json.RawMessage{raw}, probe.Mode, date)
		if err != nil {
			httpjson.Write(w, 400, map[string]string{"error": err.Error()})
			return
		}
		routes = append(routes, v...)
	}
	availableInfra := map[string]domain.Infra{}
	for _, item := range infra {
		availableInfra[item.ID] = item
	}
	referenceIDs := routeInfrastructureIDs(routes)
	if len(referenceIDs) > 0 {
		rows, err := s.pool.Query(r.Context(), `SELECT payload FROM network_infra WHERE id=ANY($1::text[])`, referenceIDs)
		if err != nil {
			s.fail(w, err)
			return
		}
		for rows.Next() {
			var raw json.RawMessage
			var item domain.Infra
			if rows.Scan(&raw) == nil && json.Unmarshal(raw, &item) == nil {
				availableInfra[item.ID] = item
			}
		}
		rows.Close()
	}
	for _, id := range body.RemoveInfra {
		delete(availableInfra, id)
	}
	if err := validateRouteInfrastructure(routes, availableInfra); err != nil {
		httpjson.Write(w, 400, map[string]string{"error": err.Error()})
		return
	}
	op := domain.Operations{UpsertInfra: infra, RemoveInfra: body.RemoveInfra, UpsertRoutes: routes, RemoveRoutes: body.RemoveRoutes}
	id := strings.TrimSpace(body.ChangeSetID)
	if id == "" {
		id = newID()
	}
	raw, _ := json.Marshal(op)
	tag, err := s.pool.Exec(r.Context(), `INSERT INTO changesets(id,workspace_id,author_id,status,effective_on,mode,title,summary,operations)VALUES($1,$2,$3,'draft',$4,$5,$6,$7,$8::jsonb)ON CONFLICT(id)DO UPDATE SET effective_on=EXCLUDED.effective_on,mode=EXCLUDED.mode,title=EXCLUDED.title,summary=EXCLUDED.summary,operations=EXCLUDED.operations,updated_at=now()WHERE changesets.author_id=EXCLUDED.author_id AND changesets.status='draft'`, id, workspace, u.ID, date, mode, strings.TrimSpace(body.Title), body.Summary, raw)
	if err != nil {
		s.fail(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpjson.Write(w, 409, map[string]string{"error": "changeset cannot be updated"})
		return
	}
	referenced := append(append([]string{}, body.RemoveInfra...), referenceIDs...)
	if len(infra)+len(routes)+len(referenced)+len(body.RemoveRoutes) > 0 {
		infraRaw, _ := json.Marshal(infra)
		routeRaw, _ := json.Marshal(routes)
		_, err = s.pool.Exec(r.Context(), `WITH changed_geometries AS(SELECT ST_SetSRID(ST_GeomFromGeoJSON(value->'geometry'),4326)geom FROM jsonb_array_elements($2::jsonb)value UNION ALL SELECT ST_SetSRID(ST_GeomFromGeoJSON(value->'geometry'),4326)geom FROM jsonb_array_elements($5::jsonb)value WHERE value->'geometry' IS NOT NULL UNION ALL SELECT geom FROM network_infra WHERE id=ANY($3::text[]) UNION ALL SELECT infra.geom FROM network_routes route CROSS JOIN LATERAL unnest(route.segment_ids)segment_id JOIN network_infra infra ON infra.id=segment_id WHERE route.id=ANY($4::text[]))UPDATE changesets SET bounds=(SELECT ST_Envelope(ST_Collect(geom))FROM changed_geometries)WHERE id=$1`, id, infraRaw, uniqueStrings(referenced), body.RemoveRoutes, routeRaw)
		if err != nil {
			s.fail(w, err)
			return
		}
	}
	httpjson.Write(w, 201, map[string]any{"ok": true, "id": id, "status": "draft", "operations": len(infra) + len(body.RemoveInfra) + len(routes) + len(body.RemoveRoutes), "date": date})
}

func routeInfrastructureIDs(routes []domain.Route) []string {
	var ids []string
	for _, route := range routes {
		ids = append(ids, routeTrackIDs(route)...)
		ids = append(ids, routeStopIDs(route)...)
	}
	return uniqueStrings(ids)
}

func routeTrackIDs(route domain.Route) []string {
	ids := append([]string{}, route.SegmentIDs...)
	for _, path := range route.Paths {
		ids = append(ids, path.SegmentIDs...)
	}
	for _, leg := range route.Legs {
		if leg.Type == "wire" {
			ids = append(ids, leg.SegmentIDs...)
		}
	}
	return uniqueStrings(ids)
}

func routeStopIDs(route domain.Route) []string {
	var ids []string
	for _, path := range route.Paths {
		ids = append(ids, path.StopIDs...)
	}
	return uniqueStrings(ids)
}

func validateRouteInfrastructure(routes []domain.Route, infra map[string]domain.Infra) error {
	for _, route := range routes {
		trackIDs := routeTrackIDs(route)
		if route.Mode != "bus" && route.Mode != "trolleybus" && len(trackIDs) == 0 {
			return fmt.Errorf("route %s must use existing infrastructure", route.ID)
		}
		for _, id := range trackIDs {
			segment, ok := infra[id]
			if !ok || segment.Kind != "track" {
				return fmt.Errorf("route %s references unavailable infrastructure %s", route.ID, id)
			}
			if segment.Mode != route.Mode {
				return fmt.Errorf("route %s and infrastructure %s have incompatible modes", route.ID, id)
			}
			if !validityOverlaps(route.Since, route.Until, segment.Since, segment.Until) {
				return fmt.Errorf("route %s and infrastructure %s do not overlap in time", route.ID, id)
			}
		}
		for _, id := range routeStopIDs(route) {
			stop, ok := infra[id]
			if !ok || (stop.Kind != "stop" && stop.Kind != "station") {
				return fmt.Errorf("route %s references unavailable stop %s", route.ID, id)
			}
			if (stop.TrackID == "" || !slices.Contains(trackIDs, stop.TrackID)) && !stopOnRoutePath(stop, trackIDs, infra) {
				return fmt.Errorf("route %s stop %s is not on its infrastructure", route.ID, id)
			}
		}
		for _, path := range route.Paths {
			if !continuousInfrastructurePath(path.SegmentIDs, infra) {
				return fmt.Errorf("route %s contains a discontinuous infrastructure path", route.ID)
			}
		}
	}
	return nil
}

func stopOnRoutePath(stop domain.Infra, trackIDs []string, infra map[string]domain.Infra) bool {
	if stop.Geometry.Type != "Point" {
		return false
	}
	var point [2]float64
	if json.Unmarshal(stop.Geometry.Coordinates, &point) != nil {
		return false
	}
	for _, id := range trackIDs {
		track := infra[id]
		if track.Geometry.Type != "LineString" {
			continue
		}
		var line [][2]float64
		if json.Unmarshal(track.Geometry.Coordinates, &line) != nil {
			continue
		}
		for index := 1; index < len(line); index++ {
			if pointOnLineSegment(point, line[index-1], line[index]) {
				return true
			}
		}
	}
	return false
}

func pointOnLineSegment(point, start, end [2]float64) bool {
	dx, dy := end[0]-start[0], end[1]-start[1]
	length := dx*dx + dy*dy
	if length == 0 {
		return abs(point[0]-start[0]) < 1e-7 && abs(point[1]-start[1]) < 1e-7
	}
	t := ((point[0]-start[0])*dx + (point[1]-start[1])*dy) / length
	if t < 0 || t > 1 {
		return false
	}
	return abs(point[0]-(start[0]+t*dx)) < 1e-7 && abs(point[1]-(start[1]+t*dy)) < 1e-7
}

func continuousInfrastructurePath(ids []string, infra map[string]domain.Infra) bool {
	for index := 1; index < len(ids); index++ {
		if !lineEndpointsMeet(infra[ids[index-1]].Geometry, infra[ids[index]].Geometry) {
			return false
		}
	}
	return true
}

func lineEndpointsMeet(a, b domain.Geometry) bool {
	if a.Type != "LineString" || b.Type != "LineString" {
		return false
	}
	var left, right [][2]float64
	if json.Unmarshal(a.Coordinates, &left) != nil || json.Unmarshal(b.Coordinates, &right) != nil || len(left) < 2 || len(right) < 2 {
		return false
	}
	for _, p := range [][2]float64{left[0], left[len(left)-1]} {
		for _, q := range [][2]float64{right[0], right[len(right)-1]} {
			if abs(p[0]-q[0]) < 1e-7 && abs(p[1]-q[1]) < 1e-7 {
				return true
			}
		}
	}
	return false
}

func abs(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

func validityOverlaps(aFrom, aTo, bFrom, bTo string) bool {
	return (aTo == "" || bFrom <= aTo) && (bTo == "" || aFrom <= bTo)
}

type legacyCommitBody struct {
	City, Date, Mode, Way, Title, Summary string
	Infra                                 []json.RawMessage `json:"infra"`
	Routes                                []json.RawMessage `json:"routes"`
}

func (s *Server) legacyCommit(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var body legacyCommitBody
	if httpjson.Read(r, &body) != nil {
		httpjson.Write(w, 400, map[string]string{"error": "bad request"})
		return
	}
	body.City = strings.TrimSpace(body.City)
	body.Mode = strings.TrimSpace(body.Mode)
	way := body.Way
	if way == "" {
		way = domain.WayOf(body.Mode)
	}
	if body.City == "" || !domain.ValidDate(body.Date) || !domain.Modes[body.Mode] || !domain.Ways[way] || domain.WayOf(body.Mode) != way {
		httpjson.Write(w, 400, map[string]string{"error": "city, date, mode"})
		return
	}
	var city bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM cities WHERE id=$1)`, body.City).Scan(&city)
	if !city {
		httpjson.Write(w, 400, map[string]string{"error": "city"})
		return
	}
	infra, err := domain.ValidateInfra(body.Infra, way, body.Date)
	if err != nil {
		httpjson.Write(w, 400, map[string]string{"error": err.Error()})
		return
	}
	routes, err := domain.ValidateRoutes(body.Routes, body.Mode, body.Date)
	if err != nil {
		httpjson.Write(w, 400, map[string]string{"error": err.Error()})
		return
	}
	existing, err := s.loadEvents(r.Context(), body.City)
	if err != nil {
		s.fail(w, err)
		return
	}
	events := domain.DiffEvents(body.City, body.Date, way, body.Mode, u.Username, strings.TrimSpace(body.Title), body.Summary, domain.Project(existing, body.Date), infra, routes)
	if len(events) > 0 {
		tx, e := s.pool.Begin(r.Context())
		if e != nil {
			s.fail(w, e)
			return
		}
		defer tx.Rollback(r.Context())
		for _, v := range events {
			_, e = tx.Exec(r.Context(), `INSERT INTO events(type,occurred_on,city_id,scope_id,actor,payload)VALUES($1,$2,$3,$3,$4,$5::jsonb)`, v.Type, v.OccurredOn, v.CityID, v.Actor, v.Payload)
			if e != nil {
				break
			}
		}
		if e == nil {
			e = tx.Commit(r.Context())
		}
		if e != nil {
			s.fail(w, e)
			return
		}
	}
	if err = s.syncProjection(r.Context(), body.City); err != nil {
		s.fail(w, err)
		return
	}
	httpjson.Write(w, 200, map[string]any{"ok": true, "events": len(events), "date": body.Date})
}

func (s *Server) publishOperations(ctx context.Context, op domain.Operations, date, actor, mode, title, summary string) (int, error) {
	ids := append([]string{}, op.RemoveInfra...)
	ids = append(ids, op.RemoveRoutes...)
	for _, v := range op.UpsertInfra {
		ids = append(ids, v.ID)
	}
	for _, v := range op.UpsertRoutes {
		ids = append(ids, v.ID)
	}
	scopes := map[string]string{}
	if len(ids) > 0 {
		rows, err := s.pool.Query(ctx, `SELECT id,source_scope FROM network_infra WHERE id=ANY($1::text[])UNION ALL SELECT id,source_scope FROM network_routes WHERE id=ANY($1::text[])`, ids)
		if err != nil {
			return 0, err
		}
		for rows.Next() {
			var id, scope string
			if rows.Scan(&id, &scope) == nil {
				scopes[id] = scope
			}
		}
		rows.Close()
	}
	type pending struct {
		kind, scope string
		payload     any
	}
	events := []pending{}
	touched := map[string]bool{}
	add := func(kind, id string, payload any) {
		scope := scopes[id]
		if scope == "" {
			scope = "world"
		}
		touched[scope] = true
		events = append(events, pending{kind, scope, payload})
	}
	for _, v := range op.UpsertInfra {
		add("infra.upsert", v.ID, v)
	}
	for _, v := range op.RemoveInfra {
		add("infra.removed", v, map[string]string{"id": v})
	}
	for _, v := range op.UpsertRoutes {
		add("route.upsert", v.ID, v)
	}
	for _, v := range op.RemoveRoutes {
		add("route.removed", v, map[string]string{"id": v})
	}
	if strings.TrimSpace(title) != "" {
		touched["world"] = true
		events = append(events, pending{"chronicle.upsert", "world", domain.Chronicle{ID: "world-" + mode + "-" + date, City: "world", Mode: mode, Date: date, Title: title, Summary: summary, Network: ""}})
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	for _, v := range events {
		raw, _ := json.Marshal(v.payload)
		if _, err = tx.Exec(ctx, `INSERT INTO events(type,occurred_on,city_id,scope_id,actor,payload)VALUES($1,$2,NULL,$3,$4,$5::jsonb)`, v.kind, date, v.scope, actor, raw); err != nil {
			return 0, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	for scope := range touched {
		if err = s.syncProjection(ctx, scope); err != nil {
			return 0, err
		}
	}
	return len(events), nil
}
