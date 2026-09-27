package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"transport-history/backend/internal/domain"
	"transport-history/backend/internal/httpjson"
)

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func (s *Server) exportSVG(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	q := r.URL.Query()
	b, ok := parseBounds(q.Get("bbox"))
	date := strings.TrimSpace(q.Get("date"))
	if !ok || !domain.ValidDate(date) {
		httpjson.Write(w, 400, map[string]string{"error": "bbox, date"})
		return
	}
	zoom, _ := strconv.ParseFloat(q.Get("zoom"), 64)
	if q.Get("zoom") == "" {
		zoom = 12
	}
	zoom = clamp(zoom, 0, 22)
	width, _ := strconv.ParseFloat(q.Get("width"), 64)
	if width == 0 {
		width = 1600
	}
	width = clamp(width, 320, 4096)
	height, _ := strconv.ParseFloat(q.Get("height"), 64)
	if height == 0 {
		height = 1000
	}
	height = clamp(height, 240, 4096)
	workspace := strings.TrimSpace(q.Get("workspace"))
	if workspace == "" {
		workspace = "main"
	}
	if !s.canViewWorkspace(r, workspace) {
		httpjson.Write(w, 404, map[string]string{"error": "workspace"})
		return
	}
	state, err := s.buildMap(r.Context(), b, date, zoom, zoom >= 11, workspace)
	if err != nil {
		s.fail(w, err)
		return
	}
	enabled := map[string]bool{}
	rawModes := q.Get("modes")
	if rawModes == "" {
		rawModes = "railway,metro,tram,trolleybus,bus"
	}
	for _, v := range strings.Split(rawModes, ",") {
		if domain.Modes[v] {
			enabled[v] = true
		}
	}
	var visible map[string]bool
	if q.Has("routes") {
		visible = map[string]bool{}
		for _, v := range strings.Split(q.Get("routes"), ",") {
			if v != "" {
				visible[v] = true
			}
		}
	}
	features := []domain.Feature{}
	for _, f := range state.Features {
		p := f.Properties
		if p.Layer == "route" {
			if enabled[p.Mode] && (visible == nil || visible[p.LineID]) {
				features = append(features, f)
			}
		} else if domain.Modes[p.Mode] {
			if enabled[p.Mode] {
				features = append(features, f)
			}
		} else if p.Way == "rail" {
			if enabled["railway"] || enabled["metro"] || enabled["tram"] {
				features = append(features, f)
			}
		} else if enabled["trolleybus"] || enabled["bus"] {
			features = append(features, f)
		}
	}
	places := []map[string]any{}
	for _, p := range state.Places {
		modes, _ := p["modes"].([]string)
		keep := false
		for _, m := range modes {
			if enabled[m] {
				keep = true
			}
		}
		if keep {
			places = append(places, p)
		}
	}
	svg, err := s.buildSVG(r, features, b, zoom, int(width), int(height), q.Get("basemap") == "1", places)
	if err != nil {
		s.fail(w, err)
		return
	}
	w.Header().Set("content-type", "image/svg+xml; charset=utf-8")
	w.Header().Set("content-disposition", fmt.Sprintf(`attachment; filename="transport-%s.svg"`, date))
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(200)
	_, _ = io.WriteString(w, svg)
}

func worldPixel(lng, lat, zoom float64) (float64, float64) {
	size := 256 * math.Pow(2, zoom)
	x := (lng + 180) / 360 * size
	limited := clamp(lat, -85.05112878, 85.05112878)
	sin := math.Sin(limited * math.Pi / 180)
	y := (.5 - math.Log((1+sin)/(1-sin))/(4*math.Pi)) * size
	return x, y
}
func rawPoints(g domain.Geometry) [][][2]float64 {
	var v any
	if json.Unmarshal(g.Coordinates, &v) != nil {
		return nil
	}
	if g.Type == "Point" {
		a := v.([]any)
		return [][][2]float64{{{a[0].(float64), a[1].(float64)}}}
	}
	if g.Type == "LineString" {
		return [][][2]float64{toPoints(v)}
	}
	out := [][][2]float64{}
	for _, line := range v.([]any) {
		out = append(out, toPoints(line))
	}
	return out
}
func toPoints(v any) [][2]float64 {
	out := [][2]float64{}
	for _, q := range v.([]any) {
		p := q.([]any)
		out = append(out, [2]float64{p[0].(float64), p[1].(float64)})
	}
	return out
}

func offsetScreenLine(points [][2]float64, offset float64) [][2]float64 {
	if len(points) < 2 || offset == 0 {
		return points
	}
	out := make([][2]float64, len(points))
	for i, point := range points {
		previous := points[max(0, i-1)]
		next := points[min(len(points)-1, i+1)]
		dx, dy := next[0]-previous[0], next[1]-previous[1]
		length := math.Hypot(dx, dy)
		if length == 0 {
			out[i] = point
			continue
		}
		out[i] = [2]float64{point[0] - dy/length*offset, point[1] + dx/length*offset}
	}
	return out
}

func svgPolylinePoints(points [][2]float64) string {
	out := make([]string, 0, len(points))
	for _, point := range points {
		out = append(out, fmt.Sprintf("%.2f,%.2f", point[0], point[1]))
	}
	return strings.Join(out, " ")
}

func doubleTrackGap(mode string, zoom float64) float64 {
	if mode == "trolleybus" {
		return 2.2 * math.Pow(1.35, math.Max(0, zoom-14))
	}
	return 2.2
}

func (s *Server) buildSVG(r *http.Request, features []domain.Feature, b bounds, zoom float64, width, height int, basemap bool, places []map[string]any) (string, error) {
	left, top := worldPixel(b.West, b.North, zoom)
	right, bottom := worldPixel(b.East, b.South, zoom)
	sx := float64(width) / (right - left)
	sy := float64(height) / (bottom - top)
	project := func(p [2]float64) (float64, float64) {
		x, y := worldPixel(p[0], p[1], zoom)
		return (x - left) * sx, (y - top) * sy
	}
	tiles := []string{}
	if basemap {
		nz := int(math.Min(19, zoom))
		span := 256 * math.Pow(2, zoom-float64(nz))
		minX, maxX := int(math.Floor(left/span)), int(math.Floor(right/span))
		minY, maxY := int(math.Floor(top/span)), int(math.Floor(bottom/span))
		count := 1 << nz
		for ty := minY; ty <= maxY; ty++ {
			for tx := minX; tx <= maxX; tx++ {
				wx := ((tx % count) + count) % count
				href, err := s.tile(r, nz, wx, ty)
				if err != nil {
					return "", err
				}
				tiles = append(tiles, fmt.Sprintf(`<image href="%s" x="%.2f" y="%.2f" width="%.2f" height="%.2f" preserveAspectRatio="none"/>`, href, (float64(tx)*span-left)*sx, (float64(ty)*span-top)*sy, span*sx, span*sy))
			}
		}
	}
	shapes := []string{}
	for _, f := range features {
		color := html.EscapeString(f.Properties.Color)
		if color == "" {
			color = "#d7c4a3"
		}
		route := f.Properties.Layer == "route"
		form := f.Properties.TrackForm
		scale := strokeScale(zoom)
		opacity := .5
		if route {
			opacity = 1
		} else if form == "double" {
			opacity = .45
		}
		stroke := math.Max(1.15, 3*scale)
		if form == "double" {
			stroke = math.Max(1.15, 5*scale)
		} else if form == "single_oneway" {
			stroke = math.Max(1.15, 3.5*scale)
		}
		dash := ""
		if f.Properties.Propulsion == "autonomous" {
			dash = "18 10"
		} else if f.Properties.Grade == "tunnel" {
			dash = "10 8"
		} else if form == "single_oneway" {
			dash = "12 8"
		} else if form == "single_both" {
			dash = "10 5 2 5"
		}
		lines := rawPoints(f.Geometry)
		if f.Geometry.Type == "Point" && len(lines) > 0 {
			cx, cy := project(lines[0][0])
			shapes = append(shapes, fmt.Sprintf(`<circle cx="%.2f" cy="%.2f" r="3" fill="%s" stroke="#fff" stroke-width="1"/>`, cx, cy, color))
			continue
		}
		if f.Geometry.Type == "Polygon" {
			for _, ring := range lines {
				points := make([][2]float64, 0, len(ring))
				for _, p := range ring {
					x, y := project(p)
					points = append(points, [2]float64{x, y})
				}
				shapes = append(shapes, fmt.Sprintf(`<polygon points="%s" fill="%s" fill-opacity="0.24" stroke="%s" stroke-opacity="0.85" stroke-width="2" stroke-linejoin="round"/>`, svgPolylinePoints(points), color, color))
			}
			continue
		}
		for _, line := range lines {
			points := make([][2]float64, 0, len(line))
			for _, p := range line {
				x, y := project(p)
				points = append(points, [2]float64{x, y})
			}
			d := ""
			if dash != "" {
				d = ` stroke-dasharray="` + dash + `"`
			}
			if form == "double" && zoom >= 14 {
				trackStroke := math.Max(1.35, 2.1*scale)
				separation := (trackStroke + doubleTrackGap(f.Properties.Mode, zoom)) / 2
				for _, offset := range []float64{-separation, separation} {
					shifted := svgPolylinePoints(offsetScreenLine(points, offset))
					shapes = append(shapes, fmt.Sprintf(`<polyline points="%s" fill="none" stroke="%s" stroke-opacity="%.2f" stroke-width="%.2f"%s stroke-linecap="round" stroke-linejoin="round"/>`, shifted, color, opacity, trackStroke, d))
				}
			} else {
				joined := svgPolylinePoints(points)
				shapes = append(shapes, fmt.Sprintf(`<polyline points="%s" fill="none" stroke="%s" stroke-opacity="%.2f" stroke-width="%.2f"%s stroke-linecap="round" stroke-linejoin="round"/>`, joined, color, opacity, stroke, d))
			}
			if form == "double" && zoom < 14 {
				inner := .35
				if route {
					inner = .9
				}
				shapes = append(shapes, fmt.Sprintf(`<polyline points="%s" fill="none" stroke="#12171c" stroke-opacity="%.2f" stroke-width="%.2f"%s stroke-linecap="round" stroke-linejoin="round"/>`, svgPolylinePoints(points), inner, math.Max(1, 1.5*scale), d))
			}
		}
	}
	placeShapes := []string{}
	for _, p := range places {
		center, ok := p["center"].([]float64)
		if !ok || len(center) != 2 {
			continue
		}
		cx, cy := project([2]float64{center[1], center[0]})
		label := ""
		if zoom >= 5 {
			label = fmt.Sprintf(`<text x="%.2f" y="%.2f" font-family="sans-serif" font-size="12" font-weight="600" fill="#1c1814">%s</text>`, cx+10, cy+4, html.EscapeString(fmt.Sprint(p["name"])))
		}
		radius := 7
		if zoom < 5 {
			radius = 5
		}
		placeShapes = append(placeShapes, fmt.Sprintf(`<circle cx="%.2f" cy="%.2f" r="%d" fill="#d7c4a3" fill-opacity="0.95" stroke="#1c1814" stroke-width="2"/>%s`, cx, cy, radius, label))
	}
	labels := []string{}
	if zoom >= 12 {
		labels = svgLabels(features, project, zoom)
	}
	background := ""
	credit := ""
	if basemap {
		background = `<rect width="100%" height="100%" fill="#e5e2dc"/>` + strings.Join(tiles, "")
		credit = fmt.Sprintf(`<text x="%d" y="%d" text-anchor="end" font-family="sans-serif" font-size="10" fill="#333">© OpenStreetMap contributors</text>`, width-8, height-8)
	}
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">%s<g>%s</g><g>%s</g><g>%s</g>%s</svg>`, width, height, width, height, background, strings.Join(shapes, ""), strings.Join(placeShapes, ""), strings.Join(labels, ""), credit), nil
}

func (s *Server) tile(r *http.Request, z, x, y int) (string, error) {
	u := fmt.Sprintf("https://tile.openstreetmap.org/%d/%d/%d.png", z, x, y)
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
	req.Header.Set("user-agent", "transporthistory.net map export")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("basemap tile %d/%d/%d: %d", z, x, y, resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data), nil
}

func strokeScale(z float64) float64 {
	if z <= 12 {
		return 1
	}
	if z >= 19 {
		return .3
	}
	return 1 - ((z-12)/7)*.7
}

type labelLine struct {
	points      [][2]float64
	length      float64
	text, color string
}

func svgLabels(features []domain.Feature, project func([2]float64) (float64, float64), zoom float64) []string {
	longest := map[string]labelLine{}
	for _, f := range features {
		if f.Properties.Layer != "route" || f.Properties.Number == "" || f.Geometry.Type == "Point" {
			continue
		}
		for _, line := range rawPoints(f.Geometry) {
			projected := make([][2]float64, len(line))
			length := 0.0
			for i, p := range line {
				x, y := project(p)
				projected[i] = [2]float64{x, y}
				if i > 0 {
					length += math.Hypot(x-projected[i-1][0], y-projected[i-1][1])
				}
			}
			cur := longest[f.Properties.LineID]
			if length > cur.length {
				longest[f.Properties.LineID] = labelLine{projected, length, f.Properties.Number, f.Properties.Color}
			}
		}
	}
	keys := make([]string, 0, len(longest))
	for k := range longest {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := []string{}
	for _, k := range keys {
		v := longest[k]
		limit := 24.0
		if zoom < 14 {
			limit = 36
		}
		if v.length < limit || len(v.points) < 2 {
			continue
		}
		target := v.length / 2
		walked := 0.0
		for i := 1; i < len(v.points); i++ {
			a, b := v.points[i-1], v.points[i]
			length := math.Hypot(b[0]-a[0], b[1]-a[1])
			if walked+length >= target {
				ratio := (target - walked) / length
				x := a[0] + (b[0]-a[0])*ratio
				y := a[1] + (b[1]-a[1])*ratio
				angle := math.Atan2(b[1]-a[1], b[0]-a[0]) * 180 / math.Pi
				if angle > 90 || angle < -90 {
					angle += 180
				}
				font, pad := 11.0, 6.0
				if zoom < 14 {
					font, pad = 10, 4
				}
				width := math.Max(18, float64(len([]rune(v.text)))*font*.68+pad*2)
				out = append(out, fmt.Sprintf(`<g transform="translate(%.2f %.2f) rotate(%.2f)"><rect x="%.2f" y="-17" width="%.2f" height="16" rx="2" fill="#f4efe6" fill-opacity="0.94" stroke="%s"/><text x="0" y="-5" text-anchor="middle" font-family="sans-serif" font-size="%.0f" font-weight="600" fill="#1c1814">%s</text></g>`, x, y, angle, -width/2, width, html.EscapeString(v.color), font, html.EscapeString(v.text)))
				break
			}
			walked += length
		}
	}
	return out
}
