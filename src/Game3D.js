import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { sfx } from './sfx.js';
import { GRID, SLOTS } from './level.js';

const FIRE_EVERY = 0.05, SHOT_TIME = 0.28, POP_TIME = 0.12;
const key = (x, y, z) => `${x},${y},${z}`;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const OFFSET = new THREE.Vector3(-GRID / 2 + 0.5, -GRID / 2 + 0.5, 0);

// Plain three.js engine; React only renders the HUD from the snapshots it emits.
export class Game {
  constructor(el, onChange) {
    this.el = el;
    this.onChange = onChange;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2b2533');
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, enablePan: false, autoRotate: true, minDistance: 15, maxDistance: 120 });
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#4a4060', 1.9));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(12, 25, 18);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#9fb8ff', 0.9); // cool back light separates the model from the background
    rim.position.set(-15, 5, -20);
    this.scene.add(rim);
    this.box = new RoundedBoxGeometry(0.96, 0.96, 0.96, 2, 0.14); // toy-brick look
    this.bit = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    this.ball = new THREE.SphereGeometry(0.32, 10, 8);
    this.fx = [];
    this.m4 = new THREE.Matrix4();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.el;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.fitted) this.fit();
  }

  fit() {
    this.fitted = true;
    this.camera.position.set(0, GRID * 0.2, (GRID * 1.6) / Math.min(1, this.camera.aspect));
    this.controls.target.set(0, 0, 0);
  }

  load(level) {
    this.level = level;
    this.restart();
    this.fit();
  }

  restart() {
    const lv = this.level;
    this.fx.forEach(f => this.scene.remove(f.m));
    this.fx = [];
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    this.colors = lv.palette.map(h => new THREE.Color(h));
    this.solid = this.colors.map(color => new THREE.MeshStandardMaterial({ color }));
    this.glow = this.colors.map(color => new THREE.MeshBasicMaterial({ color }));
    this.vox = lv.voxels.map((v, i) => ({ ...v, i, alive: true, targeted: false }));
    this.at = new Map(this.vox.map(v => [key(v.x, v.y, v.z), v]));
    this.byColor = lv.palette.map((_, c) => this.vox.filter(v => v.c === c));
    this.mesh = new THREE.InstancedMesh(this.box, new THREE.MeshStandardMaterial({ roughness: 0.55 }), this.vox.length);
    this.mesh.position.copy(OFFSET);
    const m = new THREE.Matrix4();
    this.vox.forEach(v => { this.mesh.setMatrixAt(v.i, m.makeTranslation(v.x, v.y, v.z)); this.mesh.setColorAt(v.i, this.colors[v.c]); });
    this.scene.add(this.mesh);
    this.slots = Array(SLOTS).fill(null);
    this.columns = lv.columns.map(col => col.map(s => ({ ...s, cool: 0, inflight: 0 })));
    this.remaining = this.vox.length;
    this.shots = 0;
    this.status = 'playing';
    this.emit();
  }

  pick(col) {
    if (this.status !== 'playing' || !this.columns[col]?.length) return false;
    const free = this.slots.indexOf(null);
    if (free < 0) return false;
    this.slots[free] = this.columns[col].shift();
    this.slots[free].cool = 0.15;
    this.emit();
    return true;
  }

  alive(x, y, z) { return this.at.get(key(x, y, z))?.alive; }
  exposed(v) {
    return !this.alive(v.x + 1, v.y, v.z) || !this.alive(v.x - 1, v.y, v.z) || !this.alive(v.x, v.y + 1, v.z)
      || !this.alive(v.x, v.y - 1, v.z) || !this.alive(v.x, v.y, v.z + 1) || !this.alive(v.x, v.y, v.z - 1);
  }
  targets(c) { return this.byColor[c].filter(v => v.alive && !v.targeted && this.exposed(v)); }

  fire(s, idx) {
    const t = this.targets(s.c);
    if (!t.length) return false;
    const v = t[(Math.random() * t.length) | 0];
    v.targeted = true;
    s.ammo--;
    s.inflight++;
    // shots leave from the bottom of the screen, under the slot they belong to
    const cam = this.camera.position;
    const dir = new THREE.Vector3((idx - (SLOTS - 1) / 2) * 0.3, -1.05, 0.5).unproject(this.camera).sub(cam).normalize();
    const from = dir.multiplyScalar(cam.distanceTo(this.controls.target) * 0.75).add(cam);
    const to = new THREE.Vector3(v.x, v.y, v.z).add(OFFSET);
    const m = new THREE.Mesh(this.ball, this.glow[s.c]);
    m.position.copy(from);
    this.scene.add(m);
    this.fx.push({ kind: 'shot', m, from, to, v, s, t: 0 });
    return true;
  }

  kill(v) {
    v.alive = false;
    this.remaining--;
    this.fx.push({ kind: 'pop', v, t: 0 });
    sfx.pop();
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(this.bit, this.solid[v.c]);
      m.position.set(v.x, v.y, v.z).add(OFFSET);
      this.scene.add(m);
      this.fx.push({ kind: 'bit', m, vel: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).multiplyScalar(14), life: 0.6 });
    }
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.level && this.status === 'playing') {
      let dirty = false;
      this.slots.forEach((s, i) => {
        if (!s) return;
        s.cool -= dt;
        if (s.cool <= 0 && s.ammo > 0 && this.fire(s, i)) { s.cool = FIRE_EVERY; dirty = true; }
        if (s.ammo === 0 && !s.inflight) { this.slots[i] = null; dirty = true; }
      });
      if (this.remaining === 0) { this.status = 'won'; dirty = true; sfx.win(); }
      else if (this.slots.every(s => s && s.ammo > 0) && !this.fx.some(f => f.kind === 'shot') && this.slots.every(s => !this.targets(s.c).length)) {
        this.status = 'lost'; dirty = true; sfx.lose();
      }
      if (dirty) this.emit();
    }
    this.fx = this.fx.filter(f => {
      if (f.kind === 'shot') {
        f.t += dt / SHOT_TIME;
        f.m.position.lerpVectors(f.from, f.to, Math.min(f.t, 1));
        f.m.position.y += Math.sin(Math.min(f.t, 1) * Math.PI) * 3;
        if (f.t < 1) return true;
        this.scene.remove(f.m);
        this.kill(f.v);
        f.s.inflight--;
        return false;
      }
      if (f.kind === 'pop') { // hit block swells, then disappears
        f.t += dt / POP_TIME;
        const k = f.t < 1 ? 1 + Math.sin(f.t * Math.PI) * 0.45 : 0;
        this.mesh.setMatrixAt(f.v.i, k ? this.m4.makeScale(k, k, k).setPosition(f.v.x, f.v.y, f.v.z) : ZERO);
        this.mesh.instanceMatrix.needsUpdate = true;
        return f.t < 1;
      }
      f.life -= dt;
      f.vel.y -= 35 * dt;
      f.m.position.addScaledVector(f.vel, dt);
      f.m.scale.setScalar(Math.max(f.life / 0.6, 0.01));
      if (f.life > 0) return true;
      this.scene.remove(f.m);
      return false;
    });
    this.time = (this.time || 0) + dt;
    this.controls.autoRotateSpeed = 2 * Math.cos(this.time * 0.4);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  emit() {
    this.onChange({
      palette: this.level.palette,
      slots: this.slots.map(s => s && { c: s.c, ammo: s.ammo }),
      columns: this.columns.map(col => ({ top: col.slice(0, 3).map(s => ({ c: s.c, ammo: s.ammo })), left: col.length })),
      remaining: this.remaining,
      total: this.vox.length,
      status: this.status,
    });
  }

  dispose() {
    this.ro.disconnect();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
