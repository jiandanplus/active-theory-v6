'use strict';
(() => {
  const visual = document.querySelector('[data-portfolio-visual]');
  if (!visual) return;
  const canvas = visual.querySelector('canvas');
  const button = visual.querySelector('button');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let gl, program, frame = 0, running = false, disposed = false, wanted = !motion.matches;
  const fragment = `precision mediump float;
uniform vec2 resolution; uniform float time;
void main(){vec2 p=(gl_FragCoord.xy/resolution-.5)*2.8;p.x*=resolution.x/resolution.y;
float r=length(p),a=atan(p.y,p.x);float hole=smoothstep(.44,.47,r);
float ring=exp(-abs(r-.50)*60.)+exp(-abs(r-.55)*20.)*.45;
vec2 q=vec2(p.x,p.y*4.2+p.x*.28);float d=length(q);
float disk=exp(-abs(d-.72)*7.)*smoothstep(.4,.65,d);
float grain=.7+.3*sin(a*35.+r*80.-time*1.4);
vec3 c=vec3(1.,.7,.4)*(ring+disk*grain)*hole;
gl_FragColor=vec4(c,clamp((ring+disk)*hole,0.,.98));}`;
  function shader(type,source) {
    const value = gl.createShader(type);
    gl.shaderSource(value,source); gl.compileShader(value);
    if (!gl.getShaderParameter(value,gl.COMPILE_STATUS)) {gl.deleteShader(value);throw new Error('shader');}
    return value;
  }
  let buffer, vertex, pixel, start = 0;
  function draw(now) {
    if (!running || disposed) return;
    if (!start) start = now;
    const width = Math.max(1,Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1,1.5)));
    const height = Math.max(1,Math.round(canvas.clientHeight * Math.min(devicePixelRatio || 1,1.5)));
    if (canvas.width !== width || canvas.height !== height) {canvas.width=width;canvas.height=height;}
    gl.viewport(0,0,width,height);
    gl.uniform2f(gl.getUniformLocation(program,'resolution'),width,height);
    gl.uniform1f(gl.getUniformLocation(program,'time'),(now-start)/1000);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    frame = requestAnimationFrame(draw);
  }
  function setRunning(value) {
    running = value && !disposed && !document.hidden;
    cancelAnimationFrame(frame);
    button.setAttribute('aria-pressed',String(running));
    button.textContent = running ? '暂停动态效果' : '播放动态效果';
    if (running) frame = requestAnimationFrame(draw);
  }
  function visibility() {setRunning(wanted);}
  function preference() {wanted = !motion.matches;setRunning(wanted);}
  function dispose() {
    if (disposed) return;
    setRunning(false); disposed = true;
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (pixel) gl.deleteShader(pixel);
    motion.removeEventListener('change',preference);
    document.removeEventListener('visibilitychange',visibility);
  }
  try {
    gl = canvas.getContext('webgl',{alpha:true,antialias:false,powerPreference:'low-power'});
    if (!gl) return;
    vertex = shader(gl.VERTEX_SHADER,'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}');
    pixel = shader(gl.FRAGMENT_SHADER,fragment);
    program = gl.createProgram(); gl.attachShader(program,vertex); gl.attachShader(program,pixel); gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('program');
    gl.useProgram(program); buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    button.hidden=false;
    button.addEventListener('click',() => {wanted=!wanted;setRunning(wanted);});
    motion.addEventListener('change',preference);
    document.addEventListener('visibilitychange',visibility);
    canvas.addEventListener('webglcontextlost',event => {event.preventDefault();dispose();canvas.hidden=true;button.hidden=true;});
    window.addEventListener('pagehide',dispose,{once:true});
    setRunning(wanted);
  } catch {if(gl)dispose();canvas.hidden=true;button.hidden=true;}
})();
