import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root = resolve('dist');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
http.createServer(async (req,res) => {
  try {
    const path = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = resolve(root,`.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root+sep)) { res.writeHead(403); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'});
    res.end(data);
  } catch { res.writeHead(404);res.end('Not found'); }
}).listen(4173,'0.0.0.0',() => console.log('Clade: http://localhost:4173 (run npm run build first)'));
