struct Params {
  center: vec2f, invScale: vec2f,
  rotation: vec2f, opacity: f32, mode: f32,
  tileOrigin: vec2f, maskOffset: vec2f,
  hasMask: f32, padding0: f32, padding1: f32, padding2: f32,
};
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var backdrop: texture_2d<f32>;
@group(0) @binding(3) var<uniform> p: Params;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  return vec4f(positions[i],0,1);
}
fn fetch(q:vec2i)->vec4f {
  let dimensions=vec2i(textureDimensions(source));
  if(any(q<vec2i(0))||any(q>=dimensions)){return vec4f(0);}
  let color=textureLoad(source,q,0);
  var alpha=color.a;
  if(p.hasMask>0.5){alpha*=textureLoad(mask,q+vec2i(p.maskOffset),0).r;}
  return vec4f(color.rgb*alpha,alpha);
}
fn lum(c:vec3f)->f32{return dot(c,vec3f(.3,.59,.11));}
fn sat(c:vec3f)->f32{return max(max(c.r,c.g),c.b)-min(min(c.r,c.g),c.b);}
fn clipColor(input:vec3f)->vec3f{
  var c=input;let l=lum(c);let n=min(min(c.r,c.g),c.b);let x=max(max(c.r,c.g),c.b);
  if(n<0){c=vec3f(l)+(c-vec3f(l))*l/max(l-n,0.000001);}
  if(x>1){c=vec3f(l)+(c-vec3f(l))*(1-l)/max(x-l,0.000001);}return c;
}
fn setLum(c:vec3f,l:f32)->vec3f{return clipColor(c+vec3f(l-lum(c)));}
fn setSat(c:vec3f,s:f32)->vec3f{
  let minimum=min(min(c.r,c.g),c.b);let maximum=max(max(c.r,c.g),c.b);
  if(maximum<=minimum){return vec3f(0);}return (c-vec3f(minimum))*s/(maximum-minimum);
}
fn blend(b:vec3f,s:vec3f,mode:u32)->vec3f{
  switch mode {
    case 1u:{return b*s;}
    case 2u:{return b+s-b*s;}
    case 3u:{return select(2*b*s,vec3f(1)-2*(1-b)*(1-s),b>vec3f(.5));}
    case 4u:{return min(b,s);}
    case 5u:{return max(b,s);}
    case 6u:{return select(min(vec3f(1),b/max(vec3f(.000001),1-s)),vec3f(0),b<=vec3f(0));}
    case 7u:{return select(1-min(vec3f(1),(1-b)/max(vec3f(.000001),s)),vec3f(1),b>=vec3f(1));}
    case 8u:{return select(2*b*s,vec3f(1)-2*(1-b)*(1-s),s>vec3f(.5));}
    case 9u:{let d=select(((16*b-12)*b+4)*b,sqrt(b),b>vec3f(.25));return select(b-(1-2*s)*b*(1-b),b+(2*s-1)*(d-b),s>vec3f(.5));}
    case 10u:{return abs(b-s);}
    case 11u:{return b+s-2*b*s;}
    case 12u:{return setLum(setSat(s,sat(b)),lum(b));}
    case 13u:{return setLum(setSat(b,sat(s)),lum(b));}
    case 14u:{return setLum(s,lum(b));}
    case 15u:{return setLum(b,lum(s));}
    default:{return s;}
  }
}
@fragment fn fragment(@builtin(position) pos:vec4f)->@location(0) vec4f {
  if(p.mode>99){
    let dst=textureLoad(backdrop,vec2i(pos.xy),0);let c=dst.rgb/max(dst.a,.000001);let index=vec3i(round(c*255));
    let mapped=vec3f(textureLoad(source,vec2i(index.r,0),0).r,textureLoad(source,vec2i(index.g,0),0).g,textureLoad(source,vec2i(index.b,0),0).b);
    var weight=p.opacity;if(p.hasMask>0.5){weight*=textureLoad(mask,vec2i(pos.xy+p.tileOrigin),0).r;}
    return vec4f(round(mix(c,mapped,weight)*255)/255*dst.a,dst.a);
  }
  let delta=pos.xy+p.tileOrigin-p.center;
  let local=vec2f(delta.x*p.rotation.x-delta.y*p.rotation.y,delta.x*p.rotation.y+delta.y*p.rotation.x)*p.invScale+vec2f(textureDimensions(source))*.5;
  let base=vec2i(floor(local-.5));let fraction=fract(local-.5);
  let src=mix(mix(fetch(base),fetch(base+vec2i(1,0)),fraction.x),mix(fetch(base+vec2i(0,1)),fetch(base+vec2i(1,1)),fraction.x),fraction.y)*p.opacity;
  let dst=textureLoad(backdrop,vec2i(pos.xy),0);
  let cs=select(vec3f(0),src.rgb/max(src.a,.000001),src.a>0);
  let cb=select(vec3f(0),dst.rgb/max(dst.a,.000001),dst.a>0);
  let color=(1-src.a)*dst.rgb+(1-dst.a)*src.rgb+src.a*dst.a*blend(cb,cs,u32(p.mode));
  return vec4f(color,src.a+dst.a*(1-src.a));
}
