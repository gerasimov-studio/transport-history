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

A route owns no duplicate track geometry. Each direction is an ordered path
containing infrastructure-way references and stop references. Stops are
infrastructure objects located on those ways, not free route points. The
projection reconstructs every path between consecutive stops on the
infrastructure graph, preferring the ways named by the source OSM route
relation and using other infrastructure only to close a missing connection.
It then stitches the referenced ways into continuous drawing chains. OSM way
boundaries therefore remain available for editing and versioning but are never
presented as breaks in a passenger route.

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

## Published data

Imported transport networks are ordinary published map data, not seed or demo
fixtures. Lund begins with its December 2020 opening changeset. Tampere begins
with the August 2021 opening and continues with the Santalahti and
Lentävänniemi extensions as separate changesets. Source primitive ids and
versions are retained in provenance records.

Tampere imports the complete tram infrastructure graph, not only ways used by
today's passenger routes. The opening changeset therefore includes the depot
grounds and yard tracks. Each phase uses the OSM route-relation versions that
describe service in that period and carries an explicit end date when the
route pattern is superseded.

Every imported system has its own stable `scope_id`. This scope partitions the
disposable projection and the chronicle; it does not make a city a storage
container or an API boundary. Infrastructure primitives retain the effective
date of the changeset that created them, so later extensions do not appear in
earlier map states.
