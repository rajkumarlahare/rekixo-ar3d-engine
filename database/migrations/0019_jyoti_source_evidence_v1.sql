-- Jyoti Paradise source-evidence disclosure and explicit floor geometry.
-- Engine/Jyoti scope only; no Platform/Super Admin resources are modified.

UPDATE scenes_3d
   SET settings_json = json_set(
     settings_json,
     '$.floorLevels', json('[{"floor":0,"elevationM":0,"topElevationM":3.048},{"floor":1,"elevationM":3.048,"topElevationM":6.0452},{"floor":2,"elevationM":6.0452,"topElevationM":9.0424},{"floor":3,"elevationM":9.0424,"topElevationM":12.0396},{"floor":4,"elevationM":12.0396,"topElevationM":15.0368},{"floor":5,"elevationM":15.0368,"topElevationM":18.034}]'),
     '$.dimensionPolicy', json('{"priority":["architectural-dwg","conceptual-brochure"],"note":"Architectural DWG dimensional evidence outranks the conceptual brochure. Unresolved conflicts remain disclosed until reviewed rather than being silently reconciled."}'),
     '$.sourceConflicts', json('[{"id":"floor-count-brochure-conflict","title":"Floor-plan scope requires review","detail":"The brochure labels the typical plan as 1st to 3rd floor while its unit series extends to 501/502. The viewer does not infer a resolved residential floor count from that brochure conflict.","status":"unresolved"}]'),
     '$.sourceEvidenceVersion', 1
   ),
       updated_at = datetime('now')
 WHERE id = 'scene_jyoti_typical_floor_v1';

INSERT OR IGNORE INTO publish_versions_3d (
  id, project_id, version, snapshot_json, published_at
) VALUES (
  'publish_jyoti_v17',
  'project_jyoti_paradise',
  17,
  '{"phase":"source-evidence-v1","features":["explicit-floor-levels","source-precedence-policy","unresolved-conflict-disclosure","scene-v2-room-evidence"],"limitations":["room placement remains reconstructed until higher-authority DWG/semantic boundary review","doors/openings are not authoritative"],"scope":"rekixo-ar3d-engine+jyoti-only"}',
  datetime('now')
);
