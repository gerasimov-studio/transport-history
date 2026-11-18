package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"transport-history/backend/internal/domain"
	"transport-history/backend/internal/httpjson"
)

type renderStyle struct {
	Mode       string `json:"mode"`
	Color      string `json:"color"`
	TrackForm  string `json:"trackForm,omitempty"`
	Way        string `json:"way,omitempty"`
	Gauge      int    `json:"gauge,omitempty"`
	Grade      string `json:"grade,omitempty"`
	Level      int    `json:"level,omitempty"`
	Propulsion string `json:"propulsion,omitempty"`
}

type renderFeature struct {
	ID            string          `json:"id"`
	Style         int             `json:"style"`
	Kind          string          `json:"kind,omitempty"`
	Name          string          `json:"name,omitempty"`
	Number        string          `json:"number,omitempty"`
	NodeKind      string          `json:"nodeKind,omitempty"`
	FacilityKind  string          `json:"facilityKind,omitempty"`
	StationID     string          `json:"stationId,omitempty"`
	TrackID       string          `json:"trackId,omitempty"`
	StopGroupID   string          `json:"stopGroupId,omitempty"`
	StopDirection string          `json:"stopDirection,omitempty"`
	PlatformPoint *[2]float64     `json:"platformPoint,omitempty"`
	Since         string          `json:"since,omitempty"`
	Until         string          `json:"until,omitempty"`
	Geometry      domain.Geometry `json:"geometry"`
}

type renderLayers struct {
	Tracks []renderFeature `json:"tracks"`
	Routes []renderFeature `json:"routes"`
	Stops  []renderFeature `json:"stops"`
	Areas  []renderFeature `json:"areas"`
	Nodes  []renderFeature `json:"nodes"`
}

type renderRoute struct {
	ID     string `json:"id"`
	Mode   string `json:"mode"`
	Number string `json:"number"`
	Name   string `json:"name"`
	Color  string `json:"color"`
	Since  string `json:"since,omitempty"`
	Until  string `json:"until,omitempty"`
}

type renderState struct {
	Scope      string             `json:"scope"`
	Bounds     bounds             `json:"bounds"`
	Zoom       float64            `json:"zoom"`
	Date       string             `json:"date"`
	Dates      []string           `json:"dates"`
	Events     []domain.Chronicle `json:"events"`
	Chronicles []domain.Chronicle `json:"chronicles"`
	Places     []map[string]any   `json:"places"`
	Styles     []renderStyle      `json:"styles"`
	Layers     renderLayers       `json:"layers"`
	Routes     []renderRoute      `json:"routes"`
}

func (s *Server) renderView(w http.ResponseWriter, r *http.Request) {
	b, ok := parseBounds(r.URL.Query().Get("bbox"))
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	zoom, err := strconv.ParseFloat(r.URL.Query().Get("zoom"), 64)
	if !ok || !domain.ValidDate(date) || err != nil || zoom < 0 || zoom > 22 {
		httpjson.Write(w, 400, map[string]string{"error": "bbox, date, zoom"})
		return
	}
	workspace := strings.TrimSpace(r.URL.Query().Get("workspace"))
	if workspace == "" {
		workspace = "main"
	}
	if !s.canViewWorkspace(r, workspace) {
		httpjson.Write(w, 404, map[string]string{"error": "workspace"})
		return
	}
	state, err := s.buildMap(r.Context(), b, date, zoom, false, workspace)
	if err != nil {
		s.fail(w, err)
		return
	}
	httpjson.Write(w, 200, compactRenderState(state))
}

func compactRenderState(state mapState) renderState {
	features := joinRouteFeatures(state.Features)
	sort.Slice(features, func(i, j int) bool {
		left, right := features[i].Properties, features[j].Properties
		if left.Layer != right.Layer {
			return left.Layer < right.Layer
		}
		if left.Kind != right.Kind {
			return left.Kind < right.Kind
		}
		if left.LineID != right.LineID {
			return left.LineID < right.LineID
		}
		return string(features[i].Geometry.Coordinates) < string(features[j].Geometry.Coordinates)
	})
	styles := []renderStyle{}
	styleIDs := map[renderStyle]int{}
	layers := renderLayers{Tracks: []renderFeature{}, Routes: []renderFeature{}, Stops: []renderFeature{}, Areas: []renderFeature{}, Nodes: []renderFeature{}}
	for _, feature := range features {
		p := feature.Properties
		gauge, level := 0, 0
		if p.Gauge != nil {
			gauge = *p.Gauge
		}
		if p.Level != nil {
			level = *p.Level
		}
		style := renderStyle{p.Mode, p.Color, p.TrackForm, p.Way, gauge, p.Grade, level, p.Propulsion}
		styleID, found := styleIDs[style]
		if !found {
			styleID = len(styles)
			styles = append(styles, style)
			styleIDs[style] = styleID
		}
		item := renderFeature{p.LineID, styleID, p.Kind, p.Name, p.Number, p.NodeKind, p.FacilityKind, p.StationID, p.TrackID, p.StopGroupID, p.StopDirection, p.PlatformPoint, p.Since, p.Until, simplifyGeometry(feature.Geometry, state.Zoom)}
		switch {
		case p.Layer == "route":
			layers.Routes = append(layers.Routes, item)
		case p.Kind == "stop" || p.Kind == "station" || p.Kind == "entrance":
			layers.Stops = append(layers.Stops, item)
		case p.Kind == "area":
			layers.Areas = append(layers.Areas, item)
		case p.Kind == "node":
			layers.Nodes = append(layers.Nodes, item)
		default:
			layers.Tracks = append(layers.Tracks, item)
		}
	}
	routes := make([]renderRoute, 0, len(state.Routes))
	for _, route := range state.Routes {
		routes = append(routes, renderRoute{route.ID, route.Mode, route.Number, route.Name, route.Color, route.Since, route.Until})
	}
	sort.Slice(routes, func(i, j int) bool { return routes[i].ID < routes[j].ID })
	return renderState{state.Scope, state.Bounds, state.Zoom, state.Date, state.Dates, state.Events, state.Chronicles, state.Places, styles, layers, routes}
}

func routeSignature(p domain.FeatureProperties) string {
	return fmt.Sprintf("%s|%s|%s|%s|%s|%s|%v|%s", p.LineID, p.Number, p.Color, p.TrackForm, p.Way, p.Grade, p.Level, p.Propulsion)
}

func joinRouteFeatures(features []domain.Feature) []domain.Feature {
	out := make([]domain.Feature, 0, len(features))
	type group struct {
		sample domain.Feature
		lines  [][][]float64
	}
	groups := map[string]*group{}
	for _, feature := range features {
		if feature.Properties.Layer != "route" || feature.Properties.InfraID == "" || (feature.Geometry.Type != "LineString" && feature.Geometry.Type != "MultiLineString") {
			out = append(out, feature)
			continue
		}
		key := routeSignature(feature.Properties)
		g := groups[key]
		if g == nil {
			g = &group{sample: feature}
			groups[key] = g
		}
		if feature.Geometry.Type == "LineString" {
			var line [][]float64
			_ = json.Unmarshal(feature.Geometry.Coordinates, &line)
			g.lines = append(g.lines, line)
		} else {
			var lines [][][]float64
			_ = json.Unmarshal(feature.Geometry.Coordinates, &lines)
			g.lines = append(g.lines, lines...)
		}
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		g := groups[key]
		for _, line := range joinLines(g.lines) {
			feature := g.sample
			feature.Properties.InfraID = ""
			raw, _ := json.Marshal(line)
			feature.Geometry = domain.Geometry{Type: "LineString", Coordinates: raw}
			out = append(out, feature)
		}
	}
	return out
}

func pointKey(p []float64) string { return fmt.Sprintf("%.7f,%.7f", p[0], p[1]) }

func joinLines(lines [][][]float64) [][][]float64 {
	type edge struct {
		line       [][]float64
		start, end string
	}
	edges := []edge{}
	at := map[string][]int{}
	for _, line := range lines {
		if len(line) < 2 {
			continue
		}
		e := edge{line, pointKey(line[0]), pointKey(line[len(line)-1])}
		i := len(edges)
		edges = append(edges, e)
		at[e.start] = append(at[e.start], i)
		at[e.end] = append(at[e.end], i)
	}
	unused := map[int]bool{}
	for i := range edges {
		unused[i] = true
	}
	walk := func(first int, from string) [][]float64 {
		result := [][]float64{}
		index, node := first, from
		for unused[index] {
			delete(unused, index)
			e := edges[index]
			line := e.line
			if e.end == node {
				line = reverseLine(line)
				node = e.start
			} else {
				node = e.end
			}
			if len(result) > 0 {
				result = append(result, line[1:]...)
			} else {
				result = append(result, line...)
			}
			next := []int{}
			for _, n := range at[node] {
				if unused[n] {
					next = append(next, n)
				}
			}
			if len(at[node]) != 2 || len(next) != 1 {
				break
			}
			index = next[0]
		}
		return result
	}
	out := [][][]float64{}
	for i, e := range edges {
		for _, node := range []string{e.start, e.end} {
			if unused[i] && len(at[node]) != 2 {
				out = append(out, walk(i, node))
			}
		}
	}
	for len(unused) > 0 {
		var i int
		for i = range unused {
			break
		}
		out = append(out, walk(i, edges[i].start))
	}
	return out
}

func reverseLine(line [][]float64) [][]float64 {
	out := make([][]float64, len(line))
	for i := range line {
		out[len(line)-1-i] = line[i]
	}
	return out
}

func simplifyGeometry(g domain.Geometry, zoom float64) domain.Geometry {
	if zoom >= 16 || g.Type != "LineString" {
		return g
	}
	var line [][]float64
	if json.Unmarshal(g.Coordinates, &line) != nil || len(line) < 3 {
		return g
	}
	tolerance := 0.45 / (256 * math.Pow(2, zoom)) * 360
	line = simplifyLine(line, tolerance*tolerance)
	raw, _ := json.Marshal(line)
	g.Coordinates = raw
	return g
}

func simplifyLine(points [][]float64, tolerance2 float64) [][]float64 {
	if len(points) < 3 {
		return points
	}
	keep := make([]bool, len(points))
	keep[0] = true
	keep[len(points)-1] = true
	var visit func(int, int)
	visit = func(a, b int) {
		ax, ay := points[a][0], points[a][1]
		bx, by := points[b][0], points[b][1]
		best, index := 0.0, -1
		for i := a + 1; i < b; i++ {
			d := segmentDistance2(points[i][0], points[i][1], ax, ay, bx, by)
			if d > best {
				best, index = d, i
			}
		}
		if index >= 0 && best > tolerance2 {
			keep[index] = true
			visit(a, index)
			visit(index, b)
		}
	}
	visit(0, len(points)-1)
	out := [][]float64{}
	for i, p := range points {
		if keep[i] {
			out = append(out, p)
		}
	}
	return out
}

func segmentDistance2(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	if dx == 0 && dy == 0 {
		dx, dy = px-ax, py-ay
		return dx*dx + dy*dy
	}
	t := ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)
	t = math.Max(0, math.Min(1, t))
	dx, dy = px-(ax+t*dx), py-(ay+t*dy)
	return dx*dx + dy*dy
}
