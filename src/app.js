import {effectiveTemplateFields,instanceValue,baseScope,eligibleLinkTargets,templateLineage} from './model.js';
import {BrowserRepository} from './repository.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#editor');
const repo = new BrowserRepository();
let state, query = '', timer;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const route = () => location.hash.slice(1).split('/');
const link = (kind,id) => `#${kind}/${encodeURIComponent(id)}`;
const option = (id,name,selected='') => `<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(name)}</option>`;
const templateOptions = (selected='') => state.templates.map(t=>option(t.id,t.name,selected)).join('');
const date = v => v ? new Date(v).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : '—';
function notice(message) { clearTimeout(timer); const n=document.querySelector('#notice');n.textContent=message;n.classList.add('visible');timer=setTimeout(()=>n.classList.remove('visible'),7000); }
function valueText(field,value) {
  if(value === null || value === undefined || value === '') return '—';
  if(field.type === 'checkbox') return value ? 'Yes' : 'No';
  if(field.type === 'link') return state.instances.find(i=>i.id===value)?.name || 'Unresolved link';
  if(Array.isArray(value)) return value.map(v=>state.instances.find(i=>i.id===v)?.name || v).join(', ');
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function empty(title,body,action='') { return `<section class="empty"><div class="empty-mark">↗</div><h2>${title}</h2><p>${body}</p>${action}</section>`; }
function instanceRows(instances,fields=[]) {
  const found=instances.filter(i=>`${i.name} ${i.notes}`.toLowerCase().includes(query.toLowerCase()));
  if(!found.length) return empty(query?'No matches':'Room for your first instance',query?'Try another name or note.':'Create an instance to start connecting your knowledge.');
  return `<div class="table-scroll"><table><thead><tr><th>Name</th><th>Template</th>${fields.map(f=>`<th>${esc(f.name)}</th>`).join('')}<th>Updated</th></tr></thead><tbody>${found.map(i=>`<tr><td><a class="record" href="${link('instance',i.id)}"><span class="record-dot"></span>${esc(i.name)}</a></td><td><a class="pill" href="${link('template',i.templateId)}">${esc(state.templates.find(t=>t.id===i.templateId)?.name)}</a></td>${fields.map(f=>`<td>${esc(valueText(f,instanceValue(state,i.id,f.id)))}</td>`).join('')}<td class="muted nowrap">${esc(date(i.updatedAt))}</td></tr>`).join('')}</tbody></table></div>`;
}
function render() {
  const [page='instances',rawId='']=route(); const id=decodeURIComponent(rawId);
  const template=state.templates.find(t=>t.id===id), instance=state.instances.find(i=>i.id===id);
  let title='Instances',eyebrow='YOUR WORKSPACE',description='Your knowledge, connected.',content='',actions='';
  if(page==='templates') {
    title='Templates';description='Define the shape of your knowledge.';actions='<button class="primary" data-action="template">+ New template</button>';
    content=state.templates.length ? `<div class="cards">${state.templates.map(t=>`<a class="card" href="${link('template',t.id)}"><span class="card-glyph">⌘</span><h2>${esc(t.name)}</h2><p>${esc(t.definition || 'No description yet.')}</p><footer>${effectiveTemplateFields(state,t.id).length} fields <span>${baseScope(state,t.id).instances.length} instances</span></footer></a>`).join('')}</div>` : empty('Start with a template','A template defines a type of thing, such as a Project, Person, or Book.','<button class="primary" data-action="template">Create your first template</button>');
  } else if(page==='template' && template) {
    title=template.name;eyebrow='TEMPLATE';description=template.definition || 'A shared structure for connected instances.';
    actions=`<button data-action="field" data-id="${esc(id)}">+ Add field</button><button class="primary" data-action="instance" data-id="${esc(id)}">+ New instance</button>`;
    const fields=effectiveTemplateFields(state,id), scope=baseScope(state,id);
    content=`<div class="lineage">${templateLineage(state,id).map(t=>`<a href="${link('template',t.id)}">${esc(t.name)}</a>`).join(' / ')}</div><section class="panel"><div class="section-title"><h2>Field contract</h2><span>${fields.length} fields</span></div>${fields.length?`<div class="field-list">${fields.map(f=>`<div><strong>${esc(f.name)}</strong><span>${esc(f.type)}${f.inherited?' · inherited':''}</span></div>`).join('')}</div>`:'<p class="muted pad">No fields yet. Add a field to define what each instance records.</p>'}</section><section class="panel"><div class="section-title"><h2>Base</h2><span>Includes descendant templates</span></div>${instanceRows(scope.instances,scope.fields)}</section>`;
  } else if(page==='instance' && instance) {
    title=instance.name;eyebrow='INSTANCE';description=state.templates.find(t=>t.id===instance.templateId)?.name || '';
    actions=`<button class="primary" data-action="edit" data-id="${esc(id)}">Edit instance</button>`;
    const fields=effectiveTemplateFields(state,instance.templateId);
    content=`<section class="panel"><div class="section-title"><h2>Fields</h2><a href="${link('template',instance.templateId)}">View template ↗</a></div><dl class="values">${fields.map(f=>{const value=instanceValue(state,id,f.id);return `<div><dt>${esc(f.name)}<small>${esc(f.type)}</small></dt><dd>${f.type==='link'&&value?`<a href="${link('instance',value)}">${esc(valueText(f,value))} ↗</a>`:esc(valueText(f,value))}</dd></div>`;}).join('') || '<p class="muted">This template has no fields.</p>'}</dl></section><section class="panel"><div class="section-title"><h2>Notes</h2></div><p class="notes pad">${esc(instance.notes || 'No notes yet.')}</p></section><p class="muted">Updated ${esc(date(instance.updatedAt))}</p>`;
  } else if(page==='history') {
    title='History';description='A record of the changes you make.';
    content=state.history.length?`<section class="panel history">${state.history.slice(0,100).map(h=>`<article><span class="record-dot"></span><div><p>${esc(h.summary)}</p><small>${esc(date(h.createdAt))}</small></div></article>`).join('')}</section>`:empty('A clean slate','Your changes will appear here as you build your workspace.');
  } else if(page==='settings') {
    title='Workspace';description='Your data stays yours.';
    content=`<section class="panel settings"><h2>Browser-local development build</h2><p>This workspace is saved in this browser only. It does not sync between devices. Clearing site data can delete it. Export a backup before changing browsers.</p><button data-action="export">Export JSON backup</button><button data-action="refresh">Reload saved workspace</button><hr><h2>Coming next: hosted workspaces</h2><p>Supabase sign-in, private cloud storage, and cross-device access are not connected yet. This public source repository does not make your local records public.</p><p>Desktop vault import, attachments, graph, analytics editors, and offline sync are not included in this first milestone.</p></section>`;
  } else if(page==='instances' || !page) {
    actions=state.templates.length?'<button class="primary" data-action="instance">+ New instance</button>':'<button class="primary" data-action="template">+ New template</button>';
    content=`<div class="stats"><div><strong>${state.instances.length}</strong><span>Instances</span></div><div><strong>${state.templates.length}</strong><span>Templates</span></div><div><strong>${state.fields.length}</strong><span>Fields</span></div></div><section class="panel"><div class="section-title"><h2>All instances</h2><label class="search"><span class="sr-only">Search instances</span><input id="search" type="search" placeholder="Search names or notes" value="${esc(query)}"></label></div><div id="rows">${state.templates.length?instanceRows(state.instances):empty('Give your knowledge a home','Start with a template, then create instances and connect them.','<button class="primary" data-action="template">Create a template</button>')}</div></section>`;
  } else { title='Not found';description='This item is no longer in your workspace.';content='<a href="#instances">Back to instances</a>'; }
  const nav=[['instances','◫','Instances'],['templates','⌘','Templates'],['history','◷','History'],['settings','⚙','Workspace']];
  app.innerHTML=`<aside><a class="brand" href="#instances"><img src="./assets/brand/clade-symbol-black.svg" alt="">Clade<span>WEB</span></a><div class="workspace-label"><span class="avatar">C</span><div>My workspace<small>Personal · local</small></div></div><nav aria-label="Main navigation">${nav.map(([key,glyph,label])=>`<a href="#${key}" ${page===key?'aria-current="page"':''}><span aria-hidden="true">${glyph}</span>${label}</a>`).join('')}</nav><div class="sidebar-bottom"><span class="local-dot"></span>Browser-local alpha<small>No cloud connection</small></div></aside><main id="main" tabindex="-1"><div class="topbar"><span>Workspace <span class="slash">/</span> ${esc(title)}</span><span class="version">0.1.0</span></div><header><div><p class="eyebrow">${eyebrow}</p><h1>${esc(title)}</h1><p class="subtitle">${esc(description)}</p></div><div class="actions">${actions}</div></header><div class="content">${content}</div></main>`;
}
function label(name,control) {return `<label>${name}${control}</label>`;}
function openEditor(kind,id='') {
  const instance=state.instances.find(i=>i.id===id);
  let title='',fields='';
  if(kind==='template') {title='New template';fields=label('Name','<input name="name" required maxlength="160" autofocus>')+label('Description','<textarea name="definition" rows="3"></textarea>')+label('Inherit from',`<select name="parentTemplateId">${option('','No parent')}${templateOptions()}</select>`);}
  if(kind==='field') {title='Add field';fields=label('Name','<input name="name" required maxlength="160" autofocus>')+label('Type',`<select name="fieldType">${['text','number','checkbox','link'].map(t=>option(t,t)).join('')}</select>`)+`<label id="target-label" hidden>Allowed target template<select name="allowedTargetTemplateId">${templateOptions()}</select></label><p class="muted">This field also appears on descendants of this template.</p>`;}
  if(kind==='instance') {title='New instance';fields=label('Name','<input name="name" required maxlength="160" autofocus>')+label('Template',`<select name="templateId" required>${templateOptions(id)}</select>`)+label('Notes','<textarea name="notes" rows="3"></textarea>');}
  if(kind==='edit' && instance) {
    title='Edit instance';fields=label('Name',`<input name="name" required maxlength="160" value="${esc(instance.name)}" autofocus>`)+label('Notes',`<textarea name="notes" rows="3">${esc(instance.notes)}</textarea>`);
    for(const f of effectiveTemplateFields(state,instance.templateId)) {
      const value=instanceValue(state,id,f.id);const name=`value:${f.id}`;
      if(f.role!=='ordinary'||!['text','number','checkbox','link'].includes(f.type)) { fields+=`<p>${esc(f.name)}: ${esc(valueText(f,value))} <small>(read-only in this build)</small></p>`;continue; }
      let control=`<input name="${esc(name)}" type="${f.type==='number'?'number':'text'}" ${f.type==='number'?'step="any"':''} value="${esc(value)}">`;
      if(f.type==='checkbox') control=`<select name="${esc(name)}">${option('','Unset',value==null?'':String(value))}${option('true','Yes',String(value))}${option('false','No',String(value))}</select>`;
      if(f.type==='link') control=`<select name="${esc(name)}">${option('','No link',value)}${eligibleLinkTargets(state,f).map(i=>option(i.id,i.name,value)).join('')}</select>`;
      fields+=label(esc(f.name),control);
    }
  }
  const revision=state.workspace.revision;
  dialog.innerHTML=`<form><div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button type="button" data-close aria-label="Close dialog">×</button></div><div class="dialog-body">${fields}<p id="form-error" role="alert"></p></div><footer><button type="button" data-close>Cancel</button><button class="primary" type="submit">Save</button></footer></form>`;
  dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());
  const form=dialog.querySelector('form');
  if(kind==='field') form.elements.fieldType.onchange=()=>{dialog.querySelector('#target-label').hidden=form.elements.fieldType.value!=='link';};
  form.onsubmit=async event=>{
    event.preventDefault();const data=new FormData(form);const values=Object.fromEntries(data);let operations=[];
    if(kind==='template') operations=[{kind:'createTemplate',...values}];
    if(kind==='field') operations=[{kind:'createField',templateId:id,role:'ordinary',...values}];
    if(kind==='instance') operations=[{kind:'createInstance',...values}];
    if(kind==='edit') {
      operations=[{kind:'updateInstance',instanceId:id,name:values.name,notes:values.notes}];
      for(const f of effectiveTemplateFields(state,instance.templateId)) {
        if(!data.has(`value:${f.id}`)) continue;
        const raw=data.get(`value:${f.id}`), value=raw===''?null:f.type==='number'?Number(raw):f.type==='checkbox'?raw==='true':raw;
        if(value===instanceValue(state,id,f.id)) continue;
        operations.push({kind:value===null?'clearInstanceValue':'setInstanceValue',instanceId:id,fieldId:f.id,value});
      }
    }
    const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    try {state=await repo.commit(operations,revision);dialog.close();render();notice('Saved to this browser.');}
    catch(error){dialog.querySelector('#form-error').textContent=error.message;submit.disabled=false;}
  };
  dialog.showModal();
}
app.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  const {action,id=''}=button.dataset;
  try {
    if(action==='export') {
      const content=JSON.stringify({format:'clade-web',version:1,exportedAt:new Date().toISOString(),state},null,2);
      const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`clade-web-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return;
    }
    if(action==='refresh') {state=await repo.load();render();notice('Reloaded saved workspace.');return;}
    openEditor(action,id);
  } catch(error){notice(error.message);}
});
app.addEventListener('input',event=>{if(event.target.id==='search'){query=event.target.value;document.querySelector('#rows').innerHTML=instanceRows(state.instances);}});
window.addEventListener('hashchange',()=>{if(!state)return;query='';dialog.close();render();document.querySelector('main').focus();});
try {state=await repo.open();render();}
catch(error){app.innerHTML=`<section class="empty"><h1>Clade could not open browser storage</h1><p>${esc(error.message)}</p><p>Check that site storage is allowed, then reload this page. No changes were saved.</p></section>`;}
