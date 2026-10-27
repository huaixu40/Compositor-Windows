// A job owns its Worker: cancel terminates computation without touching document
// state. Callers commit only the returned result and check their document token.
export function workerTask(kind,payload,{signal,onProgress=()=>{},transfer=[]}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new DOMException('Canceled','AbortError'));return;}
    const worker=new Worker(new URL('worker.js',document.querySelector('script[src]').src));
    let finished=false;
    const finish=(error,result)=>{if(finished)return;finished=true;worker.terminate();clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
    const abort=()=>finish(new DOMException('Canceled','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Background task timed out.')),120000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{if(data.progress!==undefined)onProgress(data.progress);else if(data.error)finish(new Error(data.error));else finish(null,data.result);};
    worker.onerror=event=>finish(new Error(event.message||'Background task failed.'));
    try{worker.postMessage({kind,payload},transfer);}catch(error){finish(error);}
  });
}
