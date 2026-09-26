package api

import (
	"math"
	"testing"
)

func TestOffsetScreenLineCreatesParallelTracks(t *testing.T) {
	line := [][2]float64{{0, 0}, {10, 0}, {20, 0}}
	left := offsetScreenLine(line, -3)
	right := offsetScreenLine(line, 3)
	for i := range line {
		if math.Abs(left[i][1]-right[i][1]-6) > 0.001 && math.Abs(right[i][1]-left[i][1]-6) > 0.001 {
			t.Fatalf("tracks are not six pixels apart at %d: left=%v right=%v", i, left[i], right[i])
		}
	}
}

func TestDetailedDoubleTrackKeepsVisibleGapAtClosestZoom(t *testing.T) {
	scale := strokeScale(22)
	trackStroke := math.Max(1.35, 2.1*scale)
	separation := (trackStroke + 2.2) / 2
	if gap := 2*separation - trackStroke; math.Abs(gap-2.2) > 0.001 {
		t.Fatalf("visible gap = %.3f, want 2.2", gap)
	}
}
