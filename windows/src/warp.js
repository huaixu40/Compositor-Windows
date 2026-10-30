import {canvas} from './pixels.js';
export function validateWarp(w){
  if(w?.version!==1||!['perspective','mesh'].includes(w.mode)||!Array.isArray(w.points)||w.points.length!==(w.mode==='mesh'?9:4)||w.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>100000||Math.abs(p.y)>100000))throw new Error('Invalid deformation.');
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
  const quads=w.mode==='mesh'?[[0,1,4,3],[1,2,5,4],[3,4,7,6],[4,5,8,7]]:[[0,1,2,3]];
  let winding=0;
  for(const quad of quads)for(let i=0;i<4;i++){
    const area=cross(w.points[quad[i]],w.points[quad[(i+1)%4]],w.points[quad[(i+2)%4]]);
    if(Math.abs(area)<.000001||(winding&&Math.sign(area)!==winding))throw new Error('Deformation folds or collapses.');
    winding=Math.sign(area);
  }
}
function solve(matrix){
  const n=matrix.length;for(let i=0;i<n;i++){let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(matrix[j][i])>Math.abs(matrix[pivot][i]))pivot=j;
    [matrix[i],matrix[pivot]]=[matrix[pivot],matrix[i]];const divisor=matrix[i][i];if(Math.abs(divisor)<1e-10)throw new Error('Deformation folds or collapses.');for(let k=i;k<=n;k++)matrix[i][k]/=divisor;
    for(let j=0;j<n;j++)if(j!==i){const f=matrix[j][i];for(let k=i;k<=n;k++)matrix[j][k]-=f*matrix[i][k];}}
  return matrix.map(row=>row[n]);
}
function homography(points){
  const uv=[[0,0],[1,0],[1,1],[0,1]],rows=[];points.forEach(({x,y},i)=>{const[u,v]=uv[i];rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);});return solve(rows);
}
export function warpImage(source,w,onProgress=()=>{}){
  validateWarp(w);const points=w.points.map(p=>({x:p.x*source.width,y:p.y*source.height})),x=Math.floor(Math.min(...points.map(p=>p.x))),y=Math.floor(Math.min(...points.map(p=>p.y))),width=Math.max(1,Math.ceil(Math.max(...points.map(p=>p.x)))-x),height=Math.max(1,Math.ceil(Math.max(...points.map(p=>p.y)))-y);
  const result=canvas(width,height),ctx=result.getContext('2d'),output=ctx.createImageData(width,height),src=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
  const put=(dx,dy,u,v)=>{
    if(u<0||u>1||v<0||v>1)return;const px=u*source.width-.5,py=v*source.height-.5,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;let alpha=0,r=0,g=0,b=0;
    for(let j=0;j<2;j++)for(let i=0;i<2;i++){const sx=ix+i,sy=iy+j;if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue;const k=(sy*source.width+sx)*4,a=src[k+3]/255*(i?fx:1-fx)*(j?fy:1-fy);alpha+=a;r+=src[k]*a;g+=src[k+1]*a;b+=src[k+2]*a;}
    const offset=(dy*width+dx)*4;if(alpha>0){output.data[offset]=r/alpha;output.data[offset+1]=g/alpha;output.data[offset+2]=b/alpha;output.data[offset+3]=alpha*255;}
  };
  if(w.mode==='perspective'){
    const h=homography(points);for(let row=0;row<height;row++){for(let col=0;col<width;col++){const px=x+col+.5,py=y+row+.5,z=h[6]*px+h[7]*py+1;put(col,row,(h[0]*px+h[1]*py+h[2])/z,(h[3]*px+h[4]*py+h[5])/z);}if(row%64===0)onProgress(row/height);}
  }else{
    const uv=points.map((_,i)=>({x:(i%3)/2,y:Math.floor(i/3)/2})),triangles=[[0,1,4],[0,4,3],[1,2,5],[1,5,4],[3,4,7],[3,7,6],[4,5,8],[4,8,7]];
    triangles.forEach((indices,index)=>{const[a,b,c]=indices.map(i=>points[i]),[ta,tb,tc]=indices.map(i=>uv[i]),den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
      for(let row=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))-y);row<Math.min(height,Math.ceil(Math.max(a.y,b.y,c.y))-y);row++)for(let col=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))-x);col<Math.min(width,Math.ceil(Math.max(a.x,b.x,c.x))-x);col++){
        const px=x+col+.5,py=y+row+.5,wa=((b.y-c.y)*(px-c.x)+(c.x-b.x)*(py-c.y))/den,wb=((c.y-a.y)*(px-c.x)+(a.x-c.x)*(py-c.y))/den,wc=1-wa-wb;if(wa>=-1e-7&&wb>=-1e-7&&wc>=-1e-7)put(col,row,ta.x*wa+tb.x*wb+tc.x*wc,ta.y*wa+tb.y*wb+tc.y*wc);
      }onProgress((index+1)/triangles.length);});
  }
  ctx.putImageData(output,0,0);return{image:result,bounds:{x,y,width,height}};
}
