import { applyGiPalette, fabricChannel, parseGiColor } from './giPalette.js';
import atlas from '../../public/assets/arena/hair/atlas-layout.json';
import frontHairAtlas from '../../public/assets/arena/hair/front-atlas-layout.json';
import { ARENA_BELT_MASKS } from './beltMasks.js';

// Authored against 1536 × 1024 cleanplates. P = source blue/cyan athlete;
// S = source emerald/lime athlete. These identities are independent of the player.
const head = (ear, eye, box, facing = 1) => ({ ear, eye, box, facing });
const scene = (heads, skin, belts, patches, stripes) => ({ heads, skin, belts, patches, stripes });
export const ARENA_APPEARANCE_LAYOUT = {
  standing: scene([
    head([596,114],[656,126],[540,30,155,185]), { ...head([976,138],[917,144],[880,45,150,185],-1), hairBackScale:1.45 },
  ], [
    [[535,25,180,230],[825,205,180,110],[140,780,190,89],[525,820,210,108]],
    [[875,35,195,190],[730,325,155,115],[850,765,190,100],[1210,790,200,145]],
  ], [
    [[285,305],[510,365],[570,445],[495,440],[295,360]],
    [[1035,390],[1245,330],[1235,385],[1100,445],[1090,580],[1035,580]],
  ], [[440,247,43,44,-18],[1116,263,40,43,13]], [[500,398,26,6,35],[1072,501,23,6,4]]),
  kneeling: scene([
    { ...head([596,196],[660,216],[535,105,165,200]), hairMultiplier:1.1, hairEar:[587,196] }, { ...head([998,221],[927,228],[890,120,165,205],-1), hairBackScale:1.4 },
  ], [
    [[530,95,180,250],[830,300,180,125],[75,670,235,140]],
    [[885,110,195,190],[720,440,160,120],[1240,660,240,155]],
  ], [
    [[285,445],[470,470],[540,570],[475,580],[300,505]],
    [[1090,500],[1225,465],[1260,520],[1135,600],[1090,665],[1040,640]],
  ], [[440,325,42,45,-14],[1120,350,43,46,15]], [[495,548,25,6,30],[1102,594,23,6,8]]),
  guard: scene([
    head([699,137],[776,165],[650,40,175,215]), { ...head([1184,657],[1148,593],[1060,535,250,195],-1), hairBackScale:1.5 },
  ], [
    [[645,35,195,300],[635,180,165,210],[[800,556],[847,568],[871,583],[899,583],[911,615],[895,647],[865,647],[822,624],[792,600]],[[859,535],[888,539],[901,557],[926,580],[886,586],[864,572]],[245,630,160,155]],
    [[1055,530,275,210],[1010,585,170,135],[[716,591],[737,573],[751,576],[768,589],[784,621],[793,668],[756,690],[746,651],[722,626]],[[875,497],[910,499],[934,533],[950,567],[935,578],[917,552],[891,528],[871,523]],[200,390,240,185]],
  ], [
    [[435,450],[540,455],[690,535],[715,605],[625,625],[435,505]],
    [[640,580],[740,580],[765,705],[735,830],[680,815]],
  ], [[545,315,44,46,-15],[1085,755,44,43,58]], [[590,531,25,6,25],[711,749,24,6,6]]),
  'half-guard': scene([
    head([1024,224],[1102,263],[980,100,200,245]), head([1356,585],[1299,510],[1210,410,270,215],-1),
  ], [
    [[975,95,220,275],[925,270,210,215],[915,550,120,115],[75,540,195,290]],
    [[1205,400,290,230],[1090,455,220,145],[1015,305,140,230],[350,560,250,190]],
  ], [
    [[570,240],[640,255],[680,440],[610,455],[565,340]],
    [[925,560],[1030,590],[1040,730],[955,775],[925,715]],
  ], [[770,310,45,44,22],[1230,650,46,43,28]], [[623,389,23,6,7],[988,702,23,6,-3]]),
  'side-control': scene([
    { ...head([1026,296],[1048,320],[980,190,145,150]), hiddenFace:true, hairScale:.52, hairAngle:.43 },
    { ...head([747,119],[779,82],[732,24,140,170]), hairScale:.53, hairAngle:0, hairEar:[747,112], frontFacing:true },
  ], [
    [[980,190,145,150],[992,490,152,105],[236,162,123,110],[203,335,159,140]],
    [[732,24,140,170],[866,137,134,132],[566,355,114,112],[609,794,93,185],[864,789,95,191]],
  ], [
    [[646,194],[677,194],[672,393],[647,400]],
    [[685,449],[775,440],[884,448],[884,479],[820,481],[851,520],[829,530],[788,479],[778,480],[754,531],[728,522],[751,480],[681,482]],
  ], [[878,347,43,43,85],[710,418,35,35,0]], [[662,338,23,6,90],[747,501,24,6,27]]),
  mount: scene([
    head([943,145],[1009,185],[890,45,185,230]), { ...head([1165,694],[1160,619],[1065,580,240,190],-1), hairBackScale:1.5 },
  ], [
    [[885,40,195,290],[870,205,165,220],[[927,588],[969,592],[998,605],[1028,624],[1035,643],[1017,660],[981,656],[955,642],[923,623]],[[1024,558],[1057,559],[1077,581],[1090,594],[1100,620],[1086,632],[1064,628],[1033,608]],[380,670,210,135]],
    [[1065,575,260,215],[1040,625,130,110],[[838,601],[844,570],[863,553],[890,549],[913,557],[934,583],[925,609],[908,626],[881,634],[856,639],[834,638]],[[1066,510],[1092,510],[1109,535],[1112,599],[1093,613],[1078,580]],[95,600,220,165],[375,585,95,100]],
  ], [
    [[650,430],[715,430],[920,485],[940,550],[850,565],[665,495]],
    [[565,535],[635,540],[650,620],[600,685],[555,640]],
  ], [[785,325,43,45,-13],[1070,745,44,45,48]], [[865,515,26,6,16],[610,590,22,6,18]]),
  'back-control': scene([
    head([504,169],[584,159],[465,45,175,210]), head([677,208],[754,205],[635,90,180,220]),
  ], [
    [[460,40,185,245],[700,385,80,80],[645,570,300,195]],
    [[635,85,185,235],[[625,397],[652,374],[675,356],[700,351],[723,359],[741,380],[728,397],[690,419],[653,438],[619,451]],[[719,333],[745,319],[780,320],[797,339],[808,371],[834,388],[845,442],[831,457],[808,426],[784,403],[762,391],[735,379],[715,357]],[680,740,205,205],[1145,680,240,205]],
  ], [
    [[370,495],[480,510],[485,560],[420,585],[410,695],[370,695]],
    [[660,515],[815,515],[870,565],[835,650],[780,650],[760,570],[680,565]],
  ], [[435,312,39,42,-12],[885,393,35,41,18]], [[401,631,22,6,4],[806,598,23,6,-9]]),
  turtle: scene([
    head([914,188],[992,232],[870,75,205,250]), { ...head([638,602],[639,674],[490,495,235,225]), hiddenFace:true, hairAngle:-1.7, hairScale:.72 },
  ], [
    [[865,70,225,280],[835,235,245,155],[795,540,210,155],[1080,310,155,145],[20,645,185,180]],
    [[485,490,245,235],[515,680,205,130],[1200,580,305,205]],
  ], [
    [[385,265],[565,300],[610,450],[555,490],[520,365],[390,330]],
    [[1060,340],[1135,350],[1175,470],[1110,600],[1070,595],[1090,460]],
  ], [[712,315,45,46,18],[868,450,44,45,12]], [[567,419,23,6,12],[1110,521,23,6,11]]),
};

const BELTS = { white: '#f4f2eb', blue: '#2563c8', purple: '#8050a7', brown: '#73462d', black: '#191a20' };
const AURAS = { 'void violet': '#8a5cff', 'mat gold': '#e9b74f', 'blue flame': '#4a91ff', 'red surge': '#ed536a', 'emerald focus': '#36c3a0' };
const imageCache = new Map();
const spriteCache = new Map();
const sceneCache = new Map();
const KEYS = ['skinTone','hairColor','hairStyle','gender','giTop','giPants','emblem','aura','belt','stripes'];

export function getArenaAppearanceKey(key, primary = {}, secondary = {}, primaryBelt = {}, secondaryBelt = {}) {
  return JSON.stringify([key, ...[primary, secondary].map((athlete) => KEYS.map((field) => athlete[field] ?? null)), ...[primaryBelt,secondaryBelt].map(({belt,stripes})=>[belt ?? null,stripes ?? 0])]);
}

function loadImage(src) {
  if (!imageCache.has(src)) imageCache.set(src, new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { imageCache.delete(src); reject(new Error('Your character artwork could not load. Please try again.')); };
    image.src = src;
  }));
  return imageCache.get(src);
}

function newCanvas(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}

function inRect(x, y, rect) { return x >= rect[0] && y >= rect[1] && x <= rect[0] + rect[2] && y <= rect[1] + rect[3]; }
function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isArenaSkinPixel(r, g, b) {
  return r > 80 && g > 40 && r > g + 7 && g > b + 3 && g / r > .32 && g / r < .94 && b / Math.max(g, 1) > .20;
}

function shadeSkin(data, i, color, sourceRed) {
  const shade = Math.min(1.12, sourceRed / 233);
  const highlight = Math.max(0, sourceRed - 235) * .35;
  for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round(color[c] * shade + highlight));
}

function tintedSprite(image, descriptor, color, kind) {
  const key = `${kind}:${descriptor.crop.join(',')}:${color}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const [x,y,w,h] = descriptor.crop;
  const canvas = newCanvas(w,h), ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image,x,y,w,h,0,0,w,h);
  const pixels = ctx.getImageData(0,0,w,h), rgb = parseGiColor(color, kind === 'hair' ? '#11131c' : '#d99b71');
  for (let i = 0; i < pixels.data.length; i += 4) {
    const d = pixels.data, r=d[i],g=d[i+1],b=d[i+2];
    if (kind === 'head' || kind === 'front') {
      if (isArenaSkinPixel(r,g,b)) shadeSkin(d,i,rgb,r);
      // Facial presets change the facial features within the existing skull.
      // Their separate scalp and neck outlines must never form a second head.
      const py=Math.floor(i/4/w)+y,px=(i/4)%w+x;
      const top=Math.min(1,Math.max(0,(py-(descriptor.eye[1]-(kind==='front'?160:88)))/38));
      const bottom=Math.min(1,Math.max(0,((descriptor.eye[1]+(kind==='front'?345:230))-py)/45));
      const back=kind==='front'?1:Math.min(1,Math.max(0,(px-(descriptor.ear[0]+12))/44));
      d[i+3]=Math.round(d[i+3]*top*bottom*back);
    }
    else if (d[i+3] && Math.max(r,g,b)>13) {
      const light=(r+g+b)/3, shade=Math.min(1.1,.13+light/180);
      for(let c=0;c<3;c++) d[i+c]=Math.min(255,Math.round(rgb[c]*shade+Math.max(0,light-35)*.08));
    }
  }
  ctx.putImageData(pixels,0,0);
  if (spriteCache.size > 48) spriteCache.delete(spriteCache.keys().next().value);
  spriteCache.set(key,canvas); return canvas;
}

function headTransform(target, descriptor) {
  const dx=target.eye[0]-target.ear[0],dy=target.eye[1]-target.ear[1];
  const sx=descriptor.eye[0]-descriptor.ear[0],sy=descriptor.eye[1]-descriptor.ear[1];
  return { scale:Math.hypot(dx,dy)/Math.hypot(sx,sy), angle:Math.atan2(dy,dx)-Math.atan2(sy,sx*target.facing), flip:target.facing };
}

function headSilhouette(original,width,height,target) {
  const mask=newCanvas(width,height), maskCtx=mask.getContext('2d');
  const [bx,by,bw,bh]=target.box;
  maskCtx.fillStyle='#fff';
  // Scanline fill includes the source ink and eyes between skin pixels while
  // retaining the exact accepted outer head/neck contour.
  for(let y=Math.max(0,by);y<Math.min(height,by+bh);y++){
    let left=Infinity,right=-1;
    for(let x=Math.max(0,bx);x<Math.min(width,bx+bw);x++){
      const i=(y*width+x)*4;
      if(isArenaSkinPixel(original[i],original[i+1],original[i+2])){left=Math.min(left,x);right=Math.max(right,x);}
    }
    if(right>=left)maskCtx.fillRect(left,y,right-left+1,1);
  }
  return mask;
}

function drawHeadAndHair(ctx, target, athlete, headImage, hairImage, original, frontFaceImage, frontHairImage) {
  const preset=atlas.heads.presets[athlete.gender] ?? atlas.heads.presets.boy;
  const transform=headTransform(target,preset);
  if(target.frontFacing && frontFaceImage && (athlete.gender==='girl'||athlete.gender==='non-binary')){
    const crop=athlete.gender==='girl'?[157,60,680,750]:[934,60,680,750];
    const descriptor={crop,eye:[crop[0]+215,397]};
    const sprite=tintedSprite(frontFaceImage,descriptor,athlete.skinTone,'front');
    const layer=newCanvas(ctx.canvas.width,ctx.canvas.height),layerCtx=layer.getContext('2d');
    layerCtx.drawImage(sprite,739,25,125,138);
    layerCtx.globalCompositeOperation='destination-in';layerCtx.drawImage(headSilhouette(original,ctx.canvas.width,ctx.canvas.height,target),0,0);
    ctx.drawImage(layer,0,0);
  }
  // Keep the source masculine face; feminine and androgynous presets replace its
  // actual facial artwork, not merely a caption or a hair-style proxy.
  if (!target.hiddenFace && !target.frontFacing && (athlete.gender === 'girl' || athlete.gender === 'non-binary')) {
    const sprite=tintedSprite(headImage,preset,athlete.skinTone,'head');
    const layer=newCanvas(ctx.canvas.width,ctx.canvas.height), layerCtx=layer.getContext('2d');
    layerCtx.save(); layerCtx.translate(...target.ear); layerCtx.rotate(transform.angle); layerCtx.scale(transform.scale*transform.flip,transform.scale);
    layerCtx.drawImage(sprite,preset.crop[0]-preset.ear[0],preset.crop[1]-preset.ear[1]); layerCtx.restore();
    layerCtx.globalCompositeOperation='destination-in';
    layerCtx.drawImage(headSilhouette(original,ctx.canvas.width,ctx.canvas.height,target),0,0);
    ctx.drawImage(layer,0,0);
  }
  if (athlete.hairStyle === 'bald') return;
  if(target.frontFacing && frontHairImage){
    const style=frontHairAtlas.styles[athlete.hairStyle]??frontHairAtlas.styles['shadow spikes'];
    const sprite=tintedSprite(frontHairImage,style,athlete.hairColor,'frontal-hair');
    const scaleX=114/style.skullWidth;
    const scaleY=Math.min(scaleX,58/(style.hairline[1]-style.crop[1]));
    ctx.save();ctx.translate(802,61);ctx.scale(scaleX,scaleY);
    ctx.drawImage(sprite,style.crop[0]-style.hairline[0],style.crop[1]-style.hairline[1]);ctx.restore();
    return;
  }
  const style=atlas.hair.styles[athlete.hairStyle] ?? atlas.hair.styles['shadow spikes'];
  const sprite=tintedSprite(hairImage,style,athlete.hairColor,'hair');
  const scale=(target.hairScale ?? transform.scale*preset.skullWidth/style.skullWidth)*(target.hairMultiplier??1);
  ctx.save(); ctx.translate(...(target.hairEar ?? target.ear)); ctx.rotate(target.hairAngle ?? transform.angle); ctx.scale(scale*transform.flip,scale);
  const split=style.ear[0]-style.crop[0],offsetY=style.crop[1]-style.ear[1];
  const backScale=athlete.hairStyle==='mohawk'?1:(target.hairBackScale??1);
  // Fit the rear cap to the source skull without moving the fringe, eyes or ear.
  // The generated alpha still preserves the shaved areas of fades and mohawks.
  ctx.drawImage(sprite,0,0,split,sprite.height,-split*backScale,offsetY,split*backScale,sprite.height);
  ctx.drawImage(sprite,split,0,sprite.width-split,sprite.height,0,offsetY,sprite.width-split,sprite.height);ctx.restore();
}

function drawPatch(ctx, image, patch) {
  if (!image || !patch) return;
  const [x,y,w,h,angle]=patch;
  ctx.save(); ctx.translate(x,y);ctx.rotate(angle*Math.PI/180);ctx.globalAlpha=.88;
  ctx.drawImage(image,-w/2,-h/2,w,h);ctx.restore();
}

function drawStripes(ctx, spec, count, outlines) {
  if (!spec || !count) return;
  const [x,y,w,h,angle]=spec;
  ctx.save();
  if(outlines){ctx.beginPath();for(const polygon of outlines){ctx.moveTo(...polygon[0]);for(const point of polygon.slice(1))ctx.lineTo(...point);ctx.closePath();}ctx.clip();}
  ctx.translate(x,y);ctx.rotate(angle*Math.PI/180);
  ctx.fillStyle='#181b23';ctx.fillRect(-w/2-2,-2,w+4,Math.min(4,Math.max(0,count))*(h+3)+1);
  ctx.fillStyle='#e8e7e2';ctx.strokeStyle='#202332';ctx.lineWidth=1;
  for(let i=0;i<Math.min(4,Math.max(0,count));i++){ctx.fillRect(-w/2,i*(h+3),w,h);ctx.strokeRect(-w/2,i*(h+3),w,h);}
  ctx.restore();
}

/** Draw a full personalized scene. Does not mutate athletes or game state. */
export async function renderArenaAppearance(ctx, { key, primary, secondary, primaryBelt = {}, secondaryBelt = {} }) {
  const layout=ARENA_APPEARANCE_LAYOUT[key];
  if (!layout) throw new Error('This position artwork is not available yet.');
  const cacheKey=getArenaAppearanceKey(key,primary,secondary,primaryBelt,secondaryBelt);
  const cached=sceneCache.get(cacheKey);
  const result={key,personalized:['gi','skin','hair','gender','belt','emblem','aura'],posePreserved:true};
  if(cached){ctx.canvas.width=cached.width;ctx.canvas.height=cached.height;ctx.drawImage(cached,0,0);sceneCache.delete(cacheKey);sceneCache.set(cacheKey,cached);return result;}
  const athletes=[primary,secondary], belts=[primaryBelt,secondaryBelt];
  const beltLayout=ARENA_BELT_MASKS[key];
  const beltOutlines=beltLayout?.belts??layout.belts.map((polygon)=>[polygon]);
  const [base,hairImage,headImage,frontFaceImage,frontHairImage,...patchImages]=await Promise.all([
    loadImage(`/assets/arena/base/${key}.png`),loadImage(atlas.hair.src),loadImage(atlas.heads.src),
    key==='side-control'?loadImage('/assets/arena/hair/front-faces.png'):Promise.resolve(null),
    key==='side-control'?loadImage(frontHairAtlas.src):Promise.resolve(null),
    ...athletes.map((athlete)=>athlete.emblem && athlete.emblem !== 'none' ? loadImage(`/assets/emblems/${athlete.emblem}.png`) : Promise.resolve(null)),
  ]);
  ctx.canvas.width=base.naturalWidth;ctx.canvas.height=base.naturalHeight;
  ctx.drawImage(base,0,0);
  const width=ctx.canvas.width,height=ctx.canvas.height;
  const pixels=ctx.getImageData(0,0,width,height), original=new Uint8ClampedArray(pixels.data);
  const skinColors=athletes.map((athlete)=>parseGiColor(athlete.skinTone,'#d99b71'));
  const beltColors=athletes.map((athlete,index)=>parseGiColor(BELTS[belts[index].belt ?? athlete.belt] ?? BELTS.white));
  const auraColors=athletes.map((athlete)=>parseGiColor(AURAS[athlete.aura] ?? AURAS['void violet']));
  applyGiPalette(pixels.data,athletes.flatMap((athlete)=>[athlete.giTop,athlete.giPants]));
  const fabric=new Uint8Array(width*height);
  for(let i=0;i<original.length;i+=4){
    const p=i/4,x=p%width,y=Math.floor(p/width),r=original[i],g=original[i+1],b=original[i+2];
    const channel=fabricChannel(r,g,b);if(channel>=0)fabric[p]=channel+1;
    const skin=channel<0 && isArenaSkinPixel(r,g,b);
    if(skin){
      let owner=-1;
      for(let actor=0;actor<2;actor++)if(layout.skin[actor].some((region)=>Array.isArray(region[0])?inPolygon(x,y,region):inRect(x,y,region)))owner=actor;
      if(owner>=0)shadeSkin(pixels.data,i,skinColors[owner],r);
    }
    let beltOwner=-1;
    if(Math.max(r,g,b)<90 && Math.max(r,g,b)-Math.min(r,g,b)<32){
      for(let actor=0;actor<2;actor++)if(beltOutlines[actor].some((polygon)=>inPolygon(x,y,polygon)))beltOwner=actor;
      if(beltOwner>=0){const shade=Math.max(.14,Math.min(1.04,Math.max(r,g,b)/65));for(let c=0;c<3;c++)pixels.data[i+c]=Math.round(beltColors[beltOwner][c]*shade);}
    }
    // A restrained halo lives in the neutral backdrop, never in skin or cloth.
    if(!skin && channel<0 && beltOwner<0 && Math.max(r,g,b)-Math.min(r,g,b)<23){
      for(let actor=0;actor<2;actor++){
        const anchor=layout.heads[actor].ear,dist=Math.hypot((x-anchor[0])/1.25,y-anchor[1]);
        const alpha=Math.max(0,1-dist/230)*.10;
        if(alpha)for(let c=0;c<3;c++)pixels.data[i+c]=Math.min(255,pixels.data[i+c]+auraColors[actor][c]*alpha);
      }
    }
  }
  ctx.putImageData(pixels,0,0);
  drawHeadAndHair(ctx,layout.heads[0],primary,headImage,hairImage,original,frontFaceImage,frontHairImage);
  drawHeadAndHair(ctx,layout.heads[1],secondary,headImage,hairImage,original,frontFaceImage,frontHairImage);
  // Existing clothing is in front of the neck / long hair. This also preserves
  // the blue sleeve over the defender's head in turtle rather than painting over it.
  const composed=ctx.getImageData(0,0,width,height);
  for(let p=0;p<fabric.length;p++)if(fabric[p]){
    const i=p*4;composed.data[i]=pixels.data[i];composed.data[i+1]=pixels.data[i+1];composed.data[i+2]=pixels.data[i+2];
  }
  ctx.putImageData(composed,0,0);
  athletes.forEach((athlete,index)=>{
    drawPatch(ctx,patchImages[index],layout.patches[index]);
    drawStripes(ctx,(beltLayout?.stripes??layout.stripes)[index],belts[index].stripes ?? athlete.stripes ?? 0,beltOutlines[index]);
  });
  const saved=newCanvas(width,height);saved.getContext('2d').drawImage(ctx.canvas,0,0);
  // Bound decoded personalized frames to about 25 MB, in addition to sources.
  if(sceneCache.size>=4)sceneCache.delete(sceneCache.keys().next().value);
  sceneCache.set(cacheKey,saved);
  return result;
}
