import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Starter anchors retained: bounded pixel ratio, local imports, PMREM, bridge,
// resize handling and an uninterrupted animation loop.
const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.28;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();
scene.background=new THREE.Color('#142832');
scene.fog=new THREE.FogExp2('#294552',.012);
let viewSize=23.5;
const camera=new THREE.OrthographicCamera(-viewSize*innerWidth/innerHeight/2,viewSize*innerWidth/innerHeight/2,viewSize/2,-viewSize/2,.1,180);
camera.position.set(13,21,44);
window.lucid?.register({renderer,scene,camera});
window.lucid?.setLoading(true);
function studioEnv(renderer){
 const c=document.createElement('canvas');c.width=256;c.height=128;const ctx=c.getContext('2d');
 const g=ctx.createLinearGradient(0,0,0,128);g.addColorStop(0,'#b2d2e1');g.addColorStop(.38,'#54798a');g.addColorStop(.55,'#35454c');g.addColorStop(.7,'#131b22');g.addColorStop(1,'#070b0f');ctx.fillStyle=g;ctx.fillRect(0,0,256,128);
 const e=new THREE.CanvasTexture(c);e.mapping=THREE.EquirectangularReflectionMapping;
 const p=new THREE.PMREMGenerator(renderer),t=p.fromEquirectangular(e).texture;e.dispose();p.dispose();return t;
}
scene.environment=studioEnv(renderer);scene.environmentIntensity=.65;
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0,4.6,0);controls.enableDamping=true;controls.dampingFactor=.075;controls.enablePan=false;
controls.minPolarAngle=.61;controls.maxPolarAngle=1.24;controls.minZoom=.65;controls.maxZoom=1.8;
controls.rotateSpeed=.5;controls.zoomSpeed=.75;controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;
const moon=new THREE.DirectionalLight('#a9d8ed',4.5);moon.position.set(-18,28,5);moon.castShadow=true;
moon.shadow.mapSize.set(2048,2048);Object.assign(moon.shadow.camera,{left:-23,right:23,top:25,bottom:-23,near:1,far:85});moon.shadow.bias=-.0004;moon.shadow.normalBias=.035;scene.add(moon);
scene.add(new THREE.HemisphereLight('#80a9c2','#171b21',1.4));
const warm=new THREE.DirectionalLight('#f6b968',.65);warm.position.set(3,12,-9);scene.add(warm);
const skyTexture=await new THREE.TextureLoader().loadAsync('./textures/storm-sky.png');skyTexture.colorSpace=THREE.SRGBColorSpace;scene.background=skyTexture;scene.backgroundIntensity=.28;
const tex=await new THREE.TextureLoader().loadAsync('./textures/slate.png');tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=8;tex.repeat.set(.55,.55);
const bump=tex.clone();bump.colorSpace=THREE.NoColorSpace;bump.needsUpdate=true;
const stone=new THREE.MeshStandardMaterial({color:'#b6bdc1',map:tex,bumpMap:bump,bumpScale:.095,roughness:.68,metalness:.13});
const edgeStone=new THREE.MeshStandardMaterial({color:'#c0c5c7',map:tex,bumpMap:bump,bumpScale:.07,roughness:.55,metalness:.17});
const darkStone=new THREE.MeshStandardMaterial({color:'#68757f',map:tex,bumpMap:bump,bumpScale:.08,roughness:.79,metalness:.08});
const floorMat=new THREE.MeshStandardMaterial({color:'#a4b0b6',map:tex,bumpMap:bump,bumpScale:.11,roughnessMap:bump,roughness:.75,metalness:.26});
const iron=new THREE.MeshStandardMaterial({color:'#23292d',metalness:.85,roughness:.36});
const gold=new THREE.MeshStandardMaterial({color:'#bd8847',metalness:.8,roughness:.31});
const emberMat=new THREE.MeshBasicMaterial({color:new THREE.Color(6.0,1.2,.035),toneMapped:true});
const amberMat=new THREE.MeshBasicMaterial({color:new THREE.Color(3.8,.63,.025),toneMapped:true});
const black=new THREE.MeshStandardMaterial({color:'#080f13',roughness:1});
let seed=58123;function rand(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}function between(a,b){return a+(b-a)*rand();}
const unitBox=new THREE.BoxGeometry(1,1,1,2,2,2);
// Subtle planar bevels catch sky and flame light without softening the voxel silhouette.
{const p=unitBox.attributes.position;const n=new THREE.Vector3(),v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);n.set(THREE.MathUtils.clamp(v.x,-.476,.476),THREE.MathUtils.clamp(v.y,-.476,.476),THREE.MathUtils.clamp(v.z,-.476,.476));v.sub(n).normalize().multiplyScalar(.024).add(n);p.setXYZ(i,v.x,v.y,v.z);}unitBox.computeVertexNormals();}
const batches=new Map();const matrix=new THREE.Matrix4();const dummy=new THREE.Object3D();
function box(mat,x,y,z,sx,sy,sz,ry=0,shade=1){
 if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push({x,y,z,sx,sy,sz,ry,shade:shade*between(.84,1.06)});
}
function meshBox(mat,parent,x,y,z,sx,sy,sz){const m=new THREE.Mesh(unitBox,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function masonry(x,z,w,h,d,base=0,mat=stone){
 const course=.29;for(let y=0;y<h-.1;y+=course){const bw=.48;const offset=Math.round(y/course)%2?bw/2:0;
 for(let a=-w/2-offset;a<w/2;a+=bw){const left=Math.max(a,-w/2),right=Math.min(a+bw,w/2);if(right-left<.04)continue;box(mat,x+(left+right)/2,base+y+course/2,z+(rand()-.5)*.018,right-left-.025,Math.min(course-.024,h-y),d,0,between(.75,1.06));}}
}
function pillar(x,z,h=7,w=1.1,base=0){
 box(darkStone,x,base+.15,z,w+1,.3,w+1);box(edgeStone,x,base+.38,z,w+.55,.19,w+.55);
 masonry(x,z,w,h,w,base+.48);
 for(let y=1.35;y<h;y+=2.2){box(edgeStone,x,base+y,z,w+.18,.19,w+.18);}
 box(edgeStone,x,base+h+.55,z,w+.55,.3,w+.55);box(darkStone,x,base+h+.82,z,w+.3,.24,w+.3);
}
function arch(x,z,width,spring,depth=.85,base=0,mat=stone){
 const half=width/2,rad=width,thick=.53,steps=20;
 for(const side of [-1,1]){
   for(let i=0;i<steps;i++){
     const a=Math.PI-i*(Math.PI/3)/steps-.0027,b=Math.PI-(i+1)*(Math.PI/3)/steps+.0027;
     const points=[new THREE.Vector2(half+Math.cos(a)*rad,Math.sin(a)*rad),new THREE.Vector2(half+Math.cos(b)*rad,Math.sin(b)*rad),new THREE.Vector2(half+Math.cos(b)*(rad+thick),Math.sin(b)*(rad+thick)),new THREE.Vector2(half+Math.cos(a)*(rad+thick),Math.sin(a)*(rad+thick))];
     const sh=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x*side,p.y)));
     const g=new THREE.ExtrudeGeometry(sh,{depth,bevelEnabled:false,curveSegments:1,steps:1});
     const m=new THREE.Mesh(g,mat);m.position.set(x,base+spring,z-depth/2);m.castShadow=true;m.receiveShadow=true;staticArches.push(m);
   }
 }
}
const staticArches=[];
// Raised courtyard and its visible, weathered foundation.
box(darkStone,0,-1.05,1,27,2,27);
for(let side of [-1,1])masonry(side*13.25,1,.55,3.8,27,-3.8,darkStone);
for(let row=0;row<38;row++)for(let col=0;col<39;col++){
 const step=.67,x=-12.65+col*step+(row%2)*.22,z=-11+row*step;
 if(rand()<.007&&Math.abs(x)>7)continue;
 const yy=-.045+between(-.025,.008),sx=step-between(.018,.033),sz=step-between(.018,.028);
 box(floorMat,x,yy,z,sx,.15,sz,between(-.007,.007),between(.62,1.1));
}
// Inlaid processional bands across the wet paving.
for(let x of [-4.3,4.3])for(let z=-5;z<11;z+=.55)box(edgeStone,x,.023,z,.12,.035,.49);
const portalBatchStart=new Map([...batches].map(([m,a])=>[m,a.length]));
const portalStandaloneStart=new Set(scene.children);
// Gatehouse — nested stone archivolts, towers and copper-sealed sanctuary.
for(let x of [-4.35,4.35]){
 pillar(x,-8.8,10.1,1.5,.0);masonry(x,-9.6,2.1,10.6,1.2);
 pillar(x+(x<0?-.95:.95),-8.6,7.8,.7);
 box(edgeStone,x,11,-8.8,2.5,.28,2.4);
 for(let h=0;h<5;h++)for(let j=0;j<3;j++){if(rand()<h*.14)continue;box(stone,x-.65+j*.58+between(-.08,.08),11.3+h*.29,-8.8+between(-.12,.12),.53,.27,between(.9,1.4));}
}
for(let layer=0;layer<3;layer++)arch(0,-8.2+layer*.27,6.3-layer*.69,5.2,.6,1.05,layer%2?edgeStone:stone);
for(let side of [-1,1])for(let layer=0;layer<3;layer++)pillar(side*(3.15-layer*.345),-8.2+layer*.27,4.55,.35,1.05);
// Steps make the navigable boundary architectural instead of an invisible wall.
for(let i=0;i<13;i++){box(edgeStone,0,.09+i*.15,-5.35-i*.39,7.7-i*.16,.19,.59);}
// Pointed sanctuary door fills the entire inner archivolt.
const doorShape=new THREE.Shape();doorShape.moveTo(-2.42,1.1);doorShape.lineTo(2.42,1.1);doorShape.lineTo(2.42,6.18);
for(let i=0;i<=16;i++){const a=i/16*Math.PI/3;doorShape.lineTo(-2.42+4.84*Math.cos(a),6.18+4.84*Math.sin(a));}
for(let i=16;i>=0;i--){const a=i/16*Math.PI/3;doorShape.lineTo(2.42-4.84*Math.cos(a),6.18+4.84*Math.sin(a));}doorShape.closePath();
const doorTexture=await new THREE.TextureLoader().loadAsync('./textures/sanctuary-door.png');doorTexture.colorSpace=THREE.SRGBColorSpace;doorTexture.anisotropy=8;
const doorBump=doorTexture.clone();doorBump.colorSpace=THREE.NoColorSpace;doorBump.needsUpdate=true;
const doorMat=new THREE.MeshStandardMaterial({color:'#ffe7c1',emissive:'#ff8f2a',emissiveMap:doorTexture,emissiveIntensity:.65,metalness:.45,roughness:.57,map:doorTexture,bumpMap:doorBump,bumpScale:.09});
const doorGeo=new THREE.ShapeGeometry(doorShape);const doorUV=doorGeo.attributes.uv,doorP=doorGeo.attributes.position;
for(let i=0;i<doorP.count;i++)doorUV.setXY(i,(doorP.getX(i)+2.42)/4.84,(doorP.getY(i)-1.1)/9.3);doorUV.needsUpdate=true;
const door=new THREE.Mesh(doorGeo,doorMat);door.position.z=-8.27;scene.add(door);
// Narrow luminous ribs climb the pointed doors.
for(let side of [-1,1])for(let i=0;i<13;i++){
const a=i/13*Math.PI/3,b=(i+1)/13*Math.PI/3;
const x1=side*(-2.42+4.84*Math.cos(a)),y1=6.18+4.84*Math.sin(a),x2=side*(-2.42+4.84*Math.cos(b)),y2=6.18+4.84*Math.sin(b);
const rib=new THREE.Mesh(unitBox,amberMat);rib.position.set((x1+x2)/2,(y1+y2)/2,-8.2);rib.scale.set(.055,Math.hypot(x2-x1,y2-y1)+.015,.045);rib.rotation.z=-Math.atan2(x2-x1,y2-y1);scene.add(rib);
}
box(black,0,3.64,-8.69,5.0,5.4,.25);
for(let side of [-1,1])box(emberMat,side*2.39,3.75,-8.21,.055,5.2,.07);
box(emberMat,0,5.55,-8.19,.045,8.7,.05);box(emberMat,0,1.13,-8.11,4.9,.075,.13);
// Relief castings sit just proud of the mapped carvings.
box(gold,0,7.15,-8.15,.08,2.4,.055);box(amberMat,0,7.8,-8.13,1.5,.047,.045);
// The sanctuary is a destination within the city, not an oversized screen-filling gate.
for(const [mat,items] of batches){for(let i=portalBatchStart.get(mat)||0;i<items.length;i++){const a=items[i];a.x*=.8;a.sx*=.8;a.y*=.84;a.sy*=.84;}}
for(const m of staticArches){m.position.x*=.8;m.position.y*=.84;m.scale.set(.8,.84,1);}
const portalRoot=new THREE.Group();for(const m of [...scene.children])if(!portalStandaloneStart.has(m))portalRoot.add(m);portalRoot.scale.set(.8,.84,1);scene.add(portalRoot);
// Smaller arcades: open to the immense city behind them.
for(const side of [-1,1]){
 for(let z of (side<0?[-7,-1.8,3.4]:[-7,-1.8]))pillar(side*10.6,z,z===3.4?5.6:6.7,1.0);
 for(let z of (side<0?[-4.4,.8]:[-4.4])){
  // Arcade geometry built in XY then rotated to align down each side.
  const before=staticArches.length;arch(0,0,4.1,4.1,.72,0,stone);
  const g=new THREE.Group();g.rotation.y=Math.PI/2;g.position.set(side*10.6,0,z);g.updateMatrix();
  for(let i=before;i<staticArches.length;i++){const m=staticArches[i];m.updateMatrix();m.geometry.applyMatrix4(m.matrix).applyMatrix4(g.matrix);m.position.set(0,0,0);m.rotation.set(0,0,0);m.updateMatrix();}
 }
 for(let z=-10;z<12;z+=1.05){
  const height=z<5?between(.5,1.0):between(.3,.8);masonry(side*12.1,z,1,height,.98,0,darkStone);
  if(rand()>.55)box(edgeStone,side*12.1,height+.08,z,1.2,.16,1.04);
 }
 for(let z of [7.8,12])pillar(side*11.7,z,1.7,1.0);
}
// Back ruins and jagged wall silhouettes.
for(const side of [-1,1]){
 for(let j=0;j<7;j++){const x=side*(5.8+j*1.04);masonry(x,-10.4,1,between(2.1,5.8),.85);}
}
// Half-fallen buttresses frame the near view without hiding the knight.
for(let side of [-1,1])for(let i=0;i<20;i++){
 const x=side*between(9.7,12.4),z=between(10.6,15),h=between(.18,.65);box(stone,x,h*.5,z,between(.2,.8),h,between(.2,.9),between(-.4,.4));
}
for(let k=0;k<6;k++)masonry(-11.4+k*.38,12.8,.36,between(2.1,4.1),.75);
// Debris deliberately kept outside the movement area.
for(let i=0;i<190;i++){
 const side=rand()>.5?1:-1,x=side*between(8.7,12),z=between(-10,11.5),s=between(.17,.6);
 box(rand()>.7?edgeStone:stone,x,s*.4,z,s*between(1,1.8),s,s*between(.6,1.3),between(-1,1));
}
for(let i=0;i<100;i++){const side=i%2?1:-1,x=side*between(7.9,12.2),z=between(-8,12),sz=between(.035,.14);box(darkStone,x,.03,z,sz,.055,sz*1.4,rand()*4);}
// An inhabited abyss: cathedral districts descend through three layers of cliffs.
function tower(x,z,w,h,base=-20){
 box(darkStone,x,base+h/2,z,w,h,w);
 for(let y=1;y<h-1;y+=2.4)box(stone,x,base+y,z,w+.2,.13,w+.2);
 for(let sx of [-1,1])for(let sz of [-1,1]){
  box(stone,x+sx*w*.46,base+h*.48,z+sz*w*.46,.27,h*.96,.27);
  for(let j=0;j<12;j++){const ww=.6*(1-j/13);box(darkStone,x+sx*w*.46,base+h+j*.2,z+sz*w*.46,ww,.21,ww);}
 }
 // Paired lancet windows and recessed mullions, front and both side elevations.
 for(let y=2;y<h-2;y+=3.1)for(let side of [-1,1]){
  const yy=base+y,xx=x+side*w*.23;
  box(black,xx,yy,z+w/2+.02,w*.22,1.9,.055);
  if(rand()>.32){box(amberMat,xx-w*.045,yy,z+w/2+.055,.07,1.6,.025);box(amberMat,xx+w*.045,yy,z+w/2+.055,.07,1.6,.025);}
  box(stone,xx,yy+1.03,z+w/2+.09,w*.25,.14,.19);
  for(let xs of [-1,1]){box(black,x+xs*(w/2+.015),yy,z+side*w*.22,.05,1.8,w*.2);if(rand()>.53)box(amberMat,x+xs*(w/2+.045),yy,z+side*w*.22,.025,1.55,.08);}
 }
 const roofH=w*2.5;for(let j=0;j<26;j++){const f=Math.pow(1-j/27,1.4);box(darkStone,x,base+h+j*roofH/26,z,w*f,roofH/26+.015,w*f);}
 box(iron,x,base+h+roofH+.5,z,.09,1.7,.09);
}
for(let layer=2;layer>=0;layer--){
 const z=-24-layer*15,base=-8-layer*5.8;
 for(let i=-12;i<=12;i++){
  const x=i*(3.6-layer*.35)+between(-.55,.55),w=between(1.35,2.6)*(1-layer*.17),h=between(6.5,13.5)*(1-layer*.12);
  tower(x,z+between(-2,2),w,h,base+between(-1,1));
  if(i%3===0){tower(x+1.6,z-2,w*.55,h*.8,base);box(darkStone,x,base+2,z,3.7,4,4);}
 }
}
// Two recognizable distant cathedrals, their naves and buttresses bridging small spires.
for(let x of [-23,20]){
 tower(x,-31,3.6,16,-12);tower(x+5.2,-32,2.9,14,-12);
 box(darkStone,x+2.3,-6,-32,7,9,5);
 for(let j=0;j<17;j++)box(darkStone,x+2.3,-1+j*.22,-32,7-j*.36,.24,5);
 for(let i=0;i<5;i++){box(stone,x-.5+i*1.35,-5,-29.4,.25,10,.5);box(amberMat,x-.1+i*1.35,-3,-29.45,.09,2.8,.04);}
}
// Long arched viaducts cross the chasm behind the courtyard.
for(let depth=0;depth<2;depth++){
 const zz=-21-depth*20,yy=-9-depth*8;
 for(let i=-7;i<=7;i++){
  const xx=i*4.5;box(stone,xx,yy,zz,4.6,.6,1.8);box(darkStone,xx,yy-4.5,zz,.85,9,1.5);
  for(let j=0;j<5;j++){box(darkStone,xx+.65+j*.65,yy-.55-Math.abs(j-2)*.28,zz,.69,.58,1.4);}
  for(let j=0;j<3;j++)box(stone,xx-1.6+j*1.55,yy+.48,zz,.55,.65,1.9);
 }
}
// The courtyard sits on a colossal ruin; no isolated tabletop edge.
box(darkStone,0,-5,5,28,8,38);
for(let row=14;row<29;row++)for(let col=0;col<26;col++)box(floorMat,-12.5+col+(row%2)*.34,-.05,row,.97,.13,.98,0,between(.65,1.02));
for(let side of [-1,1]){
 for(let z=14;z<27;z+=1.0)masonry(side*12.1,z,1,between(.3,.9),.96,0,darkStone);
 // Cropped broken framing towers and torn standards.
 pillar(side*10.5,13.5,side<0?5.8:3.2,1.65);
 for(let j=0;j<8;j++)masonry(side*(3.6+j*1.1),12.9,1.04,between(.35,1.0),.8);
}
// Jagged cliff faces extend below the arches rather than terminating as a slab.
const cliffGeo=new THREE.DodecahedronGeometry(1,0),cliffMat=new THREE.MeshStandardMaterial({color:'#273740',map:tex,roughness:.96,flatShading:true});
const cliffs=new THREE.InstancedMesh(cliffGeo,cliffMat,75);for(let i=0;i<75;i++){const side=i%2?1:-1;dummy.position.set(side*between(14,36),between(-26,-13),between(-41,20));dummy.scale.set(between(2,5),between(5,14),between(3,7));dummy.rotation.set(rand(),rand(),rand());dummy.updateMatrix();cliffs.setMatrixAt(i,dummy.matrix);}cliffs.receiveShadow=true;scene.add(cliffs);

// Iron braziers, lit embers and fire with independent lapping tongues.
const flames=[],fireLights=[];
const flameGeometry=new THREE.ConeGeometry(.14,.8,5,2);
function brazier(x,z){
 masonry(x,z,1.03,1.68,1.03);box(edgeStone,x,1.71,z,1.25,.18,1.25);box(iron,x,1.84,z,1.12,.14,1.12);
 for(let s of [-1,1]){box(iron,x+s*.46,2.03,z,.08,.38,1.05);box(iron,x,2.03,z+s*.46,1.05,.38,.08);}
 box(emberMat,x,1.97,z,.83,.12,.83);
 for(let i=0;i<7;i++){
  const m=new THREE.Mesh(flameGeometry,i%3===0?emberMat:amberMat);m.position.set(x+between(-.3,.3),2.3+between(0,.18),z+between(-.3,.3));m.userData={phase:between(0,6.3),base:m.position.y};scene.add(m);flames.push(m);
 }
 const l=new THREE.PointLight('#ff992f',100,13,2);l.position.set(x,2.7,z);scene.add(l);fireLights.push(l);
}
for(let x of [-8.1,8.1])for(let z of [-5.6,4.1])brazier(x,z);
// Soft additive halos give actual luminous volume to the flame geometry.
const haloMaterial = new THREE.ShaderMaterial({uniforms:{color:{value:new THREE.Color('#ff771c')}},transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,
 vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`uniform vec3 color;varying vec2 vUv;void main(){float d=length((vUv-.5)*2.);float a=pow(max(0.,1.-d),3.);gl_FragColor=vec4(color,a*.45);}`});
const halos=[];for(const l of fireLights){const h=new THREE.Mesh(new THREE.PlaneGeometry(3.2,3.7),haloMaterial);h.position.copy(l.position);scene.add(h);halos.push(h);}
const gateLight=new THREE.PointLight('#ff861e',140,14,2);gateLight.position.set(0,1.5,-6.9);scene.add(gateLight);const crownLight=new THREE.PointLight('#ff9d42',45,8,2);crownLight.position.set(0,6.3,-7.1);scene.add(crownLight);
// Weathered crimson standards, locally articulated strips.
const bannerTexture=await new THREE.TextureLoader().loadAsync('./textures/heraldic-cloth.png');bannerTexture.colorSpace=THREE.SRGBColorSpace;bannerTexture.anisotropy=8;
const cloth=new THREE.MeshStandardMaterial({color:'#cab8b4',map:bannerTexture,roughness:.92,side:THREE.DoubleSide});
const flags=[];
function flag(x,y,z,width=1.25,height=3.3){
 box(iron,x,y+.11,z,width+.6,.09,.09);
 const geo=new THREE.PlaneGeometry(width,height,5,12);const pos=geo.attributes.position;const bases=new Float32Array(pos.array);
 for(let i=0;i<pos.count;i++){if(bases[i*3+1]<-height*.4)bases[i*3+1]+=.25*Math.cos(bases[i*3]*9);}
 const m=new THREE.Mesh(geo,cloth);m.position.set(x,y-height/2,z+.03);m.userData={base:bases,width,height,phase:rand()*6};m.castShadow=true;scene.add(m);flags.push(m);
 // A small cross mounted on the cloth front; remains legible at default distance.
 const cross=new THREE.Group();meshBox(gold,cross,0,0,.06,.075,1.16,.025);meshBox(gold,cross,0,.19,.06,.59,.075,.025);for(let side of [-1,1]){meshBox(gold,cross,side*.26,.23,.06,.06,.26,.025);meshBox(gold,cross,side*.15,-.25,.06,.07,.27,.025);meshBox(gold,cross,side*.1,.49,.06,.25,.06,.025);}cross.visible=false;m.add(cross);
}
flag(-10.5,5.9,14.2,1.7,4.1);
flag(-4.35,9.5,-7.88,1.18,4.3);flag(4.35,9.5,-7.88,1.18,4.3);flag(-10.5,5.7,3.95,1.4,3.15);flag(10.5,6.5,-1.4,1.4,3.7);
// Wind-stirred tufts grow out of the damp joints.
const statueLight=new THREE.PointLight('#b5c7cf',19,8,2);statueLight.position.set(-8.5,4.4,-.5);scene.add(statueLight);
const grassMat=new THREE.MeshStandardMaterial({color:'#878263',roughness:.94,side:THREE.DoubleSide});
const grassPositions=[],grassColors=[];const grassTime={value:0};
for(let i=0;i<250;i++){
 const side=rand()>.5?1:-1,x=side*between(8.5,12.3),z=between(-10,14);
 for(let j=0;j<9;j++){
  const a=rand()*Math.PI*2,h=between(.16,.65),lean=between(.04,.26),w=between(.025,.055),xx=x+between(-.2,.2),zz=z+between(-.2,.2);
  grassPositions.push(xx-Math.cos(a)*w,0,zz-Math.sin(a)*w,xx+Math.cos(a)*w,0,zz+Math.sin(a)*w,xx+Math.sin(a)*lean,h,zz+Math.cos(a)*lean);
  const shade=between(.65,1.2);for(let k=0;k<3;k++)grassColors.push(shade,shade,shade*.92);
 }
}
const grassGeo=new THREE.BufferGeometry();grassGeo.setAttribute('position',new THREE.Float32BufferAttribute(grassPositions,3));grassGeo.setAttribute('color',new THREE.Float32BufferAttribute(grassColors,3));grassGeo.computeVertexNormals();grassMat.vertexColors=true;
grassMat.onBeforeCompile=shader=>{shader.uniforms.windTime=grassTime;shader.vertexShader='uniform float windTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n transformed.x += sin(windTime*1.7+position.x*2.0+position.z)*position.y*.10;');};
const grasses=new THREE.Mesh(grassGeo,grassMat);scene.add(grasses);
// Fine cracks and chips break the precision of the paving.
const cracks=[];for(let i=0;i<135;i++){let x=between(-11.5,11.5),z=between(-5,12),a=rand()*6.28;for(let j=0;j<3;j++){const nx=x+Math.cos(a)*between(.08,.24),nz=z+Math.sin(a)*between(.08,.24);cracks.push(x,.055,z,nx,.055,nz);x=nx;z=nz;a+=between(-.7,.7);}}
const crackGeo=new THREE.BufferGeometry();crackGeo.setAttribute('position',new THREE.Float32BufferAttribute(cracks,3));scene.add(new THREE.LineSegments(crackGeo,new THREE.LineBasicMaterial({color:'#0e161b',transparent:true,opacity:.5})));

// Hooded stone saints under the western arcade.
for(let z of [-4.4,.8]){
 const x=-9.65;box(edgeStone,x,.17,z,1.42,.34,1.42);
 for(let j=0;j<6;j++){const w=.9-j*.055;box(stone,x,.43+j*.24,z,w,.26,.68);}
 box(stone,x,2.0,z,1.03,.85,.67);box(darkStone,x,2.49,z,.7,.35,.63);
 box(stone,x,2.85,z-.025,.65,.65,.61);box(stone,x,3.21,z-.09,.45,.21,.45);
 box(black,x,2.85,z+.29,.35,.37,.035);
 for(let side of [-1,1]){box(edgeStone,x+side*.26,2.86,z+.29,.12,.64,.16);box(stone,x+side*.46,1.99,z+.12,.22,.78,.35);box(edgeStone,x+side*.26,1.75,z+.39,.34,.19,.24);}
 for(let j=-2;j<=2;j++)box(edgeStone,x+j*.14,1.05,z+.335,.046,1.31,.04);
 box(iron,x,1.2,z+.48,.085,2.3,.09);
}
// Votive candles nestled among the gate rubble.
const wax=new THREE.MeshStandardMaterial({color:'#b2a17c',roughness:.85});
for(let i=0;i<24;i++){const side=i%2?1:-1,x=side*between(4.2,5.9),z=between(-7.4,-5.0),h=between(.15,.48);box(wax,x,h*.5+.05,z,.075,h,.075);box(emberMat,x,h+.1,z,.032,.11,.032);}
// Flush every repeated cube into one draw per material.
for(const [mat,items] of batches){
 const m=new THREE.InstancedMesh(unitBox,mat,items.length);m.castShadow=true;m.receiveShadow=true;
 const c=new THREE.Color();items.forEach((v,i)=>{dummy.position.set(v.x,v.y,v.z);dummy.scale.set(v.sx,v.sy,v.sz);dummy.rotation.set(0,v.ry,0);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);c.setRGB(v.shade,v.shade,v.shade);m.setColorAt(i,c);});m.instanceMatrix.needsUpdate=true;scene.add(m);
}
// Arches merged by material for the same reason as the blocks.
const {mergeGeometries}=await import('three/addons/utils/BufferGeometryUtils.js');
const archBatches=new Map();for(const m of staticArches){m.updateMatrix();const g=m.geometry.clone().applyMatrix4(m.matrix);if(!archBatches.has(m.material))archBatches.set(m.material,[]);archBatches.get(m.material).push(g);m.geometry.dispose();}
for(const [mat,gs] of archBatches){const m=new THREE.Mesh(mergeGeometries(gs),mat);m.castShadow=m.receiveShadow=true;scene.add(m);gs.forEach(g=>g.dispose());}

// The pilgrim: block silhouette with separate hips, knees and pauldrons.
const knight=new THREE.Group();knight.position.set(0,.06,5.0);knight.rotation.y=Math.PI;knight.scale.setScalar(1.13);scene.add(knight);
const armor=new THREE.MeshStandardMaterial({color:'#9aaab4',metalness:.87,roughness:.28});
const armorDark=new THREE.MeshStandardMaterial({color:'#303c44',metalness:.79,roughness:.38});
const leather=new THREE.MeshStandardMaterial({color:'#242025',roughness:.86});
const crimson=new THREE.MeshStandardMaterial({color:'#e0bec0',map:bannerTexture,roughness:.86,side:THREE.DoubleSide});
const torso=new THREE.Group();torso.position.y=1.08;knight.add(torso);
meshBox(armor,torso,0,.14,0,.58,.61,.36);meshBox(armorDark,torso,0,-.17,0,.48,.19,.38);
meshBox(gold,torso,0,-.12,.2,.13,.14,.05);meshBox(armorDark,torso,0,.38,0,.32,.12,.31);
const head=new THREE.Group();head.position.y=.64;torso.add(head);
meshBox(armor,head,0,0,0,.38,.4,.37);meshBox(armorDark,head,0,-.16,.03,.36,.1,.37);
meshBox(black,head,0,.025,.19,.32,.055,.018);meshBox(gold,head,0,.05,.212,.045,.29,.035);
meshBox(armor,head,0,.23,-.04,.13,.1,.33);
const legs=[];for(let side of [-1,1]){
 const leg=new THREE.Group();leg.position.set(side*.16,.83,0);knight.add(leg);legs.push(leg);
 meshBox(leather,leg,0,-.18,0,.21,.35,.23);meshBox(armor,leg,0,-.38,.055,.25,.18,.25);meshBox(armorDark,leg,0,-.59,0,.2,.31,.23);meshBox(iron,leg,0,-.75,.1,.25,.16,.4);
}
const arms=[];for(let side of [-1,1]){
 const arm=new THREE.Group();arm.position.set(side*.4,.32,0);torso.add(arm);arms.push(arm);
 meshBox(armor,arm,0,-.03,0,.31,.26,.4);meshBox(gold,arm,side*.07,.055,0,.2,.05,.42);
 meshBox(armorDark,arm,0,-.27,0,.2,.32,.23);meshBox(armor,arm,0,-.47,.04,.22,.25,.25);meshBox(leather,arm,0,-.65,.035,.17,.13,.18);
}
const sword=new THREE.Group();arms[1].add(sword);sword.position.set(.03,-.66,.04);sword.rotation.x=-.4;sword.rotation.z=-.27;
meshBox(leather,sword,0,-.08,0,.07,.27,.07);meshBox(gold,sword,0,-.15,0,.37,.06,.095);meshBox(armor,sword,0,-.43,0,.11,.55,.055);meshBox(edgeStone,sword,0,-.74,0,.065,.1,.045);
const capeGeo=new THREE.PlaneGeometry(.88,1.26,6,9);const capeBase=new Float32Array(capeGeo.attributes.position.array);for(let i=0;i<capeGeo.attributes.position.count;i++){const y=capeBase[i*3+1];capeBase[i*3]*=.67+(.63-y)/1.26*.55;if(y<-.5)capeBase[i*3+1]+=.10*Math.sin(capeBase[i*3]*23);} 
const cape=new THREE.Mesh(capeGeo,crimson);cape.position.set(0,.015,-.26);cape.rotation.y=Math.PI;cape.castShadow=true;torso.add(cape);
const capeCross=new THREE.Group();meshBox(gold,capeCross,0,.17,.035,.07,.64,.025);meshBox(gold,capeCross,0,.29,.035,.37,.055,.025);capeCross.visible=false;cape.add(capeCross);
// Ground contact beneath the feet (no opaque circular player marker).
const contact=new THREE.Mesh(new THREE.CircleGeometry(.56,24),new THREE.MeshBasicMaterial({color:'#060a0e',transparent:true,opacity:.25,depthWrite:false}));contact.rotation.x=-Math.PI/2;contact.position.y=.049;scene.add(contact);

// True planar reflection. Reflection camera and projected texture follow all camera movement.
const reflTarget=new THREE.WebGLRenderTarget(1024,768,{type:THREE.HalfFloatType,depthBuffer:true});
const mirrorCamera=camera.clone();const textureMatrix=new THREE.Matrix4();const biasMatrix=new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);
const waterUniforms={tReflection:{value:reflTarget.texture},textureMatrix:{value:textureMatrix},time:{value:0},stoneMap:{value:bump}};
const waterMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:waterUniforms,
 vertexShader:`uniform mat4 textureMatrix; varying vec4 vProj; varying vec3 vWorld; void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;vProj=textureMatrix*w;gl_Position=projectionMatrix*viewMatrix*w;}`,
 fragmentShader:`uniform sampler2D tReflection;uniform sampler2D stoneMap;uniform float time;varying vec4 vProj;varying vec3 vWorld;
 void main(){vec2 p=vWorld.xz; vec2 uv=vProj.xy/vProj.w;
 float wave=sin(p.x*8.2+p.y*4.9+time*1.5)*sin(p.y*9.1-p.x*2.2-time*1.8);
 float fine=texture2D(stoneMap,p*.47).r;float dx=texture2D(stoneMap,p*.47+vec2(.008,0)).r-fine;float dy=texture2D(stoneMap,p*.47+vec2(0,.008)).r-fine;uv+=vec2(wave*.00055,0.)+vec2(dx,dy)*.018;
 vec3 reflected=texture2D(tReflection,uv).rgb;
 float pool=sin(p.x*.43+sin(p.y*.57))*sin(p.y*.38-p.x*.16)+sin(p.y*.91+p.x*.27)*.3;
 float wet=smoothstep(.29,.48,fine+pool*.11);float seams=step(.955,fract(p.x+.5))* .25+step(.955,fract(p.y+.5))*.25;
 float alpha=(.10+wet*.43)*(1.-seams)*(.68+fine*.6);gl_FragColor=vec4(reflected,alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
const water=new THREE.Mesh(new THREE.PlaneGeometry(25.4,25),waterMat);water.rotation.x=-Math.PI/2;water.position.set(0,.041,1);scene.add(water);
// Rain is a single line draw; wind keeps it from looking like a static overlay.
const rainCount=1500,rainPositions=new Float32Array(rainCount*6),rainData=[];
for(let i=0;i<rainCount;i++)rainData.push([between(-25,25),between(0,22),between(-22,23),between(.2,.48)]);
const rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
const rain=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:'#aac4d1',transparent:true,opacity:.16,depthWrite:false}));rain.frustumCulled=false;scene.add(rain);
// Fire sparks, each with an independent phase and drift.
const sparksN=160,sparkData=[],sparkPos=new Float32Array(sparksN*3);
for(let i=0;i<sparksN;i++)sparkData.push({fire:i%fireLights.length,phase:rand(),r:between(.12,.7),speed:between(.16,.35)});
const sparkGeo=new THREE.BufferGeometry();sparkGeo.setAttribute('position',new THREE.BufferAttribute(sparkPos,3));
const sparks=new THREE.Points(sparkGeo,new THREE.PointsMaterial({color:'#ffc16a',size:.065,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));sparks.frustumCulled=false;scene.add(sparks);
// Expanding ring ripples in the standing water.
const rippleMat=new THREE.MeshBasicMaterial({color:'#b0c4ce',transparent:true,opacity:.1,depthWrite:false,side:THREE.DoubleSide});
const ripples=[];for(let i=0;i<28;i++){const m=new THREE.Mesh(new THREE.RingGeometry(.92,1,24),rippleMat.clone());m.rotation.x=-Math.PI/2;m.position.set(between(-9,9),.052,between(-4,11));m.userData.phase=rand();scene.add(m);ripples.push(m);}
// Distant ravens circle above the broken viaduct, with independent wingbeats.
const ravens=[];const birdMat=new THREE.MeshBasicMaterial({color:'#10191e'});
const wingShape=new THREE.Shape([new THREE.Vector2(0,0),new THREE.Vector2(.65,.05),new THREE.Vector2(.43,.22),new THREE.Vector2(.1,.12)]);
const wingGeo=new THREE.ShapeGeometry(wingShape);
for(let i=0;i<9;i++){const b=new THREE.Group();const wings=[];for(let side of [-1,1]){const w=new THREE.Mesh(wingGeo,birdMat);w.scale.x=side;w.rotation.x=-Math.PI/2;b.add(w);wings.push(w);}b.userData={phase:rand()*6.28,radius:between(8,18),height:between(4,9),wings};scene.add(b);ravens.push(b);}
// Click target is transient; never a gameplay reticle.
const marker=new THREE.Mesh(new THREE.RingGeometry(.28,.31,36),new THREE.MeshBasicMaterial({color:'#dfbd7e',transparent:true,opacity:0,depthWrite:false}));marker.rotation.x=-Math.PI/2;marker.position.y=.055;scene.add(marker);

// Navigation: bounded walkable polygon, obstacle-aware A* and smoothed waypoints.
const obstacles=[...fireLights.map(l=>({x:l.position.x,z:l.position.z,r:1.08}))];
const bounds={minX:-8.25,maxX:8.25,minZ:-4.4,maxZ:10.8};
function walkable(x,z){return x>=bounds.minX&&x<=bounds.maxX&&z>=bounds.minZ&&z<=bounds.maxZ&&!obstacles.some(o=>(x-o.x)**2+(z-o.z)**2<(o.r+.26)**2);}
function segmentClear(a,b){const d=a.distanceTo(b),n=Math.ceil(d/.2);for(let i=0;i<=n;i++){const t=i/Math.max(n,1);if(!walkable(THREE.MathUtils.lerp(a.x,b.x,t),THREE.MathUtils.lerp(a.z,b.z,t)))return false;}return true;}
function route(start,end){
 if(segmentClear(start,end))return [end];
 const step=.45,offsetX=-8.1,offsetZ=-4.3,nx=37,nz=34;
 const cell=p=>[THREE.MathUtils.clamp(Math.round((p.x-offsetX)/step),0,nx-1),THREE.MathUtils.clamp(Math.round((p.z-offsetZ)/step),0,nz-1)];
 const [sx,sz]=cell(start),[ex,ez]=cell(end),id=(x,z)=>z*nx+x,goal=id(ex,ez);
 const open=[id(sx,sz)],came=new Map(),g=new Map([[open[0],0]]),closed=new Set();
 let found=false;
 while(open.length){open.sort((a,b)=>(g.get(a)+Math.hypot(a%nx-ex,Math.floor(a/nx)-ez))-(g.get(b)+Math.hypot(b%nx-ex,Math.floor(b/nx)-ez)));const cur=open.shift();if(cur===goal){found=true;break;}closed.add(cur);const x=cur%nx,z=Math.floor(cur/nx);
 for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dz)continue;const xx=x+dx,zz=z+dz,k=id(xx,zz);if(xx<0||zz<0||xx>=nx||zz>=nz||closed.has(k)||!walkable(offsetX+xx*step,offsetZ+zz*step))continue;
 if(dx&&dz&&(!walkable(offsetX+x*step,offsetZ+zz*step)||!walkable(offsetX+xx*step,offsetZ+z*step)))continue;
 const cost=g.get(cur)+Math.hypot(dx,dz);if(cost<(g.get(k)??Infinity)){came.set(k,cur);g.set(k,cost);if(!open.includes(k))open.push(k);}}
 }
 if(!found)return [];
 const raw=[end];let k=goal;while(came.has(k)){raw.push(new THREE.Vector3(offsetX+(k%nx)*step,.06,offsetZ+Math.floor(k/nx)*step));k=came.get(k);}raw.reverse();
 const smooth=[];let current=start;for(let i=0;i<raw.length;){let j=raw.length-1;while(j>i&&!segmentClear(current,raw[j]))j--;smooth.push(raw[j]);current=raw[j];i=j+1;}return smooth;
}
let path=[],markerLife=0,moving=0,walkPhase=0;const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-.06),hit=new THREE.Vector3();
let down=null;renderer.domElement.addEventListener('pointerdown',e=>{if(e.button===0)down={x:e.clientX,y:e.clientY,t:performance.now(),dragged:false};});
renderer.domElement.addEventListener('pointermove',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)down.dragged=true;});
renderer.domElement.addEventListener('pointercancel',()=>{down=null;});
renderer.domElement.addEventListener('pointerup',e=>{
 if(!down)return;const distance=Math.hypot(e.clientX-down.x,e.clientY-down.y),dragged=down.dragged;down=null;if(distance>6||dragged)return;
 const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
 if(!ray.ray.intersectPlane(plane,hit))return;
 hit.x=THREE.MathUtils.clamp(hit.x,bounds.minX+.1,bounds.maxX-.1);hit.z=THREE.MathUtils.clamp(hit.z,bounds.minZ+.1,bounds.maxZ-.1);
 for(const o of obstacles){let dx=hit.x-o.x,dz=hit.z-o.z,d=Math.hypot(dx,dz);if(d<o.r+.4){if(d<.001){dx=1;dz=0;d=1;}hit.x=o.x+dx/d*(o.r+.42);hit.z=o.z+dz/d*(o.r+.42);}}
 if(!walkable(hit.x,hit.z))return;path=route(knight.position.clone(),hit.clone());marker.position.set(hit.x,.056,hit.z);markerLife=1;
});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('keydown',e=>{if(e.code==='KeyR'){path=[];knight.position.set(0,.06,5);knight.rotation.y=Math.PI;controls.target.set(0,4.6,0);camera.position.set(13,21,44);camera.zoom=1;camera.updateProjectionMatrix();}if(e.code==='KeyH')document.querySelector('.hud').classList.toggle('hidden');});
function resize(){const a=innerWidth/innerHeight;camera.left=-viewSize*a/2;camera.right=viewSize*a/2;camera.top=viewSize/2;camera.bottom=-viewSize/2;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);reflTarget.setSize(Math.min(1280,Math.round(innerWidth)),Math.min(1024,Math.round(innerHeight)));}
window.addEventListener('resize',resize);resize();
const reflectedTarget=new THREE.Vector3(),followTarget=new THREE.Vector3(),followDelta=new THREE.Vector3();const clipPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-.07);
let last=performance.now(),elapsed=0,frame=0,fpsTime=0,fpsFrames=0,measuredFps=0;
const fpsNode=document.querySelector('#fps');
window.demo={scene,camera,renderer,knight,controls,walkable,route,get state(){return {position:knight.position.toArray(),waypoints:path.map(p=>p.toArray()),zoom:camera.zoom,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,renderFps:measuredFps};}};
window.lucid?.setLoading(false);
renderer.setAnimationLoop(()=>{
 const now=performance.now(),dt=Math.min((now-last)/1000,.05);const rawDt=(now-last)/1000;last=now;elapsed+=dt;frame++;fpsTime+=rawDt;fpsFrames++;
 if(fpsTime>.6){measuredFps=fpsFrames/fpsTime;fpsNode.textContent=Math.round(measuredFps)+' FPS';fpsTime=0;fpsFrames=0;}
 const target=path[0];let actualMove=false;
 if(target){const dx=target.x-knight.position.x,dz=target.z-knight.position.z,d=Math.hypot(dx,dz);if(d<.08)path.shift();else{const dist=Math.min(d,dt*2.65);knight.position.x+=dx/d*dist;knight.position.z+=dz/d*dist;const a=Math.atan2(dx,dz);knight.rotation.y+=Math.atan2(Math.sin(a-knight.rotation.y),Math.cos(a-knight.rotation.y))*(1-Math.exp(-dt*12));actualMove=true;}}
 moving=THREE.MathUtils.damp(moving,actualMove?1:0,9,dt);walkPhase+=dt*(actualMove?9:2);
 legs.forEach((l,i)=>l.rotation.x=Math.sin(walkPhase+i*Math.PI)*.57*moving);
 arms.forEach((a,i)=>a.rotation.x=Math.sin(walkPhase+i*Math.PI+Math.PI)*.36*moving);
 torso.position.y=1.08+Math.sin(walkPhase*2)*.035*moving+Math.sin(elapsed*2)*.013;
 const cp=capeGeo.attributes.position;for(let i=0;i<cp.count;i++){const x=capeBase[i*3],y=capeBase[i*3+1],weight=(.59-y)/1.18;cp.setXYZ(i,x+Math.sin(elapsed*3+y*3)*.025*weight,y,Math.sin(x*6+elapsed*3.5+y*3)*.07*weight+weight*weight*(.18+moving*.22));}cp.needsUpdate=true;capeGeo.computeVertexNormals();
 contact.position.x=knight.position.x;contact.position.z=knight.position.z;
 followTarget.set(knight.position.x*.58,4.6,knight.position.z*.48-2.4);followDelta.copy(followTarget).sub(controls.target).multiplyScalar(1-Math.exp(-dt*1.8));camera.position.add(followDelta);controls.target.add(followDelta);controls.update();
 flags.forEach(f=>{const p=f.geometry.attributes.position,b=f.userData.base;for(let i=0;i<p.count;i++){const w=(f.userData.height*.5-b[i*3+1])/f.userData.height;p.setXYZ(i,b[i*3],b[i*3+1],Math.sin(elapsed*2.1+b[i*3+1]*1.4+f.userData.phase)*.17*w+Math.sin(b[i*3]*7+elapsed*2)*.085*(.2+w));}p.needsUpdate=true;f.geometry.computeVertexNormals();});
 halos.forEach(h=>h.quaternion.copy(camera.quaternion));
 flames.forEach((m,i)=>{const p=m.userData.phase;m.scale.set(.7+Math.sin(elapsed*9+p)*.3,.7+Math.sin(elapsed*11+p)*.45,1);m.rotation.z=Math.sin(elapsed*7+p)*.2;m.position.y=m.userData.base+Math.sin(elapsed*8+p)*.12;});
 gateLight.intensity=140*(.96+.025*Math.sin(elapsed*2.5)+.015*Math.sin(elapsed*6));
 fireLights.forEach((l,i)=>l.intensity=100*(.94+.06*Math.sin(elapsed*9+i*2)+.035*Math.sin(elapsed*16+i)));
 for(let i=0;i<rainCount;i++){const r=rainData[i];r[1]-=dt*13;if(r[1]<0)r[1]=22;const ix=i*6;rainPositions[ix]=r[0]+Math.sin(elapsed*.12)*.6;rainPositions[ix+1]=r[1];rainPositions[ix+2]=r[2];rainPositions[ix+3]=rainPositions[ix]-.07;rainPositions[ix+4]=r[1]+r[3];rainPositions[ix+5]=r[2]-.035;}rainGeo.attributes.position.needsUpdate=true;
 for(let i=0;i<sparksN;i++){const s=sparkData[i],p=fireLights[s.fire].position,life=(elapsed*s.speed+s.phase)%1;sparkPos[i*3]=p.x+Math.sin(life*5+i)*s.r+life*.35;sparkPos[i*3+1]=2.25+life*3;sparkPos[i*3+2]=p.z+Math.cos(life*4+i)*s.r;}sparkGeo.attributes.position.needsUpdate=true;
 ripples.forEach((m,i)=>{const p=(elapsed*.6+m.userData.phase)%1;m.scale.setScalar(.08+p*.4);m.material.opacity=(1-p)*.11;});
 markerLife=Math.max(0,markerLife-dt*.65);marker.material.opacity=markerLife*.8;marker.scale.setScalar(1+(1-markerLife)*.4);
 waterUniforms.time.value=elapsed;grassTime.value=elapsed;
 ravens.forEach((b,i)=>{const a=elapsed*.075+b.userData.phase;b.position.set(Math.cos(a)*b.userData.radius,b.userData.height+Math.sin(a*3)*.5,-19+Math.sin(a)*6);b.rotation.y=-a;b.userData.wings.forEach((w,j)=>w.rotation.y=Math.sin(elapsed*6+i*3)*.4*(j?1:-1));});
 // Reflection pass excludes rain and water, clips all underfloor geometry.
 mirrorCamera.copy(camera);mirrorCamera.position.y=.082-camera.position.y;mirrorCamera.up.set(0,-1,0);reflectedTarget.copy(controls.target);reflectedTarget.y=.082-reflectedTarget.y;mirrorCamera.lookAt(reflectedTarget);mirrorCamera.updateMatrixWorld();
 textureMatrix.copy(biasMatrix).multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);
 water.visible=false;rain.visible=false;contact.visible=false;renderer.clippingPlanes=[clipPlane];
 const oldShadow=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;renderer.setRenderTarget(reflTarget);renderer.render(scene,mirrorCamera);renderer.setRenderTarget(null);renderer.shadowMap.autoUpdate=oldShadow;renderer.clippingPlanes=[];water.visible=true;rain.visible=true;contact.visible=true;
 renderer.render(scene,camera);
});


