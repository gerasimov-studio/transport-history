package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"transport-history/backend/internal/domain"
	"transport-history/backend/internal/httpjson"
)

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func pathID(re *regexp.Regexp, path string) string {
	m := re.FindStringSubmatch(path)
	if len(m) < 2 {
		return ""
	}
	v, _ := url.PathUnescape(m[1])
	return v
}

func (s *Server) workspaces(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	rows, err := s.pool.Query(r.Context(), `SELECT id,kind,title,description,visibility,base_workspace_id,created_at FROM workspaces WHERE id='main' OR owner_id=$1 ORDER BY kind,created_at`, u.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, kind, title, description, visibility string
		var base *string
		var created time.Time
		if rows.Scan(&id, &kind, &title, &description, &visibility, &base, &created) == nil {
			out = append(out, map[string]any{"id": id, "kind": kind, "title": title, "description": description, "visibility": visibility, "baseWorkspaceId": base, "createdAt": created})
		}
	}
	httpjson.Write(w, 200, map[string]any{"workspaces": out})
}

func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var body struct{ Title, Description, Visibility string }
	if httpjson.Read(r, &body) != nil {
		httpjson.Write(w, 400, map[string]string{"error": "bad request"})
		return
	}
	title := strings.TrimSpace(body.Title)
	if title == "" {
		httpjson.Write(w, 400, map[string]string{"error": "title"})
		return
	}
	visibility := body.Visibility
	if visibility != "private" && visibility != "link" && visibility != "public" {
		visibility = "private"
	}
	id := newID()
	_, err := s.pool.Exec(r.Context(), `INSERT INTO workspaces(id,kind,owner_id,title,description,visibility,base_workspace_id)VALUES($1,'scenario',$2,$3,$4,$5,'main')`, id, u.ID, title, body.Description, visibility)
	if err != nil {
		s.fail(w, err)
		return
	}
	httpjson.Write(w, 201, map[string]any{"id": id, "kind": "scenario", "title": title, "visibility": visibility})
}

func (s *Server) moderationAreas(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	rows, err := s.pool.Query(r.Context(), `SELECT area.id,area.title,area.modes,ST_AsGeoJSON(area.geom)::json,array_remove(array_agg(assignment.user_id),NULL) FROM moderation_areas area LEFT JOIN moderation_assignments assignment ON assignment.area_id=area.id GROUP BY area.id ORDER BY area.title`)
	if err != nil {
		s.fail(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, title string
		var modes []string
		var geom json.RawMessage
		var ids []int32
		if rows.Scan(&id, &title, &modes, &geom, &ids) == nil {
			var geometry any
			_ = json.Unmarshal(geom, &geometry)
			out = append(out, map[string]any{"id": id, "title": title, "modes": modes, "geometry": geometry, "userIds": ids})
		}
	}
	httpjson.Write(w, 200, map[string]any{"areas": out})
}

func (s *Server) createModerationArea(w http.ResponseWriter, r *http.Request) {
	u := s.requireSuperuser(w, r)
	if u == nil {
		return
	}
	var body struct {
		Title    string          `json:"title"`
		Modes    []string        `json:"modes"`
		Geometry domain.Geometry `json:"geometry"`
		UserIDs  []int           `json:"userIds"`
	}
	if httpjson.Read(r, &body) != nil {
		httpjson.Write(w, 400, map[string]string{"error": "bad request"})
		return
	}
	title := strings.TrimSpace(body.Title)
	if title == "" || (body.Geometry.Type != "Polygon" && body.Geometry.Type != "MultiPolygon") {
		httpjson.Write(w, 400, map[string]string{"error": "title, geometry"})
		return
	}
	modes := []string{}
	for _, v := range body.Modes {
		if domain.Modes[v] {
			modes = append(modes, v)
		}
	}
	geom := body.Geometry
	if geom.Type == "Polygon" {
		geom.Type = "MultiPolygon"
		geom.Coordinates = append(json.RawMessage("["), append(body.Geometry.Coordinates, ']')...)
	}
	raw, _ := json.Marshal(geom)
	id := newID()
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), `INSERT INTO moderation_areas(id,title,modes,geom)VALUES($1,$2,$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326))`, id, title, modes, raw); err == nil {
		for _, uid := range body.UserIDs {
			_, err = tx.Exec(r.Context(), `INSERT INTO moderation_assignments(area_id,user_id)VALUES($1,$2)`, id, uid)
			if err != nil {
				break
			}
		}
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	httpjson.Write(w, 201, map[string]any{"id": id, "title": title, "modes": modes, "userIds": body.UserIDs})
}

func (s *Server) changesets(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	rows, err := s.pool.Query(r.Context(), `SELECT c.id,c.workspace_id,c.status,c.effective_on::text,c.mode,c.title,c.summary,c.created_at,c.updated_at,u.username,($2='superuser' OR EXISTS(SELECT 1 FROM moderation_assignments assignment JOIN moderation_areas area ON area.id=assignment.area_id WHERE assignment.user_id=$1 AND c.bounds IS NOT NULL AND ST_Covers(area.geom,c.bounds)AND(cardinality(area.modes)=0 OR c.mode=ANY(area.modes)))) FROM changesets c JOIN users u ON u.id=c.author_id WHERE c.author_id=$1 OR c.status='published' OR(c.status='submitted' AND($2='superuser' OR EXISTS(SELECT 1 FROM moderation_assignments assignment JOIN moderation_areas area ON area.id=assignment.area_id WHERE assignment.user_id=$1 AND c.bounds IS NOT NULL AND ST_Covers(area.geom,c.bounds)AND(cardinality(area.modes)=0 OR c.mode=ANY(area.modes)))))ORDER BY c.updated_at DESC LIMIT 100`, u.ID, u.Role)
	if err != nil {
		s.fail(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, workspace, status, date, mode, title, summary, author string
		var created, updated time.Time
		var can bool
		if rows.Scan(&id, &workspace, &status, &date, &mode, &title, &summary, &created, &updated, &author, &can) == nil {
			out = append(out, map[string]any{"id": id, "workspaceId": workspace, "status": status, "date": date, "mode": mode, "title": title, "summary": summary, "createdAt": created, "updatedAt": updated, "author": author, "canModerate": can})
		}
	}
	httpjson.Write(w, 200, map[string]any{"changesets": out})
}

func (s *Server) submitChangeset(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id := pathID(changesetSubmitPath, r.URL.Path)
	var status string
	err := s.pool.QueryRow(r.Context(), `UPDATE changesets c SET status=CASE WHEN workspace.kind='scenario' THEN 'published' ELSE 'submitted' END,submitted_at=now(),published_at=CASE WHEN workspace.kind='scenario' THEN now() ELSE NULL END,updated_at=now() FROM workspaces workspace WHERE c.id=$1 AND c.author_id=$2 AND c.status IN('draft','changes_requested')AND workspace.id=c.workspace_id RETURNING c.status`, id, u.ID).Scan(&status)
	if err == pgx.ErrNoRows {
		httpjson.Write(w, 409, map[string]string{"error": "changeset cannot be submitted"})
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	httpjson.Write(w, 200, map[string]any{"id": id, "status": status})
}

func (s *Server) publishChangeset(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id := pathID(changesetPublishPath, r.URL.Path)
	var op domain.Operations
	var date, mode, title, summary string
	err := s.pool.QueryRow(r.Context(), `SELECT operations,effective_on::text,mode,title,summary FROM changesets WHERE id=$1 AND workspace_id='main' AND status='submitted'`, id).Scan(&op, &date, &mode, &title, &summary)
	if err == pgx.ErrNoRows {
		httpjson.Write(w, 409, map[string]string{"error": "changeset cannot be published"})
		return
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	if u.Role != "superuser" {
		var allowed bool
		_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM changesets c JOIN moderation_areas area ON c.bounds IS NOT NULL AND ST_Covers(area.geom,c.bounds)AND(cardinality(area.modes)=0 OR c.mode=ANY(area.modes))JOIN moderation_assignments assignment ON assignment.area_id=area.id WHERE c.id=$1 AND assignment.user_id=$2)`, id, u.ID).Scan(&allowed)
		if !allowed {
			httpjson.Write(w, 403, map[string]string{"error": "moderation area does not cover this changeset"})
			return
		}
	}
	var osmRaw json.RawMessage
	var workspace string
	osmErr := s.pool.QueryRow(r.Context(), `SELECT c.workspace_id,o.osm_change FROM changesets c JOIN osm_changesets o ON o.id=c.id WHERE c.id=$1`, id).Scan(&workspace, &osmRaw)
	if osmErr == nil {
		change, decodeErr := domain.DecodeOSMChange(osmRaw)
		if decodeErr != nil {
			s.fail(w, decodeErr)
			return
		}
		tx, txErr := s.pool.Begin(r.Context())
		if txErr != nil {
			s.fail(w, txErr)
			return
		}
		defer tx.Rollback(r.Context())
		if txErr = applyOSMChange(r.Context(), tx, workspace, id, change); txErr == nil {
			_, txErr = tx.Exec(r.Context(), `UPDATE changesets SET status='published',published_at=now(),updated_at=now() WHERE id=$1 AND status='submitted'`, id)
		}
		if txErr == nil {
			_, txErr = tx.Exec(r.Context(), `INSERT INTO changeset_reviews(changeset_id,reviewer_id,decision) VALUES($1,$2,'published')`, id, u.ID)
		}
		if txErr == nil {
			txErr = tx.Commit(r.Context())
		}
		if txErr != nil {
			s.fail(w, txErr)
			return
		}
		if txErr = s.syncOSMProjection(r.Context(), workspace); txErr != nil {
			s.fail(w, txErr)
			return
		}
		httpjson.Write(w, 200, map[string]any{"id": id, "status": "published", "events": osmOperationCount(change)})
		return
	}
	if osmErr != pgx.ErrNoRows {
		s.fail(w, osmErr)
		return
	}
	count, err := s.publishOperations(r.Context(), op, date, u.Username, mode, title, summary)
	if err != nil {
		s.fail(w, err)
		return
	}
	_, err = s.pool.Exec(r.Context(), `UPDATE changesets SET status='published',published_at=now(),updated_at=now()WHERE id=$1`, id)
	if err == nil {
		_, err = s.pool.Exec(r.Context(), `INSERT INTO changeset_reviews(changeset_id,reviewer_id,decision)VALUES($1,$2,'published')`, id, u.ID)
	}
	if err != nil {
		s.fail(w, err)
		return
	}
	httpjson.Write(w, 200, map[string]any{"id": id, "status": "published", "events": count})
}

func (s *Server) reviewChangeset(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id := pathID(changesetReviewPath, r.URL.Path)
	var body struct{ Decision, Note string }
	if httpjson.Read(r, &body) != nil || (body.Decision != "changes_requested" && body.Decision != "rejected") {
		httpjson.Write(w, 400, map[string]string{"error": "decision"})
		return
	}
	allowed := u.Role == "superuser"
	if !allowed {
		_ = s.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM changesets c JOIN moderation_areas area ON c.bounds IS NOT NULL AND ST_Covers(area.geom,c.bounds)AND(cardinality(area.modes)=0 OR c.mode=ANY(area.modes))JOIN moderation_assignments assignment ON assignment.area_id=area.id WHERE c.id=$1 AND c.status='submitted' AND assignment.user_id=$2)`, id, u.ID).Scan(&allowed)
	}
	if !allowed {
		httpjson.Write(w, 403, map[string]string{"error": "moderation area does not cover this changeset"})
		return
	}
	tag, err := s.pool.Exec(r.Context(), `UPDATE changesets SET status=$1,updated_at=now()WHERE id=$2 AND workspace_id='main' AND status='submitted'`, body.Decision, id)
	if err != nil {
		s.fail(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpjson.Write(w, 409, map[string]string{"error": "changeset cannot be reviewed"})
		return
	}
	_, err = s.pool.Exec(r.Context(), `INSERT INTO changeset_reviews(changeset_id,reviewer_id,decision,comment)VALUES($1,$2,$3,$4)`, id, u.ID, body.Decision, strings.TrimSpace(body.Note))
	if err != nil {
		s.fail(w, err)
		return
	}
	httpjson.Write(w, 200, map[string]any{"id": id, "status": body.Decision})
}
