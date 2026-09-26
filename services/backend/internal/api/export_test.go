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

func TestTrolleybusDoubleTrackGapGrowsWithZoom(t *testing.T) {
	previous := 0.0
	for _, zoom := range []float64{14, 18, 22} {
		gap := doubleTrackGap("trolleybus", zoom)
		if gap <= previous {
			t.Fatalf("gap did not grow at zoom %.0f: %.3f <= %.3f", zoom, gap, previous)
		}
		previous = gap
	}
	if railway := doubleTrackGap("railway", 22); math.Abs(railway-2.2) > 0.001 {
		t.Fatalf("railway gap must remain compact, got %.3f", railway)
	}
}
