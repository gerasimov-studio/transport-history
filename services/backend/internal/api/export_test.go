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
