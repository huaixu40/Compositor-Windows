struct Params{kind:f32,a:f32,b:f32,c:f32,};
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> p:Params;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{let q=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(q[i],0,1);}
fn curve(v:f32)->f32{
  let x=v*255;
  if(x<=64){return mix(0,p.a,x/64);}
  if(x<=128){return mix(p.a,p.b,(x-64)/64);}
  if(x<=192){return mix(p.b,p.c,(x-128)/64);}
  return mix(p.c,255,(x-192)/63);
}
@fragment fn fragment(@builtin(position) position:vec4f)->@location(0) vec4f{
  let q=vec2i(position.xy);let original=textureLoad(source,q,0);var c=original.rgb*255;
  switch u32(p.kind){
    case 0u:{c=(c*exp2(p.a)-128)*(1+p.b/100)+128;}
    case 1u:{c=255*pow(clamp((c-p.a)/max(1,p.b-p.a),vec3f(0),vec3f(1)),vec3f(1/p.c));}
    case 2u:{c=vec3f(curve(original.r),curve(original.g),curve(original.b));}
    case 3u:{let y=dot(c,vec3f(.299,.587,.114));let u=dot(c,vec3f(.596,-.274,-.322));let v=dot(c,vec3f(.211,-.523,.312));let angle=p.a*3.14159265359/180;let saturation=1+p.b/100;let a=(u*cos(angle)-v*sin(angle))*saturation;let z=(u*sin(angle)+v*cos(angle))*saturation;c=vec3f(y+.956*a+.621*z,y-.272*a-.647*z,y-1.106*a+1.703*z)+p.c*2.55;}
    case 4u:{c+=vec3f(p.a,p.b,p.c);}
    case 5u:{c=vec3f(dot(c,vec3f(.2126,.7152,.0722)));}
    case 6u:{let size=vec2i(textureDimensions(source));if(all(q>vec2i(0))&&all(q<size-1)){let amount=p.a/100;c=c*(1+4*amount)-amount*255*(textureLoad(source,q+vec2i(-1,0),0).rgb+textureLoad(source,q+vec2i(1,0),0).rgb+textureLoad(source,q+vec2i(0,-1),0).rgb+textureLoad(source,q+vec2i(0,1),0).rgb);}}
    default:{}
  }
  return vec4f(round(clamp(c,vec3f(0),vec3f(255)))/255,original.a);
}
