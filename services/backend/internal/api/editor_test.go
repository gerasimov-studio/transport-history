package api

import (
	"encoding/json"
	"testing"

	"transport-history/backend/internal/domain"
)

func testLine(points [][2]float64) domain.Geometry {
	raw, _ := json.Marshal(points)
	return domain.Geometry{Type: "LineString", Coordinates: raw}
}

func TestRouteRequiresCompatibleExistingInfrastructure(t *testing.T) {
	route := domain.Route{ID: "route:1", Mode: "tram", Since: "2021-01-01", SegmentIDs: []string{"track:1"}}
	infra := map[string]domain.Infra{
		"track:1": {ID: "track:1", Kind: "track", Mode: "tram", Since: "2020-01-01"},
	}
	if err := validateRouteInfrastructure([]domain.Route{route}, infra); err != nil {
		t.Fatalf("valid route rejected: %v", err)
	}
	delete(infra, "track:1")
	if err := validateRouteInfrastructure([]domain.Route{route}, infra); err == nil {
		t.Fatal("route without infrastructure was accepted")
	}
}

func TestRouteInfrastructureMustOverlapInModeAndTime(t *testing.T) {
	route := domain.Route{ID: "route:1", Mode: "tram", Since: "2021-01-01", Until: "2022-01-01", SegmentIDs: []string{"track:1"}}
	infra := map[string]domain.Infra{
		"track:1": {ID: "track:1", Kind: "track", Mode: "railway", Since: "2020-01-01"},
	}
	if err := validateRouteInfrastructure([]domain.Route{route}, infra); err == nil {
		t.Fatal("route with an incompatible mode was accepted")
	}
	infra["track:1"] = domain.Infra{ID: "track:1", Kind: "track", Mode: "tram", Since: "2023-01-01"}
	if err := validateRouteInfrastructure([]domain.Route{route}, infra); err == nil {
		t.Fatal("route outside infrastructure lifetime was accepted")
	}
}

func TestBusAndAutonomousTrolleybusMayOmitInfrastructure(t *testing.T) {
	routes := []domain.Route{
		{ID: "bus:1", Mode: "bus", Since: "2021-01-01"},
		{ID: "trolleybus:1", Mode: "trolleybus", Since: "2021-01-01", Legs: []domain.RouteLeg{{Type: "autonomous"}}},
	}
	if err := validateRouteInfrastructure(routes, map[string]domain.Infra{}); err != nil {
		t.Fatalf("road-only route rejected: %v", err)
	}
}

func TestRoutePathMustBeContinuousAndStopsMustBelongToIt(t *testing.T) {
	route := domain.Route{ID: "route:1", Mode: "tram", Since: "2021-01-01", Paths: []domain.RoutePath{{
		SegmentIDs: []string{"track:1", "track:2"}, StopIDs: []string{"stop:1"},
	}}}
	infra := map[string]domain.Infra{
		"track:1": {ID: "track:1", Kind: "track", Mode: "tram", Geometry: testLine([][2]float64{{1, 1}, {2, 2}})},
		"track:2": {ID: "track:2", Kind: "track", Mode: "tram", Geometry: testLine([][2]float64{{2, 2}, {3, 3}})},
		"stop:1":  {ID: "stop:1", Kind: "stop", Mode: "tram", TrackID: "track:2"},
	}
	if err := validateRouteInfrastructure([]domain.Route{route}, infra); err != nil {
		t.Fatalf("continuous route rejected: %v", err)
	}
	infra["track:2"] = domain.Infra{ID: "track:2", Kind: "track", Mode: "tram", Geometry: testLine([][2]float64{{4, 4}, {5, 5}})}
	if err := validateRouteInfrastructure([]domain.Route{route}, infra); err == nil {
		t.Fatal("discontinuous route was accepted")
	}
	infra["track:2"] = domain.Infra{ID: "track:2", Kind: "track", Mode: "tram", Geometry: testLine([][2]float64{{2, 2}, {3, 3}})}
	infra["stop:1"] = domain.Infra{ID: "stop:1", Kind: "stop", Mode: "tram", TrackID: "track:outside"}
	if err := validateRouteInfrastructure([]domain.Route{route}, infra); err == nil {
		t.Fatal("stop outside route infrastructure was accepted")
	}
}
