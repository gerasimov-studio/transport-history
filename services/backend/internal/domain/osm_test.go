package domain

import "testing"

func TestOSMChangeValidation(t *testing.T) {
	change := OSMChange{Version: "0.6", Generator: "transporthistory", Create: OSMPrimitives{
		Nodes: []OSMNode{{ID: -1, Version: 1, Lat: 55.7, Lon: 13.2}},
		Ways:  []OSMWay{{ID: -2, Version: 1, Nodes: []int64{-1, -3}, Tags: OSMTags{"railway": "tram"}}},
	}}
	if err := change.Validate(); err != nil {
		t.Fatal(err)
	}
	change.Modify.Nodes = []OSMNode{{ID: -1, Version: 2, Lat: 55.7, Lon: 13.2}}
	if err := change.Validate(); err == nil {
		t.Fatal("duplicate primitive must fail")
	}
}
