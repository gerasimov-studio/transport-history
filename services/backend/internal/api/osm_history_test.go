package api

import (
	"testing"

	"transport-history/backend/internal/domain"
)

func TestContainingTrackIDRequiresNodeMembership(t *testing.T) {
	ways := map[int64]osmProjectionWay{
		10: {tags: domain.OSMTags{"railway": "tram"}, refs: []int64{1, 2, 3}},
		20: {tags: domain.OSMTags{"railway": "platform"}, refs: []int64{4, 5, 6}},
	}
	if got := containingTrackID(2, ways); got != "osm:way:10" {
		t.Fatalf("track id = %q", got)
	}
	if got := containingTrackID(5, ways); got != "" {
		t.Fatalf("platform must not become track: %q", got)
	}
}

func TestStopGroupIDPairsDirectionalStops(t *testing.T) {
	if a, b := stopGroupID("Lund Solbjer", 1), stopGroupID("Lund Solbjer", 2); a != b || a != "osm:stop-group:solbjer" {
		t.Fatalf("unexpected group ids %q and %q", a, b)
	}
}

func TestPlatformPointUsesOSMPlatformGeometry(t *testing.T) {
	nodes := map[int64]osmProjectionNode{
		1: {lon: 13.0, lat: 55.0},
		2: {lon: 13.2, lat: 55.2},
	}
	ways := map[int64]osmProjectionWay{20: {refs: []int64{1, 2}}}
	point := platformPointForStop(10, map[int64]int64{10: 20}, ways, nodes)
	if point == nil || point[0] != 13.1 || point[1] != 55.1 {
		t.Fatalf("platform point = %#v", point)
	}
}

func TestDepotAndRouteDirectionRecognition(t *testing.T) {
	if !isTramDepot(domain.OSMTags{"industrial": "depot", "description": "Spårvagnsdepå"}) {
		t.Fatal("tram depot was not recognized")
	}
	if isTramDepot(domain.OSMTags{"building": "industrial", "depot": "tram", "description": "Spårvagnsdepå"}) {
		t.Fatal("depot building must not replace the depot grounds")
	}
	relations := map[int64]osmProjectionRelation{
		100: {members: []domain.OSMMember{{Type: "way", Ref: 10}}},
		200: {members: []domain.OSMMember{{Type: "way", Ref: 20}}},
	}
	directions := map[int64]string{100: "forward", 200: "backward"}
	if !wayHasSingleRouteDirection(10, relations, directions) {
		t.Fatal("one-direction route way was not recognized")
	}
	if wayHasSingleRouteDirection(30, relations, directions) {
		t.Fatal("non-route yard way must remain bidirectional")
	}
}

func TestDefaultModeColors(t *testing.T) {
	want := map[string]string{"metro": "#171717", "tram": "#c43b32", "trolleybus": "#27824a", "bus": "#d5a900"}
	for mode, color := range want {
		if got := defaultModeColor(mode); got != color {
			t.Errorf("%s color = %s, want %s", mode, got, color)
		}
	}
}
