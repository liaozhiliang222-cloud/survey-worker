// This is the persisted semantic contract, independent of compact UI profiles.
export function datasetMetadata(table, source = {}, { datasetId = null, weighted = false, weighting = null } = {}) {
  const variables = new Map((table.variables || source.variables || []).map((v) => [v.name, v]));
  return {
    schema_version: 1,
    sheet_name: table.name,
    sheets: datasetId ? [{ name: table.name, row_count: table.rows.length, column_count: table.headers.length }] : table.sheets || source.sheets || [{ name: table.name, row_count: table.rows.length, column_count: table.headers.length }],
    source_sheets: source.source_sheets || source.sheets || table.sheets || [{ name: table.name, row_count: table.rows.length, column_count: table.headers.length }],
    source_format: table.source_format || source.source_format || '',
    encoding: table.encoding || source.encoding || '',
    source_version: source.source_version || null,
    parent_version: datasetId,
    fields: [...table.headers], fields_truncated: false, variables_truncated: false,
    variables: table.headers.map((name) => ({ name, source_name: name, label: '', type: 'unknown', measure: 'unknown', missing: { kind: 'none' }, value_labels: [], ...variables.get(name) })),
    profile_structure_complete: true,
    weight_status: weighted ? 'weighted' : 'unweighted',
    weight_field: weighted ? '__weight' : null,
    ...(weighting ? { weighting } : {}),
  };
}

export function derivedPayload(table, rows, metadata) {
  return { schema_version: 1, sheet_name: table.name, headers: metadata.fields, rows, metadata };
}
