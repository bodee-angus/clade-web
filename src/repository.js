import {emptyWorkspaceState} from './model.js';
import {commitBatch} from './commands.js';

export class BrowserRepository {
  async open() {
    this.db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('clade-web-v1',1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Clade tabs and retry.'));
    });
    return this.transaction('readwrite', (store,current) => {
      if (current) return current;
      const blank = emptyWorkspaceState({workspace:{id:crypto.randomUUID(),name:'My workspace'}});
      store.put(blank,'current');
      return blank;
    });
  }
  transaction(mode, run) {
    return new Promise((resolve,reject) => {
      const tx = this.db.transaction('workspaces',mode);
      const store = tx.objectStore('workspaces');
      let result, failure;
      const request = store.get('current');
      request.onsuccess = () => {
        try { result = run(store,request.result); }
        catch(error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new Error('Workspace save failed.'));
      tx.onerror = () => reject(failure || tx.error || new Error('Browser storage is unavailable.'));
    });
  }
  load() { return this.transaction('readonly', (_store,current) => current); }
  commit(operations,revision) {
    return this.transaction('readwrite', (store,current) => {
      const next = commitBatch(current,operations,revision);
      store.put(next,'current');
      return next;
    });
  }
}
