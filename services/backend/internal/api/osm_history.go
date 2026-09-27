package api

import (
	"context"
	"encoding/json"
	"net/http"
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
			tags, _ := json.Marshal(node.Tags)
			if _, err := tx.Exec(ctx, `INSERT INTO osm_node_versions(workspace_id,id,version,changeset_id,visible,lat,lon,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, workspace, node.ID, node.Version, changesetID, item.visible, node.Lat, node.Lon, tags); err != nil {
				return err
			}
		}
		for _, way := range item.group.Ways {
			tags, _ := json.Marshal(way.Tags)
			if _, err := tx.Exec(ctx, `INSERT INTO osm_way_versions(workspace_id,id,version,changeset_id,visible,tags) VALUES($1,$2,$3,$4,$5,$6)`, workspace, way.ID, way.Version, changesetID, item.visible, tags); err != nil {
				return err
			}
			for sequence, nodeID := range way.Nodes {
				if _, err := tx.Exec(ctx, `INSERT INTO osm_way_nodes(workspace_id,way_id,way_version,sequence,node_id) VALUES($1,$2,$3,$4,$5)`, workspace, way.ID, way.Version, sequence, nodeID); err != nil {
					return err
				}
			}
		}
		for _, relation := range item.group.Relations {
			tags, _ := json.Marshal(relation.Tags)
			if _, err := tx.Exec(ctx, `INSERT INTO osm_relation_versions(workspace_id,id,version,changeset_id,visible,tags) VALUES($1,$2,$3,$4,$5,$6)`, workspace, relation.ID, relation.Version, changesetID, item.visible, tags); err != nil {
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
