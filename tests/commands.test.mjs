import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspaceState,instanceValue} from '../src/model.js';
import {commitBatch} from '../src/commands.js';
function fixture(type='text') {
  return commitBatch(emptyWorkspaceState(),[
    {kind:'createTemplate',id:'t',name:'Project'},
    {kind:'createField',id:'f',templateId:'t',name:'Status',fieldType:type},
    {kind:'createInstance',id:'i',templateId:'t',name:'Example'}
  ],0);
}
test('a stale write is refused',()=>{
  assert.throws(()=>commitBatch(fixture(),[{kind:'createTemplate',name:'Other'}],0),/another tab/);
});
test('a failed batch never mutates the input state',()=>{
  const state=fixture(); const original=structuredClone(state);
  assert.throws(()=>commitBatch(state,[{kind:'updateInstance',instanceId:'i',name:'Changed'},{kind:'createTemplate',name:''}],state.workspace.revision));
  assert.deepEqual(state,original);
});
test('nonfinite numbers are refused',()=>{
  const state=fixture('number');
  for(const value of [NaN,Infinity,'3']) assert.throws(()=>commitBatch(state,[{kind:'setInstanceValue',instanceId:'i',fieldId:'f',value}],state.workspace.revision),/finite/);
});
test('checkbox false survives save',()=>{
  const state=fixture('checkbox'); const next=commitBatch(state,[{kind:'setInstanceValue',instanceId:'i',fieldId:'f',value:false}],state.workspace.revision);
  assert.equal(instanceValue(next,'i','f'),false);
});
test('system fields cannot be changed through the web boundary',()=>{
  const state=fixture(); state.fields[0].role='system';
  for(const kind of ['setInstanceValue','clearInstanceValue']) assert.throws(()=>commitBatch(state,[{kind,instanceId:'i',fieldId:'f',value:'x'}],state.workspace.revision),/read-only/);
});
test('destructive commands are not exposed',()=>{
  const state=fixture();assert.throws(()=>commitBatch(state,[{kind:'deleteInstance',instanceId:'i'}],state.workspace.revision),/not enabled/);
});
test('inheritance is preserved across web commands',()=>{
  const state=fixture();const next=commitBatch(state,[{kind:'createTemplate',id:'child',name:'Subproject',parentTemplateId:'t'},{kind:'createInstance',id:'child-i',name:'Child',templateId:'child'},{kind:'setInstanceValue',instanceId:'child-i',fieldId:'f',value:'Inherited'}],state.workspace.revision);
  assert.equal(instanceValue(next,'child-i','f'),'Inherited');
});
test('link targets must satisfy the template constraint',()=>{
  const state=fixture();const next=commitBatch(state,[{kind:'createTemplate',id:'p',name:'Person'},{kind:'createField',id:'owner',name:'Owner',fieldType:'link',allowedTargetTemplateId:'p',templateId:'t'}],state.workspace.revision);
  assert.throws(()=>commitBatch(next,[{kind:'setInstanceValue',instanceId:'i',fieldId:'owner',value:'i'}],next.workspace.revision),/allowed target/);
});
