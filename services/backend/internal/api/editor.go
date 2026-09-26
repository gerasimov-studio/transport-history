package api

import (
	"context"
	"encoding/json"
	"net/http"
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
	referenced := append([]string{}, body.RemoveInfra...)
	for _, v := range routes {
		referenced = append(referenced, v.SegmentIDs...)
	}
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
