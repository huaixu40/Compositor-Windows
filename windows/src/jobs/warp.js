import {workerTask} from './runner.js';
import {canvas} from '../pixels.js';
export async function warpJob(source,warp,options={}){
  const bitmap=await createImageBitmap(source);
  try{const result=await workerTask('warp',{image:bitmap,warp},{...options,transfer:[bitmap]});const image=canvas(result.image.width,result.image.height);image.getContext('2d').drawImage(result.image,0,0);result.image.close();return{image,bounds:result.bounds};}
  finally{bitmap.close();}
}
