import {applyLocalOperation, effectiveTemplateFields} from './model.js';

// A deliberately restricted web command boundary, not a substitute for server validation.
const allowed = new Set(['createTemplate','createField','createInstance','updateInstance','setInstanceValue','clearInstanceValue']);
export function commitBatch(state, operations, expectedRevision) {
  if (state.workspace.revision !== expectedRevision) throw new Error('This workspace changed in another tab. Reload before saving.');
  if (!Array.isArray(operations) || !operations.length) throw new Error('No changes supplied.');
  let next = state;
  for (const op of operations) {
    if (!allowed.has(op.kind)) throw new Error('This operation is not enabled in Clade Web yet.');
    if (op.kind === 'setInstanceValue' || op.kind === 'clearInstanceValue') {
      const instance = next.instances.find(i => i.id === op.instanceId);
      const field = effectiveTemplateFields(next, instance?.templateId).find(f => f.id === op.fieldId);
      if (!field || field.role === 'system' || field.role === 'subtype' || field.type === 'function') throw new Error('This field is read-only.');
      if (op.kind === 'setInstanceValue') {
        if (field.type === 'number' && (typeof op.value !== 'number' || !Number.isFinite(op.value))) throw new Error('Enter a finite number.');
        if (field.type === 'checkbox' && typeof op.value !== 'boolean') throw new Error('Checkbox values must be true or false.');
        if (field.type === 'text' && typeof op.value !== 'string') throw new Error('Enter text.');
      }
    }
    next = applyLocalOperation(next, op);
  }
  return next;
}
