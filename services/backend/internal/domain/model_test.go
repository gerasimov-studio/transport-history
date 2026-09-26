package domain

import (
	"encoding/json"
	"testing"
)

func raw(value string) json.RawMessage { return json.RawMessage(value) }

func TestProjectAndRenderTrolleybusLegs(t *testing.T) {
	events := []Event{
		{Type: "infra.upsert", OccurredOn: "2020-01-01", Payload: raw(`{"id":"wire","kind":"track","way":"road","mode":"trolleybus","name":"Wire","color":"#333","trackForm":"double","geometry":{"type":"LineString","coordinates":[[1,2],[3,4]]}}`)},
		{Type: "route.upsert", OccurredOn: "2020-01-01", Payload: raw(`{"id":"route-1","mode":"trolleybus","number":"1","name":"Route 1","color":"#f00","segmentIds":[],"legs":[{"type":"wire","segmentIds":["wire"]},{"type":"autonomous","geometry":{"type":"LineString","coordinates":[[3,4],[5,6]]}}]}`)},
	}
	state := Project(events, "2020-01-01")
	features := Features(state, "2020-01-01")
	if len(features) != 3 {
		t.Fatalf("expected infrastructure and two route legs, got %d", len(features))
	}
	propulsion := map[string]bool{}
	for _, feature := range features {
		if feature.Properties.Layer == "route" {
			propulsion[feature.Properties.Propulsion] = true
			if feature.Properties.Propulsion == "wire" && feature.Properties.TrackForm != "double" {
				t.Fatalf("wired route must inherit infrastructure track form: %#v", feature.Properties)
			}
			if feature.Properties.Propulsion == "autonomous" && feature.Properties.InfraID != "" {
				t.Fatalf("autonomous route must not reference infrastructure: %#v", feature.Properties)
			}
		}
	}
	if !propulsion["wire"] || !propulsion["autonomous"] {
		t.Fatalf("missing trolleybus propulsion variants: %#v", propulsion)
	}
}

func TestRailwayIsRailInfrastructure(t *testing.T) {
	if got := WayOf("railway"); got != "rail" {
		t.Fatalf("railway way = %q, want rail", got)
	}
	items := []json.RawMessage{raw(`{"id":"mainline","kind":"track","mode":"railway","name":"Main line","color":"#735f4b","trackForm":"single_both","geometry":{"type":"LineString","coordinates":[[1,2],[3,4]]}}`)}
	result, err := ValidateInfra(items, "rail", "1900-01-01")
	if err != nil {
		t.Fatal(err)
	}
	if result[0].Mode != "railway" || result[0].TrackForm != "single_both" {
		t.Fatalf("unexpected railway infrastructure: %#v", result[0])
	}
}

func TestProjectKeepsFutureInfrastructureForLifecycleFiltering(t *testing.T) {
	events := []Event{{Type: "infra.upsert", OccurredOn: "2030-01-01", Payload: raw(`{"id":"future","kind":"track","way":"rail","since":"2030-01-01","name":"Future","color":"#333","trackForm":"double","geometry":{"type":"LineString","coordinates":[[1,2],[3,4]]}}`)}}
	state := Project(events, "2020-01-01")
	if _, ok := state.Infra["future"]; !ok {
		t.Fatal("event projection must retain infrastructure; validity is applied while rendering")
	}
	if got := len(Features(state, "2020-01-01")); got != 0 {
		t.Fatalf("future infrastructure rendered early: %d", got)
	}
}

func TestValidateInfraNormalizesLegacyGauge(t *testing.T) {
	items := []json.RawMessage{raw(`{"id":"track","kind":"track","gauge":1524,"name":"Track","color":"#333","trackForm":"double","geometry":{"type":"LineString","coordinates":[[1,2],[3,4]]}}`)}
	result, err := ValidateInfra(items, "rail", "2000-01-01")
	if err != nil {
		t.Fatal(err)
	}
	if result[0].Gauge == nil || *result[0].Gauge != 1520 {
		t.Fatalf("unexpected normalized gauge: %#v", result[0].Gauge)
	}
}

func TestValidateInfraAcceptsStandaloneDepotArea(t *testing.T) {
	items := []json.RawMessage{raw(`{"id":"depot","kind":"area","facilityKind":"depot","name":"Depot","color":"#735f4b","geometry":{"type":"Polygon","coordinates":[[[1,2],[3,2],[3,4],[1,2]]]}}`)}
	result, err := ValidateInfra(items, "road", "2000-01-01")
	if err != nil {
		t.Fatal(err)
	}
	if result[0].FacilityKind != "depot" || result[0].Geometry.Type != "Polygon" {
		t.Fatalf("unexpected depot area: %#v", result[0])
	}
}

func TestValidateInfraRejectsOpenDepotArea(t *testing.T) {
	items := []json.RawMessage{raw(`{"id":"depot","kind":"area","facilityKind":"depot","name":"Depot","color":"#735f4b","geometry":{"type":"Polygon","coordinates":[[[1,2],[3,2],[3,4],[1,4]]]}}`)}
	if _, err := ValidateInfra(items, "road", "2000-01-01"); err == nil {
		t.Fatal("expected open depot polygon to be rejected")
	}
}

func TestValidateInfraAcceptsStationWithMultipleEntrances(t *testing.T) {
	items := []json.RawMessage{
		raw(`{"id":"central","kind":"station","mode":"metro","name":"Central","color":"#735f4b","geometry":{"type":"Point","coordinates":[1,2]}}`),
		raw(`{"id":"central-north","kind":"entrance","stationId":"central","mode":"metro","name":"North entrance","color":"#735f4b","geometry":{"type":"Point","coordinates":[1.001,2.001]}}`),
		raw(`{"id":"central-south","kind":"entrance","stationId":"central","mode":"metro","name":"South entrance","color":"#735f4b","geometry":{"type":"Point","coordinates":[0.999,1.999]}}`),
	}
	result, err := ValidateInfra(items, "rail", "2000-01-01")
	if err != nil {
		t.Fatal(err)
	}
	if result[1].StationID != "central" || result[2].StationID != "central" {
		t.Fatalf("station links were lost: %#v", result)
	}
}

func TestValidateInfraRejectsUnlinkedStationEntrance(t *testing.T) {
	items := []json.RawMessage{raw(`{"id":"entrance","kind":"entrance","mode":"metro","name":"Entrance","color":"#735f4b","geometry":{"type":"Point","coordinates":[1,2]}}`)}
	if _, err := ValidateInfra(items, "rail", "2000-01-01"); err == nil {
		t.Fatal("expected entrance without stationId to be rejected")
	}
}
