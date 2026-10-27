import { workerTask } from './runner.js';
import { packDocument, unpackDocument } from './document-transfer.js';
export async function readPsdJob(bytes,name,options){
  const result=await workerTask('psd-read',{bytes,name},options);
  return{doc:unpackDocument(result.doc),notes:result.notes,preview:result.preview?unpackDocument(result.preview):null};
}
export async function exportJob(doc,extension,options={}){
  const packed=await packDocument(doc,options);
  try{return await workerTask('export',{document:packed.document,extension},{...options,transfer:packed.transfer});}
  finally{for(const bitmap of packed.transfer)bitmap.close();}
}
