# OSM-compatible history model

Transport History stores the canonical network as an OSM 0.6-compatible graph.
History runs forward: the earliest changeset creates the first known graph and
each later changeset transforms it into the next state.

## Canonical primitives

- `node`: numeric id, latitude, longitude and tags.
- `way`: numeric id, ordered node references and tags.
- `relation`: numeric id, ordered typed members with roles and tags.
- `osmChange`: `create`, `modify` and `delete` groups containing complete OSM
  primitives.

The database normalises these structures, but import and export must be
lossless with OSM XML/PBF semantics. Unknown tags are retained.

Transport History adds metadata around, rather than inside, OSM data:

- effective date of the real-world change;
- recorded and publication timestamps;
- author, workspace and moderation state;
- title, historical description and sources;
- confidence and distinction between a real event and a later data correction.

External OSM ids are provenance, not identity. One imported OSM primitive may
map to several historical primitives and vice versa after splits or merges.

## Versioning

Every primitive version belongs to exactly one published changeset. A version
becomes effective on the changeset date. `delete` writes an invisible version;
it never removes an earlier version. The state at a date is the latest version
per `(workspace, primitive type, id)` whose changeset is effective on or before
that date.

Several changesets may share a date. Their deterministic order is
`effective_on`, then publication sequence. A data correction may be recorded
today with an earlier effective date and causes affected projections to be
rebuilt from that date.

## Read model

The browser never reconstructs OSM history. Published primitive versions are
compiled into a spatial projection bounded by viewport and date. Projection
tables are disposable and must be reproducible from published changesets.

Routes use standard `type=route` relations. Systems use
`type=transport_system` relations. Historical articles remain changeset
metadata and are not encoded as artificial OSM tags.

Surface stops are projected from OSM `stop_position` nodes that are actual
members of an infrastructure way. The projection stores that way as `trackId`
and derives the served direction from route-relation membership; platform
geometry remains source context rather than a second map stop. Its centroid is
stored in the disposable projection only to orient the stop semicircle toward
the physical platform. Opposite directions share a stable stop group. Stops,
tracks and the route created by one opening changeset share its effective date.

Depot grounds are projected independently from routes as infrastructure areas.
Every rail way in the imported depot extract is projected, including yard,
workshop and access tracks that carry no passenger route.

## Initial dataset

The first demonstration dataset is Lund tramway. Its initial changeset is
effective in December 2020 and creates the imported current OSM tram graph.
Source primitive ids and versions are retained in provenance records.
