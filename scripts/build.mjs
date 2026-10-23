import {mkdir,cp} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for (const path of ['index.html','src','assets','_headers']) await cp(path,`dist/${path}`,{recursive:true});
console.log('Static build ready in dist/. No secrets or workspace data included.');
