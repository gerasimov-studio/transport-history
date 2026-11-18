package api

import (
	"encoding/json"
	"testing"

	"transport-history/backend/internal/domain"
)

func renderGeometry(value string) domain.Geometry {
	return domain.Geometry{Type: "LineString", Coordinates: json.RawMessage(value)}
}

func TestJoinRouteFeaturesBuildsContinuousChain(t *testing.T) {
	properties := domain.FeatureProperties{Kind: "track", Mode: "tram", LineID: "line-1", Number: "1", Color: "#c43b32", TrackForm: "double", Layer: "route", InfraID: "track"}
	features := []domain.Feature{
		{Type: "Feature", Properties: properties, Geometry: renderGeometry(`[[1,1],[2,2]]`)},
		{Type: "Feature", Properties: properties, Geometry: renderGeometry(`[[3,3],[2,2]]`)},
	}
	joined := joinRouteFeatures(features)
	if len(joined) != 1 {
		t.Fatalf("joined features = %d, want 1", len(joined))
	}
	var coordinates [][]float64
	if err := json.Unmarshal(joined[0].Geometry.Coordinates, &coordinates); err != nil {
		t.Fatal(err)
	}
	if len(coordinates) != 3 || joined[0].Properties.InfraID != "" {
		t.Fatalf("unexpected joined route: %#v", joined[0])
	}
}

func TestSimplifyGeometryKeepsEndpoints(t *testing.T) {
	geometry := renderGeometry(`[[0,0],[0.00000001,0.00000001],[1,1]]`)
	simplified := simplifyGeometry(geometry, 12)
	var coordinates [][]float64
	if err := json.Unmarshal(simplified.Coordinates, &coordinates); err != nil {
		t.Fatal(err)
	}
	if len(coordinates) != 2 || coordinates[0][0] != 0 || coordinates[1][0] != 1 {
		t.Fatalf("unexpected simplified geometry: %#v", coordinates)
	}
}

func TestCompactRenderStateDeduplicatesStylesAndSplitsLayers(t *testing.T) {
	style := domain.FeatureProperties{Mode: "tram", Color: "#c43b32", TrackForm: "double", Way: "rail", Layer: "infra"}
	track := style
	track.Kind, track.LineID = "track", "track-1"
	stop := style
	stop.Kind, stop.LineID = "stop", "stop-1"
	state := mapState{Zoom: 15, Features: []domain.Feature{
		{Type: "Feature", Properties: track, Geometry: renderGeometry(`[[1,1],[2,2]]`)},
		{Type: "Feature", Properties: stop, Geometry: domain.Geometry{Type: "Point", Coordinates: json.RawMessage(`[1,1]`)}},
	}}
	rendered := compactRenderState(state)
	if len(rendered.Styles) != 1 || len(rendered.Layers.Tracks) != 1 || len(rendered.Layers.Stops) != 1 {
		t.Fatalf("unexpected compact state: %#v", rendered)
	}
}
