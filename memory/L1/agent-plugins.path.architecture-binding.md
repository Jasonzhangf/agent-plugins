<!-- project-memory:v1 {"category":"path","created_at":"2026-09-05T12:24:22.959896+00:00","id":"agent-plugins.path.architecture-binding","importance":0,"memory_level":1,"review_evidence":["user-review-2026-09-05"],"review_status":"reviewed","source_refs":[".appsdk/maps/function-map.json",".appsdk/maps/mainline-call-map.json",".appsdk/maps/module-registry.json",".appsdk/maps/resource-map.json",".appsdk/maps/verification-map.json","AGENTS.md","skills/agent-plugins-governance/SKILL.md"],"tags":["architecture","maps","owner","verification"],"updated_at":"2026-09-05T14:30:14.066842+00:00"} -->

# Architecture binding order

For runtime or framework work, inspect resource map first, then function map, mainline call map, module registry, verification map, and source. Bind the issue to one owner and adjacent edges before editing; map gaps are recorded and repaired through the owning map scope instead of being inferred from grep results.
<!-- project-memory:end -->
