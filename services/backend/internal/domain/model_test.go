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
		}
	}
	if !propulsion["wire"] || !propulsion["autonomous"] {
		t.Fatalf("missing trolleybus propulsion variants: %#v", propulsion)
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
