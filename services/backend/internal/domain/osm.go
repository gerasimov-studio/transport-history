package domain

import (
	"encoding/json"
	"fmt"
)

type OSMTags map[string]string

type OSMNode struct {
	ID      int64   `json:"id"`
	Version int     `json:"version"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	Tags    OSMTags `json:"tags,omitempty"`
}

type OSMWay struct {
	ID      int64   `json:"id"`
	Version int     `json:"version"`
	Nodes   []int64 `json:"nodes"`
	Tags    OSMTags `json:"tags,omitempty"`
}

type OSMMember struct {
	Type string `json:"type"`
	Ref  int64  `json:"ref"`
	Role string `json:"role"`
}

type OSMRelation struct {
	ID      int64       `json:"id"`
	Version int         `json:"version"`
	Members []OSMMember `json:"members"`
	Tags    OSMTags     `json:"tags,omitempty"`
}

type OSMPrimitives struct {
	Nodes     []OSMNode     `json:"nodes,omitempty"`
	Ways      []OSMWay      `json:"ways,omitempty"`
	Relations []OSMRelation `json:"relations,omitempty"`
}

type OSMChange struct {
	Version   string        `json:"version"`
	Generator string        `json:"generator"`
	Create    OSMPrimitives `json:"create,omitempty"`
	Modify    OSMPrimitives `json:"modify,omitempty"`
	Delete    OSMPrimitives `json:"delete,omitempty"`
}

func (change OSMChange) Validate() error {
	if change.Version != "0.6" {
		return fmt.Errorf("osmChange version must be 0.6")
	}
	seen := map[string]bool{}
	groups := []OSMPrimitives{change.Create, change.Modify, change.Delete}
	for _, group := range groups {
		for _, node := range group.Nodes {
			if node.ID == 0 || node.Version < 1 || node.Lat < -90 || node.Lat > 90 || node.Lon < -180 || node.Lon > 180 {
				return fmt.Errorf("invalid OSM node")
			}
			key := fmt.Sprintf("node/%d", node.ID)
			if seen[key] {
				return fmt.Errorf("primitive %s occurs more than once", key)
			}
			seen[key] = true
		}
		for _, way := range group.Ways {
			if way.ID == 0 || way.Version < 1 || len(way.Nodes) < 2 {
				return fmt.Errorf("invalid OSM way")
			}
			key := fmt.Sprintf("way/%d", way.ID)
			if seen[key] {
				return fmt.Errorf("primitive %s occurs more than once", key)
			}
			seen[key] = true
		}
		for _, relation := range group.Relations {
			if relation.ID == 0 || relation.Version < 1 {
				return fmt.Errorf("invalid OSM relation")
			}
			for _, member := range relation.Members {
				if member.Ref == 0 || (member.Type != "node" && member.Type != "way" && member.Type != "relation") {
					return fmt.Errorf("invalid OSM relation member")
				}
			}
			key := fmt.Sprintf("relation/%d", relation.ID)
			if seen[key] {
				return fmt.Errorf("primitive %s occurs more than once", key)
			}
			seen[key] = true
		}
	}
	return nil
}

func DecodeOSMChange(raw json.RawMessage) (OSMChange, error) {
	var change OSMChange
	if err := json.Unmarshal(raw, &change); err != nil {
		return change, err
	}
	return change, change.Validate()
}
