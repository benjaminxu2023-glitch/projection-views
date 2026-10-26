// Geometry catalogue: every entry creates its own indexed surface mesh.
const Geometry=(()=>{
const catalogue=[];
const entry=(id,name,group,build)=>catalogue.push({id,name,group,build});
const polygon=(n,r=1,phase=0)=>Array.from({length:n},(_,i)=>[r*Math.cos(2*Math.PI*i/n+phase),r*Math.sin(2*Math.PI*i/n+phase)]);
function extrude(poly,h=1.7,topScale=1,twist=0){const n=poly.length,v=poly.map(p=>[...p,0]);poly.forEach(([x,y])=>v.push([topScale*(x*Math.cos(twist)-y*Math.sin(twist)),topScale*(x*Math.sin(twist)+y*Math.cos(twist)),h]));const f=[Array.from({length:n},(_,i)=>n-1-i),Array.from({length:n},(_,i)=>i+n)];for(let i=0;i<n;i++)f.push([i,(i+1)%n,(i+1)%n+n,i+n]);return {v,f}}
function apex(n,bipyramid=false){let v=polygon(n).map(p=>[...p,bipyramid?1:0]);v.push([0,0,2]);let f=[];for(let i=0;i<n;i++)f.push([i,(i+1)%n,n]);if(bipyramid){v.push([0,0,0]);for(let i=0;i<n;i++)f.push([(i+1)%n,i,n+1])}else f.push(Array.from({length:n},(_,i)=>n-1-i));return {v,f}}
function revolve(profile,n=40){let v=[],f=[];for(let [r,z]of profile)for(let i=0;i<n;i++){let a=2*Math.PI*i/n;v.push([r*Math.cos(a),r*Math.sin(a),z])}for(let j=0;j<profile.length-1;j++)for(let i=0;i<n;i++)f.push([j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i]);return {v,f,smooth:true}}
function sphere(rx=1,ry=1,rz=1,hemi=false){let profile=Array.from({length:19},(_,j)=>{let a=j/18*Math.PI*(hemi?.5:1);return [Math.sin(a)*rx,1+Math.cos(a)*rz]});if(hemi)profile.push([0,1]);let m=revolve(profile);m.v=m.v.map(([x,y,z])=>[x,y*ry/rx,z]);return m}
function torus(){let v=[],f=[],n=40,k=16;for(let i=0;i<n;i++)for(let j=0;j<k;j++){let a=i/n*Math.PI*2,b=j/k*Math.PI*2;v.push([(1+.38*Math.cos(b))*Math.cos(a),(1+.38*Math.cos(b))*Math.sin(a),1+.38*Math.sin(b)])}for(let i=0;i<n;i++)for(let j=0;j<k;j++)f.push([i*k+j,((i+1)%n)*k+j,((i+1)%n)*k+(j+1)%k,i*k+(j+1)%k]);return {v,f,smooth:true}}
function combine(parts){let v=[],f=[];for(let m of parts){let offset=v.length;v.push(...m.v);f.push(...m.f.map(face=>face.map(i=>i+offset)))}return {v,f}}
const box=(x,y,z,offset=[0,0,0])=>{let m=extrude([[-x/2,-y/2],[x/2,-y/2],[x/2,y/2],[-x/2,y/2]],z);m.v=m.v.map(p=>p.map((a,i)=>a+offset[i]));return m};
entry('cube','正方体','基础几何体',()=>box(1.7,1.7,1.7));entry('cuboid','长方体','基础几何体',()=>box(2.5,1.2,1.7));entry('tetrahedron','正四面体','基础几何体',()=>{let m=apex(3);m.v[3][2]=Math.sqrt(2);return m});entry('octahedron','正八面体','基础几何体',()=>{let m=apex(4,true);m.v=m.v.map(([x,y,z])=>[x,y,(z-1)*1+1]);return m});
entry('oblique-box','斜平行六面体','基础几何体',()=>{let m=box(1.6,1.4,1.7);m.v=m.v.map(([x,y,z])=>[x+z*.4,y+z*.15,z]);return m});entry('wedge','楔形体','基础几何体',()=>extrude([[-1,-.8],[1,-.8],[0,.9]],1.8));
const names={3:'三',4:'四',5:'五',6:'六',7:'七',8:'八',9:'九',10:'十',11:'十一',12:'十二'};
for(let n=3;n<=12;n++)entry('prism-'+n,`${names[n]}棱柱`,'棱柱',()=>extrude(polygon(n),1.8));
for(let n=3;n<=12;n++)entry('pyramid-'+n,`${names[n]}棱锥`,'棱锥',()=>apex(n));
for(let n=3;n<=10;n++)entry('frustum-'+n,`${names[n]}棱台`,'棱台',()=>extrude(polygon(n,1.2),1.7,.5));
for(let n=3;n<=8;n++)entry('antiprism-'+n,`${names[n]}角反棱柱`,'反棱柱与双棱锥',()=>{let m=extrude(polygon(n),1.6,1,Math.PI/n);m.f=m.f.slice(0,2);for(let i=0;i<n;i++){let j=(i+1)%n;m.f.push([i,j,i+n],[j,j+n,i+n])}return m});
for(let n=3;n<=8;n++)entry('bipyramid-'+n,`${names[n]}角双棱锥`,'反棱柱与双棱锥',()=>apex(n,true));
entry('sphere','球体','曲面与旋转体',()=>sphere());entry('ellipsoid','椭球体','曲面与旋转体',()=>sphere(1.3,.7,1));entry('oblate','扁球体','曲面与旋转体',()=>sphere(1.2,1.2,.55));entry('hemisphere','半球体','曲面与旋转体',()=>sphere(1,1,1,true));
entry('cylinder','圆柱体','曲面与旋转体',()=>revolve([[0,0],[1,0],[1,2],[0,2]]));entry('cone','圆锥体','曲面与旋转体',()=>revolve([[0,0],[1.1,0],[0,2.2]]));entry('cone-frustum','圆台','曲面与旋转体',()=>revolve([[0,0],[1.2,0],[.6,1.8],[0,1.8]]));entry('torus','圆环体','曲面与旋转体',torus);entry('tube','空心圆柱','曲面与旋转体',()=>revolve([[1,0],[1,1.8],[.65,1.8],[.65,0],[1,0]]));entry('hollow-cone','空心圆台','曲面与旋转体',()=>revolve([[1.2,0],[.8,1.8],[.55,1.8],[.95,0],[1.2,0]]));
entry('capsule','胶囊体','曲面与旋转体',()=>{let p=[];for(let i=0;i<=12;i++){let a=i/12*Math.PI/2;p.push([.7*Math.sin(a),.7-.7*Math.cos(a)])}for(let i=0;i<=12;i++){let a=i/12*Math.PI/2;p.push([.7*Math.cos(a),1.5+.7*Math.sin(a)])}return revolve(p)});
entry('paraboloid','抛物面体','曲面与旋转体',()=>revolve([[0,0],...Array.from({length:20},(_,i)=>{let z=i/19*2;return [Math.sqrt(z/2),z]}),[0,2]]));entry('hyperboloid','单叶双曲面体','曲面与旋转体',()=>revolve([[0,0],...Array.from({length:21},(_,i)=>{let z=i/10;return [.55*Math.sqrt(1+2*(z-1)**2),z]}),[0,2]]));entry('barrel','鼓形体','曲面与旋转体',()=>revolve([[0,0],...Array.from({length:21},(_,i)=>[.65+.45*Math.sin(i/20*Math.PI),i/10]),[0,2]]));entry('hourglass','沙漏体','曲面与旋转体',()=>revolve([[0,0],[1,0],[.25,1],[1,2],[0,2]]));
const outlines={
'l-shape':['L 形柱',[[-1,-1],[1,-1],[1,-.25],[-.25,-.25],[-.25,1],[-1,1]]],
 't-shape':['T 形柱',[[-1,-1],[1,-1],[1,-.3],[.3,-.3],[.3,1],[-.3,1],[-.3,-.3],[-1,-.3]]],
 'u-shape':['U 形柱',[[-1,-1],[1,-1],[1,1],[.4,1],[.4,-.4],[-.4,-.4],[-.4,1],[-1,1]]],
 'cross':['十字柱',[[-.35,-1],[.35,-1],[.35,-.35],[1,-.35],[1,.35],[.35,.35],[.35,1],[-.35,1],[-.35,.35],[-1,.35],[-1,-.35],[-.35,-.35]]],
 'z-shape':['Z 形柱',[[-1,-1],[1,-1],[1,-.5],[-.2,.5],[1,.5],[1,1],[-1,1],[-1,.5],[.2,-.5],[-1,-.5]]],
 'trapezoid':['梯形柱',[[-1,-.8],[1,-.8],[.6,.8],[-.6,.8]]],
 'house':['屋形五棱柱',[[-1,-1],[1,-1],[1,.3],[0,1],[-1,.3]]]
};for(let [id,[name,poly]]of Object.entries(outlines))entry(id,name,'异形柱体',()=>extrude(poly,1.1));
for(let n of [5,6,8])entry('star-'+n,`${names[n]}角星柱`,'异形柱体',()=>extrude(Array.from({length:2*n},(_,i)=>{let a=i*Math.PI/n,r=i%2?.48:1.2;return [r*Math.cos(a),r*Math.sin(a)]}),1.1));
entry('stairs','三级阶梯','组合几何体',()=>combine([box(.7,1.5,.6,[-.7,0,0]),box(.7,1.5,1.2,[0,0,0]),box(.7,1.5,1.8,[.7,0,0])]));entry('pedestal','方台叠层','组合几何体',()=>combine([box(2,2,.45),box(1.3,1.3,.6,[0,0,.45]),box(.7,.7,.8,[0,0,1.05])]));entry('bridge','门形组合体','组合几何体',()=>combine([box(.5,1,1.7,[-.8,0,0]),box(.5,1,1.7,[.8,0,0]),box(2.1,1,.45,[0,0,1.7])]));entry('cross-block','立体十字','组合几何体',()=>combine([box(2.4,.6,.6,[0,0,.8]),box(.6,2.4,.6,[0,0,.8]),box(.6,.6,2.2)]));entry('tower','圆柱与圆锥组合','组合几何体',()=>combine([revolve([[0,0],[.8,0],[.8,1.2],[0,1.2]]),revolve([[0,1.2],[1.1,1.2],[0,2.4]])]));
return {catalogue,create(id){const item=catalogue.find(x=>x.id===id);if(!item)throw Error('未知几何体：'+id);return item.build()}};
})();
