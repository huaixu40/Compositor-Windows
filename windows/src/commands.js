// All editor entry points share availability checks, error handling and the
// clipboard queue. Keeping this outside the tools prevents keyboard/menu drift.
export class CommandRegistry extends Map {
  constructor({blocked=()=>false,before=()=>{},error=()=>{}}={}) {
    super();this.blocked=blocked;this.before=before;this.error=error;
    this.pendingClipboard=0;this.clipboardQueue=Promise.resolve();
  }
  async execute(id) {
    const c=this.get(id);if(!c||this.blocked())return;
    this.before(id);if(!c.enabled())return;
    if(['copy','cut','copy-merged','paste'].includes(id)) {
      this.pendingClipboard++;
      const task=this.clipboardQueue.then(()=>c.run());
      this.clipboardQueue=task.catch(this.error).finally(()=>this.pendingClipboard--);
      return this.clipboardQueue;
    }
    try{return await c.run();}catch(error){this.error(error);}
  }
}
