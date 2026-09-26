package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

var Modes = map[string]bool{"metro": true, "tram": true, "trolleybus": true, "bus": true}
var Ways = map[string]bool{"rail": true, "road": true}
var TrackForms = map[string]bool{"double": true, "single_oneway": true, "single_both": true}
var NodeKinds = map[string]bool{"junction": true, "terminus": true, "loop": true, "wye": true, "crossover": true, "portal": true}

type Geometry struct {
	Type        string          `json:"type"`
	Coordinates json.RawMessage `json:"coordinates"`
}

type Infra struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"`
	Way       string   `json:"way"`
	Mode      string   `json:"mode,omitempty"`
	Gauge     *int     `json:"gauge,omitempty"`
	Grade     string   `json:"grade,omitempty"`
	Level     *int     `json:"level,omitempty"`
	Since     string   `json:"since,omitempty"`
	Until     string   `json:"until,omitempty"`
	Name      string   `json:"name"`
	Color     string   `json:"color"`
	TrackForm string   `json:"trackForm"`
	NodeKind  string   `json:"nodeKind,omitempty"`
	Geometry  Geometry `json:"geometry"`
}

type RouteLeg struct {
	Type       string    `json:"type"`
	SegmentIDs []string  `json:"segmentIds,omitempty"`
	Geometry   *Geometry `json:"geometry,omitempty"`
}

type Route struct {
	ID         string     `json:"id"`
	Mode       string     `json:"mode"`
	Number     string     `json:"number"`
	Name       string     `json:"name"`
	Color      string     `json:"color"`
	SegmentIDs []string   `json:"segmentIds"`
	Geometry   *Geometry  `json:"geometry,omitempty"`
	Legs       []RouteLeg `json:"legs,omitempty"`
	Since      string     `json:"since,omitempty"`
	Until      string     `json:"until,omitempty"`
}

type Chronicle struct {
	ID      string `json:"id"`
	City    string `json:"city"`
	Mode    string `json:"mode"`
	Date    string `json:"date"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Network string `json:"network"`
}

type Event struct {
	ID         int64           `json:"id,omitempty"`
	Type       string          `json:"type"`
	OccurredOn string          `json:"occurredOn"`
	CityID     string          `json:"cityId"`
	Actor      *string         `json:"actor,omitempty"`
	Payload    json.RawMessage `json:"payload"`
}

type Projection struct {
	Infra      map[string]Infra
	Routes     map[string]Route
	Chronicles map[string]Chronicle
}

type FeatureProperties struct {
	Kind       string `json:"kind"`
	Mode       string `json:"mode"`
	LineID     string `json:"lineId"`
	Number     string `json:"number"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	TrackForm  string `json:"trackForm"`
	NodeKind   string `json:"nodeKind,omitempty"`
	Layer      string `json:"layer,omitempty"`
	InfraID    string `json:"infraId,omitempty"`
	Way        string `json:"way,omitempty"`
	Gauge      *int   `json:"gauge,omitempty"`
	Grade      string `json:"grade,omitempty"`
	Level      *int   `json:"level,omitempty"`
	Propulsion string `json:"propulsion,omitempty"`
	Since      string `json:"since,omitempty"`
	Until      string `json:"until,omitempty"`
}

type Feature struct {
	Type       string            `json:"type"`
	Properties FeatureProperties `json:"properties"`
	Geometry   Geometry          `json:"geometry"`
}

type Operations struct {
	UpsertInfra  []Infra  `json:"upsertInfra"`
	RemoveInfra  []string `json:"removeInfra"`
	UpsertRoutes []Route  `json:"upsertRoutes"`
	RemoveRoutes []string `json:"removeRoutes"`
}

func ValidDate(value string) bool { return datePattern.MatchString(value) }

func WayOf(mode string) string {
	if mode == "metro" || mode == "tram" {
		return "rail"
	}
	return "road"
}

func Alive(since, until, date string) bool {
	return (since == "" || since <= date) && (until == "" || until >= date)
}

func NormalizeInfra(v Infra, fallbackWay string) Infra {
	if !Ways[v.Way] {
		if Modes[v.Mode] {
			v.Way = WayOf(v.Mode)
		} else {
			v.Way = fallbackWay
		}
	}
	if v.Way == "rail" {
		if v.Gauge != nil && *v.Gauge == 1524 {
			n := 1520
			v.Gauge = &n
		}
		if v.Gauge != nil && (*v.Gauge < 600 || *v.Gauge > 3000) {
			v.Gauge = nil
		}
		if v.Gauge == nil {
			n := 1520
			v.Gauge = &n
		}
		if v.Grade != "tunnel" {
			v.Grade = "surface"
			v.Level = nil
		}
		if v.Grade == "tunnel" && v.Level == nil {
			n := -1
			v.Level = &n
		}
		if v.Grade == "tunnel" && v.Level != nil && (*v.Level > -1 || *v.Level < -9) {
			n := -1
			v.Level = &n
		}
	} else {
		v.Gauge = nil
		v.Grade = ""
		v.Level = nil
	}
	if !TrackForms[v.TrackForm] {
		if v.Mode == "metro" {
			v.TrackForm = "double"
		} else {
			v.TrackForm = "single_both"
		}
	}
	if v.Until != "" && v.Since != "" && v.Until < v.Since {
		v.Until = v.Since
	}
	return v
}

func NormalizeRoute(v Route) Route {
	if v.Mode != "bus" {
		v.Geometry = nil
	}
	if v.Mode != "trolleybus" {
		v.Legs = nil
	}
	if v.Until != "" && v.Since != "" && v.Until < v.Since {
		v.Until = v.Since
	}
	return v
}

func Project(events []Event, viewDate string) Projection {
	p := Projection{Infra: map[string]Infra{}, Routes: map[string]Route{}, Chronicles: map[string]Chronicle{}}
	for _, e := range events {
		if viewDate != "" && e.Type == "chronicle.upsert" && e.OccurredOn > viewDate {
			continue
		}
		switch e.Type {
		case "infra.upsert":
			var v Infra
			if json.Unmarshal(e.Payload, &v) == nil {
				v = NormalizeInfra(v, "rail")
				p.Infra[v.ID] = v
			}
		case "infra.removed":
			var v struct {
				ID string `json:"id"`
			}
			_ = json.Unmarshal(e.Payload, &v)
			delete(p.Infra, v.ID)
		case "route.upsert":
			var v Route
			if json.Unmarshal(e.Payload, &v) == nil {
				v = NormalizeRoute(v)
				p.Routes[v.ID] = v
			}
		case "route.removed":
			var v struct {
				ID string `json:"id"`
			}
			_ = json.Unmarshal(e.Payload, &v)
			delete(p.Routes, v.ID)
		case "chronicle.upsert":
			var v Chronicle
			if json.Unmarshal(e.Payload, &v) == nil {
				p.Chronicles[v.Mode+":"+v.Date] = v
			}
		}
	}
	return p
}

func Features(p Projection, date string) []Feature {
	out := make([]Feature, 0, len(p.Infra)+len(p.Routes))
	for _, v := range p.Infra {
		if date != "" && !Alive(v.Since, v.Until, date) {
			continue
		}
		mode := v.Mode
		if mode == "" {
			if v.Way == "rail" {
				mode = "metro"
			} else {
				mode = "trolleybus"
			}
		}
		out = append(out, Feature{Type: "Feature", Geometry: v.Geometry, Properties: FeatureProperties{Kind: v.Kind, Mode: mode, LineID: v.ID, Name: v.Name, Color: v.Color, TrackForm: v.TrackForm, NodeKind: v.NodeKind, Layer: "infra", InfraID: v.ID, Way: v.Way, Gauge: v.Gauge, Grade: v.Grade, Level: v.Level, Since: v.Since, Until: v.Until}})
	}
	for _, r := range p.Routes {
		if date != "" && !Alive(r.Since, r.Until, date) {
			continue
		}
		if len(r.Legs) > 0 {
			for _, leg := range r.Legs {
				if leg.Type == "autonomous" && leg.Geometry != nil && CoordinateCount(*leg.Geometry) >= 2 {
					out = append(out, routeFeature(r, *leg.Geometry, "", "road", "autonomous", nil))
				}
				if leg.Type == "wire" {
					for _, id := range leg.SegmentIDs {
						out = appendRouteSegment(out, p, r, id, date, "wire")
					}
				}
			}
		} else if r.Geometry != nil && CoordinateCount(*r.Geometry) >= 2 {
			out = append(out, routeFeature(r, *r.Geometry, "", "road", "", nil))
		} else {
			for _, id := range r.SegmentIDs {
				out = appendRouteSegment(out, p, r, id, date, "")
			}
		}
	}
	return out
}

func appendRouteSegment(out []Feature, p Projection, r Route, id, date, propulsion string) []Feature {
	v, ok := p.Infra[id]
	if !ok || v.Kind != "track" || (date != "" && !Alive(v.Since, v.Until, date)) {
		return out
	}
	return append(out, routeFeature(r, v.Geometry, v.ID, v.Way, propulsion, &v))
}

func routeFeature(r Route, g Geometry, infraID, way, propulsion string, infra *Infra) Feature {
	form := "single_both"
	var gauge *int
	grade := ""
	var level *int
	if infra != nil {
		form = infra.TrackForm
		gauge = infra.Gauge
		grade = infra.Grade
		level = infra.Level
	}
	return Feature{Type: "Feature", Geometry: g, Properties: FeatureProperties{Kind: "track", Mode: r.Mode, LineID: r.ID, Number: r.Number, Name: r.Name, Color: r.Color, TrackForm: form, Layer: "route", InfraID: infraID, Way: way, Gauge: gauge, Grade: grade, Level: level, Propulsion: propulsion, Since: r.Since, Until: r.Until}}
}

func CoordinateCount(g Geometry) int {
	var v any
	if json.Unmarshal(g.Coordinates, &v) != nil {
		return 0
	}
	return countPoints(v)
}
func countPoints(v any) int {
	a, ok := v.([]any)
	if !ok {
		return 0
	}
	if len(a) == 2 {
		_, x := a[0].(float64)
		_, y := a[1].(float64)
		if x && y {
			return 1
		}
	}
	n := 0
	for _, q := range a {
		n += countPoints(q)
	}
	return n
}

func GeometryInBounds(g Geometry, west, south, east, north float64) bool {
	var v any
	if json.Unmarshal(g.Coordinates, &v) != nil {
		return false
	}
	points := [][2]float64{}
	collectPoints(v, &points)
	if len(points) == 0 {
		return false
	}
	minX, maxX, minY, maxY := points[0][0], points[0][0], points[0][1], points[0][1]
	for _, p := range points[1:] {
		minX = math.Min(minX, p[0])
		maxX = math.Max(maxX, p[0])
		minY = math.Min(minY, p[1])
		maxY = math.Max(maxY, p[1])
	}
	return minX <= east && maxX >= west && minY <= north && maxY >= south
}
func collectPoints(v any, out *[][2]float64) {
	a, ok := v.([]any)
	if !ok {
		return
	}
	if len(a) == 2 {
		a0, x := a[0].(float64)
		a1, y := a[1].(float64)
		if x && y {
			*out = append(*out, [2]float64{a0, a1})
			return
		}
	}
	for _, q := range a {
		collectPoints(q, out)
	}
}

func ValidateInfra(input []json.RawMessage, way, fallbackSince string) ([]Infra, error) {
	out := make([]Infra, 0, len(input))
	for i, raw := range input {
		var v Infra
		if json.Unmarshal(raw, &v) != nil {
			return nil, fmt.Errorf("infra %d: geometry", i)
		}
		if v.ID == "" {
			return nil, fmt.Errorf("infra %d: id", i)
		}
		if v.Kind != "track" && v.Kind != "stop" && v.Kind != "node" {
			return nil, fmt.Errorf("infra %d: kind", i)
		}
		if v.Geometry.Type == "" || len(v.Geometry.Coordinates) == 0 {
			return nil, fmt.Errorf("infra %d: geometry", i)
		}
		if v.Kind == "track" && v.Geometry.Type != "LineString" && v.Geometry.Type != "MultiLineString" {
			return nil, fmt.Errorf("infra %d: track geometry", i)
		}
		if v.Kind == "stop" && v.Geometry.Type != "Point" {
			return nil, fmt.Errorf("infra %d: stop geometry", i)
		}
		if v.Kind == "node" {
			if !NodeKinds[v.NodeKind] {
				return nil, fmt.Errorf("infra %d: nodeKind", i)
			}
			if way == "road" && (v.NodeKind == "wye" || v.NodeKind == "crossover" || v.NodeKind == "portal") {
				return nil, fmt.Errorf("infra %d: nodeKind", i)
			}
			line := v.NodeKind == "loop" || v.NodeKind == "wye" || v.NodeKind == "crossover"
			if (line && (v.Geometry.Type != "LineString" && v.Geometry.Type != "MultiLineString")) || (!line && v.Geometry.Type != "Point") {
				return nil, fmt.Errorf("infra %d: node geometry", i)
			}
		}
		if v.Since == "" {
			v.Since = fallbackSince
		}
		if !ValidDate(v.Since) {
			return nil, fmt.Errorf("infra %d: since", i)
		}
		if v.Until != "" && (!ValidDate(v.Until) || v.Until < v.Since) {
			return nil, fmt.Errorf("infra %d: until", i)
		}
		v.Way = way
		if !Modes[v.Mode] || WayOf(v.Mode) != way {
			v.Mode = ""
		}
		if v.Name == "" {
			if v.Kind == "track" {
				if way == "road" {
					v.Name = "Улица"
				} else {
					v.Name = "Путь"
				}
			} else if v.Kind == "stop" {
				v.Name = "Остановка"
			} else {
				v.Name = "Узел"
			}
		}
		if v.Color == "" {
			if v.Kind == "track" {
				if way == "road" {
					v.Color = "#6b746c"
				} else {
					v.Color = "#8b9098"
				}
			} else {
				v.Color = "#c45c26"
			}
		}
		v = NormalizeInfra(v, way)
		out = append(out, v)
	}
	return out, nil
}

func ValidateRoutes(input []json.RawMessage, mode, fallbackSince string) ([]Route, error) {
	out := make([]Route, 0, len(input))
	for i, raw := range input {
		var v Route
		if json.Unmarshal(raw, &v) != nil {
			return nil, fmt.Errorf("route %d: geometry", i)
		}
		v.Number = strings.TrimSpace(v.Number)
		if v.ID == "" {
			return nil, fmt.Errorf("route %d: id", i)
		}
		if v.Number == "" {
			return nil, fmt.Errorf("route %d: number", i)
		}
		v.Mode = mode
		if v.Since == "" {
			v.Since = fallbackSince
		}
		if !ValidDate(v.Since) {
			return nil, fmt.Errorf("route %d: since", i)
		}
		if v.Until != "" && (!ValidDate(v.Until) || v.Until < v.Since) {
			return nil, fmt.Errorf("route %d: until", i)
		}
		if v.Name == "" {
			v.Name = "Route №" + v.Number
		}
		if v.Color == "" {
			v.Color = "#c45c26"
		}
		if mode == "bus" && v.Geometry != nil && (v.Geometry.Type != "LineString" || CoordinateCount(*v.Geometry) < 2) {
			return nil, fmt.Errorf("route %d: geometry", i)
		}
		if mode == "trolleybus" {
			for j, l := range v.Legs {
				if l.Type == "wire" {
					continue
				}
				if l.Type != "autonomous" || l.Geometry == nil || l.Geometry.Type != "LineString" || CoordinateCount(*l.Geometry) < 2 {
					return nil, fmt.Errorf("route %d: leg %d", i, j)
				}
			}
		}
		v = NormalizeRoute(v)
		out = append(out, v)
	}
	return out, nil
}

func DiffEvents(city, date, way, mode, actor, title, summary string, before Projection, infra []Infra, routes []Route) []Event {
	events := []Event{}
	beforeI := map[string]Infra{}
	for id, v := range before.Infra {
		v = NormalizeInfra(v, way)
		if v.Way == way {
			beforeI[id] = v
		}
	}
	afterI := map[string]Infra{}
	for _, v := range infra {
		v = NormalizeInfra(v, way)
		afterI[v.ID] = v
		if old, ok := beforeI[v.ID]; !ok || !JSONEqual(old, v) {
			events = append(events, newEvent("infra.upsert", date, city, actor, v))
		}
	}
	for id := range beforeI {
		if _, ok := afterI[id]; !ok {
			events = append(events, newEvent("infra.removed", date, city, actor, map[string]string{"id": id}))
		}
	}
	beforeR := map[string]Route{}
	for id, v := range before.Routes {
		v = NormalizeRoute(v)
		if v.Mode == mode {
			beforeR[id] = v
		}
	}
	afterR := map[string]Route{}
	for _, v := range routes {
		v = NormalizeRoute(v)
		afterR[v.ID] = v
		if old, ok := beforeR[v.ID]; !ok || !JSONEqual(old, v) {
			events = append(events, newEvent("route.upsert", date, city, actor, v))
		}
	}
	for id := range beforeR {
		if _, ok := afterR[id]; !ok {
			events = append(events, newEvent("route.removed", date, city, actor, map[string]string{"id": id}))
		}
	}
	if strings.TrimSpace(title) != "" {
		var prev *Chronicle
		for _, v := range before.Chronicles {
			if v.Mode == mode && v.Date <= date && (prev == nil || prev.Date < v.Date) {
				q := v
				prev = &q
			}
		}
		next := Chronicle{ID: city + "-" + mode + "-" + date, City: city, Mode: mode, Date: date, Title: title, Summary: summary, Network: ""}
		if prev == nil || prev.Title != title || prev.Summary != summary || prev.Date != date {
			events = append(events, newEvent("chronicle.upsert", date, city, actor, next))
		}
	}
	return events
}
func newEvent(kind, date, city, actor string, payload any) Event {
	raw, _ := json.Marshal(payload)
	a := actor
	return Event{Type: kind, OccurredOn: date, CityID: city, Actor: &a, Payload: raw}
}
func JSONEqual(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	var xa, ya any
	_ = json.Unmarshal(x, &xa)
	_ = json.Unmarshal(y, &ya)
	return bytes.Equal(canonical(xa), canonical(ya))
}
func canonical(v any) []byte {
	if m, ok := v.(map[string]any); ok {
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var b bytes.Buffer
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			q, _ := json.Marshal(k)
			b.Write(q)
			b.WriteByte(':')
			b.Write(canonical(m[k]))
		}
		b.WriteByte('}')
		return b.Bytes()
	}
	if a, ok := v.([]any); ok {
		var b bytes.Buffer
		b.WriteByte('[')
		for i, q := range a {
			if i > 0 {
				b.WriteByte(',')
			}
			b.Write(canonical(q))
		}
		b.WriteByte(']')
		return b.Bytes()
	}
	q, _ := json.Marshal(v)
	return q
}

func IntValue(v any) (int, bool) {
	switch q := v.(type) {
	case float64:
		if math.Trunc(q) == q {
			return int(q), true
		}
	case string:
		n, e := strconv.Atoi(q)
		return n, e == nil
	}
	return 0, false
}
