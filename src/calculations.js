const cloneCalculationValue = (value) => structuredClone(value);
const list = (value) => Array.isArray(value) ? value : [];
const string = (value, fallback = "") => typeof value === "string" ? value : fallback;

export const FORMULA_VERSION = 1;

export const FUNCTION_RESULT_TYPES = Object.freeze([
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "duration", label: "Duration" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
]);

export const FUNCTION_RESULT_TYPE_METADATA = Object.freeze({
  text: Object.freeze({ label: "Text", storageType: "text", displayFormat: "text", unit: "" }),
  number: Object.freeze({ label: "Number", storageType: "number", displayFormat: "number", unit: "" }),
  duration: Object.freeze({ label: "Duration", storageType: "number", displayFormat: "duration", unit: "milliseconds" }),
  checkbox: Object.freeze({ label: "Checkbox", storageType: "checkbox", displayFormat: "checkbox", unit: "" }),
  date: Object.freeze({ label: "Date", storageType: "date", displayFormat: "date", unit: "" }),
  datetime: Object.freeze({ label: "Date and time", storageType: "datetime", displayFormat: "datetime", unit: "" }),
});

export const ANALYSIS_MEASURE_OPERATIONS = Object.freeze([
  { value: "count", label: "Count" },
  { value: "distinct_count", label: "Distinct count" },
  { value: "sum", label: "Sum" },
  { value: "average", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
  { value: "earliest", label: "Earliest" },
  { value: "latest", label: "Latest" },
]);

export class CalculationError extends Error {
  constructor(message, code = "calculation_error") {
    super(message);
    this.name = "CalculationError";
    this.code = code;
  }
}

export function isBlankCalculationValue(value) {
  return value === null
    || value === undefined
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && value.length === 0);
}

export function normalizeFunctionResultType(value, fallback = "number") {
  const normalized = string(value, fallback).replaceAll("_", "").replaceAll("-", "").replaceAll(" ", "").toLowerCase();
  return {
    boolean: "checkbox",
    bool: "checkbox",
    checkbox: "checkbox",
    date: "date",
    datetime: "datetime",
    duration: "duration",
    number: "number",
    text: "text",
  }[normalized] ?? fallback;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const FLOATING_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

function authoritativeTemporalValue(value) {
  if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) {
    return value.value ?? value.iso ?? "";
  }
  return value;
}

function floatingDisplayDate(match) {
  const [, yearText, monthText, dayText, hourText = "0", minuteText = "0", secondText = "0", fractionText = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fractionText.padEnd(3, "0").slice(0, 3) || 0);
  const date = new Date(0);
  date.setUTCHours(hour, minute, second, millisecond);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second) return null;
  return date;
}

function displayDate(value) {
  value = authoritativeTemporalValue(value);
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? { date: value, floating: false } : null;
  const source = string(value).trim();
  if (!source) return null;
  const floatingMatch = source.match(DATE_ONLY_PATTERN) ?? source.match(FLOATING_DATETIME_PATTERN);
  if (floatingMatch) {
    const date = floatingDisplayDate(floatingMatch);
    return date ? { date, floating: true } : null;
  }
  const date = new Date(source);
  return Number.isFinite(date.valueOf()) ? { date, floating: false } : null;
}

function formatDisplayDate(value, options, locale) {
  const parsed = displayDate(value);
  if (!parsed) return value === null || value === undefined ? "" : String(value);
  const formatOptions = parsed.floating ? { ...options, timeZone: "UTC" } : options;
  try {
    return new Intl.DateTimeFormat(locale, formatOptions).format(parsed.date);
  } catch {
    try {
      return new Intl.DateTimeFormat(undefined, formatOptions).format(parsed.date);
    } catch {
      return String(value);
    }
  }
}

export function formatDateValue(value, locale = undefined) {
  return formatDisplayDate(value, { dateStyle: "medium" }, locale);
}

export function formatDateTimeValue(value, locale = undefined) {
  return formatDisplayDate(value, { dateStyle: "medium", timeStyle: "short" }, locale);
}

export function formatTemporalValue(value, valueType, locale = undefined) {
  const type = normalizeFunctionResultType(valueType, string(valueType).trim());
  if (type === "date") return formatDateValue(value, locale);
  if (type === "datetime") return formatDateTimeValue(value, locale);
  return value === null || value === undefined ? "" : String(value);
}

export function formatFunctionValue(value, resultType) {
  const type = normalizeFunctionResultType(resultType, "number");
  if (isBlankCalculationValue(value)) return "";
  if (["date", "datetime"].includes(type)) return formatTemporalValue(value, type);
  if (type !== "duration") return type === "checkbox" ? (value ? "Yes" : "No") : String(value);
  const number = finiteNumber(value, "duration");
  const sign = number < 0 ? "−" : "";
  let remaining = Math.abs(Math.round(number));
  const units = [
    [86_400_000, "d"],
    [3_600_000, "h"],
    [60_000, "m"],
    [1_000, "s"],
  ];
  const parts = [];
  for (const [size, label] of units) {
    const amount = Math.floor(remaining / size);
    if (amount) parts.push(`${amount}${label}`);
    remaining %= size;
  }
  if (remaining || !parts.length) parts.push(`${remaining}ms`);
  return `${sign}${parts.slice(0, 3).join(" ")}`;
}

function canonicalCallName(value) {
  const normalized = string(value).trim().replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();
  return {
    avg: "average",
    durationbetween: "duration_between",
    dateadd: "date_add",
    eq: "equals",
    equal: "equals",
    greaterthan: "greater_than",
    gt: "greater_than",
    lessthan: "less_than",
    lt: "less_than",
  }[normalized.replaceAll("_", "")] ?? normalized;
}

function normalizeExpression(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rawKind = string(input.kind ?? input.type).trim().toLowerCase();
  if (rawKind === "field" || input.fieldId !== undefined || input.field_id !== undefined) {
    const fieldId = string(input.fieldId ?? input.field_id ?? input.id).trim();
    return fieldId ? { kind: "field", fieldId } : null;
  }
  if (rawKind === "literal" || Object.hasOwn(input, "value")) {
    return { kind: "literal", value: cloneCalculationValue(input.value ?? null) };
  }
  if (rawKind === "call" || input.name !== undefined || input.function !== undefined || input.operator !== undefined) {
    const name = canonicalCallName(input.name ?? input.function ?? input.operator);
    if (!name) return null;
    const rawArguments = input.args ?? input.arguments ?? input.operands ?? [];
    const args = list(rawArguments).map(normalizeExpression);
    if (args.some((entry) => !entry)) return null;
    return { kind: "call", name, args };
  }
  return null;
}

export function normalizeFormula(input) {
  if (!input || typeof input !== "object") return null;
  const expression = normalizeExpression(input.expression ?? input.root ?? input.ast ?? input);
  if (!expression) return null;
  return { version: Number(input.version ?? FORMULA_VERSION), expression };
}

export function formulaDependencies(input) {
  const formula = normalizeFormula(input);
  if (!formula) return [];
  const dependencies = [];
  const seen = new Set();
  const visit = (node) => {
    if (node.kind === "field") {
      if (!seen.has(node.fieldId)) dependencies.push(node.fieldId);
      seen.add(node.fieldId);
    }
    if (node.kind === "call") node.args.forEach(visit);
  };
  visit(formula.expression);
  return dependencies;
}

function fieldValueType(field) {
  const type = field?.type === "function"
    ? normalizeFunctionResultType(field.resultType, "number")
    : string(field?.type, "text");
  return type === "temporal" ? "datetime" : type;
}

function literalType(value) {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "string") return "text";
  if (value === null || value === undefined) return "blank";
  return Array.isArray(value) ? "list" : "unknown";
}

function numericType(type) {
  return type === "number" || type === "duration";
}

const CALL_SIGNATURES = Object.freeze({
  add: { min: 2, type: "number" },
  subtract: { min: 2, max: 2, type: "number" },
  multiply: { min: 2, type: "number" },
  divide: { min: 2, max: 2, type: "number" },
  average: { min: 2, type: "number" },
  min: { min: 2, type: "number" },
  max: { min: 2, type: "number" },
  concat: { min: 2, type: "text" },
  count: { min: 1, max: 1, type: "number" },
  duration_between: { min: 2, max: 2, type: "duration" },
  date_add: { min: 3, max: 3, type: "temporal" },
  equals: { min: 2, max: 2, type: "checkbox" },
  greater_than: { min: 2, max: 2, type: "checkbox" },
  less_than: { min: 2, max: 2, type: "checkbox" },
  if: { min: 3, max: 3, type: "conditional" },
  round: { min: 1, max: 2, type: "number" },
  and: { min: 2, type: "checkbox" },
  or: { min: 2, type: "checkbox" },
  not: { min: 1, max: 1, type: "checkbox" },
});

function inferExpressionType(node, fieldsById, errors) {
  if (node.kind === "literal") return literalType(node.value);
  if (node.kind === "field") {
    const field = fieldsById.get(node.fieldId);
    if (!field) {
      errors.push(`Formula dependency ${node.fieldId} does not exist.`);
      return "unknown";
    }
    return fieldValueType(field);
  }
  const signature = CALL_SIGNATURES[node.name];
  if (!signature) {
    errors.push(`Formula function ${node.name} is not supported.`);
    return "unknown";
  }
  if (node.args.length < signature.min || (signature.max !== undefined && node.args.length > signature.max)) {
    errors.push(`Formula function ${node.name} has the wrong number of arguments.`);
  }
  const argumentTypes = node.args.map((argument) => inferExpressionType(argument, fieldsById, errors));
  if (["add", "subtract", "multiply", "divide", "average", "min", "max", "round"].includes(node.name)) {
    if (argumentTypes.some((type) => type !== "number" && type !== "blank")) {
      errors.push(`Formula function ${node.name} accepts only Number values.`);
    }
  }
  if (node.name === "count" && !["list", "linkList", "textList", "numberList"].includes(argumentTypes[0])) {
    errors.push("count requires a List Field.");
  }
  if (node.name === "duration_between" && argumentTypes.some((type) => !["date", "datetime"].includes(type))) {
    errors.push("duration_between requires Date or Date and time Fields.");
  }
  if (node.name === "date_add") {
    if (!["date", "datetime"].includes(argumentTypes[0])) errors.push("date_add requires a Date or Date and time first argument.");
    if (argumentTypes[1] !== "number") errors.push("date_add requires a Number amount second argument.");
    if (argumentTypes[2] !== "text") errors.push("date_add requires a text time unit third argument.");
    return "datetime";
  }
  if (["equals", "greater_than", "less_than"].includes(node.name) && argumentTypes.length === 2 && argumentTypes[0] !== argumentTypes[1]) {
    errors.push(`${node.name} requires two values of the same type.`);
  }
  if (node.name === "if") {
    if (argumentTypes[0] !== "checkbox") errors.push("if requires a Checkbox condition.");
    return argumentTypes[1] === argumentTypes[2] ? argumentTypes[1] : "unknown";
  }
  if (["and", "or", "not"].includes(node.name) && argumentTypes.some((type) => type !== "checkbox")) {
    errors.push(`${node.name} requires Checkbox values.`);
  }
  return signature.type;
}

export function validateFormula(input, fields = [], resultType = "number", functionFieldId = "") {
  const formula = normalizeFormula(input);
  const errors = [];
  if (!formula) return { valid: false, errors: ["A valid formula is required."], dependencies: [], inferredType: "unknown", formula: null };
  if (formula.version !== FORMULA_VERSION) errors.push(`Formula version ${formula.version} is not supported.`);
  const dependencies = formulaDependencies(formula);
  if (functionFieldId && dependencies.includes(functionFieldId)) errors.push("A Function Field cannot directly reference itself.");
  const inferredType = inferExpressionType(formula.expression, new Map(fields.map((field) => [field.id, field])), errors);
  const expected = normalizeFunctionResultType(resultType, "number");
  const compatible = inferredType === expected || (expected === "date" && inferredType === "datetime");
  if (!compatible && !["unknown", "blank"].includes(inferredType)) {
    errors.push(`The formula returns ${inferredType}, but this Function Field returns ${expected}.`);
  }
  return { valid: errors.length === 0, errors, dependencies, inferredType, formula };
}

function temporalMilliseconds(value) {
  value = authoritativeTemporalValue(value);
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.valueOf();
  const source = string(value).trim();
  if (!source) throw new CalculationError("A date input is blank.", "blank_dependency");
  let timestamp;
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) timestamp = Date.parse(`${source}T00:00:00.000Z`);
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(source)) timestamp = Date.parse(`${source}Z`);
  else timestamp = Date.parse(source);
  if (!Number.isFinite(timestamp)) throw new CalculationError(`“${source}” is not a valid date or date and time.`, "invalid_date");
  return timestamp;
}

function finiteNumber(value, label = "value") {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new CalculationError(`The ${label} is not a finite number.`, "invalid_number");
  return number;
}

function flattenValues(values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value]);
}

function formulaText(value) {
  if (Array.isArray(value)) return value.map(formulaText).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value && typeof value === "object") return JSON.stringify(value);
  return value === null || value === undefined ? "" : String(value);
}

function evaluateCall(name, args) {
  if (name !== "count" && args.some(isBlankCalculationValue)) {
    throw new CalculationError("A required formula input is blank.", "blank_dependency");
  }
  if (name === "add") return args.reduce((total, value) => total + finiteNumber(value), 0);
  if (name === "subtract") return finiteNumber(args[0]) - finiteNumber(args[1]);
  if (name === "multiply") return args.reduce((total, value) => total * finiteNumber(value), 1);
  if (name === "divide") {
    const divisor = finiteNumber(args[1], "divisor");
    if (divisor === 0) throw new CalculationError("A formula cannot divide by zero.", "division_by_zero");
    return finiteNumber(args[0]) / divisor;
  }
  if (["average", "min", "max"].includes(name)) {
    const numbers = flattenValues(args).filter((value) => !isBlankCalculationValue(value)).map((value) => finiteNumber(value));
    if (!numbers.length) throw new CalculationError(`The ${name} function has no populated values.`, "blank_dependency");
    if (name === "average") return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    return name === "min" ? Math.min(...numbers) : Math.max(...numbers);
  }
  if (name === "concat") return args.map(formulaText).join("");
  if (name === "count") return Array.isArray(args[0]) ? args[0].length : isBlankCalculationValue(args[0]) ? 0 : 1;
  if (name === "duration_between") return temporalMilliseconds(args[1]) - temporalMilliseconds(args[0]);
  if (name === "date_add") {
    const source = authoritativeTemporalValue(args[0]);
    const units = {
      millisecond: 1, milliseconds: 1,
      second: 1_000, seconds: 1_000,
      minute: 60_000, minutes: 60_000,
      hour: 3_600_000, hours: 3_600_000,
      day: 86_400_000, days: 86_400_000,
      week: 604_800_000, weeks: 604_800_000,
    };
    const unit = args.length < 3 ? 1 : units[string(args[2]).toLowerCase()];
    if (!unit) throw new CalculationError("date_add requires milliseconds, seconds, minutes, hours, days, or weeks.", "invalid_date_unit");
    const date = new Date(temporalMilliseconds(source) + finiteNumber(args[1], "amount") * unit);
    return date.toISOString().replace(/\.000Z$/, "").replace(/Z$/, "");
  }
  if (name === "equals") return Object.is(args[0], args[1]) || String(args[0]) === String(args[1]);
  if (name === "greater_than" || name === "less_than") {
    const compare = (typeof args[0] === "number" || typeof args[1] === "number")
      ? [finiteNumber(args[0]), finiteNumber(args[1])]
      : [String(args[0]), String(args[1])];
    return name === "greater_than" ? compare[0] > compare[1] : compare[0] < compare[1];
  }
  if (name === "if") return Boolean(args[0]) ? args[1] : args[2];
  if (name === "round") {
    const digits = Math.max(0, Math.min(12, Math.trunc(finiteNumber(args[1] ?? 0, "digits"))));
    const factor = 10 ** digits;
    return Math.round(finiteNumber(args[0]) * factor) / factor;
  }
  if (name === "and") return args.every(Boolean);
  if (name === "or") return args.some(Boolean);
  if (name === "not") return !Boolean(args[0]);
  throw new CalculationError(`Formula function ${name} is not supported.`, "unsupported_function");
}

function validateResultValue(value, resultType) {
  const type = normalizeFunctionResultType(resultType, "number");
  if (isBlankCalculationValue(value)) throw new CalculationError("The formula returned a blank value.", "blank_result");
  const valid = type === "text" ? typeof value === "string"
    : type === "checkbox" ? typeof value === "boolean"
      : ["number", "duration"].includes(type) ? typeof value === "number" && Number.isFinite(value)
        : ["date", "datetime"].includes(type) ? typeof value === "string" && Number.isFinite(temporalMilliseconds(value))
          : false;
  if (!valid) throw new CalculationError(`The calculated value does not match result type ${type}.`, "result_type_mismatch");
  return value;
}

function templateLineageIds(state, templateId) {
  const templates = new Map(list(state.templates).map((template) => [template.id, template]));
  const result = [];
  const seen = new Set();
  let current = templates.get(templateId);
  while (current) {
    if (seen.has(current.id)) throw new CalculationError("Template inheritance contains a cycle.", "template_cycle");
    seen.add(current.id);
    result.unshift(current.id);
    current = current.parentId ? templates.get(current.parentId) : null;
  }
  return result;
}

function effectiveFieldIds(state, templateId) {
  const ids = [];
  const seen = new Set();
  for (const lineageId of templateLineageIds(state, templateId)) {
    const assignments = list(state.templateFields).filter((entry) => entry.templateId === lineageId)
      .sort((left, right) => Number(left.position ?? 0) - Number(right.position ?? 0));
    for (const assignment of assignments) {
      if (!seen.has(assignment.fieldId)) ids.push(assignment.fieldId);
      seen.add(assignment.fieldId);
    }
  }
  return ids;
}

export function validateFunctionFieldDefinitions(state) {
  const fields = list(state.fields);
  const functions = fields.filter((field) => field.type === "function");
  const errors = [];
  const dependencies = new Map();
  for (const field of functions) {
    const validation = validateFormula(field.formula, fields, field.resultType, field.id);
    dependencies.set(field.id, validation.dependencies);
    for (const error of validation.errors) errors.push({ fieldId: field.id, message: error });
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (fieldId, path = []) => {
    if (visiting.has(fieldId)) {
      errors.push({ fieldId, message: `Function Field dependency cycle: ${[...path, fieldId].join(" → ")}.` });
      return;
    }
    if (visited.has(fieldId)) return;
    visiting.add(fieldId);
    for (const dependencyId of dependencies.get(fieldId) ?? []) {
      if (dependencies.has(dependencyId)) visit(dependencyId, [...path, fieldId]);
    }
    visiting.delete(fieldId);
    visited.add(fieldId);
  };
  functions.forEach((field) => visit(field.id));

  for (const template of list(state.templates)) {
    const effective = new Set(effectiveFieldIds(state, template.id));
    for (const field of functions.filter((candidate) => effective.has(candidate.id))) {
      const missing = (dependencies.get(field.id) ?? []).filter((dependencyId) => !effective.has(dependencyId));
      if (missing.length) errors.push({ fieldId: field.id, templateId: template.id, message: `Function Field dependencies ${missing.join(", ")} are outside this Template contract.` });
    }
  }
  return { valid: errors.length === 0, errors, dependencies };
}

export function evaluateFunctionFields(state) {
  const fieldsById = new Map(list(state.fields).map((field) => [field.id, field]));
  const rawValues = new Map(list(state.values).filter((entry) => !entry.derived)
    .map((entry) => [`${entry.instanceId}\u0000${entry.fieldId}`, entry.value]));
  const values = [];
  const errors = [];

  for (const instance of list(state.instances)) {
    const effective = new Set(effectiveFieldIds(state, instance.templateId));
    const memo = new Map();
    const visiting = new Set();
    const resolveField = (fieldId) => {
      if (!effective.has(fieldId)) throw new CalculationError(`Field ${fieldId} is outside this Instance contract.`, "missing_dependency");
      if (memo.has(fieldId)) {
        const result = memo.get(fieldId);
        if (result.error) throw result.error;
        return result.value;
      }
      const field = fieldsById.get(fieldId);
      if (!field) throw new CalculationError(`Field ${fieldId} does not exist.`, "missing_dependency");
      if (field.type !== "function") return rawValues.get(`${instance.id}\u0000${fieldId}`) ?? null;
      if (visiting.has(fieldId)) throw new CalculationError("Function Field dependency cycle detected.", "formula_cycle");
      visiting.add(fieldId);
      try {
        const formula = normalizeFormula(field.formula);
        if (!formula) throw new CalculationError("This Function Field has no valid formula.", "invalid_formula");
        const evaluateNode = (node) => {
          if (node.kind === "literal") return cloneCalculationValue(node.value);
          if (node.kind === "field") return resolveField(node.fieldId);
          return evaluateCall(node.name, node.args.map(evaluateNode));
        };
        const value = validateResultValue(evaluateNode(formula.expression), field.resultType);
        memo.set(fieldId, { value });
        return value;
      } catch (error) {
        const calculationError = error instanceof CalculationError ? error : new CalculationError(error.message ?? String(error));
        memo.set(fieldId, { error: calculationError });
        throw calculationError;
      } finally {
        visiting.delete(fieldId);
      }
    };

    for (const fieldId of effective) {
      const field = fieldsById.get(fieldId);
      if (field?.type !== "function") continue;
      try {
        const resultType = normalizeFunctionResultType(field.resultType);
        const metadata = FUNCTION_RESULT_TYPE_METADATA[resultType];
        values.push({ instanceId: instance.id, fieldId, value: resolveField(fieldId), derived: true, resultType, displayFormat: field.displayFormat || metadata.displayFormat, unit: metadata.unit });
      } catch (error) {
        const calculationError = error instanceof CalculationError ? error : new CalculationError(error.message ?? String(error));
        const resultType = normalizeFunctionResultType(field.resultType);
        const metadata = FUNCTION_RESULT_TYPE_METADATA[resultType];
        const record = { instanceId: instance.id, fieldId, value: null, derived: true, resultType, displayFormat: field.displayFormat || metadata.displayFormat, unit: metadata.unit, error: calculationError.message, errorCode: calculationError.code };
        values.push(record);
        errors.push(record);
      }
    }
  }
  return { values, errors };
}

export function formatFormula(input, fields = []) {
  const formula = normalizeFormula(input);
  if (!formula) return "";
  const names = new Map(fields.map((field) => [field.id, field.name]));
  const format = (node) => {
    if (node.kind === "field") return `{${names.get(node.fieldId) ?? node.fieldId}}`;
    if (node.kind === "literal") return typeof node.value === "string" ? JSON.stringify(node.value) : String(node.value);
    return `${node.name}(${node.args.map(format).join(", ")})`;
  };
  return format(formula.expression);
}

function normalizeAnalysisFilter(filter, index) {
  if (!filter || typeof filter !== "object") return null;
  const fieldId = string(filter.fieldId ?? filter.field_id).trim();
  const systemField = string(filter.systemField ?? filter.system_field).trim();
  const operator = string(filter.operator, "equals").trim().replace(/[\s-]+/g, "_").toLowerCase();
  if (!fieldId && !systemField) return null;
  return { id: string(filter.id, `filter-${index + 1}`), fieldId, systemField, operator, value: cloneCalculationValue(filter.value ?? null), secondValue: cloneCalculationValue(filter.secondValue ?? filter.second_value ?? null) };
}

function normalizeAnalysisGroup(group) {
  if (!group || typeof group !== "object") return null;
  const kind = string(group.kind, group.fieldId || group.field_id ? "field" : "template").trim();
  const fieldId = string(group.fieldId ?? group.field_id).trim();
  const systemField = string(group.systemField ?? group.system_field).trim();
  if (kind === "field" && !fieldId) return null;
  return { kind, fieldId, systemField, dateBucket: string(group.dateBucket ?? group.date_bucket).trim().toLowerCase() };
}

function normalizeAnalysisMeasure(measure, index) {
  if (!measure || typeof measure !== "object") return null;
  const operation = string(measure.operation ?? measure.aggregate, "count").trim().replace(/[\s-]+/g, "_").toLowerCase();
  const supported = new Set(ANALYSIS_MEASURE_OPERATIONS.map((entry) => entry.value));
  if (!supported.has(operation)) return null;
  const fieldId = string(measure.fieldId ?? measure.field_id).trim();
  if (operation !== "count" && !fieldId) return null;
  return { id: string(measure.id, `measure-${index + 1}`), label: string(measure.label, operation.replaceAll("_", " ")), operation, fieldId };
}

export function normalizeAnalysisDefinition(input) {
  const root = input && typeof input === "object" ? input : {};
  const filters = list(root.filters).map(normalizeAnalysisFilter).filter(Boolean);
  const measures = list(root.measures).map(normalizeAnalysisMeasure).filter(Boolean);
  const visualizationRoot = root.visualization && typeof root.visualization === "object" ? root.visualization : {};
  const chartType = string(visualizationRoot.type ?? root.chartType ?? root.chart_type, "auto").toLowerCase();
  const normalizedMeasures = measures.length ? measures : [{ id: "measure-1", label: "Count", operation: "count", fieldId: "" }];
  return {
    version: Number(root.version ?? 1),
    filters,
    groupBy: normalizeAnalysisGroup(root.groupBy ?? root.group_by),
    measures: normalizedMeasures,
    visualization: {
      type: ["auto", "bar", "line", "none"].includes(chartType) ? chartType : "auto",
      measureId: string(visualizationRoot.measureId ?? visualizationRoot.measure_id ?? root.chartMeasureId ?? root.chart_measure_id) || normalizedMeasures[0].id,
    },
  };
}

export function normalizeAnalysis(input) {
  if (!input || typeof input !== "object") return null;
  const id = string(input.id).trim();
  const name = string(input.name).trim();
  const sourceTemplateId = string(input.sourceTemplateId ?? input.source_template_id ?? input.templateId ?? input.template_id).trim();
  if (!id || !name || !sourceTemplateId) return null;
  return {
    id,
    name,
    description: string(input.description ?? input.definition),
    sourceTemplateId,
    definition: normalizeAnalysisDefinition(input.configuration ?? input.definition ?? input.definitionJson ?? input.definition_json ?? input),
    createdAt: string(input.createdAt ?? input.created_at),
    updatedAt: string(input.updatedAt ?? input.updated_at),
  };
}

export function analysisFieldDependencies(input) {
  const definition = normalizeAnalysisDefinition(input?.definition ?? input);
  const ids = [];
  const seen = new Set();
  const add = (fieldId) => {
    if (fieldId && !seen.has(fieldId)) ids.push(fieldId);
    if (fieldId) seen.add(fieldId);
  };
  definition.filters.forEach((filter) => add(filter.fieldId));
  add(definition.groupBy?.fieldId);
  definition.measures.forEach((measure) => add(measure.fieldId));
  return ids;
}

function descendantTemplateIds(state, templateId) {
  const ids = new Set([templateId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const template of list(state.templates)) {
      if (ids.has(template.parentId) && !ids.has(template.id)) {
        ids.add(template.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function validateAnalysis(state, input) {
  const analysis = normalizeAnalysis(input);
  const errors = [];
  if (!analysis) return { valid: false, errors: ["A named Analysis with a source Template is required."], analysis: null };
  if (analysis.definition.version !== 1) errors.push(`Analysis version ${analysis.definition.version} is not supported.`);
  const source = list(state.templates).find((template) => template.id === analysis.sourceTemplateId);
  if (!source) errors.push("The Analysis source Template does not exist.");
  const fieldsById = new Map(list(state.fields).map((field) => [field.id, field]));
  const effective = source ? new Set(effectiveFieldIds(state, source.id)) : new Set();
  const filterOperators = new Set(["equals", "not_equals", "contains", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "between", "is_blank", "is_not_blank"]);
  for (const filter of analysis.definition.filters) if (!filterOperators.has(filter.operator)) errors.push(`Analysis filter ${filter.operator} is not supported.`);
  for (const fieldId of analysisFieldDependencies(analysis)) {
    if (!fieldsById.has(fieldId)) errors.push(`Analysis Field ${fieldId} does not exist.`);
    else if (!effective.has(fieldId)) errors.push(`Analysis Field ${fieldId} is outside the source Template contract.`);
  }
  for (const measure of analysis.definition.measures) {
    const field = fieldsById.get(measure.fieldId);
    const type = fieldValueType(field);
    if (["sum", "average"].includes(measure.operation) && !numericType(type)) {
      errors.push(`${measure.operation} requires a Number or Duration Field.`);
    }
    if (["earliest", "latest"].includes(measure.operation) && !["date", "datetime"].includes(type)) {
      errors.push(`${measure.operation} requires a Date or Date and time Field.`);
    }
  }
  if (!analysis.definition.measures.some((measure) => measure.id === analysis.definition.visualization.measureId)) {
    errors.push("The Analysis chart references a measure that does not exist.");
  }
  return { valid: errors.length === 0, errors, analysis };
}

function stableValueKey(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(String));
  if (value && typeof value === "object") return JSON.stringify(value);
  return `${typeof value}:${String(value)}`;
}

function valueForInstance(state, instance, fieldId, systemField = "") {
  if (systemField === "template") return instance.templateId;
  if (systemField === "createdAt") return instance.createdAt;
  if (systemField === "updatedAt") return instance.updatedAt;
  return list(state.values).find((entry) => entry.instanceId === instance.id && entry.fieldId === fieldId)?.value ?? null;
}

function compareAnalysisValues(left, right) {
  if (typeof left === "number" || typeof right === "number") return finiteNumber(left) - finiteNumber(right);
  try {
    const leftTime = temporalMilliseconds(left);
    const rightTime = temporalMilliseconds(right);
    return leftTime - rightTime;
  } catch {
    return String(left).localeCompare(String(right));
  }
}

function filterMatches(value, filter) {
  const operator = filter.operator;
  if (operator === "is_blank") return isBlankCalculationValue(value);
  if (operator === "is_not_blank") return !isBlankCalculationValue(value);
  if (isBlankCalculationValue(value)) return false;
  const expected = filter.value;
  if (operator === "equals") return stableValueKey(value) === stableValueKey(expected) || String(value) === String(expected);
  if (operator === "not_equals") return !filterMatches(value, { ...filter, operator: "equals" });
  if (operator === "contains") return Array.isArray(value) ? value.map(String).includes(String(expected)) : String(value).toLocaleLowerCase().includes(String(expected).toLocaleLowerCase());
  if (["greater_than", "greater_or_equal", "less_than", "less_or_equal"].includes(operator)) {
    const comparison = compareAnalysisValues(value, expected);
    return operator === "greater_than" ? comparison > 0 : operator === "greater_or_equal" ? comparison >= 0 : operator === "less_than" ? comparison < 0 : comparison <= 0;
  }
  if (operator === "between") return compareAnalysisValues(value, expected) >= 0 && compareAnalysisValues(value, filter.secondValue) <= 0;
  return false;
}

function bucketDate(value, bucket) {
  const date = new Date(temporalMilliseconds(value));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  if (bucket === "year") return String(year);
  if (bucket === "month") return `${year}-${month}`;
  if (bucket === "week") {
    const start = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    const weekday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - weekday);
    return start.toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

function analysisGroupValueType(state, groupBy) {
  if (["createdAt", "updatedAt"].includes(groupBy?.systemField)) return "datetime";
  if (groupBy?.kind !== "field") return "";
  return fieldValueType(list(state.fields).find((field) => field.id === groupBy.fieldId));
}

function displayAnalysisValue(state, value, valueType = "") {
  if (Array.isArray(value)) return value.map((entry) => displayAnalysisValue(state, entry, valueType)).join(", ");
  if (value && typeof value === "object" && typeof value.label === "string" && value.label.trim()) return value.label.trim();
  const instance = list(state.instances).find((entry) => entry.id === String(value));
  if (instance) return instance.name;
  const template = list(state.templates).find((entry) => entry.id === String(value));
  if (template) return template.name;
  return ["date", "datetime"].includes(valueType) ? formatTemporalValue(value, valueType) : String(value);
}

function displayDateBucket(key, bucket) {
  if (bucket === "year") return key;
  if (bucket === "week") return `Week of ${formatDateValue(key)}`;
  if (bucket === "month") return formatDisplayDate(`${key}-01`, { month: "long", year: "numeric" });
  return formatDateValue(key);
}

function groupForInstance(state, instance, groupBy) {
  if (!groupBy) return { key: "all", label: "All Instances" };
  const value = groupBy.kind === "template"
    ? instance.templateId
    : valueForInstance(state, instance, groupBy.fieldId, groupBy.systemField);
  if (isBlankCalculationValue(value)) return { key: "blank", label: "Blank" };
  if (groupBy.dateBucket) {
    try {
      const key = bucketDate(value, groupBy.dateBucket);
      return { key, label: displayDateBucket(key, groupBy.dateBucket) };
    } catch {
      return { key: "invalid", label: "Invalid date" };
    }
  }
  return { key: stableValueKey(value), label: displayAnalysisValue(state, value, analysisGroupValueType(state, groupBy)) };
}

function measureValue(state, instances, measure) {
  const values = measure.fieldId
    ? instances.map((instance) => valueForInstance(state, instance, measure.fieldId)).filter((value) => !isBlankCalculationValue(value))
    : [];
  if (measure.operation === "count") return measure.fieldId ? values.length : instances.length;
  if (measure.operation === "distinct_count") return new Set(values.map(stableValueKey)).size;
  if (["sum", "average"].includes(measure.operation)) {
    const numbers = values.map((value) => finiteNumber(value));
    if (!numbers.length) return null;
    const sum = numbers.reduce((total, value) => total + value, 0);
    return measure.operation === "sum" ? sum : sum / numbers.length;
  }
  if (["min", "max", "earliest", "latest"].includes(measure.operation)) {
    if (!values.length) return null;
    const temporal = ["earliest", "latest"].includes(measure.operation);
    return values.reduce((selected, value) => {
      const comparison = temporal ? temporalMilliseconds(value) - temporalMilliseconds(selected) : compareAnalysisValues(value, selected);
      const choose = ["min", "earliest"].includes(measure.operation) ? comparison < 0 : comparison > 0;
      return choose ? value : selected;
    });
  }
  return null;
}

export function evaluateAnalysis(state, input) {
  const validation = validateAnalysis(state, input);
  if (!validation.valid) throw new CalculationError(validation.errors.join(" "), "invalid_analysis");
  const analysis = validation.analysis;
  const allowedTemplates = descendantTemplateIds(state, analysis.sourceTemplateId);
  const scoped = list(state.instances).filter((instance) => allowedTemplates.has(instance.templateId));
  const filtered = scoped.filter((instance) => analysis.definition.filters.every((filter) => filterMatches(valueForInstance(state, instance, filter.fieldId, filter.systemField), filter)));
  const grouped = new Map();
  for (const instance of filtered) {
    const group = groupForInstance(state, instance, analysis.definition.groupBy);
    const entry = grouped.get(group.key) ?? { ...group, instances: [] };
    entry.instances.push(instance);
    grouped.set(group.key, entry);
  }
  if (!grouped.size && !analysis.definition.groupBy) grouped.set("all", { key: "all", label: "All Instances", instances: [] });
  const groups = [...grouped.values()].sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key)).map((group) => ({
    key: group.key,
    label: group.label,
    count: group.instances.length,
    measures: Object.fromEntries(analysis.definition.measures.map((measure) => [measure.id, measureValue(state, group.instances, measure)])),
    instanceIds: group.instances.map((instance) => instance.id),
  }));
  const calculationErrorCount = list(state.values).filter((record) => record.derived && record.error && filtered.some((instance) => instance.id === record.instanceId)).length;
  return {
    analysis,
    sourceTemplate: list(state.templates).find((template) => template.id === analysis.sourceTemplateId),
    scopedCount: scoped.length,
    filteredCount: filtered.length,
    groups,
    totals: Object.fromEntries(analysis.definition.measures.map((measure) => [measure.id, measureValue(state, filtered, measure)])),
    warnings: calculationErrorCount ? [`${calculationErrorCount} calculated value${calculationErrorCount === 1 ? "" : "s"} could not be evaluated and were treated as blank.`] : [],
  };
}

