package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"transport-history/backend/internal/domain"
	"transport-history/backend/internal/httpjson"
)

type osmCommitBody struct {
	WorkspaceID string           `json:"workspaceId"`
	ChangeSetID string           `json:"changeSetId"`
	Date        string           `json:"date"`
	Mode        string           `json:"mode"`
	Title       string           `json:"title"`
	Summary     string           `json:"summary"`
	Correction  bool             `json:"correction"`
	OSMChange   domain.OSMChange `json:"osmChange"`
}

func (s *Server) syncOSMProjection(ctx context.Context, workspace string) error {
	type node struct {
		id       int64
		lat, lon float64
		tags     domain.OSMTags
	}
	nodes := map[int64]node{}
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT ON(v.id) v.id,v.lat,v.lon,v.tags,v.visible
		FROM osm_node_versions v JOIN osm_changesets o ON o.id=v.changeset_id JOIN changesets c ON c.id=o.id
		WHERE v.workspace_id=$1 AND c.status='published' ORDER BY v.id,c.effective_on DESC,o.sequence DESC`, workspace)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v node
		var visible bool
		if err = rows.Scan(&v.id, &v.lat, &v.lon, &v.tags, &visible); err != nil {
			return err
		}
		if visible {
			nodes[v.id] = v
		}
	}
	rows.Close()
	type way struct {
		id      int64
		version int
		tags    domain.OSMTags
		refs    []int64
	}
	ways := map[int64]way{}
	rows, err = s.pool.Query(ctx, `SELECT DISTINCT ON(v.id) v.id,v.version,v.tags,v.visible
		FROM osm_way_versions v JOIN osm_changesets o ON o.id=v.changeset_id JOIN changesets c ON c.id=o.id
		WHERE v.workspace_id=$1 AND c.status='published' ORDER BY v.id,c.effective_on DESC,o.sequence DESC`, workspace)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v way
		var visible bool
		if err = rows.Scan(&v.id, &v.version, &v.tags, &visible); err != nil {
			return err
		}
		if visible {
			ways[v.id] = v
		}
	}
	rows.Close()
	for id, v := range ways {
		rows, err = s.pool.Query(ctx, `SELECT node_id FROM osm_way_nodes WHERE workspace_id=$1 AND way_id=$2 AND way_version=$3 ORDER BY sequence`, workspace, id, v.version)
		if err != nil {
			return err
		}
		for rows.Next() {
			var ref int64
			if rows.Scan(&ref) == nil {
				v.refs = append(v.refs, ref)
			}
		}
		rows.Close()
		ways[id] = v
	}
	type relation struct {
		id      int64
		version int
		tags    domain.OSMTags
		members []domain.OSMMember
	}
	relations := map[int64]relation{}
	rows, err = s.pool.Query(ctx, `SELECT DISTINCT ON(v.id) v.id,v.version,v.tags,v.visible FROM osm_relation_versions v JOIN osm_changesets o ON o.id=v.changeset_id JOIN changesets c ON c.id=o.id WHERE v.workspace_id=$1 AND c.status='published' ORDER BY v.id,c.effective_on DESC,o.sequence DESC`, workspace)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v relation
		var visible bool
		if err = rows.Scan(&v.id, &v.version, &v.tags, &visible); err != nil {
			return err
		}
		if visible {
			relations[v.id] = v
		}
	}
	rows.Close()
	for id, v := range relations {
		rows, err = s.pool.Query(ctx, `SELECT member_type,member_id,role FROM osm_relation_members WHERE workspace_id=$1 AND relation_id=$2 AND relation_version=$3 ORDER BY sequence`, workspace, id, v.version)
		if err != nil {
			return err
		}
		for rows.Next() {
			var m domain.OSMMember
			if rows.Scan(&m.Type, &m.Ref, &m.Role) == nil {
				v.members = append(v.members, m)
			}
		}
		rows.Close()
		relations[id] = v
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	scope := "lund"
	if _, err = tx.Exec(ctx, `DELETE FROM network_routes WHERE source_scope=$1`, scope); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM network_infra WHERE source_scope=$1`, scope); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM events WHERE scope_id=$1`, scope); err != nil {
		return err
	}
	var sumLat, sumLon float64
	var pointCount int
	infra := map[int64]string{}
	for id, v := range ways {
		railway := v.tags["railway"]
		if railway != "tram" && railway != "rail" && railway != "subway" && railway != "light_rail" {
			continue
		}
		coords := make([][2]float64, 0, len(v.refs))
		for _, ref := range v.refs {
			if n, ok := nodes[ref]; ok {
				coords = append(coords, [2]float64{n.lon, n.lat})
				sumLat += n.lat
				sumLon += n.lon
				pointCount++
			}
		}
		if len(coords) < 2 {
			continue
		}
		rawCoords, _ := json.Marshal(coords)
		mode := "railway"
		if railway == "tram" {
			mode = "tram"
		} else if railway == "subway" {
			mode = "metro"
		}
		gauge := 1435
		if n, e := strconv.Atoi(v.tags["gauge"]); e == nil {
			gauge = n
		}
		form := "single_both"
		if v.tags["oneway"] == "yes" {
			form = "single_oneway"
		}
		obj := domain.Infra{ID: fmt.Sprintf("osm:way:%d", id), Kind: "track", Way: "rail", Mode: mode, Gauge: &gauge, Grade: "surface", Name: v.tags["name"], Color: "#7f7160", TrackForm: form, Geometry: domain.Geometry{Type: "LineString", Coordinates: rawCoords}}
		raw, _ := json.Marshal(obj)
		geom, _ := json.Marshal(obj.Geometry)
		if _, err = tx.Exec(ctx, `INSERT INTO network_infra(id,source_scope,kind,way,payload,geom)VALUES($1,$2,'track','rail',$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326))`, obj.ID, scope, raw, geom); err != nil {
			return err
		}
		infra[id] = obj.ID
	}
	for id, n := range nodes {
		if n.tags["railway"] != "tram_stop" {
			continue
		}
		coords, _ := json.Marshal([2]float64{n.lon, n.lat})
		obj := domain.Infra{ID: fmt.Sprintf("osm:node:%d", id), Kind: "stop", Way: "rail", Mode: "tram", Name: n.tags["name"], Color: "#7f7160", TrackForm: "single_both", Geometry: domain.Geometry{Type: "Point", Coordinates: coords}}
		raw, _ := json.Marshal(obj)
		geom, _ := json.Marshal(obj.Geometry)
		if _, err = tx.Exec(ctx, `INSERT INTO network_infra(id,source_scope,kind,way,payload,geom)VALUES($1,$2,'stop','rail',$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326))`, obj.ID, scope, raw, geom); err != nil {
			return err
		}
	}
	if pointCount > 0 {
		lat, lon := sumLat/float64(pointCount), sumLon/float64(pointCount)
		if _, err = tx.Exec(ctx, `INSERT INTO transport_systems(id,name,aliases,lat,lng,zoom,valid_from)VALUES('lund','Lund',ARRAY['Lund tramway'],$1,$2,13,DATE '2020-12-12') ON CONFLICT(id)DO UPDATE SET lat=EXCLUDED.lat,lng=EXCLUDED.lng`, lat, lon); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO transport_system_names(system_id,name,valid_from)VALUES('lund','Lund',DATE '2020-12-12')ON CONFLICT(system_id,valid_from)DO NOTHING`); err != nil {
			return err
		}
	}
	for _, master := range relations {
		if master.tags["type"] != "route_master" || master.tags["route_master"] != "tram" {
			continue
		}
		number := master.tags["ref"]
		segments := []string{}
		seen := map[string]bool{}
		for _, member := range master.members {
			if member.Type != "relation" {
				continue
			}
			child, ok := relations[member.Ref]
			if !ok {
				continue
			}
			if number == "" {
				number = child.tags["ref"]
			}
			for _, part := range child.members {
				if part.Type == "way" {
					if id, ok := infra[part.Ref]; ok && !seen[id] {
						seen[id] = true
						segments = append(segments, id)
					}
				}
			}
		}
		route := domain.Route{ID: fmt.Sprintf("osm:relation:%d", master.id), Mode: "tram", Number: number, Name: master.tags["name"], Color: "#7f7160", SegmentIDs: segments, Since: "2020-12-12"}
		raw, _ := json.Marshal(route)
		if _, err = tx.Exec(ctx, `INSERT INTO network_routes(id,source_scope,mode,valid_from,segment_ids,payload)VALUES($1,$2,'tram',DATE '2020-12-12',$3,$4)`, route.ID, scope, segments, raw); err != nil {
			return err
		}
	}
	rows, err = tx.Query(ctx, `SELECT c.id,c.effective_on::text,c.mode,c.title,c.summary,u.username FROM changesets c JOIN users u ON u.id=c.author_id JOIN osm_changesets o ON o.id=c.id WHERE c.workspace_id=$1 AND c.status='published' ORDER BY c.effective_on,o.sequence`, workspace)
	if err != nil {
		return err
	}
	type historyItem struct{ id, date, mode, title, summary, actor string }
	history := []historyItem{}
	for rows.Next() {
		var item historyItem
		if err = rows.Scan(&item.id, &item.date, &item.mode, &item.title, &item.summary, &item.actor); err != nil {
			return err
		}
		history = append(history, item)
	}
	rows.Close()
	for _, item := range history {
		article := domain.Chronicle{ID: item.id, City: "lund", Mode: item.mode, Date: item.date, Title: item.title, Summary: item.summary}
		raw, _ := json.Marshal(article)
		if _, err = tx.Exec(ctx, `INSERT INTO events(type,occurred_on,city_id,scope_id,actor,payload)VALUES('chronicle.upsert',$1,NULL,$2,$3,$4)`, item.date, scope, item.actor, raw); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Server) osmCommit(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var body osmCommitBody
	if httpjson.Read(r, &body) != nil || !domain.ValidDate(body.Date) || !domain.Modes[body.Mode] {
		httpjson.Write(w, http.StatusBadRequest, map[string]string{"error": "date, mode or osmChange"})
		return
	}
	if err := body.OSMChange.Validate(); err != nil {
		httpjson.Write(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	workspace := strings.TrimSpace(body.WorkspaceID)
	if workspace == "" {
		workspace = "main"
	}
	var allowed bool
	_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=$1 AND(id='main' OR owner_id=$2))`, workspace, u.ID).Scan(&allowed)
	if !allowed {
		httpjson.Write(w, http.StatusForbidden, map[string]string{"error": "workspace"})
		return
	}
	id := strings.TrimSpace(body.ChangeSetID)
	if id == "" {
		id = newID()
	}
	raw, _ := json.Marshal(body.OSMChange)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	tag, err := tx.Exec(r.Context(), `INSERT INTO changesets(id,workspace_id,author_id,status,effective_on,mode,title,summary,operations)
		VALUES($1,$2,$3,'draft',$4,$5,$6,$7,'{}')
		ON CONFLICT(id) DO UPDATE SET effective_on=EXCLUDED.effective_on,mode=EXCLUDED.mode,title=EXCLUDED.title,
		summary=EXCLUDED.summary,updated_at=now() WHERE changesets.author_id=EXCLUDED.author_id AND changesets.status='draft'`,
		id, workspace, u.ID, body.Date, body.Mode, strings.TrimSpace(body.Title), body.Summary)
	if err != nil || tag.RowsAffected() == 0 {
		if err != nil {
			s.fail(w, err)
		} else {
			httpjson.Write(w, http.StatusConflict, map[string]string{"error": "changeset cannot be updated"})
		}
		return
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO osm_changesets(id,osm_change,correction) VALUES($1,$2,$3)
		ON CONFLICT(id) DO UPDATE SET osm_change=EXCLUDED.osm_change,correction=EXCLUDED.correction`, id, raw, body.Correction)
	if err != nil {
		s.fail(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.fail(w, err)
		return
	}
	httpjson.Write(w, http.StatusCreated, map[string]any{"ok": true, "id": id, "status": "draft", "operations": osmOperationCount(body.OSMChange), "date": body.Date})
}

func osmOperationCount(change domain.OSMChange) int {
	count := func(group domain.OSMPrimitives) int { return len(group.Nodes) + len(group.Ways) + len(group.Relations) }
	return count(change.Create) + count(change.Modify) + count(change.Delete)
}

func applyOSMChange(ctx context.Context, tx pgx.Tx, workspace, changesetID string, change domain.OSMChange) error {
	if err := change.Validate(); err != nil {
		return err
	}
	for _, item := range []struct {
		group   domain.OSMPrimitives
		visible bool
	}{
		{change.Create, true}, {change.Modify, true}, {change.Delete, false},
	} {
		for _, node := range item.group.Nodes {
			if node.Tags == nil {
				node.Tags = domain.OSMTags{}
			}
			tags, _ := json.Marshal(node.Tags)
			if _, err := tx.Exec(ctx, `INSERT INTO osm_node_versions(workspace_id,id,version,changeset_id,visible,lat,lon,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, workspace, node.ID, node.Version, changesetID, item.visible, node.Lat, node.Lon, string(tags)); err != nil {
				return err
			}
		}
		for _, way := range item.group.Ways {
			if way.Tags == nil {
				way.Tags = domain.OSMTags{}
			}
			tags, _ := json.Marshal(way.Tags)
			if _, err := tx.Exec(ctx, `INSERT INTO osm_way_versions(workspace_id,id,version,changeset_id,visible,tags) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, workspace, way.ID, way.Version, changesetID, item.visible, string(tags)); err != nil {
				return err
			}
			for sequence, nodeID := range way.Nodes {
				if _, err := tx.Exec(ctx, `INSERT INTO osm_way_nodes(workspace_id,way_id,way_version,sequence,node_id) VALUES($1,$2,$3,$4,$5)`, workspace, way.ID, way.Version, sequence, nodeID); err != nil {
					return err
				}
			}
		}
		for _, relation := range item.group.Relations {
			if relation.Tags == nil {
				relation.Tags = domain.OSMTags{}
			}
			tags, _ := json.Marshal(relation.Tags)
			if _, err := tx.Exec(ctx, `INSERT INTO osm_relation_versions(workspace_id,id,version,changeset_id,visible,tags) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, workspace, relation.ID, relation.Version, changesetID, item.visible, string(tags)); err != nil {
				return err
			}
			for sequence, member := range relation.Members {
				if _, err := tx.Exec(ctx, `INSERT INTO osm_relation_members(workspace_id,relation_id,relation_version,sequence,member_type,member_id,role) VALUES($1,$2,$3,$4,$5,$6,$7)`, workspace, relation.ID, relation.Version, sequence, member.Type, member.Ref, member.Role); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
