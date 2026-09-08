/* WebGPU run-atlas renderer. Canvas supplies native font shaping/rasterization
 * only on atlas misses. WebGPU composes cached runs, selection and caret in one
 * instanced draw; document size never determines canvas or DOM size. */
const SHADER = `
struct View { size: vec2f, pad: vec2f };
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var atlasSampler: sampler;
struct In { @location(0) rect: vec4f, @location(1) uv: vec4f,
            @location(2) color: vec4f, @location(3) clip: vec4f };
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f,
             @location(1) color: vec4f, @location(2) point: vec2f,
             @location(3) @interpolate(flat) clip: vec4f };
@vertex fn vs(v: In, @builtin(vertex_index) index: u32) -> Out {
  var corners = array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let corner=corners[index]; let p=v.rect.xy+corner*v.rect.zw;
  var o:Out; o.position=vec4f(p/view.size*vec2f(2,-2)+vec2f(-1,1),0,1);
  o.uv=v.uv.xy+corner*v.uv.zw; o.color=v.color; o.point=p; o.clip=v.clip; return o;
}
@fragment fn fs(v:Out) -> @location(0) vec4f {
  // Sample before conditional discard so implicit derivatives stay uniform.
  let a=textureSample(atlas,atlasSampler,v.uv).a*v.color.a;
  if(v.point.x<v.clip.x || v.point.y<v.clip.y || v.point.x>=v.clip.z || v.point.y>=v.clip.w){discard;}
  return vec4f(v.color.rgb*a,a);
}`;
export class TextRenderer {
  constructor(canvas, fallback) {
    this.canvas=canvas; this.fallback=fallback; this.mode='initializing'; this.reason='';
    this.dpr=Math.min(devicePixelRatio||1,2); this.width=1; this.height=1;
    this.cache=new Map(); this.clock=0; this.entries=[]; this.uploads=0; this.frames=0;
    this.metrics={frameMs:0,drawCalls:0,instances:0,atlasEntries:0}; this.lastScene=null;
    this.tile=document.createElement('canvas'); this.tileCtx=this.tile.getContext('2d',{alpha:true});
    this.measure=document.createElement('canvas').getContext('2d');
  }
  async init() {
    try {
      if(!navigator.gpu) throw new Error('WebGPU is not available in this browser or context.');
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'low-power'});
      if(!adapter) throw new Error('No WebGPU adapter was available.');
      this.adapterInfo=adapter.info ? {vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description} : {};
      this.device=await adapter.requestDevice();
      this.context=this.canvas.getContext('webgpu'); if(!this.context) throw new Error('Cannot create WebGPU canvas.');
      this.format=navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({device:this.device,format:this.format,alphaMode:'opaque'});
      const module=this.device.createShaderModule({code:SHADER});
      const compilation=await module.getCompilationInfo();
      const errors=compilation.messages.filter(x=>x.type==='error'); if(errors.length) throw new Error(errors.map(e=>e.message).join('\n'));
      this.pipeline=await this.device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:64,stepMode:'instance',attributes:[0,1,2,3].map(i=>({shaderLocation:i,offset:i*16,format:'float32x4'}))}]},fragment:{module,entryPoint:'fs',targets:[{format:this.format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
      this.uniform=this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      this.sampler=this.device.createSampler({magFilter:'nearest',minFilter:'nearest'});
      this.atlasSize=Math.min(4096,this.device.limits.maxTextureDimension2D);
      this.texture=this.device.createTexture({size:[this.atlasSize,this.atlasSize],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
      this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:this.texture.createView()},{binding:2,resource:this.sampler}]});
      this.device.queue.writeTexture({texture:this.texture,origin:[0,0]},new Uint8Array([255,255,255,255]),{bytesPerRow:4},{width:1,height:1});
      this.atlasX=2;this.atlasY=2;this.shelfH=0;
      this.mode='WebGPU'; this.canvas.hidden=false; this.fallback.hidden=true;
      this.device.lost.then(info=>{this.useFallback(`GPU device lost: ${info.message}`);this.onInvalidate?.();});
      this.device.addEventListener('uncapturederror',e=>{this.reason=e.error.message;console.error('WebGPU:',e.error.message);});
    } catch(error) {this.useFallback(error.message);}
    this.onInvalidate?.(); return this.mode;
  }
  useFallback(reason) {this.mode='Canvas 2D';this.reason=reason;this.canvas.hidden=true;this.fallback.hidden=false;}
  setFont(family='Lucida Console',size=10,style='Regular') {
    const px=size*96/72;
    const fallback=family==='Lucida Console'?'"Courier New",monospace':'Arial,sans-serif';
    this.font=`${style.includes('Italic')?'italic ':''}${style.includes('Bold')?'bold ':''}${px}px "${family.replace(/["\\]/g,'')}",${fallback}`;
    this.measure.font=this.font; this.advance=this.measure.measureText('M').width;
    this.monospace=Math.abs(this.measure.measureText('iiii').width-this.measure.measureText('MMMM').width)<.05;
    this.lineHeight=Math.ceil(px*1.2); const m=this.measure.measureText('Mg');
    this.baseline=Math.round((this.lineHeight-(m.actualBoundingBoxAscent+m.actualBoundingBoxDescent))/2+m.actualBoundingBoxAscent);
    this.fontSize=px; this.cache.clear(); this.entries=[];this.atlasX=2;this.atlasY=2;this.shelfH=0;
  }
  resize(width,height) {
    this.width=Math.max(1,Math.floor(width));this.height=Math.max(1,Math.floor(height));
    const dpr=Math.min(devicePixelRatio||1,2);if(dpr!==this.dpr){this.dpr=dpr;this.cache.clear();this.entries=[];this.atlasX=2;this.atlasY=2;this.shelfH=0;}
    for(const c of [this.canvas,this.fallback]){const w=Math.ceil(this.width*this.dpr),h=Math.ceil(this.height*this.dpr);if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;}
  }
  getRun(text,width) {
    const key=text; let entry=this.cache.get(key);
    if(entry){entry.tick=this.clock;return entry;}
    const w=Math.min(this.atlasSize-4,Math.max(2,Math.ceil((width+4)*this.dpr))),h=Math.ceil((this.lineHeight+2)*this.dpr);
    let x,y;
    if(this.atlasX+w>=this.atlasSize){this.atlasX=2;this.atlasY+=this.shelfH+2;this.shelfH=0;}
    if(this.atlasY+h>=this.atlasSize) {
      // Recycle only slots not referenced by this frame; never overwrite a live quad.
      entry=this.entries.filter(e=>e.tick!==this.clock && e.slotW>=w && e.slotH>=h).sort((a,b)=>a.tick-b.tick)[0];
      if(!entry) return null;
      this.cache.delete(entry.key);x=entry.x;y=entry.y;
    } else {x=this.atlasX;y=this.atlasY;this.atlasX+=w+2;this.shelfH=Math.max(this.shelfH,h);entry={slotW:w,slotH:h};this.entries.push(entry);}
    this.tile.width=w;this.tile.height=h;
    const ctx=this.tileCtx;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.clearRect(0,0,w/this.dpr,h/this.dpr);
    ctx.font=this.font;ctx.textBaseline='alphabetic';ctx.fillStyle='#ffffff';ctx.fillText(text,2,this.baseline);
    this.device.queue.copyExternalImageToTexture({source:this.tile},{texture:this.texture,origin:[x,y]},[w,h]);
    Object.assign(entry,{key,text,x,y,w,h,width:w/this.dpr,height:h/this.dpr,tick:this.clock});this.cache.set(key,entry);this.uploads++;
    return entry;
  }
  render(scene) {
    const started=performance.now();this.lastScene=scene;this.clock++;this.frames++;
    if(this.mode!=='WebGPU'){this.draw2D(this.fallback.getContext('2d'),scene,this.dpr);this.metrics={frameMs:performance.now()-started,drawCalls:scene.runs.length,instances:scene.runs.length,atlasEntries:0};return;}
    try {
      const data=[],W=this.width,H=this.height;
      const push=(x,y,w,h,uv,color,clip=[0,0,W,H])=>{if(w<=0||h<=0)return;data.push(x,y,w,h,...uv,...color,...clip);};
      const solid=(r,color)=>push(r.x,r.y,r.width,r.height,[.5/this.atlasSize,.5/this.atlasSize,0,0],color);
      for(const r of scene.selections) solid(r,scene.active?[.192,.416,.773,1]:[.80,.80,.80,1]);
      let overflow=false;
      for(const r of scene.runs) {
        const entry=this.getRun(r.text,r.width);if(!entry){overflow=true;break;}
        const uv=[entry.x/this.atlasSize,entry.y/this.atlasSize,entry.w/this.atlasSize,entry.h/this.atlasSize];
        push(r.x-2,r.y,entry.width,entry.height,uv,[0,0,0,1]);
        if(r.selection && scene.active)push(r.x-2,r.y,entry.width,entry.height,uv,[1,1,1,1],[r.selection[0],Math.max(0,r.y),r.selection[1],Math.min(H,r.y+this.lineHeight)]);
      }
      if(overflow){this.draw2D(this.fallback.getContext('2d'),scene,this.dpr);this.fallback.hidden=false;this.canvas.hidden=true;this.metrics.temporaryFallback=true;return;}
      this.fallback.hidden=true;this.canvas.hidden=false;
      if(scene.caret)solid(scene.caret,[0,0,0,1]);
      const bytes=new Float32Array(data);
      if(!this.instanceBuffer||this.instanceCapacity<bytes.byteLength){this.instanceBuffer?.destroy();this.instanceCapacity=Math.max(65536,2**Math.ceil(Math.log2(Math.max(1,bytes.byteLength))));this.instanceBuffer=this.device.createBuffer({size:this.instanceCapacity,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}
      this.device.queue.writeBuffer(this.uniform,0,new Float32Array([W,H,0,0]));
      if(bytes.byteLength)this.device.queue.writeBuffer(this.instanceBuffer,0,bytes);
      const encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:1,g:1,b:1,a:1},loadOp:'clear',storeOp:'store'}]});
      if(data.length){pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.setVertexBuffer(0,this.instanceBuffer);pass.draw(6,data.length/16);}
      pass.end();this.device.queue.submit([encoder.finish()]);
      this.metrics={frameMs:performance.now()-started,drawCalls:data.length?1:0,instances:data.length/16,atlasEntries:this.cache.size,atlasUploads:this.uploads};
    } catch(error){this.useFallback(error.message);this.draw2D(this.fallback.getContext('2d'),scene,this.dpr);}
  }
  draw2D(ctx,scene,dpr=1) {
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#fff';ctx.fillRect(0,0,this.width,this.height);ctx.font=this.font;ctx.textBaseline='alphabetic';
    ctx.fillStyle=scene.active?'#316ac5':'#ccc';for(const r of scene.selections)ctx.fillRect(r.x,r.y,r.width,r.height);
    for(const r of scene.runs){ctx.fillStyle='#000';ctx.fillText(r.text,r.x,r.y+this.baseline);if(r.selection&&scene.active){ctx.save();ctx.beginPath();ctx.rect(r.selection[0],r.y,r.selection[1]-r.selection[0],this.lineHeight);ctx.clip();ctx.fillStyle='#fff';ctx.fillText(r.text,r.x,r.y+this.baseline);ctx.restore();}}
    if(scene.caret){const r=scene.caret;ctx.fillStyle='#000';ctx.fillRect(r.x,r.y,r.width,r.height);}
  }
  screenshot() {const c=document.createElement('canvas');c.width=this.width;c.height=this.height;this.draw2D(c.getContext('2d'),this.lastScene||{runs:[],selections:[]});return c.toDataURL('image/png');}
}
