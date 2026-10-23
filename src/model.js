import {
  analysisFieldDependencies,
  evaluateFunctionFields,
  formulaDependencies,
  normalizeAnalysis,
  normalizeFormula,
  normalizeFunctionResultType,
  validateAnalysis,
  validateFunctionFieldDefinitions,
} from "./calculations.js";

export const FIELD_TYPES = Object.freeze([
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
  { value: "temporal", label: "Temporal" },
  { value: "location", label: "Location" },
  { value: "link", label: "Link" },
  { value: "linkList", label: "List of links" },
  { value: "textList", label: "List of text" },
  { value: "numberList", label: "List of numbers" },
  { value: "function", label: "Function" },
]);

export const TEMPLATE_KINDS = Object.freeze([
  { value: "user", label: "User-defined Template" },
  { value: "intrinsic", label: "Intrinsic Template" },
]);

export const FIELD_ROLES = Object.freeze([
  { value: "ordinary", label: "Ordinary Field" },
  { value: "system", label: "System Field" },
  { value: "subtype", label: "Subtype-generating Field" },
]);

export const NAMING_CONVENTIONS = Object.freeze([
  { value: "unique", label: "Entered names" },
  { value: "generated", label: "Generated names" },
]);

/** Toggle one value while preserving the established order of every other selection. */
export function toggleOrderedSelection(values, value) {
  const ordered = [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
  const target = String(value ?? "");
  if (!target) return ordered;
  const index = ordered.indexOf(target);
  if (index >= 0) ordered.splice(index, 1);
  else ordered.push(target);
  return ordered;
}

/** Move an existing selection by one position without sorting or changing its identity. */
export function moveOrderedSelection(values, value, direction) {
  const ordered = [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
  const index = ordered.indexOf(String(value ?? ""));
  if (index < 0) return ordered;
  const offset = direction === "up" || Number(direction) < 0 ? -1 : 1;
  const destination = Math.min(ordered.length - 1, Math.max(0, index + offset));
  if (destination === index) return ordered;
  [ordered[index], ordered[destination]] = [ordered[destination], ordered[index]];
  return ordered;
}

export class WorkspaceError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkspaceError";
  }
}

const clone = (value) => structuredClone(value);
const array = (value) => Array.isArray(value) ? value : [];
const text = (value, fallback = "") => typeof value === "string" ? value : fallback;
const bool = (value, fallback = false) => typeof value === "boolean" ? value : fallback;
const byPosition = (left, right) => (left.position ?? 0) - (right.position ?? 0);

function creationTimestamp(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function compareInstancesByCreation(left, right) {
  return creationTimestamp(right?.createdAt) - creationTimestamp(left?.createdAt)
    || String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

/** Keep the canonical Field Registry deterministic while presenting the newest definitions first. */
export function compareFieldsByCreation(left, right) {
  return creationTimestamp(right?.createdAt) - creationTimestamp(left?.createdAt)
    || String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

export function emptyWorkspaceState(overrides = {}) {
  const { workspace: workspaceOverrides = {}, ...collectionOverrides } = overrides ?? {};
  return {
    templates: [],
    fields: [],
    templateFields: [],
    instances: [],
    values: [],
    attachments: [],
    inboxFiles: [],
    sources: [],
    derivedRelationships: [],
    analyses: [],
    calculationErrors: [],
    history: [],
    ...collectionOverrides,
    workspace: {
      id: "workspace-local",
      name: "Clade",
      revision: 0,
      databasePath: "",
      persistent: false,
      ...workspaceOverrides,
    },
  };
}

function normaliseRole(role) {
  const value = text(role).toLowerCase();
  if (value.includes("system")) return "system";
  if (value.includes("subtype")) return "subtype";
  if (value.includes("ordinary")) return "ordinary";
  return value || "ordinary";
}

function normaliseFieldType(type) {
  const value = text(type).replaceAll("_", "").replaceAll(" ", "").toLowerCase();
  const aliases = {
    checkbox: "checkbox",
    date: "date",
    datetime: "datetime",
    function: "function",
    location: "location",
    link: "link",
    linklist: "linkList",
    listoflinks: "linkList",
    number: "number",
    numberlist: "numberList",
    listofnumbers: "numberList",
    text: "text",
    textlist: "textList",
    listoftext: "textList",
    temporal: "temporal",
    temporalfield: "temporal",
    locationfield: "location",
  };
  return aliases[value] ?? "text";
}

function normaliseTemplateKind(template) {
  const value = text(template?.templateKind ?? template?.template_kind ?? template?.kind)
    .replaceAll("_", "")
    .replaceAll("-", "")
    .toLowerCase();
  if (["intrinsic", "system", "systemmanaged", "builtin"].includes(value)) return "intrinsic";
  if (bool(template?.intrinsic) || bool(template?.systemManaged ?? template?.system_managed)) return "intrinsic";
  if (text(template?.intrinsicKey ?? template?.intrinsic_key ?? template?.systemKey ?? template?.system_key).trim()) return "intrinsic";
  return "user";
}

export function isIntrinsicTemplate(template) {
  return Boolean(template && (
    template.kind === "intrinsic"
    || template.templateKind === "intrinsic"
    || template.template_kind === "intrinsic"
    || template.intrinsic === true
    || template.systemManaged === true
    || template.system_managed === true
    || template.intrinsicKey
    || template.intrinsic_key
  ));
}

const templateKindOf = (template) => isIntrinsicTemplate(template) ? "intrinsic" : "user";

export function userTemplates(state) {
  return array(state?.templates).filter((template) => !isIntrinsicTemplate(template));
}

export function intrinsicTemplates(state) {
  return array(state?.templates).filter(isIntrinsicTemplate);
}

/** Convert the repository response into the single shape consumed by every view. */
export function normalizeWorkspaceState(input) {
  if (!input || typeof input !== "object") return emptyWorkspaceState();
  const root = input.state && typeof input.state === "object" ? input.state : input;
  const rawWorkspace = root.workspace ?? root.summary ?? {};
  const rawTemplates = array(root.templates);
  const templates = rawTemplates.map((template) => {
    const kind = normaliseTemplateKind(template);
    return {
      id: text(template.id),
      name: text(template.name),
      definition: text(template.definition),
      kind,
      intrinsicKey: text(
        template.intrinsicKey
        ?? template.intrinsic_key
        ?? template.intrinsicId
        ?? template.intrinsic_id
        ?? template.systemKey
        ?? template.system_key,
      ),
      // Intrinsic containment is represented by derived Instance relationships,
      // never by user-ontology Template inheritance.
      parentId: kind === "intrinsic"
        ? ""
        : text(template.parentTemplateId ?? template.parentId ?? template.parent_id ?? template.parent?.id),
      namingConvention: text(template.namingConvention ?? template.naming_convention, "unique").toLowerCase(),
      version: Number(template.version ?? 1),
      directFieldIds: array(template.directFieldIds ?? template.direct_field_ids),
      effectiveFieldIds: array(template.effectiveFieldIds ?? template.effective_field_ids),
      createdAt: text(template.createdAt ?? template.created_at),
      updatedAt: text(template.updatedAt ?? template.updated_at),
    };
  }).filter((entry) => entry.id && entry.name);

  const fields = array(root.fields).map((field) => {
    const type = normaliseFieldType(field.fieldType ?? field.type ?? field.field_type);
    const resultType = type === "function"
      ? normalizeFunctionResultType(field.functionResultType ?? field.function_result_type ?? field.resultType ?? field.result_type, "number")
      : type;
    return {
      id: text(field.id),
      name: text(field.name),
      definition: text(field.definition ?? field.description),
      type,
      resultType,
      formula: type === "function"
        ? normalizeFormula(field.formula ?? field.formulaJson ?? field.formula_json)
        : null,
      displayFormat: text(
        field.displayFormat ?? field.display_format,
        type === "function" && resultType === "duration" ? "duration" : "",
      ),
      role: normaliseRole(field.role),
      required: bool(field.required),
      intrinsicTemplateKey: text(
        field.intrinsicTemplateKey
        ?? field.intrinsic_template_key
        ?? field.intrinsicKind
        ?? field.intrinsic_kind,
      ),
      configuration: clone(field.configuration ?? field.config ?? field.options ?? null),
      allowedTargetTemplateId: text(
        field.allowedTargetTemplateId
        ?? field.allowed_target_template_id
        ?? field.targetTemplateId
        ?? field.target_template_id,
      ),
      introducerTemplateId: text(field.introducerTemplateId ?? field.introducer_template_id ?? field.originTemplateId),
      createdAt: text(field.createdAt ?? field.created_at),
      updatedAt: text(field.updatedAt ?? field.updated_at),
    };
  }).filter((entry) => entry.id && entry.name);

  const declaredAssignments = array(root.templateFields ?? root.template_fields).map((link, index) => ({
    templateId: text(link.templateId ?? link.template_id),
    fieldId: text(link.fieldId ?? link.field_id),
    position: Number(link.position ?? index),
    required: bool(link.required),
    originTemplateId: text(link.originTemplateId ?? link.origin_template_id),
  }));
  const nestedAssignments = templates.flatMap((template) => template.directFieldIds.map((fieldId, position) => ({
    templateId: template.id,
    fieldId,
    position,
    required: fields.find((field) => field.id === fieldId)?.required ?? false,
    originTemplateId: template.id,
  })));
  const templateFields = [...declaredAssignments, ...nestedAssignments]
    .filter((entry, index, all) => entry.templateId && entry.fieldId && all.findIndex((candidate) => candidate.templateId === entry.templateId && candidate.fieldId === entry.fieldId) === index)
    .sort(byPosition);

  const rawInstances = array(root.instances);
  const templateKindById = new Map(templates.map((template) => [template.id, template.kind]));
  const instances = rawInstances.map((instance) => ({
    id: text(instance.id),
    name: text(instance.name),
    templateId: text(instance.templateId ?? instance.template_id ?? instance.template?.id),
    notes: text(instance.notes),
    completed: bool(instance.completed ?? instance.completedNote ?? instance.completed_note),
    canonicalKey: text(
      instance.canonicalKey
      ?? instance.canonical_key
      ?? instance.intrinsicKey
      ?? instance.intrinsic_key,
    ),
    storageKind: text(
      instance.storageKind ?? instance.storage_kind,
      templateKindById.get(text(instance.templateId ?? instance.template_id ?? instance.template?.id)) === "intrinsic"
        ? "intrinsic"
        : "standard",
    ),
    systemManaged: bool(
      instance.systemManaged ?? instance.system_managed,
      templateKindById.get(text(instance.templateId ?? instance.template_id ?? instance.template?.id)) === "intrinsic",
    ),
    createdAt: text(instance.createdAt ?? instance.created_at),
    updatedAt: text(instance.updatedAt ?? instance.updated_at),
  })).filter((entry) => entry.id && entry.name);

  const nestedValues = rawInstances.flatMap((instance) => {
    if (Array.isArray(instance?.values)) return instance.values.map((entry) => ({ ...entry, instanceId: instance.id }));
    if (!instance?.values || typeof instance.values !== "object") return [];
    return Object.entries(instance.values).map(([fieldId, value]) => ({ instanceId: instance.id, fieldId, value }));
  });
  const values = [...array(root.values ?? root.instanceValues ?? root.instance_values), ...nestedValues]
    .map((entry) => ({
      instanceId: text(entry.instanceId ?? entry.instance_id),
      fieldId: text(entry.fieldId ?? entry.field_id),
      value: clone(entry.value ?? entry.valueJson ?? entry.value_json ?? null),
      derived: bool(entry.derived),
      resultType: text(entry.resultType ?? entry.result_type),
      error: text(entry.error),
      errorCode: text(entry.errorCode ?? entry.error_code),
    }))
    .filter((entry) => !entry.derived)
    .filter((entry, index, all) => entry.instanceId && entry.fieldId && all.findIndex((candidate) => candidate.instanceId === entry.instanceId && candidate.fieldId === entry.fieldId) === index);

  const sources = array(root.sources).map((source) => ({
    id: text(source.id),
    instanceId: text(source.instanceId ?? source.instance_id ?? source.ownerInstanceId),
    name: text(source.name ?? source.originalName),
    path: text(source.path ?? source.storedPath),
    mime: text(source.mime ?? source.mimeType),
    checksum: text(source.checksum),
    size: Number(source.size ?? 0),
  })).filter((entry) => entry.id && entry.name);

  const rawDerivedRelationships = array(
    root.derivedRelationships
    ?? root.derived_relationships
    ?? root.intrinsicRelationships
    ?? root.intrinsic_relationships
    ?? root.instanceRelationships
    ?? root.instance_relationships,
  );
  const derivedRelationships = rawDerivedRelationships.map((relationship, index) => ({
    id: text(relationship.id, `derived-relationship-${index}`),
    sourceInstanceId: text(
      relationship.sourceInstanceId
      ?? relationship.source_instance_id
      ?? relationship.fromInstanceId
      ?? relationship.from_instance_id
      ?? relationship.sourceId
      ?? relationship.source_id,
    ),
    targetInstanceId: text(
      relationship.targetInstanceId
      ?? relationship.target_instance_id
      ?? relationship.toInstanceId
      ?? relationship.to_instance_id
      ?? relationship.targetId
      ?? relationship.target_id,
    ),
    relationKind: text(
      relationship.relationKind
      ?? relationship.relation_kind
      ?? relationship.relationshipKind
      ?? relationship.relationship_kind
      ?? relationship.kind,
      "intrinsic",
    ),
    fieldId: text(relationship.fieldId ?? relationship.field_id),
    label: text(relationship.label ?? relationship.displayLabel ?? relationship.display_label),
    provenance: clone(
      relationship.provenance
      ?? relationship.metadata
      ?? relationship.pathMetadata
      ?? relationship.path_metadata
      ?? null,
    ),
    createdAt: text(relationship.createdAt ?? relationship.created_at),
  })).filter((relationship) => relationship.sourceInstanceId && relationship.targetInstanceId)
    .filter((relationship, index, all) => all.findIndex((candidate) => (
      candidate.sourceInstanceId === relationship.sourceInstanceId
      && candidate.targetInstanceId === relationship.targetInstanceId
      && candidate.relationKind === relationship.relationKind
      && candidate.fieldId === relationship.fieldId
    )) === index)
    .sort((left, right) => left.sourceInstanceId.localeCompare(right.sourceInstanceId)
      || left.targetInstanceId.localeCompare(right.targetInstanceId)
      || left.relationKind.localeCompare(right.relationKind)
      || left.fieldId.localeCompare(right.fieldId));

  const attachments = array(root.attachments).map((attachment) => ({
    id: text(attachment.id),
    instanceId: text(attachment.instanceId ?? attachment.instance_id ?? attachment.ownerInstanceId),
    originalName: text(attachment.originalName ?? attachment.original_name ?? attachment.name),
    mimeType: text(attachment.mimeType ?? attachment.mime_type ?? attachment.mime),
    sizeBytes: Number(attachment.sizeBytes ?? attachment.size_bytes ?? attachment.size ?? 0),
    checksumSha256: text(attachment.checksumSha256 ?? attachment.checksum_sha256 ?? attachment.checksum),
    ordinal: Number(attachment.ordinal ?? attachment.position ?? 0),
    status: text(attachment.status, "active").toLowerCase(),
    createdAt: text(attachment.createdAt ?? attachment.created_at),
    updatedAt: text(attachment.updatedAt ?? attachment.updated_at),
  })).filter((entry) => entry.id && entry.originalName && ["active", "archived"].includes(entry.status));

  const inboxFiles = array(root.inboxFiles ?? root.inbox_files).map((file) => ({
    id: text(file.id),
    originalName: text(file.originalName ?? file.original_name ?? file.name),
    mimeType: text(file.mimeType ?? file.mime_type ?? file.mime),
    sizeBytes: Number(file.sizeBytes ?? file.size_bytes ?? file.size ?? 0),
    checksumSha256: text(file.checksumSha256 ?? file.checksum_sha256 ?? file.checksum),
    ordinal: Number(file.ordinal ?? file.position ?? 0),
    status: text(file.status, "inbox").toLowerCase(),
    createdAt: text(file.createdAt ?? file.created_at),
    updatedAt: text(file.updatedAt ?? file.updated_at),
  })).filter((entry) => entry.id && entry.originalName && ["inbox", "archived"].includes(entry.status));

  const history = array(root.auditEntries ?? root.history ?? root.auditLog ?? root.audit_log).map((entry, index) => ({
    id: String(entry.id ?? `history-${index}`),
    action: text(entry.action ?? entry.operation, "Change"),
    summary: text(entry.summary ?? entry.detail),
    objectKind: text(entry.objectKind ?? entry.object_kind),
    objectId: text(entry.objectId ?? entry.object_id),
    createdAt: text(entry.createdAt ?? entry.created_at),
  }));

  const analyses = array(root.analyses ?? root.analytics)
    .map(normalizeAnalysis)
    .filter(Boolean);

  const normalized = emptyWorkspaceState({
    workspace: {
      id: text(rawWorkspace.id, "workspace-local"),
      name: text(rawWorkspace.name, "Clade"),
      revision: Number(rawWorkspace.revision ?? root.revision ?? 0),
      databasePath: text(rawWorkspace.databasePath ?? rawWorkspace.database_path ?? root.databasePath),
      persistent: bool(rawWorkspace.persistent ?? root.persistent),
      createdAt: text(rawWorkspace.createdAt ?? rawWorkspace.created_at),
      updatedAt: text(rawWorkspace.updatedAt ?? rawWorkspace.updated_at),
    },
    templates,
    fields,
    templateFields,
    instances,
    values,
    attachments,
    inboxFiles,
    sources,
    derivedRelationships,
    analyses,
    history,
  });
  const calculated = evaluateFunctionFields(normalized);
  normalized.values.push(...calculated.values);
  normalized.calculationErrors = calculated.errors;
  for (const instance of normalized.instances) instance.completed = instanceContractComplete(normalized, instance);
  return normalized;
}

export const fieldTypeLabel = (type) => FIELD_TYPES.find((entry) => entry.value === type)?.label ?? type;
export const fieldRoleLabel = (role) => FIELD_ROLES.find((entry) => entry.value === role)?.label ?? role;
export const namingConventionLabel = (value) => NAMING_CONVENTIONS.find((entry) => entry.value === value)?.label ?? value;

export const indexWorkspace = (state) => ({
  templates: new Map(state.templates.map((entry) => [entry.id, entry])),
  fields: new Map(state.fields.map((entry) => [entry.id, entry])),
  instances: new Map(state.instances.map((entry) => [entry.id, entry])),
  attachments: new Map(state.attachments.map((entry) => [entry.id, entry])),
  inboxFiles: new Map(state.inboxFiles.map((entry) => [entry.id, entry])),
  sources: new Map(state.sources.map((entry) => [entry.id, entry])),
  analyses: new Map(state.analyses.map((entry) => [entry.id, entry])),
});

export function templateLineage(state, templateId) {
  const templates = indexWorkspace(state).templates;
  const lineage = [];
  const seen = new Set();
  let current = templates.get(templateId);
  while (current) {
    if (seen.has(current.id)) throw new WorkspaceError(`Template inheritance contains a cycle at ${current.name}.`);
    seen.add(current.id);
    lineage.unshift(current);
    current = current.parentId ? templates.get(current.parentId) : null;
  }
  return lineage;
}

export function templateDescendantIds(state, templateId, includeSelf = true, options = {}) {
  const root = state.templates.find((template) => template.id === templateId);
  const kind = options.kind ?? templateKindOf(root);
  const includesKind = (template) => kind === "all" || templateKindOf(template) === kind;
  const ids = new Set([templateId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const template of state.templates) {
      if (includesKind(template) && ids.has(template.parentId) && !ids.has(template.id)) {
        ids.add(template.id);
        changed = true;
      }
    }
  }
  if (!includeSelf) ids.delete(templateId);
  return ids;
}

export function effectiveTemplateFields(state, templateId) {
  const fields = indexWorkspace(state).fields;
  const lineage = templateLineage(state, templateId);
  const result = [];
  const seen = new Set();
  for (const template of lineage) {
    for (const assignment of state.templateFields.filter((entry) => entry.templateId === template.id).sort(byPosition)) {
      if (seen.has(assignment.fieldId)) continue;
      const definition = fields.get(assignment.fieldId);
      if (!definition) continue;
      seen.add(assignment.fieldId);
      result.push({ ...definition, required: assignment.required || definition.required, inherited: template.id !== templateId, originTemplateId: assignment.originTemplateId || template.id, contractTemplateId: template.id, position: result.length });
    }
  }
  return result;
}

export function directTemplateFields(state, templateId) {
  const fields = indexWorkspace(state).fields;
  return state.templateFields.filter((entry) => entry.templateId === templateId).sort(byPosition)
    .map((assignment) => ({ ...fields.get(assignment.fieldId), ...assignment }))
    .filter((entry) => entry.id);
}

/** Templates that can become the direct introduction point for one assignment. */
export function fieldIntroductionDestinations(state, fieldId, fromTemplateId) {
  const hasSource = state.templateFields.some((entry) => entry.templateId === fromTemplateId && entry.fieldId === fieldId);
  if (!hasSource) return [];
  const remainingIntroductions = new Set(state.templateFields
    .filter((entry) => entry.fieldId === fieldId && entry.templateId !== fromTemplateId)
    .map((entry) => entry.templateId));
  return userTemplates(state).filter((template) => {
    if (template.id === fromTemplateId) return false;
    return !templateLineage(state, template.id).some((ancestor) => remainingIntroductions.has(ancestor.id));
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function fieldUsage(state, fieldId) {
  const directIds = new Set(state.templateFields.filter((entry) => entry.fieldId === fieldId).map((entry) => entry.templateId));
  const inheritedIds = new Set();
  for (const templateId of directIds) for (const id of templateDescendantIds(state, templateId)) inheritedIds.add(id);
  const populatedIds = new Set(state.values
    .filter((entry) => entry.fieldId === fieldId && !entry.error && !isBlankFieldValue(entry.value))
    .map((entry) => entry.instanceId));
  return {
    directTemplates: state.templates.filter((entry) => directIds.has(entry.id)),
    templates: state.templates.filter((entry) => inheritedIds.has(entry.id)),
    instances: state.instances.filter((entry) => inheritedIds.has(entry.templateId)),
    populatedInstances: state.instances.filter((entry) => populatedIds.has(entry.id)),
    dependentFunctions: state.fields.filter((entry) => entry.type === "function" && formulaDependencies(entry.formula).includes(fieldId)),
    analyses: state.analyses.filter((entry) => analysisFieldDependencies(entry).includes(fieldId)),
  };
}

export function instanceValue(state, instanceId, fieldId) {
  return state.values.find((entry) => entry.instanceId === instanceId && entry.fieldId === fieldId)?.value ?? null;
}

export function instanceValueRecord(state, instanceId, fieldId) {
  return state.values.find((entry) => entry.instanceId === instanceId && entry.fieldId === fieldId) ?? null;
}

export function instanceCalculationError(state, instanceId, fieldId) {
  return instanceValueRecord(state, instanceId, fieldId)?.error ?? "";
}

export function isBlankFieldValue(value) {
  return value === null
    || value === undefined
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && value.length === 0);
}

/** Completion is a live consequence of the entire effective Field contract. */
export function instanceContractComplete(state, instanceOrId) {
  const instance = typeof instanceOrId === "string"
    ? state.instances.find((entry) => entry.id === instanceOrId)
    : instanceOrId;
  if (!instance) return false;
  const fields = effectiveTemplateFields(state, instance.templateId);
  return fields.every((field) => !isBlankFieldValue(instanceValue(state, instance.id, field.id))
    && !instanceCalculationError(state, instance.id, field.id));
}

export function baseScope(state, templateId) {
  const templateIds = templateDescendantIds(state, templateId);
  return {
    templates: state.templates.filter((entry) => templateIds.has(entry.id)),
    fields: effectiveTemplateFields(state, templateId),
    instances: state.instances.filter((entry) => templateIds.has(entry.templateId)).sort(compareInstancesByCreation),
  };
}

/**
 * Build the recursive row groups for a Base. A node contains only Instances whose
 * exact Template is that node; descendants are represented only by child nodes.
 */
export function groupedBaseScope(state, templateId, matchingInstanceIds = null) {
  const scope = baseScope(state, templateId);
  const allowed = matchingInstanceIds instanceof Set
    ? matchingInstanceIds
    : matchingInstanceIds
      ? new Set(matchingInstanceIds)
      : null;
  const scopedInstances = allowed
    ? scope.instances.filter((instance) => allowed.has(instance.id))
    : scope.instances;
  const byTemplate = new Map();
  for (const instance of scopedInstances) {
    const exact = byTemplate.get(instance.templateId) ?? [];
    exact.push(instance);
    byTemplate.set(instance.templateId, exact);
  }

  const buildNode = (template, keepRoot = false) => {
    const children = childrenOf(state, template.id, { kind: templateKindOf(template) })
      .map((child) => buildNode(child))
      .filter(Boolean);
    const instances = [...(byTemplate.get(template.id) ?? [])].sort(compareInstancesByCreation);
    if (!keepRoot && !instances.length && !children.length) return null;
    return {
      template,
      instances,
      children,
      totalInstances: instances.length + children.reduce((total, child) => total + child.totalInstances, 0),
    };
  };

  const rootTemplate = state.templates.find((template) => template.id === templateId);
  return {
    ...scope,
    instances: scopedInstances,
    root: rootTemplate ? buildNode(rootTemplate, true) : null,
  };
}

/**
 * Build the workspace-wide Instance index as one pruned group for each populated
 * root Template branch. Each node keeps only its exact-Template Instances; the
 * shared Base grouping rules retain populated ancestors and sort rows newest
 * first with a stable ID tie-breaker.
 */
export function groupedWorkspaceInstances(state) {
  return hierarchyRoots(state)
    .map((template) => groupedBaseScope(state, template.id).root)
    .filter((node) => node && node.totalInstances > 0);
}

/** Intrinsic records use the same Base grouping rules without entering the user ontology tree. */
export function groupedIntrinsicWorkspaceInstances(state) {
  return intrinsicHierarchyRoots(state)
    .map((template) => groupedBaseScope(state, template.id).root)
    .filter((node) => node && node.totalInstances > 0);
}

export function fieldAllowsInstance(state, fieldOrId, instanceOrId) {
  const field = typeof fieldOrId === "string"
    ? state.fields.find((entry) => entry.id === fieldOrId)
    : fieldOrId;
  const instance = typeof instanceOrId === "string"
    ? state.instances.find((entry) => entry.id === instanceOrId)
    : instanceOrId;
  if (!field || !instance || !["link", "linkList"].includes(field.type)) return false;
  if (!field.allowedTargetTemplateId) return false;
  return templateDescendantIds(state, field.allowedTargetTemplateId).has(instance.templateId);
}

export function eligibleLinkTargets(state, fieldOrId) {
  const field = typeof fieldOrId === "string"
    ? state.fields.find((entry) => entry.id === fieldOrId)
    : fieldOrId;
  if (!field?.allowedTargetTemplateId || !["link", "linkList"].includes(field.type)) return [];
  const templateIds = templateDescendantIds(state, field.allowedTargetTemplateId);
  return state.instances
    .filter((instance) => templateIds.has(instance.templateId))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function linkedInstanceIds(value) {
  return (Array.isArray(value) ? value : [value]).map((candidate) => {
    if (candidate && typeof candidate === "object") {
      return text(candidate.instanceId ?? candidate.instance_id ?? candidate.id);
    }
    return String(candidate ?? "");
  }).filter(Boolean);
}

function relationshipConnections(state) {
  const fields = new Map(state.fields.map((field) => [field.id, field]));
  const instances = new Map(state.instances.map((instance) => [instance.id, instance]));
  const effectiveFieldIds = new Map();
  const edges = [];

  for (const valueRecord of state.values) {
    const field = fields.get(valueRecord.fieldId);
    const source = instances.get(valueRecord.instanceId);
    if (!field || !source || !["link", "linkList"].includes(field.type)) continue;
    if (!effectiveFieldIds.has(source.templateId)) {
      effectiveFieldIds.set(source.templateId, new Set(
        effectiveTemplateFields(state, source.templateId).map((candidate) => candidate.id),
      ));
    }
    if (!effectiveFieldIds.get(source.templateId).has(field.id)) continue;
    for (const targetInstanceId of linkedInstanceIds(valueRecord.value)) {
      if (!instances.has(targetInstanceId)) continue;
      edges.push({
        id: `field:${source.id}:${targetInstanceId}:${field.id}`,
        sourceInstanceId: source.id,
        targetInstanceId,
        kind: "field",
        fieldId: field.id,
        relationKind: field.type,
        label: field.name,
        provenance: { fieldId: field.id, fieldName: field.name },
      });
    }
  }

  for (const relationship of array(state.derivedRelationships)) {
    if (!instances.has(relationship.sourceInstanceId) || !instances.has(relationship.targetInstanceId)) continue;
    edges.push({
      id: relationship.id,
      sourceInstanceId: relationship.sourceInstanceId,
      targetInstanceId: relationship.targetInstanceId,
      kind: "derived",
      fieldId: relationship.fieldId,
      relationKind: relationship.relationKind || "intrinsic",
      label: relationship.label,
      provenance: clone(relationship.provenance),
    });
  }

  const edgeKey = (edge) => [
    edge.sourceInstanceId,
    edge.targetInstanceId,
    edge.kind === "field" ? "0" : "1",
    edge.fieldId,
    edge.relationKind,
    edge.id,
  ].join("\u0000");
  edges.sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)));

  const byPair = new Map();
  for (const edge of edges) {
    const pairKey = `${edge.sourceInstanceId}\u0000${edge.targetInstanceId}`;
    const pair = byPair.get(pairKey) ?? [];
    if (!pair.some((candidate) => edgeKey(candidate) === edgeKey(edge))) pair.push(edge);
    byPair.set(pairKey, pair);
  }

  return [...byPair.values()].map((relationships) => {
    const primary = relationships[0];
    const fieldIds = [...new Set(relationships.map((edge) => edge.fieldId).filter(Boolean))].sort();
    return {
      sourceInstanceId: primary.sourceInstanceId,
      targetInstanceId: primary.targetInstanceId,
      kind: primary.kind,
      fieldId: fieldIds[0] ?? "",
      fieldIds,
      relationKind: primary.relationKind,
      label: primary.label,
      provenance: clone(primary.provenance),
      relationships: relationships.map((edge) => ({ ...edge, provenance: clone(edge.provenance) })),
    };
  }).sort((left, right) => left.sourceInstanceId.localeCompare(right.sourceInstanceId)
    || left.targetInstanceId.localeCompare(right.targetInstanceId)
    || left.kind.localeCompare(right.kind)
    || left.fieldId.localeCompare(right.fieldId));
}

function relationshipPathKey(path) {
  return `${path.instanceIds.join("\u0000")}\u0001${path.steps.map((step) => (
    `${step.kind}:${step.fieldIds.join(",")}:${step.relationKind}:${step.label}`
  )).join("\u0000")}`;
}

/**
 * Traverse every incoming explicit and derived relationship with breadth-first
 * search. Each Instance appears at its shortest depth only; every equal-length
 * provenance path is retained in deterministic order, cycles cannot re-enter
 * an already shorter path, and a stable first path remains available to legacy UI.
 */
export function embeddedBaseScopes(state, targetInstanceId) {
  const target = state.instances.find((instance) => instance.id === targetInstanceId);
  if (!target) return [];
  const instances = new Map(state.instances.map((instance) => [instance.id, instance]));
  const incoming = new Map();
  for (const connection of relationshipConnections(state)) {
    const relationships = incoming.get(connection.targetInstanceId) ?? [];
    relationships.push(connection);
    incoming.set(connection.targetInstanceId, relationships);
  }
  for (const relationships of incoming.values()) {
    relationships.sort((left, right) => left.sourceInstanceId.localeCompare(right.sourceInstanceId)
      || left.kind.localeCompare(right.kind)
      || left.fieldId.localeCompare(right.fieldId));
  }

  const bestDepths = new Map([[target.id, 0]]);
  const queue = [target.id];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentId = queue[cursor];
    const currentDepth = bestDepths.get(currentId);
    for (const connection of incoming.get(currentId) ?? []) {
      const sourceId = connection.sourceInstanceId;
      if (!instances.has(sourceId)) continue;
      const candidateDepth = currentDepth + 1;
      const existingDepth = bestDepths.get(sourceId);
      if (existingDepth !== undefined && existingDepth <= candidateDepth) continue;
      bestDepths.set(sourceId, candidateDepth);
      queue.push(sourceId);
    }
  }

  // Once shortest depths are known, every edge from depth N to N-1 forms a
  // finite acyclic shortest-path graph even when the source relationships cycle.
  // Materialize every path through that graph so converging provenance is not
  // lost while each Instance itself remains globally deduplicated.
  const outgoing = new Map();
  for (const relationships of incoming.values()) {
    for (const connection of relationships) {
      const connections = outgoing.get(connection.sourceInstanceId) ?? [];
      connections.push(connection);
      outgoing.set(connection.sourceInstanceId, connections);
    }
  }
  for (const connections of outgoing.values()) {
    connections.sort((left, right) => left.targetInstanceId.localeCompare(right.targetInstanceId)
      || left.kind.localeCompare(right.kind)
      || left.fieldId.localeCompare(right.fieldId));
  }
  const shortestPathsByInstance = new Map([[
    target.id,
    [{ depth: 0, sourceInstanceId: target.id, targetInstanceId: target.id, instanceIds: [target.id], steps: [] }],
  ]]);
  const orderedInstances = [...bestDepths]
    .filter(([instanceId]) => instanceId !== target.id)
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  for (const [sourceId, depth] of orderedInstances) {
    const candidates = new Map();
    for (const connection of outgoing.get(sourceId) ?? []) {
      if (bestDepths.get(connection.targetInstanceId) !== depth - 1) continue;
      for (const tail of shortestPathsByInstance.get(connection.targetInstanceId) ?? []) {
        const candidate = {
          depth,
          sourceInstanceId: sourceId,
          targetInstanceId: target.id,
          instanceIds: [sourceId, ...tail.instanceIds],
          steps: [{
            ...connection,
            relationships: connection.relationships.map((edge) => ({ ...edge, provenance: clone(edge.provenance) })),
          }, ...tail.steps],
        };
        candidates.set(relationshipPathKey(candidate), candidate);
      }
    }
    shortestPathsByInstance.set(sourceId, [...candidates.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, path]) => path));
  }
  bestDepths.delete(target.id);

  const groups = new Map();
  for (const [instanceId, depth] of bestDepths) {
    const source = instances.get(instanceId);
    if (!source || !state.templates.some((template) => template.id === source.templateId)) continue;
    const paths = shortestPathsByInstance.get(instanceId) ?? [];
    const path = paths[0];
    if (!path) continue;
    const key = `${depth}\u0000${source.templateId}`;
    const group = groups.get(key) ?? {
      templateId: source.templateId,
      depth,
      instanceIds: new Set(),
      fieldIds: new Set(),
      relationshipFieldIdsByInstance: new Map(),
      relationshipDepthByInstance: new Map(),
      relationshipPathsByInstance: new Map(),
      shortestRelationshipPathsByInstance: new Map(),
    };
    group.instanceIds.add(source.id);
    const sourceFieldIds = [...new Set(paths.flatMap((candidate) => candidate.steps[0]?.fieldIds ?? []))].sort();
    for (const fieldId of sourceFieldIds) group.fieldIds.add(fieldId);
    group.relationshipFieldIdsByInstance.set(source.id, sourceFieldIds);
    group.relationshipDepthByInstance.set(source.id, depth);
    group.relationshipPathsByInstance.set(source.id, path);
    group.shortestRelationshipPathsByInstance.set(source.id, paths);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const scope = groupedBaseScope(state, group.templateId, group.instanceIds);
    const paths = [...group.shortestRelationshipPathsByInstance.values()].flat()
      .sort((left, right) => left.sourceInstanceId.localeCompare(right.sourceInstanceId)
        || relationshipPathKey(left).localeCompare(relationshipPathKey(right)));
    return {
      ...scope,
      targetInstance: target,
      depth: group.depth,
      direct: group.depth === 1,
      fieldIds: [...group.fieldIds].sort(),
      relationshipFieldIdsByInstance: group.relationshipFieldIdsByInstance,
      relationshipDepthByInstance: group.relationshipDepthByInstance,
      relationshipPathsByInstance: group.relationshipPathsByInstance,
      shortestRelationshipPathsByInstance: group.shortestRelationshipPathsByInstance,
      paths,
    };
  }).filter((group) => group.instances.length)
    .sort((left, right) => left.depth - right.depth
      || left.root.template.name.localeCompare(right.root.template.name)
      || left.root.template.id.localeCompare(right.root.template.id));
}

function hierarchyKind(options, fallback = "user") {
  if (typeof options === "string") return options;
  if (options?.includeIntrinsic) return "all";
  return options?.kind ?? fallback;
}

/** User ontology roots by default. Intrinsic roots are intentionally separate. */
export function hierarchyRoots(state, options = {}) {
  const kind = hierarchyKind(options);
  const templates = state.templates.filter((entry) => kind === "all" || templateKindOf(entry) === kind);
  const existing = new Set(templates.map((entry) => entry.id));
  return templates.filter((entry) => !entry.parentId || !existing.has(entry.parentId))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function intrinsicHierarchyRoots(state) {
  return hierarchyRoots(state, { kind: "intrinsic" });
}

/** User ontology children by default. */
export function childrenOf(state, templateId, options = {}) {
  const kind = hierarchyKind(options);
  return state.templates.filter((entry) => entry.parentId === templateId && (kind === "all" || templateKindOf(entry) === kind))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function intrinsicChildrenOf(state, templateId) {
  return childrenOf(state, templateId, { kind: "intrinsic" });
}

export function searchWorkspace(state, query) {
  const needle = text(query).trim().toLocaleLowerCase();
  if (!needle) return [];
  const rank = (name, definition = "") => {
    const title = name.toLocaleLowerCase();
    const body = definition.toLocaleLowerCase();
    if (title === needle) return 0;
    if (title.startsWith(needle)) return 1;
    if (title.includes(needle)) return 2;
    if (body.includes(needle)) return 3;
    return 99;
  };
  return [
    ...state.templates.map((entry) => ({ ...entry, templateKind: entry.kind, kind: "template", score: rank(entry.name, entry.definition) })),
    ...state.fields.map((entry) => ({ ...entry, kind: "field", score: rank(entry.name, entry.definition) })),
    ...state.instances.map((entry) => ({ ...entry, kind: "instance", score: rank(entry.name, entry.notes) })),
    ...state.analyses.map((entry) => ({ ...entry, kind: "analysis", score: rank(entry.name, entry.description) })),
  ].filter((entry) => entry.score < 99)
    .sort((left, right) => left.score - right.score || left.name.localeCompare(right.name)).slice(0, 60);
}

export function objectByKind(state, kind, id) {
  const collection = { template: state.templates, intrinsicTemplate: state.templates, field: state.fields, instance: state.instances, attachment: state.attachments, source: state.sources, analysis: state.analyses }[kind];
  return collection?.find((entry) => entry.id === id) ?? null;
}

function newId(prefix) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

/** Browser preview only. The desktop always commits through the SQLite repository. */
export function applyLocalOperation(inputState, operation) {
  const next = clone(normalizeWorkspaceState(inputState));
  const completionBefore = new Map(next.instances.map((instance) => [instance.id, instance.completed]));
  next.values = next.values.filter((entry) => !entry.derived);
  next.calculationErrors = [];
  const now = new Date().toISOString();
  const op = operation ?? {};
  const unique = (collection, name, exceptId = "") => {
    if (collection.some((entry) => entry.id !== exceptId && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new WorkspaceError(`The name “${name}” is already in use.`);
  };
  const templateById = (templateId) => next.templates.find((entry) => entry.id === templateId);
  const intrinsicInstance = (instance) => Boolean(instance?.systemManaged || isIntrinsicTemplate(templateById(instance?.templateId)));
  const requireUserTemplate = (templateId) => {
    const template = templateById(templateId);
    if (!template) throw new WorkspaceError("Template not found.");
    if (isIntrinsicTemplate(template)) throw new WorkspaceError("Intrinsic Templates are managed automatically by Clade.");
    return template;
  };
  const requireUserInstance = (instanceId) => {
    const instance = next.instances.find((entry) => entry.id === instanceId);
    if (!instance) throw new WorkspaceError("Instance not found.");
    if (intrinsicInstance(instance)) throw new WorkspaceError("Intrinsic Instances are managed automatically by Clade.");
    return instance;
  };
  const name = () => {
    const value = text(op.name).trim();
    if (!value) throw new WorkspaceError("A name is required.");
    return value;
  };
  let objectKind = "";
  let objectId = "";
  let summary = "";
  switch (op.kind) {
    case "renameWorkspace": {
      const value = name();
      next.workspace.name = value;
      next.workspace.updatedAt = now;
      objectKind = "workspace"; objectId = next.workspace.id; summary = `Renamed workspace to “${value}”.`; break;
    }
    case "createTemplate": {
      const value = name(); unique(userTemplates(next), value); objectKind = "template"; objectId = op.id || newId("template");
      const parentId = text(op.parentTemplateId ?? op.parentId);
      if (parentId) requireUserTemplate(parentId);
      next.templates.push({ id: objectId, name: value, definition: text(op.definition), kind: "user", intrinsicKey: "", parentId, namingConvention: text(op.namingConvention, "unique"), version: 1, createdAt: now, updatedAt: now });
      summary = `Created Template “${value}”.`; break;
    }
    case "updateTemplate":
    case "setTemplateParent": {
      const entry = requireUserTemplate(op.templateId);
      if (op.name !== undefined) { const value = name(); unique(userTemplates(next), value, entry.id); entry.name = value; }
      if (op.definition !== undefined) entry.definition = text(op.definition);
      if (op.parentTemplateId !== undefined || op.parentId !== undefined) {
        const parentId = text(op.parentTemplateId ?? op.parentId);
        if (parentId === entry.id || templateDescendantIds(next, entry.id, false).has(parentId)) throw new WorkspaceError("A Template cannot inherit from itself or one of its descendants.");
        if (parentId) requireUserTemplate(parentId);
        entry.parentId = parentId;
      }
      if (op.namingConvention !== undefined) entry.namingConvention = text(op.namingConvention);
      entry.version += 1; entry.updatedAt = now; objectKind = "template"; objectId = entry.id; summary = `Updated Template “${entry.name}”.`; break;
    }
    case "deleteTemplate": {
      const entry = requireUserTemplate(op.templateId);
      if (next.templates.some((item) => item.parentId === entry.id) || next.instances.some((item) => item.templateId === entry.id)) throw new WorkspaceError("This Template still has descendants or Instances.");
      if (next.analyses.some((analysis) => analysis.sourceTemplateId === entry.id)) throw new WorkspaceError("This Template is still used as an Analysis source.");
      next.templates = next.templates.filter((item) => item.id !== entry.id); next.templateFields = next.templateFields.filter((item) => item.templateId !== entry.id);
      objectKind = "template"; objectId = entry.id; summary = `Deleted Template “${entry.name}”.`; break;
    }
    case "createFunctionField":
    case "createField": {
      const value = name(); unique(next.fields, value); objectKind = "field"; objectId = op.id || newId("field");
      if (op.templateId) requireUserTemplate(op.templateId);
      const type = op.kind === "createFunctionField" ? "function" : normaliseFieldType(op.fieldType ?? op.type);
      const allowedTargetTemplateId = ["link", "linkList"].includes(type)
        ? text(op.allowedTargetTemplateId ?? op.allowed_target_template_id)
        : "";
      if (["link", "linkList"].includes(type) && !next.templates.some((entry) => entry.id === allowedTargetTemplateId)) {
        throw new WorkspaceError("Link Fields require an allowed target Template.");
      }
      const resultType = type === "function" ? normalizeFunctionResultType(op.functionResultType ?? op.function_result_type ?? op.resultType ?? op.result_type, "number") : type;
      next.fields.push({
        id: objectId,
        name: value,
        definition: text(op.definition),
        type,
        resultType,
        formula: type === "function" ? normalizeFormula(op.formula ?? op.formulaJson ?? op.formula_json) : null,
        displayFormat: text(op.displayFormat ?? op.display_format, type === "function" && resultType === "duration" ? "duration" : ""),
        role: normaliseRole(op.role),
        required: Boolean(op.required),
        allowedTargetTemplateId,
        createdAt: now,
        updatedAt: now,
      });
      if (op.templateId) next.templateFields.push({ templateId: op.templateId, fieldId: objectId, position: Number(op.position ?? next.templateFields.filter((entry) => entry.templateId === op.templateId).length), required: Boolean(op.required), originTemplateId: op.templateId });
      summary = `Created Field “${value}”.`; break;
    }
    case "updateFunctionField":
    case "updateField": {
      const entry = next.fields.find((item) => item.id === op.fieldId); if (!entry) throw new WorkspaceError("Field not found.");
      if (op.name !== undefined) { const value = name(); unique(next.fields, value, entry.id); entry.name = value; }
      if (op.definition !== undefined) entry.definition = text(op.definition);
      if (op.kind === "updateFunctionField") entry.type = "function";
      else if (op.fieldType !== undefined || op.type !== undefined) entry.type = normaliseFieldType(op.fieldType ?? op.type);
      if (op.role !== undefined) entry.role = normaliseRole(op.role);
      if (op.required !== undefined) entry.required = Boolean(op.required);
      if (entry.type === "function") {
        entry.resultType = normalizeFunctionResultType(op.functionResultType ?? op.function_result_type ?? op.resultType ?? op.result_type ?? entry.resultType, "number");
        if (op.formula !== undefined || op.formulaJson !== undefined || op.formula_json !== undefined) {
          entry.formula = normalizeFormula(op.formula ?? op.formulaJson ?? op.formula_json);
        }
        if (op.displayFormat !== undefined || op.display_format !== undefined) entry.displayFormat = text(op.displayFormat ?? op.display_format);
        if (!entry.displayFormat && entry.resultType === "duration") entry.displayFormat = "duration";
        entry.allowedTargetTemplateId = "";
        next.values = next.values.filter((record) => record.fieldId !== entry.id);
      } else if (["link", "linkList"].includes(entry.type)) {
        entry.resultType = entry.type;
        entry.formula = null;
        entry.displayFormat = "";
        if (op.allowedTargetTemplateId !== undefined || op.allowed_target_template_id !== undefined) {
          entry.allowedTargetTemplateId = text(op.allowedTargetTemplateId ?? op.allowed_target_template_id);
        }
        if (!next.templates.some((template) => template.id === entry.allowedTargetTemplateId)) {
          throw new WorkspaceError("Link Fields require an allowed target Template.");
        }
        for (const record of next.values.filter((candidate) => candidate.fieldId === entry.id)) {
          const ids = Array.isArray(record.value) ? record.value : [record.value];
          if (ids.some((id) => !fieldAllowsInstance(next, entry, String(id)))) {
            throw new WorkspaceError("The new target Template would invalidate an existing linked value.");
          }
        }
      } else {
        entry.resultType = entry.type;
        entry.formula = null;
        entry.displayFormat = "";
        entry.allowedTargetTemplateId = "";
      }
      entry.updatedAt = now; objectKind = "field"; objectId = entry.id; summary = `Updated Field “${entry.name}” everywhere.`; break;
    }
    case "addTemplateField": {
      requireUserTemplate(op.templateId);
      if (!next.fields.some((entry) => entry.id === op.fieldId)) throw new WorkspaceError("Template or Field not found.");
      if (!next.templateFields.some((entry) => entry.templateId === op.templateId && entry.fieldId === op.fieldId)) {
        const direct = next.templateFields.filter((entry) => entry.templateId === op.templateId);
        next.templateFields.push({ templateId: op.templateId, fieldId: op.fieldId, position: Number(op.position ?? direct.length), required: Boolean(op.required), originTemplateId: op.templateId });
      }
      objectKind = "field"; objectId = op.fieldId; summary = "Added Field to Template contract."; break;
    }
    case "removeTemplateField": {
      requireUserTemplate(op.templateId);
      next.templateFields = next.templateFields.filter((entry) => !(entry.templateId === op.templateId && entry.fieldId === op.fieldId));
      objectKind = "field"; objectId = op.fieldId; summary = "Removed Field from Template contract."; break;
    }
    case "reorderTemplateField": {
      requireUserTemplate(op.templateId);
      const direct = next.templateFields.filter((entry) => entry.templateId === op.templateId).sort(byPosition);
      const index = direct.findIndex((entry) => entry.fieldId === op.fieldId); const target = Math.max(0, Math.min(direct.length - 1, Number(op.position)));
      if (index >= 0) { const [moved] = direct.splice(index, 1); direct.splice(target, 0, moved); direct.forEach((entry, position) => { entry.position = position; }); }
      objectKind = "template"; objectId = op.templateId; summary = "Reordered the Template Field contract."; break;
    }
    case "moveFieldIntroduction": {
      const field = next.fields.find((entry) => entry.id === op.fieldId);
      const fromTemplate = requireUserTemplate(op.fromTemplateId);
      const toTemplate = requireUserTemplate(op.toTemplateId);
      if (!field) throw new WorkspaceError("Field or Template not found.");
      if (fromTemplate.id === toTemplate.id) throw new WorkspaceError("Choose a different destination Template.");
      const assignmentIndex = next.templateFields.findIndex((entry) => entry.templateId === fromTemplate.id && entry.fieldId === field.id);
      if (assignmentIndex < 0) throw new WorkspaceError("The selected Template does not directly introduce this Field.");
      if (next.templateFields.some((entry) => entry.templateId === toTemplate.id && entry.fieldId === field.id)) {
        throw new WorkspaceError("The destination Template already directly introduces this Field.");
      }
      const [assignment] = next.templateFields.splice(assignmentIndex, 1);
      if (effectiveTemplateFields(next, toTemplate.id).some((entry) => entry.id === field.id)) {
        throw new WorkspaceError("The destination Template already inherits this Field through another introduction.");
      }
      const destinationAssignments = next.templateFields.filter((entry) => entry.templateId === toTemplate.id).sort(byPosition);
      const position = Number.isFinite(Number(op.position))
        ? Math.max(0, Math.min(destinationAssignments.length, Number(op.position)))
        : destinationAssignments.length;
      for (const entry of destinationAssignments) if (entry.position >= position) entry.position += 1;
      next.templateFields.push({ ...assignment, templateId: toTemplate.id, originTemplateId: toTemplate.id, position });
      const orphaned = next.values.filter((record) => record.fieldId === field.id).filter((record) => {
        const instance = next.instances.find((entry) => entry.id === record.instanceId);
        return instance && !effectiveTemplateFields(next, instance.templateId).some((entry) => entry.id === field.id);
      });
      if (orphaned.length) {
        throw new WorkspaceError(`This move would strand ${orphaned.length} populated Field ${orphaned.length === 1 ? "value" : "values"}.`);
      }
      fromTemplate.version += 1;
      fromTemplate.updatedAt = now;
      toTemplate.version += 1;
      toTemplate.updatedAt = now;
      objectKind = "field"; objectId = field.id; summary = `Moved “${field.name}” from “${fromTemplate.name}” to “${toTemplate.name}”.`; break;
    }
    case "deleteField": {
      const entry = next.fields.find((item) => item.id === op.fieldId); if (!entry) throw new WorkspaceError("Field not found.");
      next.fields = next.fields.filter((item) => item.id !== entry.id); next.templateFields = next.templateFields.filter((item) => item.fieldId !== entry.id); next.values = next.values.filter((item) => item.fieldId !== entry.id);
      objectKind = "field"; objectId = entry.id; summary = `Deleted Field “${entry.name}”.`; break;
    }
    case "createInstance": {
      requireUserTemplate(op.templateId);
      let value = text(op.name).trim();
      if (!value) {
        const root = templateLineage(next, op.templateId)[0];
        if (root?.namingConvention !== "generated") throw new WorkspaceError("A name is required.");
        let sequence = next.instances.length + 1;
        value = `Generated Instance ${sequence}`;
        while (next.instances.some((entry) => entry.name === value)) value = `Generated Instance ${++sequence}`;
      }
      unique(next.instances.filter((entry) => !intrinsicInstance(entry)), value);
      objectKind = "instance"; objectId = op.id || newId("instance"); next.instances.push({ id: objectId, name: value, templateId: op.templateId, notes: text(op.notes), completed: false, storageKind: "standard", createdAt: now, updatedAt: now });
      summary = `Created Instance “${value}”.`; break;
    }
    case "updateInstance":
    case "reclassifyInstance": {
      const entry = requireUserInstance(op.instanceId);
      if (op.name !== undefined) { const value = name(); unique(next.instances.filter((candidate) => !intrinsicInstance(candidate)), value, entry.id); entry.name = value; }
      if (op.notes !== undefined) entry.notes = text(op.notes);
      if (op.templateId !== undefined) { requireUserTemplate(op.templateId); entry.templateId = text(op.templateId); }
      if (op.completed !== undefined) entry.completed = Boolean(op.completed);
      entry.updatedAt = now; objectKind = "instance"; objectId = entry.id; summary = `Updated Instance “${entry.name}”.`; break;
    }
    case "setInstanceValue": {
      const source = requireUserInstance(op.instanceId);
      const field = next.fields.find((entry) => entry.id === op.fieldId);
      if (!field) throw new WorkspaceError("Instance or Field not found.");
      if (field.type === "function") throw new WorkspaceError("Function Fields are calculated and cannot be edited directly.");
      if (!effectiveTemplateFields(next, source.templateId).some((entry) => entry.id === field.id)) {
        throw new WorkspaceError("This Field is not part of the Instance's effective Template contract.");
      }
      if (["link", "linkList"].includes(field.type)) {
        const ids = field.type === "linkList" ? array(op.value).map(String) : [String(op.value ?? "")];
        if (!ids.length || ids.some((id) => !fieldAllowsInstance(next, field, id))) {
          throw new WorkspaceError(`Every linked value must be an Instance of the allowed target Template or one of its descendants.`);
        }
      }
      const existing = next.values.find((entry) => entry.instanceId === op.instanceId && entry.fieldId === op.fieldId);
      if (existing) existing.value = clone(op.value); else next.values.push({ instanceId: op.instanceId, fieldId: op.fieldId, value: clone(op.value) });
      objectKind = "instance"; objectId = op.instanceId; summary = "Updated an Instance value."; break;
    }
    case "clearInstanceValue": {
      requireUserInstance(op.instanceId);
      const field = next.fields.find((entry) => entry.id === op.fieldId);
      if (field?.type === "function") throw new WorkspaceError("Function Fields are calculated and cannot be edited directly.");
      next.values = next.values.filter((entry) => !(entry.instanceId === op.instanceId && entry.fieldId === op.fieldId)); objectKind = "instance"; objectId = op.instanceId; summary = "Cleared an Instance value."; break;
    }
    case "deleteInstance": {
      const entry = requireUserInstance(op.instanceId);
      next.instances = next.instances.filter((item) => item.id !== entry.id); next.values = next.values.filter((item) => item.instanceId !== entry.id); next.sources = next.sources.filter((item) => item.instanceId !== entry.id);
      next.derivedRelationships = next.derivedRelationships.filter((relationship) => relationship.sourceInstanceId !== entry.id && relationship.targetInstanceId !== entry.id);
      objectKind = "instance"; objectId = entry.id; summary = `Deleted Instance “${entry.name}”.`; break;
    }
    case "createAnalysis": {
      const value = name(); unique(next.analyses, value); objectKind = "analysis"; objectId = op.id || newId("analysis");
      const candidate = normalizeAnalysis({
        id: objectId,
        name: value,
        description: text(op.description ?? op.definition),
        sourceTemplateId: text(op.sourceTemplateId ?? op.source_template_id ?? op.templateId),
        definition: op.configuration ?? op.analysisDefinition ?? op.definitionJson ?? op.definition_json ?? op.analysis ?? op.definition,
        createdAt: now,
        updatedAt: now,
      });
      if (!candidate) throw new WorkspaceError("An Analysis requires a source Template and definition.");
      next.analyses.push(candidate);
      summary = `Created Analysis “${value}”.`; break;
    }
    case "updateAnalysis": {
      const entry = next.analyses.find((item) => item.id === op.analysisId); if (!entry) throw new WorkspaceError("Analysis not found.");
      const updatedName = op.name === undefined ? entry.name : name();
      unique(next.analyses, updatedName, entry.id);
      const candidate = normalizeAnalysis({
        ...entry,
        name: updatedName,
        description: op.description === undefined ? entry.description : text(op.description),
        sourceTemplateId: text(op.sourceTemplateId ?? op.source_template_id ?? op.templateId, entry.sourceTemplateId),
        definition: op.configuration ?? op.analysisDefinition ?? op.definitionJson ?? op.definition_json ?? op.definition ?? entry.definition,
        updatedAt: now,
      });
      if (!candidate) throw new WorkspaceError("An Analysis requires a source Template and definition.");
      Object.assign(entry, candidate);
      objectKind = "analysis"; objectId = entry.id; summary = `Updated Analysis “${entry.name}”.`; break;
    }
    case "deleteAnalysis": {
      const entry = next.analyses.find((item) => item.id === op.analysisId); if (!entry) throw new WorkspaceError("Analysis not found.");
      next.analyses = next.analyses.filter((item) => item.id !== entry.id);
      objectKind = "analysis"; objectId = entry.id; summary = `Deleted Analysis “${entry.name}”.`; break;
    }
    default: throw new WorkspaceError(`Unsupported operation: ${op.kind || "unknown"}.`);
  }
  const functionValidation = validateFunctionFieldDefinitions(next);
  if (!functionValidation.valid) throw new WorkspaceError(functionValidation.errors[0].message);
  for (const analysis of next.analyses) {
    const validation = validateAnalysis(next, analysis);
    if (!validation.valid) throw new WorkspaceError(validation.errors[0]);
  }
  next.workspace.revision += 1;
  next.history.unshift({ id: newId("history"), action: op.kind, summary, objectKind, objectId, createdAt: now });
  const materialized = normalizeWorkspaceState(next);
  for (const instance of materialized.instances) {
    if (completionBefore.get(instance.id) !== instance.completed) instance.updatedAt = now;
  }
  return materialized;
}

export function previewLocalOperation(state, operation) {
  const before = normalizeWorkspaceState(state);
  const usage = operation?.fieldId ? fieldUsage(before, operation.fieldId) : null;
  const descendants = operation?.templateId ? templateDescendantIds(before, operation.templateId).size : 0;
  const next = applyLocalOperation(before, operation);
  return {
    title: {
      renameWorkspace: "Rename workspace",
      createTemplate: "Create Template", updateTemplate: "Edit Template", deleteTemplate: "Delete Template",
      createField: "Create Field", createFunctionField: "Create Function Field",
      updateField: "Edit Field everywhere", updateFunctionField: "Edit Function Field everywhere", deleteField: "Delete Field",
      addTemplateField: "Add Field to Template", removeTemplateField: "Remove Field from Template",
      moveFieldIntroduction: "Move Field introduction",
      createInstance: "Create Instance", updateInstance: "Edit Instance", deleteInstance: "Delete Instance",
      reclassifyInstance: "Reclassify Instance", setInstanceValue: "Update value", clearInstanceValue: "Clear value",
      createAnalysis: "Create Analysis", updateAnalysis: "Edit Analysis", deleteAnalysis: "Delete Analysis",
    }[operation.kind] ?? "Apply change",
    summary: next.history[0]?.summary ?? "Apply this change.",
    impact: {
      templates: usage?.templates.length ?? descendants,
      fields: operation?.fieldId || ["createField", "createFunctionField"].includes(operation?.kind) ? 1 : 0,
      instances: usage?.instances.length ?? (operation?.instanceId ? 1 : 0),
      populatedValues: usage?.populatedInstances.length ?? 0,
      analyses: usage?.analyses.length ?? (operation?.analysisId || operation?.kind === "createAnalysis" ? 1 : 0),
      incomingLinks: 0,
    },
    destructive: operation.kind.startsWith("delete") || operation.kind === "removeTemplateField",
    operation,
  };
}

