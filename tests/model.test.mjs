import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLocalOperation,
  baseScope,
  effectiveTemplateFields,
  emptyWorkspaceState,
  fieldUsage,
  instanceValue,
  normalizeWorkspaceState,
  templateLineage,
} from "../src/model.js";

function createWorkspace() {
  let state = emptyWorkspaceState();
  state = applyLocalOperation(state, { kind: "createTemplate", id: "template-root", name: "Root Template", definition: "Root definition", namingConvention: "unique" });
  state = applyLocalOperation(state, { kind: "createTemplate", id: "template-child", name: "Child Template", definition: "Child definition", parentTemplateId: "template-root" });
  state = applyLocalOperation(state, { kind: "createField", id: "field-shared", name: "Shared Field", definition: "Shared definition", fieldType: "text", role: "ordinary", templateId: "template-root" });
  state = applyLocalOperation(state, { kind: "createField", id: "field-child", name: "Child Field", definition: "Child definition", fieldType: "number", role: "ordinary", templateId: "template-child" });
  state = applyLocalOperation(state, { kind: "createInstance", id: "instance-root", name: "Root Record", templateId: "template-root" });
  state = applyLocalOperation(state, { kind: "createInstance", id: "instance-child", name: "Child Record", templateId: "template-child" });
  return state;
}

test("a new workspace contains no domain records", () => {
  const state = emptyWorkspaceState();
  assert.deepEqual(state.templates, []);
  assert.deepEqual(state.fields, []);
  assert.deepEqual(state.instances, []);
  assert.equal(state.workspace.revision, 0);
});

test("the repository WorkspaceState shape is normalised without seeding records", () => {
  const state = normalizeWorkspaceState({
    workspace: { id: "w1", name: "Blank", revision: 0, databasePath: "workspace.sqlite3" },
    summary: { templates: 0, fields: 0, instances: 0 },
    templates: [],
    fields: [],
    instances: [],
    auditEntries: [],
  });
  assert.equal(state.workspace.name, "Blank");
  assert.deepEqual(state.templates, []);
  assert.deepEqual(state.fields, []);
  assert.deepEqual(state.instances, []);
});

test("a canonical Field rename preserves identity, assignments, and values", () => {
  let state = createWorkspace();
  state = applyLocalOperation(state, { kind: "setInstanceValue", instanceId: "instance-child", fieldId: "field-shared", value: "Kept value" });
  state = applyLocalOperation(state, { kind: "updateField", fieldId: "field-shared", name: "Renamed Everywhere" });

  assert.equal(state.fields.find((field) => field.id === "field-shared").name, "Renamed Everywhere");
  assert.equal(effectiveTemplateFields(state, "template-root")[0].name, "Renamed Everywhere");
  assert.equal(effectiveTemplateFields(state, "template-child")[0].name, "Renamed Everywhere");
  assert.equal(instanceValue(state, "instance-child", "field-shared"), "Kept value");
  assert.ok(state.templateFields.some((entry) => entry.fieldId === "field-shared"));
});

test("a Base includes descendant rows but only the selected Template's shared columns", () => {
  const state = createWorkspace();
  const rootBase = baseScope(state, "template-root");
  assert.deepEqual(rootBase.instances.map((entry) => entry.id).sort(), ["instance-child", "instance-root"]);
  assert.deepEqual(rootBase.fields.map((entry) => entry.id), ["field-shared"]);

  const childBase = baseScope(state, "template-child");
  assert.deepEqual(childBase.instances.map((entry) => entry.id), ["instance-child"]);
  assert.deepEqual(childBase.fields.map((entry) => entry.id), ["field-shared", "field-child"]);
});

test("Template lineage is ordered from root to selected descendant", () => {
  assert.deepEqual(templateLineage(createWorkspace(), "template-child").map((entry) => entry.id), ["template-root", "template-child"]);
});

test("Field reverse usage includes inherited Templates and their Instances", () => {
  const usage = fieldUsage(createWorkspace(), "field-shared");
  assert.deepEqual(usage.directTemplates.map((entry) => entry.id), ["template-root"]);
  assert.deepEqual(usage.templates.map((entry) => entry.id).sort(), ["template-child", "template-root"]);
  assert.deepEqual(usage.instances.map((entry) => entry.id).sort(), ["instance-child", "instance-root"]);
});

test("generated branches allow creation without an entered Instance name", () => {
  let state = emptyWorkspaceState();
  state = applyLocalOperation(state, { kind: "createTemplate", id: "template-generated", name: "Generated Root", definition: "Definition", namingConvention: "generated" });
  state = applyLocalOperation(state, { kind: "createInstance", id: "instance-generated", templateId: "template-generated" });
  assert.equal(state.instances.length, 1);
  assert.match(state.instances[0].name, /^Generated Instance /);
});

