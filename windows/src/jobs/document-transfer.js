import { canvas } from '../pixels.js';
export async function packDocument(doc,{signal}={}){
  const transfer=[];
  async function bitmap(source){if(signal?.aborted)throw new DOMException('Canceled','AbortError');if(!source)return null;const result=await createImageBitmap(source);transfer.push(result);return result;}
  async function layers(nodes){const output=[];for(const l of nodes){const {image,mask,originalImage,originalMask,children,raw,highPrecision,...properties}=l;output.push({...properties,image:await bitmap(image),mask:await bitmap(mask),originalImage:await bitmap(originalImage),originalMask:await bitmap(originalMask),children:children?await layers(children):undefined});}return output;}
  try{return{document:{width:doc.width,height:doc.height,name:doc.name,layers:await layers(doc.layers)},transfer};}
  catch(error){for(const bitmap of transfer)bitmap.close();throw error;}
}
export function unpackDocument(doc){
  const image=bitmap=>{if(!bitmap)return null;const c=canvas(bitmap.width,bitmap.height);c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return c;};
  const layers=nodes=>nodes.map(l=>({...l,image:image(l.image),mask:image(l.mask),originalImage:image(l.originalImage),originalMask:image(l.originalMask),children:l.children?layers(l.children):undefined}));
  return {...doc,layers:layers(doc.layers)};
}
